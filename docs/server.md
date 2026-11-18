# Server — Ravocal

graphql-yoga 5 on Express 5, running TypeScript directly (Node 26 strips types without a flag). There is no build step: the container runs `node server/src/index.ts` too.

## Folders

| Folder | Holds |
| ------ | ----- |
| `core/` | What every folder reads, about no one concept: config, defaults, wire constants, errors, validation, the context type, preflight |
| `http/` | The Express app and the process around it: `createApp`, `/healthz`, a provider's sign-in redirects, the SPA, shutdown |
| `auth/` | Who the caller is, and how they sign in: better-auth and the host that rebuilds it, Google and Facebook, its endpoints as GraphQL, `authConfig`, the sign-in throttle |
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
| `http/app.ts` | `createApp({ db, authHost, limiter?, staticDir? })`: the Express app, with no listen and no side effects |
| `http/sso.ts` | `mountSso(app, authHost)`: `GET /sso/:provider` and better-auth's `GET /api/auth/callback/:provider`, the two browser legs of a provider's sign-in; `signInUrl(id)` |
| `http/health.ts` | `checkHealth(db)` for `GET /healthz` |
| `http/static.ts` | The built app from `app/dist`, and `index.html` for every other page |
| `http/shutdown.ts` | `stopOnSignals`: drain, close the database, exit |
| `graphql/handler.ts` | `createGraphQLHandler` (Yoga) and `createContextFactory` |
| `graphql/logger.ts` | `graphqlLogger`: Yoga's logger with the `[graphql]` tag |
| `graphql/operation-limits.ts` | `useOperationLimits`: depth, aliases and cost |
| `auth/better-auth.ts` | `createAuth(db, opts)`: better-auth on Drizzle with the `bearer`, `oneTimeToken`, providers and `magicLink` plugins, and the account-linking rules; `sendsMagicLinks`, `nonSessionCookies`, `sessionUserId` |
| `auth/auth-host.ts` | `createAuthHost(db, opts)` and `fixedAuthHost(auth, providers)`: the current auth instance, which providers it offers, and `rebuild()` |
| `auth/providers.ts` | `providersPlugin`: Google and Facebook through better-auth's `genericOAuth`, and `PROVIDER_ENDPOINTS`, where each is reached |
| `auth/endpoints.ts` | `applyBetterAuthExtension`: better-auth's endpoints (`BETTER_AUTH_OPERATIONS`) as GraphQL fields, with Ravocal's `around`s |
| `auth/resolvers.ts` | `applyAuthExtension`: `authConfig` |
| `auth/throttle.ts` | `AuthFlow`, `throttle(ctx, flow, email?)`: what every sign-in step calls first |
| `auth/rate-limit.ts` | `createRateLimiter`: the in-process sliding window behind `ctx.limiter` |
| `auth/email.ts` | `sendMagicLinkEmail` |
| `schema/write-schema.ts` | Prints the served schema for codegen |

## Boot

`server/src/index.ts` is boot only:

1. `core/preflight.ts` (its first import): `DATABASE_URL` must be set, in production `BETTER_AUTH_SECRET` must not be unset, a published default, or shorter than `AUTH_DEFAULTS.minSecretLength`, and `SECURE_LOCAL_NET` is refused when `APP_URL`'s host is not private (unless `I_KNOW_SECURE_LOCAL_NET_IS_PUBLIC=true`), a provider's client id without its secret (or the reverse) is refused, and so is a `SERVER_URL` that is not a URL
2. `waitForDatabase` (from `@cubicecho/ravocal-db/wait`), exiting with a sentence if Postgres never answers
3. The migrations in `db/drizzle`
4. `createApp({ db, authHost: await createAuthHost(db), staticDir })`, then `listen` on `PORT` (default 3001) on every interface. It logs each provider it offers with the redirect URI to register (`<SERVER_URL>/api/auth/callback/<id>`), and warns under `[auth]` when `SECURE_LOCAL_NET` is on, and when nobody can sign in (no `SMTP_URL`, no provider and no `SECURE_LOCAL_NET`)
5. `stopOnSignals(server, { after: closeDatabase })`: on SIGTERM or SIGINT it stops taking requests, lets the open ones finish (cutting them after `HTTP_DEFAULTS.drainSeconds`), closes the database and exits, inside `HTTP_DEFAULTS.shutdownDeadlineSeconds`

Every log line carries a `[subsystem]` tag: `[preflight]`, `[db]`, `[server]`, `[auth]`, `[graphql]`, `[email]`.

## HTTP

