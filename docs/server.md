# Server — Ravocal

graphql-yoga 5 on Express 5, running TypeScript directly (Node 26 strips types without a flag). There is no build step: the container runs `node server/src/index.ts` too.

## Folders

| Folder | Holds |
| ------ | ----- |
| `core/` | What every folder reads, about no one concept: config, defaults, wire constants, errors, validation, the context type, preflight |
| `http/` | The Express app and the process around it: `createApp`, `/healthz`, the SPA, shutdown |
| `auth/` | Who the caller is, and how they sign in: better-auth, its endpoints as GraphQL, `authConfig`, the sign-in throttle |
| `graphql/` | The rules every operation obeys: the Yoga handler and context factory, the logger, the operation limits |
| `schema/` | The hand-written SDL's resolvers, one file per domain, and `buildSchema` |
| `services/` | Email (one SMTP transport for every message) and the voting algorithm |

| File | What it is |
| ---- | ---------- |
| `core/config.ts` | Typed getters over `process.env`. No other module reads the environment, except preflight and the db package |
| `core/defaults.ts` | Every tunable value as `<CONCEPT>_DEFAULTS` groups: `HTTP_DEFAULTS`, `OPERATION_LIMIT_DEFAULTS`, `RATE_LIMIT_DEFAULTS`, `AUTH_DEFAULTS`, `GROUP_DEFAULTS`, `SCHEDULE_DEFAULTS` |
| `core/wire.ts` | `HttpStatus`, and the unit conversions (`MS_PER_MINUTE`, `SECONDS_PER_DAY`, `PERCENT`, …) |
| `core/errors.ts` | `ErrorCode`, `badInput` / `notFound` / `forbidden` / `unauthenticated` / `rateLimited` / `tooComplex`, `requireAuth`, `errorMessage` |
| `core/validation.ts` | `parseOrThrow`: a zod failure as `BAD_USER_INPUT` |
| `core/context.ts` | The `Context` interface |
| `core/preflight.ts` | The first import of index.ts: refuses a bad configuration with a sentence |
| `http/app.ts` | `createApp({ db, auth, limiter?, staticDir? })`: the Express app, with no listen and no side effects |
| `http/health.ts` | `checkHealth(db)` for `GET /healthz` |
| `http/static.ts` | The built app from `app/dist`, and `index.html` for every other page |
| `http/shutdown.ts` | `stopOnSignals`: drain, close the database, exit |
| `graphql/handler.ts` | `createGraphQLHandler` (Yoga) and `createContextFactory` |
| `graphql/logger.ts` | `graphqlLogger`: Yoga's logger with the `[graphql]` tag |
| `graphql/operation-limits.ts` | `useOperationLimits`: depth, aliases and cost |
| `auth/better-auth.ts` | `createAuth(db, opts)`: better-auth on Drizzle with the `bearer` and `magicLink` plugins; `sendsMagicLinks`, `sessionUserId` |
| `auth/endpoints.ts` | `applyBetterAuthExtension`: better-auth's endpoints (`BETTER_AUTH_OPERATIONS`) as GraphQL fields, with Ravocal's `around`s |
| `auth/resolvers.ts` | `applyAuthExtension`: `authConfig` |
| `auth/throttle.ts` | `AuthFlow`, `throttle(ctx, flow, email?)`: what every sign-in step calls first |
| `auth/rate-limit.ts` | `createRateLimiter`: the in-process sliding window behind `ctx.limiter` |
| `auth/email.ts` | `sendMagicLinkEmail` |
| `schema/write-schema.ts` | Prints the served schema for codegen |

## Boot

`server/src/index.ts` is boot only:

1. `core/preflight.ts` (its first import): `DATABASE_URL` must be set, in production `BETTER_AUTH_SECRET` must not be unset, a published default, or shorter than `AUTH_DEFAULTS.minSecretLength`, and `SECURE_LOCAL_NET` is refused when `APP_URL`'s host is not private (unless `I_KNOW_SECURE_LOCAL_NET_IS_PUBLIC=true`)
2. `waitForDatabase` (from `@cubicecho/ravocal-db/wait`), exiting with a sentence if Postgres never answers
3. The migrations in `db/drizzle`
4. `createApp({ db, auth: createAuth(db), staticDir })`, then `listen` on `PORT` (default 3001) on every interface. It warns under `[auth]` when `SECURE_LOCAL_NET` is on, and when nobody can sign in (no `SMTP_URL` and no `SECURE_LOCAL_NET`)
5. `stopOnSignals(server, { after: closeDatabase })`: on SIGTERM or SIGINT it stops taking requests, lets the open ones finish (cutting them after `HTTP_DEFAULTS.drainSeconds`), closes the database and exits, inside `HTTP_DEFAULTS.shutdownDeadlineSeconds`

