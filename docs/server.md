# Server — Ravocal

graphql-yoga 5 on Express 5, running TypeScript directly (Node 26 strips types without a flag). There is no build step: the container runs `node server/src/index.ts` too.

## Folders

| Folder | Holds |
| ------ | ----- |
| `core/` | What every folder reads, about no one concept: config, defaults, wire constants, errors, validation, the context type, preflight |
| `http/` | The Express app and the process around it: `createApp`, `/healthz`, the SPA, shutdown |
| `graphql/` | The rules every operation obeys: the Yoga handler and context factory, the logger, the operation limits |
| `schema/` | The hand-written SDL's resolvers, one file per domain |
| `services/` | Email, magic links and session tokens, and the voting algorithm |

| File | What it is |
| ---- | ---------- |
| `core/config.ts` | Typed getters over `process.env`. No other module reads the environment, except preflight and the db package |
| `core/defaults.ts` | Every tunable value as `<CONCEPT>_DEFAULTS` groups: `HTTP_DEFAULTS`, `OPERATION_LIMIT_DEFAULTS`, `AUTH_DEFAULTS`, `GROUP_DEFAULTS`, `SCHEDULE_DEFAULTS`, `EMAIL_DEFAULTS` |
| `core/wire.ts` | `HttpStatus`, and the unit conversions (`MS_PER_MINUTE`, `PERCENT`, …) |
| `core/errors.ts` | `ErrorCode`, `badInput` / `notFound` / `forbidden` / `unauthenticated` / `tooComplex`, `requireAuth`, `errorMessage` |
| `core/validation.ts` | `parseOrThrow`: a zod failure as `BAD_USER_INPUT` |
| `core/context.ts` | The `Context` interface |
| `core/preflight.ts` | The first import of index.ts: refuses a bad configuration with a sentence |
| `http/app.ts` | `createApp({ db, staticDir })`: the Express app, with no listen and no side effects |
| `http/health.ts` | `checkHealth(db)` for `GET /healthz` |
| `http/static.ts` | The built app from `app/dist`, and `index.html` for every other page |
| `http/shutdown.ts` | `stopOnSignals`: drain, close the database, exit |
| `graphql/handler.ts` | `createGraphQLHandler` (Yoga) and `createContextFactory` |
| `graphql/logger.ts` | `graphqlLogger`: Yoga's logger with the `[graphql]` tag |
| `graphql/operation-limits.ts` | `useOperationLimits`: depth, aliases and cost |

## Boot

`server/src/index.ts` is boot only:

1. `core/preflight.ts` (its first import): `DATABASE_URL` must be set, and in production `JWT_SECRET` must not be unset, a published default, or shorter than `AUTH_DEFAULTS.minSecretLength`
2. `waitForDatabase` (from `@cubicecho/ravocal-db/wait`), exiting with a sentence if Postgres never answers
3. The migrations in `db/drizzle`
4. `createApp({ db, staticDir })`, then `listen` on `PORT` (default 3001) on every interface
5. `stopOnSignals(server, { after: closeDatabase })`: on SIGTERM or SIGINT it stops taking requests, lets the open ones finish (cutting them after `HTTP_DEFAULTS.drainSeconds`), closes the database and exits, inside `HTTP_DEFAULTS.shutdownDeadlineSeconds`

Every log line carries a `[subsystem]` tag: `[preflight]`, `[db]`, `[server]`, `[graphql]`, `[email]`.

## HTTP

| Route | What answers |
| ----- | ------------ |
| `/graphql` | Yoga, behind `express.json({ limit: HTTP_DEFAULTS.bodyLimit })` (1 MB; over it is 413). GraphiQL outside production |
| `GET /healthz` | `{ ok, version }`, or 503 with `error` when Postgres doesn't answer |
| everything else | The SPA: a file from `app/dist`, or `index.html` |

No CORS headers are sent: Yoga's `cors` is off. Production serves the app and the API from one origin, and in development the app reaches the API through Vite's `/graphql` proxy (`app/vite.config.ts`).

`trust proxy` is `TRUST_PROXY` (default false): set it to the number of proxies in front, so `ctx.ip` is the client's address.

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

## Operation limits

