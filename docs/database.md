# Database — Ravocal

Drizzle ORM with PGlite (embedded Postgres, zero setup) or external Postgres via `DATABASE_URL`.

## Tables

### `users`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | default random |
| email | text UNIQUE NOT NULL | lowercased on write |
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

Never duplicate types. Always infer from Drizzle:

```typescript
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

All inferred types are exported from `db/src/schema.ts` and re-exported from `db/src/index.ts`.

## Connection

`db/src/index.ts` exports a singleton `db`. Backend is chosen at startup:

| `DATABASE_URL` value | Backend |
|---------------------|---------|
| unset | PGlite at `./pgdata` |
| path string | PGlite at that path |
| `postgres://...` | postgres-js |
| `postgresql://...` | postgres-js |

## Migrations

```bash
npm run db:generate   # after any schema.ts change
npm run db:migrate    # apply to the database
npm run db:studio     # GUI explorer
```

Migration files land in `db/drizzle/`. Commit them. The server applies migrations automatically on startup via `drizzle-orm/pglite/migrator`.

## Query Patterns

```typescript
// findFirst with relation
const group = await db.query.groups.findFirst({
  where: eq(groups.id, id),
  with: { members: { with: { user: true } } },
});

// insert + return
const [user] = await db.insert(users).values({ email }).returning();

// update
await db.update(groups).set({ name }).where(eq(groups.id, id));

// delete
await db.delete(timeBlocks).where(eq(timeBlocks.id, id));
```