Every log line carries a `[subsystem]` tag: `[preflight]`, `[db]`, `[server]`, `[auth]`, `[graphql]`, `[email]`.

## HTTP

| Route | What answers |
| ----- | ------------ |
| `/graphql` | Yoga, behind `express.json({ limit: HTTP_DEFAULTS.bodyLimit })` (1 MB; over it is 413). GraphiQL outside production |
| `GET /healthz` | `{ ok, version }`, or 503 with `error` when Postgres doesn't answer |
| everything else | The SPA: a file from `app/dist`, or `index.html` |

No CORS headers are sent: Yoga's `cors` is off. Production serves the app and the API from one origin, and in development the app reaches the API through Vite's `/graphql` proxy (`app/vite.config.ts`).

`trust proxy` is `TRUST_PROXY` (default false): set it to the number of proxies in front, so `ctx.ip` is the client's address. The sign-in throttle keys on it: behind a proxy with it unset, every client shares the proxy's address and one budget.

better-auth's REST routes (`/api/auth/*`) are not mounted: its endpoints are served as GraphQL fields.

## Schema Pipeline

`server/src/schema/index.ts` exports `buildSchema(db)`:

1. Reads `server/src/schema.graphql` (the SDL — manually maintained)
2. Calls each `apply*Resolvers(queryFields, mutationFields)` function
3. Passes resolvers + SDL to `makeExecutableSchema` from `@graphql-tools/schema`, with the `DateTime` scalar from `graphql-scalars`
4. `applyAuthExtension` adds `authConfig`, and `applyBetterAuthExtension(schema, db)` adds better-auth's endpoints with `applyBetterAuthGraphQL` (graphql-js `extendSchema`, which keeps the executable schema's resolvers and scalars). `db` only builds the instance the fields are described from; requests are served by `ctx.auth`

`npm run codegen` runs `schema/write-schema.ts`, which prints that schema to `server/src/__generated__/schema.graphql` for both codegen configs. It needs no database: with `DATABASE_URL` unset it uses a placeholder it never connects to.

Adding a new domain:
1. Add SDL types/queries/mutations to `schema.graphql`
2. Create `server/src/schema/resolvers/my-domain.ts` with `applyMyDomainResolvers`
3. Call it in `schema/index.ts`

## Operation limits

