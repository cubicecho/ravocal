# Server — Ravocal

Express + Apollo Server 4, running TypeScript directly (Node 26 strips types without a flag). There is no build step: the container runs `node server/src/index.ts` too.

## Entry Point

`server/src/index.ts`:
1. Waits for Postgres (`waitForDatabase` from `@cubicecho/ravocal-db/wait`), exiting with a sentence if it never answers
2. Runs the migrations in `db/drizzle`
3. Calls `buildSchema()` to assemble the GraphQL schema
4. Starts Apollo Server, mounts at `/graphql`
5. Serves the built Vite app from `app/dist/` for all other routes
6. On SIGTERM or SIGINT: stops taking requests, stops Apollo, closes the database (`closeDatabase`) and exits

## Schema Pipeline

`server/src/schema/index.ts` exports `buildSchema()`:

1. Reads `server/src/schema.graphql` (the SDL — manually maintained)
2. Calls each `apply*Resolvers(queryFields, mutationFields)` function
3. Passes resolvers + SDL to `makeExecutableSchema` from `@graphql-tools/schema`
4. Adds `DateTime` scalar from `graphql-scalars`

Adding a new domain:
1. Add SDL types/queries/mutations to `schema.graphql`
2. Create `server/src/schema/resolvers/my-domain.ts` with `applyMyDomainResolvers`
3. Call it in `schema/index.ts`

## Context

`server/src/context.ts` exports `Context`:

```typescript
type Context = {
  userId: string | null;
  db: DB;
};
```

Auth: Bearer JWT → `jwtVerify` (jose). Invalid/missing token → `userId: null`. JWTs expire in 30 days.

## Resolver Authoring

Guard clause order — always auth → existence → ownership:

```typescript
if (!ctx.userId) throw new Error("Not authenticated");
const group = await ctx.db.query.groups.findFirst({ where: { id: args.id } });
if (!group) throw new Error(`Group ${args.id} not found`);
if (group.ownerId !== ctx.userId) throw new Error("Forbidden");
```

Validate input with Zod at the resolver boundary:

```typescript
const input = CreateGroupInput.parse(args);
```

## Auth Flow

1. Client calls `requestMagicLink(email)` — creates a token, sends email, returns `true`
2. User clicks email link → `/login/verify?token=...`
3. Client calls `verifyMagicLink(token)` — validates token, marks used, returns JWT + user
4. Client stores JWT in `localStorage.ravocal_token`
5. Apollo Client sends `Authorization: Bearer <jwt>` on all subsequent requests

Magic link tokens expire in 15 minutes and are single-use. Invite tokens expire in 7 days.

## Email Service

`server/src/services/email.ts` uses nodemailer. In development (no `SMTP_HOST`), emails are logged to the console instead of sent.

Configure via env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`.

## Public Mutations

`requestMagicLink`, `verifyMagicLink`, and `acceptGroupInvite` do not require auth (userId may be null). All other resolvers must check `ctx.userId`.

## Running the Server

```bash
npm run dev:server    # hot-reload via --watch
npm run dev           # server + app concurrently
```

Server listens on `PORT` env (default 3001). GraphQL playground available at `http://localhost:3001/graphql` in development.
