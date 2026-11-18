// Proves on a real Postgres that a migration which rewrites rows rewrites them right. It applies db/drizzle up to just
// before the migration, writes the rows the migration changes, applies the rest, and checks what came out. The tests
// can't: they build their database from the models, so no migration ever runs on rows there.
//
// Needs an empty database in DATABASE_URL. CI's postgres job runs it (`npm run check:data-migrations -w db`).
import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');
/** It numbers each vote's slots in the order they were written, and closes all but each group's newest open vote. */
const SLOT_POSITIONS = '_vote_slot_positions';
/** It adds `users.is_admin`, and makes the oldest account the admin when an instance already has accounts. */
const OIDC_PAIRING = '_oidc_pairing';

/** Slots in ballot order, which isn't time order, so a position can only have come from the order they were written. */
const NEWER_SLOTS = ['2026-12-03T18:00:00.000Z', '2026-12-01T18:00:00.000Z', '2026-12-02T18:00:00.000Z'];
const OLDER_SLOTS = ['2026-11-30T09:00:00.000Z', '2026-11-29T09:00:00.000Z'];

interface Row {
  id: string;
}

const url = process.env.DATABASE_URL ?? '';
if (url === '') {
  throw new Error('DATABASE_URL is not set. Point it at an empty Postgres database.');
}

// Two connections: drizzle replaces its client's date parsers, and the checks below read dates as Dates.
const client = postgres(url, { onnotice: () => {} });
const db = drizzle({ connection: { url, onnotice: () => {} } });
const beforeDir = await mkdtemp(join(tmpdir(), 'ravocal-migrations-'));

/**
 * Applies the migrations up to `name` (not including it).
 *
 * @param names - Every migration folder, in the order they apply.
 * @param name - The first migration not to apply.
 */
async function migrateUpTo(names: string[], name: string): Promise<void> {
  const index = names.findIndex((each) => each.endsWith(name));
  assert.ok(index > 0, `no migration ending in ${name}, or nothing before it`);
  for (const each of names.slice(0, index)) {
    await cp(join(MIGRATIONS, each), join(beforeDir, each), { recursive: true });
  }
  await migrate(db, { migrationsFolder: beforeDir });
}

/**
 * Reads a vote's slots in ballot order.
 *
 * @param voteId - The vote.
 * @returns Each slot's start and position.
 */
async function slotsOf(voteId: string): Promise<{ startsAt: string; position: number }[]> {
  const rows = await client<{ startsAt: Date; position: number }[]>`
    SELECT starts_at AS "startsAt", position FROM vote_slots WHERE vote_id = ${voteId} ORDER BY position`;
  return rows.map((row) => ({ startsAt: row.startsAt.toISOString(), position: row.position }));
}

/**
 * Reads a vote's status and when it closed.
 *
 * @param voteId - The vote.
 * @returns Its status, and its closed_at as an ISO string or null.
 */
async function voteOf(voteId: string): Promise<{ status: string; closedAt: string | null }> {
  const [row] = await client<{ status: string; closedAt: Date | null }[]>`
    SELECT status, closed_at AS "closedAt" FROM votes WHERE id = ${voteId}`;
  return { status: row.status, closedAt: row.closedAt?.toISOString() ?? null };
}

/**
 * Reads which accounts are admins.
 *
 * @returns Their ids.
 */
async function adminIds(): Promise<string[]> {
  const rows = await client<Row[]>`SELECT id FROM users WHERE is_admin`;
  return rows.map((row) => row.id);
}

try {
  const [{ exists }] = await client<{ exists: boolean }[]>`SELECT to_regclass('public.users') IS NOT NULL AS exists`;
  assert.equal(exists, false, 'the database is not empty: run this against a fresh one');

  const names = (await readdir(MIGRATIONS)).sort();
  await migrateUpTo(names, SLOT_POSITIONS);

  const [owner] = await client<Row[]>`
    INSERT INTO users (email, name) VALUES ('owner@example.com', 'Owner') RETURNING id`;
  const [busy] = await client<Row[]>`
    INSERT INTO groups (name, owner_id) VALUES ('Two open votes', ${owner.id}) RETURNING id`;
  const [quiet] = await client<Row[]>`
    INSERT INTO groups (name, owner_id) VALUES ('One open vote', ${owner.id}) RETURNING id`;
  const [older] = await client<Row[]>`
    INSERT INTO votes (group_id, status, created_at) VALUES (${busy.id}, 'active', now() - interval '1 day')
    RETURNING id`;
  const [newer] = await client<Row[]>`
    INSERT INTO votes (group_id, status) VALUES (${busy.id}, 'active') RETURNING id`;
  const [only] = await client<Row[]>`
    INSERT INTO votes (group_id, status, created_at) VALUES (${quiet.id}, 'active', now() - interval '1 week')
    RETURNING id`;
  const [done] = await client<Row[]>`
    INSERT INTO votes (group_id, status, created_at, closed_at)
    VALUES (${busy.id}, 'closed', now() - interval '3 days', now() - interval '2 days') RETURNING id`;
  const doneBefore = await voteOf(done.id);

  // Interleaved, so the numbering has to keep each vote's slots apart.
  const writes = NEWER_SLOTS.flatMap((startsAt, index) => {
    const olderSlot = OLDER_SLOTS[index];
    const each = [{ voteId: newer.id, startsAt }];
    return olderSlot === undefined ? each : [...each, { voteId: older.id, startsAt: olderSlot }];
  });
  for (const slot of writes) {
    await client`
      INSERT INTO vote_slots (vote_id, starts_at, ends_at)
      VALUES (${slot.voteId}, ${slot.startsAt}, ${slot.startsAt}::timestamptz + interval '30 minutes')`;
  }

  await migrateUpTo(names, OIDC_PAIRING);
  // Made after the owner but dated before them, so only created_at can say it is the oldest.
  const [oldest] = await client<Row[]>`
    INSERT INTO users (email, name, created_at) VALUES ('first@example.com', 'First', now() - interval '1 year')
    RETURNING id`;

  await migrate(db, { migrationsFolder: MIGRATIONS });

  const inOrder = (starts: string[]) => starts.map((startsAt, position) => ({ startsAt, position }));
  assert.deepEqual(await slotsOf(newer.id), inOrder(NEWER_SLOTS), "the newer vote's slot positions");
  assert.deepEqual(await slotsOf(older.id), inOrder(OLDER_SLOTS), "the older vote's slot positions");

  const olderAfter = await voteOf(older.id);
  assert.equal(olderAfter.status, 'closed', "the group's older open vote is closed");
  assert.notEqual(olderAfter.closedAt, null, 'and has a closed_at');
  assert.deepEqual(await voteOf(newer.id), { status: 'active', closedAt: null }, "the group's newest stays open");
  assert.deepEqual(await voteOf(only.id), { status: 'active', closedAt: null }, "another group's only vote stays open");
  assert.deepEqual(await voteOf(done.id), doneBefore, 'a vote already closed is untouched');

  console.log('[db] vote_slot_positions: positions follow the order slots were written; one open vote per group');

  assert.deepEqual(await adminIds(), [oldest.id], 'the oldest account, and only it, is the admin');
  console.log('[db] oidc_pairing: the oldest account is the admin');
} finally {
  await client.end();
  await db.$client.end();
  await rm(beforeDir, { recursive: true, force: true });
}
