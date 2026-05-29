# AGENTS.md — Ravocal

## Project Overview

Ravocal is a group scheduling and ranked-choice voting app. Users create groups, invite members via email, and each member marks blocks of time they are free. The group owner starts a ranked-choice vote over overlapping free slots; members vote, and the winning slot is displayed in-app. If no slots meet the group's overlap threshold, the owner can force a vote that prioritizes their own availability while maximizing overlap for the group.

Monorepo: npm workspaces with three packages: `app/` (frontend), `server/` (GraphQL API), and `db/` (database schema and connection).

## Tech Stack

| Layer    | Technology                                        |
| -------- | ------------------------------------------------- |
| Frontend | React 19, Vite, TanStack Router, Apollo Client    |
| UI       | Tailwind CSS, shadcn/ui components, Radix UI      |
| API      | Apollo Server, GraphQL                             |
| Database | Drizzle ORM, PGlite (embedded Postgres)            |
| Auth     | Magic-link email + JWT (jose)                      |
| Testing  | Vitest                                             |
| Linting  | Biome (formatter + linter)                         |
| Runtime  | Node.js 22+, ESM (`"type": "module"` throughout)  |

## Domain Model

### Entities

- **User** — identified by email; signs in via magic link. No passwords.
- **Group** — has one owner (creator), a name, and a configurable overlap threshold (0–100%). Owner is the only one who can start/force votes and manage membership.
- **GroupMember** — join table linking users to groups.
- **GroupInvite** — pending email invitation (tokenized); converts to GroupMember on acceptance.
- **TimeBlock** — a contiguous free-time window (30-min aligned start/end) that a group member submits to the group's shared calendar.
- **Vote** — created by the group owner. Status: `pending → active → closed`. Can be `isForced = true` if the owner bypassed the overlap threshold.
- **VoteSlot** — a candidate time slot attached to a vote (derived from overlapping TimeBlocks, or forced from owner's blocks).
- **VoteRanking** — a member's ranked-choice ranking of VoteSlots (rank 1 = top choice).

### Overlap threshold

Each group stores an `overlapThreshold` (integer 0–100, default 50). A normal vote is only allowed when at least that percentage of members have marked a common slot as free. Below the threshold the owner can start a forced vote; in forced mode, slots are ranked by: (1) owner is free, (2) most members free.

### Email notifications

Three events trigger email: group invite, vote started, vote result announced.

## Project Structure

```
ravocal/
├── app/                     # Frontend (Vite + React)
│   ├── src/
│   │   ├── __generated__/   # Auto-generated GraphQL types (do not edit)
│   │   ├── components/
│   │   │   ├── ui/          # shadcn/ui primitives
│   │   │   ├── domain/      # Feature components (group/, vote/, calendar/)
│   │   │   └── layouts/     # Structural wrappers
│   │   ├── lib/             # Utilities (cn(), date helpers)
│   │   └── routes/          # TanStack Router file-based routes
│   ├── index.html
│   ├── vite.config.ts
│   └── tailwind.config.ts
├── server/                  # GraphQL API (Apollo Server, port 3001)
│   └── src/
│       ├── index.ts         # Server entry point
│       ├── schema/
│       │   ├── index.ts     # buildSchema + applyCustomResolvers
│       │   └── resolvers/   # One file per domain (auth, groups, votes, etc.)
│       ├── services/
│       │   ├── email.ts     # Email sending (invite, vote-start, vote-result)
│       │   └── voting.ts    # Ranked-choice tallying, overlap computation
│       └── __tests__/
├── db/                      # Drizzle ORM + PGlite
│   └── src/
│       ├── schema.ts        # Table definitions
│       ├── relations.ts     # Drizzle relations
│       └── index.ts         # DB singleton + re-exports
├── docs/                    # Technical docs for agents
│   ├── database.md
│   ├── server.md
│   ├── graphql.md
│   ├── frontend.md
│   └── voting.md            # Overlap algorithm + ranked-choice tallying
├── vitest.config.ts
├── biome.json
└── package.json
```

## Build / Dev / Lint / Test Commands

All commands run from the **project root**.

### Development
```bash
npm run dev              # Start server + app concurrently
npm run dev:app          # Vite dev server only (port 3000)
npm run dev:server       # Apollo Server only (port 3001, watch mode)
```

### Building
```bash
npm run build            # Build all workspaces (db → server → app)
npm run build:app        # Frontend only
npm run build:server     # Server only
```

### GraphQL Codegen
```bash
npm run codegen          # Generate types for app and server
npm run codegen:app      # Client-side types (app/src/__generated__/)
npm run codegen:server   # Server resolver types (server/src/__generated__/)
```

> Run `npm run codegen` after any Drizzle schema change or after adding/changing GraphQL documents in `app/src/`.

### Testing
```bash
npm test                 # Run all tests once
npm run test:watch       # Watch mode
```

### Linting & Formatting (Biome)
```bash
npm run check            # codegen + check:biome + check:types
npm run check:biome      # Biome linter + formatter check
npm run check:fix        # Auto-fix
npm run lint             # Linter only
npm run format           # Format all files
npm run check:types      # tsc --noEmit across all packages
```

### Database
```bash
npm run db:generate      # Generate Drizzle migration files
npm run db:migrate       # Run pending migrations
npm run db:push          # Push schema directly (dev only)
npm run db:studio        # Drizzle Studio GUI
```

## Code Style Guidelines

### Formatting (Biome)
- **Semicolons**: always
- **Quotes**: double quotes
- **Indentation**: 2 spaces
- **Trailing commas**: all
- **Line width**: 80 characters
- **Arrow parens**: always

### Imports
- `type` imports for type-only symbols (enforced by Biome `style/useImportType`)
- `@/` path alias within `app/` (maps to `app/src/`)
- `@ravocal/db` package name when importing db in server
- `.js` extensions in server/db imports (ESM requirement)

### TypeScript
- Strict mode everywhere — no implicit `any`
- Prefix unused params with `_`
- `interface` for object shapes, `type` for unions/utilities
- Infer types from Drizzle (`$inferSelect` / `$inferInsert`) — never duplicate manually

### Naming
- **Files**: `kebab-case.ts` / `kebab-case.tsx`
- **Components**: `PascalCase`
- **Variables/functions**: `camelCase`
- **Types/Interfaces**: `PascalCase`
- **DB columns**: `snake_case` in SQL, `camelCase` in Drizzle (mapped automatically)
- **GraphQL**: `camelCase` fields, `PascalCase` types, `PascalCase` + `Input` suffix for inputs

### Auth / Guard clause order
```typescript
if (!context.userId) throw new Error("Not authenticated");
const group = await context.db.query.groups.findFirst({ where: eq(groups.id, args.id) });
if (!group) throw new Error(`Group ${args.id} not found`);
if (group.ownerId !== context.userId) throw new Error("Forbidden");
```

### Error handling
- Never swallow errors silently
- Always surface errors to the user or log them

### Testing
- Test files in `__tests__/` or as `*.test.ts`
- Use in-memory PGlite for database tests
- `describe` / `it` / `expect` from Vitest (globals enabled)
- Fresh test context in `beforeEach`

## Git

Use merge instead of rebase:
```bash
git pull --no-rebase
```

Do not add `Co-Authored-By` trailers to commit messages.

## Documentation Reference

| Topic | Document |
| ----- | -------- |
| Database tables, migrations, Drizzle patterns | [`docs/database.md`](docs/database.md) |
| Apollo Server, schema, resolvers | [`docs/server.md`](docs/server.md) |
| GraphQL queries, mutations, types | [`docs/graphql.md`](docs/graphql.md) |
| React app, routing, Apollo Client | [`docs/frontend.md`](docs/frontend.md) |
| Overlap algorithm, ranked-choice tallying | [`docs/voting.md`](docs/voting.md) |