`useOperationLimits` refuses an operation as `QUERY_TOO_COMPLEX` before any resolver runs when its document is longer than `maxTokens` (1,000, counted while parsing, so ten thousand copies of one field are refused before graphql-js's pairwise field comparison can spend seconds on them), is deeper than `maxDepth` (8; inline fragments and spreads count as a level), has more than `maxAliases` aliases (15), or costs more than `maxCost` (10,000). No field has a cost hint yet, so each costs `defaultFieldCost` (1). The numbers are `OPERATION_LIMIT_DEFAULTS` in `core/defaults.ts`.

## Context

`createContextFactory({ db })` builds each request's `Context`:

```typescript
interface Context {
  db: DB;
  userId: string | null;
  ip: string;
  headers: Headers;
}
```

Auth: `Authorization: Bearer <jwt>` → `sessionUserId` (`services/auth.ts`, jose). A missing or invalid token is `userId: null`. JWTs expire after `AUTH_DEFAULTS.sessionTtlDays` (30).

## Errors

Yoga masks every error that is not a `GraphQLError` as `Unexpected error.` (`INTERNAL_SERVER_ERROR`) and logs the original, with its cause, under `[graphql]`. So every failure a client should read is thrown with a helper from `core/errors.ts`, which sets `extensions.code`:

| Code | Helper | When |
| ---- | ------ | ---- |
| `UNAUTHENTICATED` | `requireAuth(ctx)`, `unauthenticated()` | No session. The message is `Not authenticated`, which the app matches on |
| `NOT_FOUND` | `notFound(message)` | The row doesn't exist |
| `FORBIDDEN` | `forbidden('Forbidden')` | The caller isn't the owner, or isn't a member |
| `BAD_USER_INPUT` | `badInput(message)`, `parseOrThrow` | Arguments the caller can fix, a spent or expired link or invite, a vote in the wrong state |
| `QUERY_TOO_COMPLEX` | `tooComplex(message)` | Only `operation-limits.ts` |

A non-member asking for a group gets `FORBIDDEN`, not `NOT_FOUND`; the resolver rewrite will change that.

Read a caught value with `errorMessage(error)`, which follows the `cause` chain (Drizzle puts the real reason there).

## Resolver Authoring

Guard clause order — always auth → existence → ownership:

```typescript
const userId = requireAuth(ctx);
const group = await ctx.db.query.groups.findFirst({ where: { id: args.id } });
if (!group) {
  throw notFound(`Group ${args.id} not found`);
}
if (group.ownerId !== userId) {
  throw forbidden('Forbidden');
}
```

Validate input with zod 4 at the resolver boundary. Every rule carries a sentence the app can show:

```typescript
const input = parseOrThrow(CreateGroupInput, args);
```

## Auth Flow

1. Client calls `requestMagicLink(email)` — creates a token, sends email, returns `true`
2. User clicks email link → `/login/verify?token=...`
3. Client calls `verifyMagicLink(token)` — validates token, marks used, returns JWT + user
4. Client stores JWT in `localStorage.ravocal_token`
5. Apollo Client sends `Authorization: Bearer <jwt>` on all subsequent requests

Magic link tokens expire in 15 minutes and are single-use. Invite tokens expire in 7 days (`AUTH_DEFAULTS`, `GROUP_DEFAULTS`).

## Email Service

`server/src/services/email.ts` uses nodemailer. In development (no `SMTP_HOST`), emails are logged to the console instead of sent.

Configure via env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (read through `core/config.ts`).

## Public Mutations

`requestMagicLink` and `verifyMagicLink` do not require auth. All other resolvers start with `requireAuth(ctx)`, except `me`, which answers null when signed out.

## Testing

- `__tests__/helpers.ts`: `createClient(db, userId)` runs operations in-process; `expectError` returns `{ message, code }`
- `__tests__/http/app.test.ts`: the real `createApp` over HTTP against PGlite: health, the body cap, the operation limits (with introspection and every document in `app/src` let through), masking, the SPA and CORS
- `__tests__/http/shutdown.test.ts`: `stopOnSignals` in a child process, sent SIGTERM mid-request

## Running the Server

```bash
npm run dev:server    # hot-reload via --watch
npm run dev           # server + app concurrently
```

The server listens on `PORT` (default 3001). GraphiQL is at `http://localhost:3001/graphql` outside production.