| Route | What answers |
| ----- | ------------ |
| `/graphql` | Yoga, behind `express.json({ limit: HTTP_DEFAULTS.bodyLimit })` (1 MB; over it is 413). GraphiQL outside production |
| `GET /healthz` | `{ ok, version }`, or 503 with `error` when Postgres doesn't answer |
| `GET /sso/:provider` | Starts a sign-in with Google or Facebook: a 302 to the provider, with better-auth's state cookie |
| `GET /api/auth/callback/:provider` | Where the provider sends the browser back: better-auth's own callback, then a 302 to the app |
| everything else | The SPA: a file from `app/dist`, or `index.html` |

No CORS headers are sent: Yoga's `cors` is off. Production serves the app and the API from one origin, and in development the app reaches the API through Vite's proxy (`app/vite.config.ts`), which forwards `/graphql`, `/sso/` and `/api/auth/`. So `SERVER_URL` defaults to `APP_URL` in both, and a provider's state cookie comes back to the origin that set it.

`trust proxy` is `TRUST_PROXY` (default false): set it to the number of proxies in front, so `ctx.ip` is the client's address. The sign-in throttle keys on it: behind a proxy with it unset, every client shares the proxy's address and one budget.

better-auth's REST routes (`/api/auth/*`) are not mounted: its endpoints are served as GraphQL fields. The one exception is a provider's callback, which a browser has to be redirected to.

## Schema Pipeline

`server/src/schema/index.ts` exports `buildSchema(db)`:

1. Reads `server/src/schema.graphql` (the SDL — manually maintained)
2. Calls each `apply*Resolvers(queryFields, mutationFields)` function
3. Passes resolvers + SDL to `makeExecutableSchema` from `@graphql-tools/schema`, with the `DateTime` scalar from `graphql-scalars`
4. `applyAuthExtension` adds `authConfig`, and `applyBetterAuthExtension(schema, db)` adds better-auth's endpoints with `applyBetterAuthGraphQL` (graphql-js `extendSchema`, which keeps the executable schema's resolvers and scalars). `db` only builds the instance the fields are described from (with the magic-link plugin and no provider); requests are served by `ctx.auth`

`npm run codegen` runs `schema/write-schema.ts`, which prints that schema to `server/src/__generated__/schema.graphql` for both codegen configs. It needs no database: with `DATABASE_URL` unset it uses a placeholder it never connects to.

Adding a new domain:
1. Add SDL types/queries/mutations to `schema.graphql`
2. Create `server/src/schema/resolvers/my-domain.ts` with `applyMyDomainResolvers`
3. Call it in `schema/index.ts`

## Operation limits

