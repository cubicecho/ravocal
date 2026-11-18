import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { version } from '../../core/config.ts';
import { OPERATION_LIMIT_DEFAULTS } from '../../core/defaults.ts';
import { ErrorCode, errorMessage } from '../../core/errors.ts';
import { HttpStatus } from '../../core/wire.ts';
import { createApp } from '../../http/app.ts';
import { signSessionToken } from '../../services/auth.ts';
import { closeTestDb, createTestDb, createUser, portOf, resetTestDb, type TestDb } from '../helpers.ts';

const { maxDepth, maxAliases, maxCost } = OPERATION_LIMIT_DEFAULTS;
/** Past `HTTP_DEFAULTS.bodyLimit`, which is 1 MB. */
const OVERSIZED_PADDING_BYTES = 1_100_000;
/** What Yoga answers in place of an error it masks. */
const MASKED_MESSAGE = 'Unexpected error.';
/** The code Yoga gives a masked error. */
const INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR';
/** A line only the test's index.html holds, so a response can be told to be that file. */
const INDEX_MARKER = '<title>ravocal test shell</title>';
/** An origin the app is never served from. */
const FOREIGN_ORIGIN = 'https://elsewhere.example';

/**
 * Starts an app on a free port.
 *
 * @param app - The Express app.
 * @returns The server and its base URL.
 */
async function listen(app: Express): Promise<{ server: Server; base: string }> {
  const server = app.listen(0);
  await once(server, 'listening');
  return { server, base: `http://127.0.0.1:${portOf(server)}` };
}

/**
 * Stops a test server.
 *
 * @param server - The server to close.
 * @returns Resolves once it is closed.
 */
function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Builds a selection that is `levels` inline fragments deep. Each one is a level to the depth rule.
 *
 * @param levels - How many fragments to nest.
 * @returns The selection, ending in `id`.
 */
function nestedFragments(levels: number): string {
  return levels === 0 ? 'id' : `... on User { ${nestedFragments(levels - 1)} }`;
}

/**
 * Builds a query priced at `1 + spreads * fields`: `me`, holding a fragment of `fields` ids spread `spreads` times.
 *
 * @param spreads - How many times the fragment is spread.
 * @param fields - How many `id`s the fragment selects.
 * @returns The query.
 */
function pricedQuery(spreads: number, fields: number): string {
  return `{ me { ${'...Ids '.repeat(spreads)}} } fragment Ids on User { ${'id '.repeat(fields)}}`;
}

