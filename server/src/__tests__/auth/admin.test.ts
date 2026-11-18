import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { users } from '@cubicecho/ravocal-db/schema';
import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimFirstAdmin, hasUsers, isAdmin } from '../../auth/admin.ts';
import { createAuthHost } from '../../auth/auth-host.ts';
import {
  closeTestDb,
  createClient,
  createTestDb,
  createUser,
  resetTestDb,
  TEST_SECRET,
  type TestDb,
} from '../helpers.ts';

// Who runs the instance: the first account better-auth creates, whichever way it signed in, and only that one; and,
// on an instance that had accounts before there was an admin, the oldest (the oidc_pairing migration).

const MIGRATIONS = fileURLToPath(new URL('../../../../db/drizzle', import.meta.url));
/** The migration that adds `users.is_admin`. */
const OIDC_PAIRING = '_oidc_pairing';
const SIGN_IN = 'mutation ($email: String!) { signInMagicLink(email: $email) { userId } }';

/**
 * Reads the admins.
 *
 * @param db - The database.
 * @returns Their ids.
 */
async function adminIds(db: TestDb): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.isAdmin, true));
  return rows.map((row: { id: string }) => row.id);
}

describe('the first account', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(() => closeTestDb(db));

  beforeEach(async () => {
    await resetTestDb(db);
    vi.unstubAllEnvs();
  });

  /**
   * Signs an address up as a reader would, through better-auth, with SECURE_LOCAL_NET so no link is needed.
   *
   * @param email - The address.
   * @returns The new account's id.
   */
  async function signUp(email: string): Promise<string> {
    vi.stubEnv('SECURE_LOCAL_NET', 'true');
    const authHost = await createAuthHost(db, { secret: TEST_SECRET });
    const { signInMagicLink } = await createClient(db, null, { authHost }).expectOk(SIGN_IN, { email });
    return signInMagicLink.userId;
  }

  it('becomes the admin, and no account after it does', async () => {
    expect(await hasUsers(db)).toBe(false);
    const first = await signUp('first@example.com');
    const second = await signUp('second@example.com');
    expect(await hasUsers(db)).toBe(true);
    expect(await isAdmin(db, first)).toBe(true);
    expect(await isAdmin(db, second)).toBe(false);
  });

  it('is one account even when two sign up at once', async () => {
    await Promise.all(['first@example.com', 'second@example.com', 'third@example.com'].map(signUp));
    expect(await adminIds(db)).toHaveLength(1);
  });

  it('is one account when two claim at the same moment', async () => {
    const [a, b] = await Promise.all([createUser(db, 'a@example.com'), createUser(db, 'b@example.com')]);
    await Promise.all([claimFirstAdmin(db, a), claimFirstAdmin(db, b)]);
    expect(await adminIds(db)).toHaveLength(1);
  });

  it('cannot be joined by a second admin, whatever writes it', async () => {
    const [a, b] = await Promise.all([createUser(db, 'a@example.com'), createUser(db, 'b@example.com')]);
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, a));
    await expect(db.update(users).set({ isAdmin: true }).where(eq(users.id, b))).rejects.toThrow();
    expect(await adminIds(db)).toEqual([a]);
  });

  it('is not anyone for a user that does not exist', async () => {
    expect(await isAdmin(db, '00000000-0000-4000-8000-000000000000')).toBe(false);
  });
});

describe('the oidc_pairing migration', () => {
  let client: PGlite;
  let before: string;

  beforeEach(async () => {
    client = new PGlite('memory://');
    before = await mkdtemp(join(tmpdir(), 'ravocal-migrations-'));
    const names = (await readdir(MIGRATIONS)).sort();
    const index = names.findIndex((name) => name.endsWith(OIDC_PAIRING));
    expect(index).toBeGreaterThan(0);
    for (const name of names.slice(0, index)) {
      await cp(join(MIGRATIONS, name), join(before, name), { recursive: true });
    }
  });

  afterEach(async () => {
    await client.close();
    await rm(before, { recursive: true, force: true });
  });

  it('makes the oldest account the admin on an instance that already has accounts', async () => {
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: before });
    // Written first but dated later, so only created_at can say which is the oldest.
    await db.execute(sql`INSERT INTO users (email, name) VALUES ('newer@example.com', 'Newer')`);
    await db.execute(
      sql`INSERT INTO users (email, name, created_at) VALUES ('oldest@example.com', 'Oldest', now() - interval '1 year')`,
    );

    await migrate(db, { migrationsFolder: MIGRATIONS });
    const { rows } = await client.query<{ email: string }>('SELECT email FROM users WHERE is_admin');
    expect(rows).toEqual([{ email: 'oldest@example.com' }]);
  });

  it('makes nobody the admin on an instance with no accounts, so the first sign-up can be', async () => {
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    await db.execute(sql`INSERT INTO users (email, name) VALUES ('first@example.com', 'First')`);
    const { rows } = await client.query('SELECT email FROM users WHERE is_admin');
    expect(rows).toEqual([]);
  });
});