`useOperationLimits` refuses an operation as `QUERY_TOO_COMPLEX` before any resolver runs when its document is longer than `maxTokens` (1,000, counted while parsing, so ten thousand copies of one field are refused before graphql-js's pairwise field comparison can spend seconds on them), is deeper than `maxDepth` (8; inline fragments and spreads count as a level), has more than `maxAliases` aliases (15), or costs more than `maxCost` (10,000). No field has a cost hint yet, so each costs `defaultFieldCost` (1). The numbers are `OPERATION_LIMIT_DEFAULTS` in `core/defaults.ts`.

## Context

`createContextFactory({ db, authHost, limiter })` builds each request's `Context`, asking the host for the current auth instance every time:

```typescript
interface Context {
  db: DB;
  auth: Auth; // authHost.current(); the auth operations call ctx.auth.api.*
  authHost: AuthHost; // which providers are offered, and rebuild()
  limiter: RateLimiter; // the sign-in throttle
  userId: string | null;
  ip: string;
  headers: Headers;
  setCookie: (cookie: string) => void; // only a provider link's state cookie is ever sent
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

### Google and Facebook

`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and `FACEBOOK_CLIENT_ID`/`FACEBOOK_CLIENT_SECRET` turn each provider on; `.env.example` says how to get them. Both run through better-auth's `genericOAuth` plugin (`auth/providers.ts`): Google from its discovery document, with its id token verified against its keys and PKCE; Facebook from explicit endpoints, with the profile read from the Graph API's `/me`. `createAuth`'s `providerEndpoints` points them elsewhere, which only the tests do.

1. The login page's button is a link to `${SERVER_URL}/sso/<provider>` (`authConfig.providers[].signInUrl`). `http/sso.ts` calls `signInSocial`, forwards the state cookie, and redirects to the provider
2. The provider sends the browser to `/api/auth/callback/<provider>`. `http/sso.ts` hands it to `auth.handler`, which checks the state, swaps the code and opens a session; the session cookie is dropped, a one-time token (`AUTH_DEFAULTS.oneTimeTokenTtlMinutes`, 3) is minted for it, and the browser goes to `${APP_URL}/auth/sso?token=…`
3. The app's `/auth/sso` page calls `verifyOneTimeToken(token)` once, and keeps the bearer token it answers with. A spent, expired or unknown token is `BAD_USER_INPUT`
4. A refusal goes to `${APP_URL}/login?error=<code>&provider=<id>`, with better-auth's code. A provider that is unknown or not set up is `?error=sso_off`

Linking by address (`account.accountLinking` in `auth/better-auth.ts`):

- **Google is trusted.** A Google-verified address signs in to the account that has it, even one made under `SECURE_LOCAL_NET` that nobody confirmed, and confirms it.
- **Facebook is not.** Its profile is never counted as a checked address, so a Facebook sign-in whose address an account already has is refused as `account_not_linked`; the reader signs in by email and connects Facebook in Settings. A new address makes a new account, with the address unconfirmed. No address at all is `email_not_found`.
- **Connecting in Settings** is `linkSocialAccount(provider)` over GraphQL, as the signed-in reader. Its `around` points the provider back at `/settings`, and puts the state cookie on the GraphQL response (`ctx.setCookie`). The callback then links the provider to that reader, whatever address it has. Facebook's profile counts as checked only here, where `getOAuthState()` says the callback finishes a link, because better-auth links only trusted or checked providers.
- **Disconnecting** is `unlinkAccount(accountId)`. It is refused as `BAD_USER_INPUT` when it would leave no provider this instance offers connected and no email way in (a confirmed address while links are sent, or `SECURE_LOCAL_NET`). better-auth also wants a session from the last day (`session.freshAge`); an older one is asked to sign in again.
- `listUserAccounts` lists the providers connected.

`AuthHost.rebuild()` builds a new instance from the providers set now, and the next request uses it; sessions are rows in Postgres, so nobody is signed out. Nothing calls it yet.

Rate limit: `signInMagicLink`, `magicLinkVerify` and `verifyOneTimeToken` call `throttle(ctx, flow, email?)` first. The limiter (`RATE_LIMIT_DEFAULTS`, 5 per 15 minutes per key) counts by client address and, for `signInMagicLink`, by normalized email, and refuses past the budget as `TOO_MANY_REQUESTS`. better-auth's own limiter only runs on its REST routes, which are not mounted. The counts are in process.

## Email Service

`server/src/services/email.ts` sends every email (sign-in links, invites, votes) through one nodemailer transport over `SMTP_URL`, from `SMTP_FROM` (default `ravocal@` the host of `APP_URL`). With `SMTP_URL` unset, invite and vote emails are printed to the console under `[email]`, and no sign-in link is sent at all: links are never printed or logged. In development `npm run db:up` starts Mailpit, which `.env.example`'s `SMTP_URL` points at; read the mail at http://localhost:8036.

## Testing

- `__tests__/helpers.ts`: `createClient(db, userId, { auth, authHost, limiter, ip, headers, cookies })` runs operations in-process; `expectError` returns `{ message, code, extensions }`. `createTestAuth(db, { providers, providerEndpoints })` is real better-auth on PGlite with sign-in links captured in `links` (no provider unless given), `createLinklessAuth(db)` has no way to send one, and `createSessionToken(auth, userId)` starts a real session
- `__tests__/auth/endpoints.test.ts`: sign-in, verify, bad links as `BAD_USER_INPUT`, sign-out, sessions, `SECURE_LOCAL_NET` and `authConfig`
- `__tests__/auth/rate-limit.test.ts`: the limiter's window, and the sixth sign-in refused by address and by email
- `__tests__/http/app.test.ts`: the real `createApp` over HTTP against PGlite: health, the body cap, the operation limits (with introspection and every document in `app/src` let through), masking, the SPA and CORS
- `__tests__/http/sso.test.ts`: Google and Facebook sign-in through the real app over HTTP, against a stand-in for both on a loopback port (`http/fixtures/fake-provider.ts`: discovery, a JWKS from jose, a token endpoint checking the client secret and PKCE, a Graph-style `/me`). The one-time token, linking by address, connecting and disconnecting, `sso_off`, `authConfig.providers` and `AuthHost.rebuild()`
- `__tests__/http/shutdown.test.ts`: `stopOnSignals` in a child process, sent SIGTERM mid-request

## Running the Server

```bash
npm run dev:server    # hot-reload via --watch
npm run dev           # server + app concurrently
```

The server listens on `PORT` (default 3001). GraphiQL is at `http://localhost:3001/graphql` outside production.
