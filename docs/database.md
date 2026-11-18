# Database — Ravocal

Drizzle ORM 1.0.0-rc.5 on Postgres, through postgres-js. Postgres in development (`npm run db:up`) and production; in-memory PGlite only in tests.

## The db package (`@cubicecho/ravocal-db`)

The package exports its TypeScript sources. Nothing is compiled: Node 26 strips the types at runtime.

| Export | File | What it is |
|--------|------|------------|
| `@cubicecho/ravocal-db` | `src/index.ts` | `db` (the postgres-js client), `type DB`, `closeDatabase`, `relations`, and every model. Needs `DATABASE_URL` at import time |
| `@cubicecho/ravocal-db/schema` | `src/schema.ts` | Every table and row type, re-exported from `src/models/` |
| `@cubicecho/ravocal-db/relations` | `src/relations.ts` | `relations`, built with `defineRelations` |
| `@cubicecho/ravocal-db/wait` | `src/wait.ts` | `waitForDatabase(db, overrides?, log?)` |
| `@cubicecho/ravocal-db/defaults` | `src/defaults.ts` | `DATABASE_DEFAULTS` and `DatabaseSettings` |

```
db/
├── drizzle.config.ts     # reads ../.env for DATABASE_URL
├── drizzle/              # generated migrations, committed
└── src/
    ├── index.ts          # client, DB, closeDatabase
    ├── schema.ts         # export * from each model
    ├── relations.ts      # defineRelations
    ├── defaults.ts       # DATABASE_DEFAULTS
    ├── wait.ts           # waitForDatabase
    ├── ssl.ts            # requiresSsl
    └── models/           # one table per file: users.ts, magic-links.ts, groups.ts, group-members.ts,
                          # group-invites.ts, time-blocks.ts, votes.ts, vote-slots.ts, vote-rankings.ts
```

Server modules import tables and row types from `/schema`, never the package root: the root opens a client and throws when `DATABASE_URL` is unset, which is what tests rely on. `server/src/index.ts` is the one importer of the root's values; `import type { DB }` from the root is erased at runtime and fine anywhere.

Constraint names are explicit: `uq_<table>_<cols>` for unique indexes and `idx_<table>_<cols>` for indexes. Every foreign key is indexed (directly, or as the leading column of a unique index).

## Tables

### `users`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | default random |
| email | text NOT NULL | lowercased on write; unique (`uq_users_email`) |
| name | text | nullable, set after first login |
| created_at | timestamptz NOT NULL | auto |

### `magic_links`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid FK → users | cascade delete |
| token | text UNIQUE NOT NULL | 32-byte hex |
| expires_at | timestamptz NOT NULL | 15 min from creation |
| used_at | timestamptz | null until redeemed |
| created_at | timestamptz NOT NULL | auto |

### `groups`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text NOT NULL | |
| owner_id | uuid FK → users | cascade delete |
| overlap_threshold | integer NOT NULL DEFAULT 50 | 0–100, percent |
| created_at | timestamptz NOT NULL | auto |

### `group_members`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| group_id | uuid FK → groups | cascade delete |
| user_id | uuid FK → users | cascade delete |
| joined_at | timestamptz NOT NULL | auto |
| — | UNIQUE(group_id, user_id) | |

### `group_invites`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| group_id | uuid FK → groups | cascade delete |
| email | text NOT NULL | |
| token | text UNIQUE NOT NULL | 32-byte hex |
| expires_at | timestamptz NOT NULL | 7 days |
| accepted_at | timestamptz | null until accepted |
| created_at | timestamptz NOT NULL | auto |

### `time_blocks`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| group_id | uuid FK → groups | cascade delete |
| user_id | uuid FK → users | cascade delete |
| starts_at | timestamptz NOT NULL | must be :00 or :30 |
| ends_at | timestamptz NOT NULL | must be :00 or :30 |
| created_at | timestamptz NOT NULL | auto |

Validation: `starts_at` and `ends_at` must be 30-min aligned; `ends_at - starts_at >= 30 min`. Enforced in the Zod validator in `server/src/schema/resolvers/time-blocks.ts`.