`useOperationLimits` refuses an operation as `QUERY_TOO_COMPLEX` before any resolver runs when its document is longer than `maxTokens` (1,000, counted while parsing, so ten thousand copies of one field are refused before graphql-js's pairwise field comparison can spend seconds on them), is deeper than `maxDepth` (8; inline fragments and spreads count as a level), has more than `maxAliases` aliases (15), or costs more than `maxCost` (10,000). No field has a cost hint yet, so each costs `defaultFieldCost` (1). The numbers are `OPERATION_LIMIT_DEFAULTS` in `core/defaults.ts`.

## Context

`createContextFactory({ db, auth, limiter })` builds each request's `Context`:

```typescript
interface Context {
  db: DB;
  auth: Auth; // better-auth; the auth operations call ctx.auth.api.*
  limiter: RateLimiter; // the sign-in throttle
  userId: string | null;
  ip: string;
  headers: Headers;
}
```

Auth: `Authorization: Bearer <token>` → `sessionUserId(auth, headers)` (`auth/better-auth.ts`), which asks better-auth for the session in Postgres. A missing, ended or expired session is `userId: null`. Sessions last `AUTH_DEFAULTS.sessionTtlDays` (30) after their last use.

## Errors

Yoga masks every error that is not a `GraphQLError` as `Unexpected error.` (`INTERNAL_SERVER_ERROR`) and logs the original, with its cause, under `[graphql]`. So every failure a client should read is thrown with a helper from `core/errors.ts`, which sets `extensions.code`:

| Code | Helper | When |
| ---- | ------ | ---- |
| `UNAUTHENTICATED` | `requireAuth(ctx)`, `unauthenticated()` | No session. The app drops its token on this code, so a bad sign-in link is never this |
| `NOT_FOUND` | `notFound(message)` | The row doesn't exist |
| `FORBIDDEN` | `forbidden('Forbidden')` | The caller isn't the owner, or isn't a member |
| `BAD_USER_INPUT` | `badInput(message)`, `parseOrThrow` | Arguments the caller can fix, a spent or expired link or invite, a vote in the wrong state |
| `TOO_MANY_REQUESTS` | `rateLimited(message, retryAfter)` | Only the sign-in throttle. `extensions.retryAfter` is in seconds |
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

better-auth (`auth/better-auth.ts`) keeps users, sessions and pending links in Postgres, with uuid ids, and signs with `BETTER_AUTH_SECRET`.

1. Client calls `signInMagicLink(email)`. Its `around` throttles, normalizes and checks the address, then better-auth stores the link's hashed token in `verifications` and `sendMagicLinkEmail` mails `${APP_URL}/auth/verify?token=…`
2. User opens the link → the app's `/auth/verify` page
3. Client calls `magicLinkVerify(token)`. better-auth spends the token, creates the user on first sign-in (named for the address's local part), and answers with a session `token`
4. Client stores the token and sends `Authorization: Bearer <token>`
5. `signOut` deletes the session row, so the token stops working everywhere

Under `SECURE_LOCAL_NET=true`, step 1 signs the address in at once: the account is found or created through better-auth's adapter (unverified), and the session comes back in `token` and `userId`. With no `SMTP_URL` and no `SECURE_LOCAL_NET`, `signInMagicLink` is refused as `BAD_USER_INPUT` and nobody can sign in.

Sign-in links expire in `AUTH_DEFAULTS.magicLinkTtlMinutes` (15) and work once. Invite tokens expire in `GROUP_DEFAULTS.inviteTtlDays` (7).

Rate limit: `signInMagicLink` and `magicLinkVerify` call `throttle(ctx, flow, email?)` first. The limiter (`RATE_LIMIT_DEFAULTS`, 5 per 15 minutes per key) counts by client address and, for `signInMagicLink`, by normalized email, and refuses past the budget as `TOO_MANY_REQUESTS`. better-auth's own limiter only runs on its REST routes, which are not mounted. The counts are in process.

## Email Service

`server/src/services/email.ts` sends every email (sign-in links, invites, votes) through one nodemailer transport over `SMTP_URL`, from `SMTP_FROM` (default `ravocal@` the host of `APP_URL`). With `SMTP_URL` unset, invite and vote emails are printed to the console under `[email]`, and no sign-in link is sent at all: links are never printed or logged. In development `npm run db:up` starts Mailpit, which `.env.example`'s `SMTP_URL` points at; read the mail at http://localhost:8036.

## Testing

- `__tests__/helpers.ts`: `createClient(db, userId, { auth, limiter, ip, headers })` runs operations in-process; `expectError` returns `{ message, code, extensions }`. `createTestAuth(db)` is real better-auth on PGlite with sign-in links captured in `links`, `createLinklessAuth(db)` has no way to send one, and `createSessionToken(auth, userId)` starts a real session
- `__tests__/auth/endpoints.test.ts`: sign-in, verify, bad links as `BAD_USER_INPUT`, sign-out, sessions, `SECURE_LOCAL_NET` and `authConfig`
- `__tests__/auth/rate-limit.test.ts`: the limiter's window, and the sixth sign-in refused by address and by email
- `__tests__/http/app.test.ts`: the real `createApp` over HTTP against PGlite: health, the body cap, the operation limits (with introspection and every document in `app/src` let through), masking, the SPA and CORS
- `__tests__/http/shutdown.test.ts`: `stopOnSignals` in a child process, sent SIGTERM mid-request

## Running the Server

```bash
npm run dev:server    # hot-reload via --watch
npm run dev           # server + app concurrently
```

The server listens on `PORT` (default 3001). GraphiQL is at `http://localhost:3001/graphql` outside production.