describe('app over HTTP', () => {
  let db: TestDb;
  let staticDir: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    db = await createTestDb();
    staticDir = await mkdtemp(join(tmpdir(), 'ravocal-'));
    await writeFile(join(staticDir, 'index.html'), `<!doctype html>${INDEX_MARKER}`);
    ({ server, base } = await listen(createApp({ db, staticDir })));
  });

  afterAll(async () => {
    await close(server);
    await closeTestDb(db);
    await rm(staticDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetTestDb(db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  /** Posts a query and returns the parsed response body. */
  const query = async (source: string, headers?: Record<string, string>) =>
    (await post({ query: source }, headers)).json();

  describe('/healthz', () => {
    it('reports healthy with a live database', async () => {
      const response = await fetch(`${base}/healthz`);
      expect(response.status).toBe(HttpStatus.Ok);
      expect(await response.json()).toEqual({ ok: true, version: version() });
    });

    it('answers 503 when the database is closed', async () => {
      const closedDb = await createTestDb();
      await closeTestDb(closedDb);
      const closed = await listen(createApp({ db: closedDb }));
      try {
        const response = await fetch(`${closed.base}/healthz`);
        expect(response.status).toBe(HttpStatus.ServiceUnavailable);
        expect(await response.json()).toMatchObject({ ok: false, version: version(), error: expect.any(String) });
      } finally {
        await close(closed.server);
      }
    });
  });

  it('rejects a body over the body limit with 413', async () => {
    const response = await post({ query: '{ __typename }', variables: { pad: 'x'.repeat(OVERSIZED_PADDING_BYTES) } });
    expect(response.status).toBe(HttpStatus.PayloadTooLarge);
  });

  describe('operation limits', () => {
    // Unauthenticated on purpose: every bound runs before any resolver, so it refuses a caller who couldn't
    // read the data anyway.
    it('accepts a query exactly maxDepth deep', async () => {
      // `me` and `id` are a level each, so maxDepth - 2 fragments between them make maxDepth.
      const body = await query(`{ me { ${nestedFragments(maxDepth - 2)} } }`);
      expect(body).toEqual({ data: { me: null } });
    });

    it('refuses a query one level deeper than maxDepth', async () => {
      const body = await query(`{ me { ${nestedFragments(maxDepth - 1)} } }`);
      expect(body.errors[0].extensions.code).toBe(ErrorCode.QueryTooComplex);
      expect(body.data).toBeUndefined();
    });

    it('accepts maxAliases aliases', async () => {
      const aliases = Array.from({ length: maxAliases }, (_, index) => `a${index}: me { id }`);
      const body = await query(`{ ${aliases.join(' ')} }`);
      expect(body.errors).toBeUndefined();
    });

    it('refuses one alias more than maxAliases', async () => {
      const aliases = Array.from({ length: maxAliases + 1 }, (_, index) => `a${index}: me { id }`);
      const body = await query(`{ ${aliases.join(' ')} }`);
      expect(body.errors[0].extensions.code).toBe(ErrorCode.QueryTooComplex);
      expect(body.data).toBeUndefined();
    });

    // Nothing in the hand-written schema carries a cost hint, so every field costs defaultFieldCost (1), and
    // `me` with `spreads` copies of a fragment holding `fields` ids costs 1 + spreads * fields. Spreads, not
    // ten thousand ids in a row: graphql-js compares repeated fields pairwise, which takes seconds at that size.
    it('accepts a query that costs exactly maxCost', async () => {
      const body = await query(pricedQuery(99, 101));
      expect(body).toEqual({ data: { me: null } });
    });

    it('refuses a query that costs one more than maxCost', async () => {
      const body = await query(pricedQuery(100, 100));
      expect(body.errors[0].extensions.code).toBe(ErrorCode.QueryTooComplex);
      expect(body.errors[0].message).toContain(`Query cost ${maxCost + 1} exceeds ${maxCost}`);
      expect(body.data).toBeUndefined();
    });
  });

  describe('errors', () => {
    it('passes a coded error through with its code and message', async () => {
      const body = await query('{ myGroups { id } }');
      expect(body.errors[0]).toMatchObject({
        message: 'Not authenticated',
        extensions: { code: ErrorCode.Unauthenticated },
      });
    });

    it('masks an unexpected error, and logs its cause with the [graphql] tag', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const userId = await createUser(db, 'alice@example.com');
      const token = await signSessionToken({ id: userId, email: 'alice@example.com' });
      // Postgres refuses an id that is not a uuid, which no resolver expects.
      const body = await query('{ group(id: "not-a-uuid") { id } }', { authorization: `Bearer ${token}` });
      expect(body.errors[0]).toMatchObject({ message: MASKED_MESSAGE, extensions: { code: INTERNAL_SERVER_ERROR } });
      const [[tag, path, cause] = []] = logged.mock.calls;
      expect(tag).toBe('[graphql]');
      expect(path).toBe('group');
      // Drizzle's own message is the SQL; Postgres's reason is on its cause.
      expect(errorMessage(cause)).toMatch(/invalid input syntax for type uuid/);
    });
  });

  describe('the SPA', () => {
    it('serves index.html for a deep link', async () => {
      const response = await fetch(`${base}/groups/some-group-id`, { headers: { accept: 'text/html' } });
      expect(response.status).toBe(HttpStatus.Ok);
      expect(response.headers.get('content-type')).toMatch(/text\/html/);
      expect(await response.text()).toContain(INDEX_MARKER);
    });

    it('leaves /healthz to the health check', async () => {
      const response = await fetch(`${base}/healthz`, { headers: { accept: 'text/html' } });
      expect(response.headers.get('content-type')).toMatch(/application\/json/);
    });
  });

  describe('CORS', () => {
    it('sends no CORS headers to a cross-origin preflight', async () => {
      const response = await fetch(`${base}/graphql`, {
        method: 'OPTIONS',
        headers: {
          origin: FOREIGN_ORIGIN,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type, authorization',
        },
      });
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(response.headers.get('access-control-allow-headers')).toBeNull();
    });

    it('sends no CORS headers on a cross-origin request', async () => {
      const response = await post({ query: '{ me { id } }' }, { origin: FOREIGN_ORIGIN });
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    });
  });
});