### `votes`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| group_id | uuid FK → groups | cascade delete |
| status | text NOT NULL DEFAULT 'active' | enum: active \| closed |
| is_forced | boolean NOT NULL DEFAULT false | |
| winner_slot_id | uuid nullable | set on closeVote |
| closed_at | timestamptz | null until closed |
| created_at | timestamptz NOT NULL | auto |

### `vote_slots`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| vote_id | uuid FK → votes | cascade delete |
| starts_at | timestamptz NOT NULL | |
| ends_at | timestamptz NOT NULL | 30 min after starts_at |
| overlap_count | integer NOT NULL DEFAULT 0 | members free during this slot |

### `vote_rankings`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| vote_id | uuid FK → votes | cascade delete |
| user_id | uuid FK → users | cascade delete |
| slot_id | uuid FK → vote_slots | cascade delete |
| rank | integer NOT NULL | 1 = top choice |
| created_at | timestamptz NOT NULL | auto |
| — | UNIQUE(vote_id, user_id, slot_id) | |

## Type Inference

Never duplicate types. Always infer from Drizzle, next to the table in its model file:

```typescript
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

`schema.ts` re-exports them, and the package root re-exports `schema.ts`. `DB` is `typeof db`: fully typed from the relations, with no `any`.

## Relations

`src/relations.ts` defines every relation with `defineRelations` (relational queries v2). A `one` side whose foreign key is `NOT NULL` is `optional: false`, so a loaded parent is typed as present (`link.user.id`, not `link.user?.id`).

## Connection

`src/index.ts` builds one postgres-js client from `DATABASE_URL`, and throws at import when it is unset. postgres-js doesn't connect until the first query.

- **TLS:** in production, `ssl: 'require'` is forced only when `requiresSsl(url)` says so: not for an explicit `sslmode`, and not for localhost, a dotless host (a compose service), a private address or a private suffix (`.lan`, `.local`, `.internal`, `.home.arpa`).
- **Boot:** the server calls `waitForDatabase(db)`, which retries `select 1` on transient errors (`ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND`, `EAI_AGAIN`, `ETIMEDOUT`, `57P03`) with backoff from `firstRetryDelayMs`, growing by `retryBackoffFactor` up to `maxRetryDelayMs`, for `connectTimeoutMs` in all (`DB_CONNECT_TIMEOUT_MS` overrides it). Bad credentials or a missing database fail at once.
- **Shutdown:** `closeDatabase()` ends the pool, giving running queries `closeTimeoutSeconds`.

## Migrations

```bash
npm run db:generate   # after any model change; review and commit db/drizzle
npm run db:migrate    # apply to the database in DATABASE_URL
npm run db:studio     # GUI explorer
```

Each migration is a folder under `db/drizzle/` (`<timestamp>_<name>/migration.sql` plus `snapshot.json`). Commit them, and never edit one that has been applied: generate a new one. The server applies pending migrations on boot with `drizzle-orm/postgres-js/migrator`. `db:push` is for throwaway experiments only.

The history was restarted at `20261118021722_baseline` (Phase 1 of the cubicecho move). There was no live data to preserve.

## Tests

Tests never touch a real Postgres. `server/src/__tests__/global-setup.ts` diffs the models once per run with drizzle-kit's `pushSchema` and provides the DDL; each test file boots one in-memory PGlite with `createTestDb()` (`helpers.ts`), empties it with `resetTestDb` between tests and closes it with `closeTestDb`.

## Query Patterns

```typescript
// findFirst with relations (RQB v2: object `where`)
const group = await db.query.groups.findFirst({
  where: { id },
  with: { members: { with: { user: true } } },
});

// several conditions are ANDed
const membership = await db.query.groupMembers.findFirst({ where: { groupId, userId } });

// insert + return
const [user] = await db.insert(users).values({ email }).returning();

// update and delete use the core builder with eq/and from drizzle-orm
await db.update(groups).set({ name }).where(eq(groups.id, id));
await db.delete(timeBlocks).where(eq(timeBlocks.id, id));
```
