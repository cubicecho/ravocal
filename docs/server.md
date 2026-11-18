# Server — Ravocal

graphql-yoga 5 on Express 5, running TypeScript directly (Node 26 strips types without a flag). There is no build step: the container runs `node server/src/index.ts` too.

## Folders

| Folder         | Holds                                                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`        | What every folder reads, about no one concept: config, defaults, wire constants, errors, validation, the context type, preflight                                                                    |
| `http/`        | The Express app and the process around it: `createApp`, `/healthz`, a provider's sign-in redirects, the SPA, shutdown                                                                               |
| `auth/`        | Who the caller is, and how they sign in: better-auth and the host that rebuilds it, Google, Facebook and the OIDC provider, its endpoints as GraphQL, `authConfig`, the sign-in throttle, the admin |
| `sso/`         | The instance's OIDC provider: where it comes from (the environment, or a pairing), pairing by setup URL, and `ssoSetup`, `pairSso`, `unpairSso`                                                     |
| `graphql/`     | The served schema, and the rules every operation obeys: `createSchema`, tenancy, permissions, the write guards, the Yoga handler and context factory, the logger, the operation limits              |
| `groups/`      | A group and its members: `createGroup`, `removeMember`, the update hook, the loaders hand-written resolvers reach a group through                                                                   |
| `invites/`     | Joining by link: `inviteToGroup`, `acceptGroupInvite`, `cancelInvite`, and the invite email                                                                                                         |
| `time-blocks/` | Free time: the generated writes' hooks (membership, the 30-minute grid in UTC)                                                                                                                      |
| `votes/`       | Ranked-choice votes: `startVote`, `forceStartVote`, `submitRankings`, `closeVote`, the pure `tally.ts`, and the vote emails                                                                         |
| `users/`       | A user's own row: the update hook (the name only)                                                                                                                                                   |

| File                          | What it is                                                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/config.ts`              | Typed getters over `process.env`. No other module reads the environment, except preflight and the db package                                                                                                |
| `core/defaults.ts`            | Every tunable value as `<CONCEPT>_DEFAULTS` groups: `HTTP_DEFAULTS`, `OPERATION_LIMIT_DEFAULTS`, `RATE_LIMIT_DEFAULTS`, `AUTH_DEFAULTS`, `USER_DEFAULTS`, `GROUP_DEFAULTS`, `SCHEDULE_DEFAULTS`             |
| `core/wire.ts`                | `HttpStatus`, and the unit conversions (`MS_PER_MINUTE`, `SECONDS_PER_DAY`, `PERCENT`, …)                                                                                                                   |
| `core/errors.ts`              | `ErrorCode`, `badInput` / `notFound` / `forbidden` / `conflict` / `unauthenticated` / `rateLimited` / `tooComplex`, `requireAuth`, `errorMessage`                                                           |
| `core/validation.ts`          | `parseOrThrow`: a zod failure as `BAD_USER_INPUT`                                                                                                                                                           |
| `core/context.ts`             | The `Context` interface                                                                                                                                                                                     |
| `core/preflight.ts`           | The first import of index.ts: refuses a bad configuration with a sentence                                                                                                                                   |
| `http/app.ts`                 | `createApp({ db, authHost, limiter?, mailer?, staticDir? })`: the Express app, with no listen and no side effects                                                                                           |
| `http/sso.ts`                 | `mountSso(app, authHost)`: `GET /sso/:provider` and better-auth's `GET /api/auth/callback/:provider`, the two browser legs of a provider's sign-in; `signInUrl(id)`                                         |
| `http/health.ts`              | `checkHealth(db)` for `GET /healthz`                                                                                                                                                                        |
| `http/static.ts`              | The built app from `app/dist`, and `index.html` for every other page                                                                                                                                        |
| `http/shutdown.ts`            | `stopOnSignals`: drain, close the database, exit                                                                                                                                                            |
| `graphql/build-schema.ts`     | `createSchema(db)`: drizzle-graphql's `buildSchema`, NOT_FOUND for a single-row write that matched nothing, the extension chain, then the permissions                                                       |
| `graphql/tenancy.ts`          | `scope`, `contextValues`, `features`, `exclude`, `AUTH_TABLES`, `SERVER_TABLES`                                                                                                                             |
| `graphql/permissions.ts`      | `permissionsFor(schema)` and `applyAppPermissions`: graphql-casl's abilities, `createCan`, and the `PermissionsMap`                                                                                         |
| `graphql/drizzle-filters.ts`  | `drizzleFilters`: the casl adapter that writes an ability's conditions as a generated `where`                                                                                                               |
| `graphql/write-guards.ts`     | `writtenRows`, `assertWritableColumns`, `assertMemberOfGroups`: what every table's hooks share                                                                                                              |
| `graphql/read-back.ts`        | `readRow`, `readRows`: a hand-written mutation's result, read as the generated query would                                                                                                                  |
| `graphql/object-type.ts`      | `objectType(schema, name)`: a type whose fields are about to get resolvers                                                                                                                                  |
| `graphql/write-schema.ts`     | Prints the served schema for codegen                                                                                                                                                                        |
| `graphql/handler.ts`          | `createGraphQLHandler` (Yoga) and `createContextFactory`                                                                                                                                                    |
| `graphql/logger.ts`           | `graphqlLogger`: Yoga's logger with the `[graphql]` tag                                                                                                                                                     |
| `graphql/operation-limits.ts` | `useOperationLimits`: tokens, depth, aliases and cost                                                                                                                                                       |
| `auth/better-auth.ts`         | `createAuth(db, opts)`: better-auth on Drizzle with the `bearer`, `oneTimeToken`, providers and `magicLink` plugins, and the account-linking rules; `sendsMagicLinks`, `nonSessionCookies`, `sessionUserId` |
| `auth/auth-host.ts`           | `createAuthHost(db, opts)` and `fixedAuthHost(auth, providers)`: the current auth instance, which providers it offers (`currentProviders(db)`: the environment's, then the OIDC provider), and `rebuild()`  |
| `auth/admin.ts`               | `claimFirstAdmin`, `isAdmin`, `hasUsers`: who runs the instance                                                                                                                                             |
| `auth/unproven-access.ts`     | `revokeUnprovenAccess`: the database hooks that end an account's unproven sessions and provider links when its address is first proven                                                                      |
| `auth/providers.ts`           | `providersPlugin`: Google, Facebook and the OIDC provider through better-auth's `genericOAuth`, and `PROVIDER_ENDPOINTS`, where Google and Facebook are reached                                             |
| `auth/endpoints.ts`           | `applyBetterAuthExtension`: better-auth's endpoints (`BETTER_AUTH_OPERATIONS`) as GraphQL fields, with Ravocal's `around`s                                                                                  |
| `auth/resolvers.ts`           | `applyAuthExtension`: `authConfig`                                                                                                                                                                          |
| `auth/throttle.ts`            | `AuthFlow`, `throttle(ctx, flow, email?)`: what every sign-in step calls first                                                                                                                              |
| `auth/rate-limit.ts`          | `createRateLimiter`: the in-process sliding window behind `ctx.limiter`                                                                                                                                     |
| `auth/email.ts`               | The mail transport: `sendMail` (the default `Mailer`), `sendEach` (sends what a committed write announces, logging a failure), `sendMagicLinkEmail`                                                         |
| `sso/settings.ts`             | `effectiveOidc(db)`: the one place that decides the OIDC provider (the environment, else the `oidc_settings` row, else none) and its `SsoSource`; reading, saving and clearing the row                      |
| `sso/pairing.ts`              | `parseSetupUrl`, `pair(db, setupUrl)`, `unpair(db)`, `PairingError` and its `PairingFailure` reasons                                                                                                        |
| `sso/resolvers.ts`            | `applySsoExtension`: `ssoSetup`, `pairSso`, `unpairSso`, and `canPairSso`                                                                                                                                   |
| `<domain>/resolvers.ts`       | `apply<Domain>Extension(schema)`: the domain's hand-written SDL and resolvers                                                                                                                               |
| `<domain>/input.ts`           | The zod schemas its writes are parsed with                                                                                                                                                                  |
| `<domain>/hooks.ts`           | Its table's `onWrite` hooks, merged in build-schema.ts                                                                                                                                                      |

## Boot

`server/src/index.ts` is boot only:

1. `core/preflight.ts` (its first import): `DATABASE_URL` must be set, in production `BETTER_AUTH_SECRET` must not be unset, a published default, or shorter than `AUTH_DEFAULTS.minSecretLength`, and `SECURE_LOCAL_NET` is refused when `APP_URL`'s host is not private (unless `I_KNOW_SECURE_LOCAL_NET_IS_PUBLIC=true`), a provider's client id without its secret (or the reverse) is refused, so are `OIDC_ISSUER` without `OIDC_CLIENT_ID` (or the reverse), an `OIDC_ISSUER` that is not an http(s) URL and an unknown `OIDC_CLIENT_AUTH`, and so is a `SERVER_URL` that is not a URL
2. `waitForDatabase` (from `@cubicecho/ravocal-db/wait`), exiting with a sentence if Postgres never answers
3. The migrations in `db/drizzle`
4. `createApp({ db, authHost: await createAuthHost(db), staticDir })`, then `listen` on `PORT` (default 3001) on every interface. It logs each provider it offers (the OIDC provider with its issuer) with the redirect URI to register (`<SERVER_URL>/api/auth/callback/<id>`), and warns under `[auth]` when `SECURE_LOCAL_NET` is on, and when nobody can sign in (no `SMTP_URL`, no provider and no `SECURE_LOCAL_NET`; pairing from the login page is still open then)
5. `stopOnSignals(server, { after: closeDatabase })`: on SIGTERM or SIGINT it stops taking requests, lets the open ones finish (cutting them after `HTTP_DEFAULTS.drainSeconds`), closes the database and exits, inside `HTTP_DEFAULTS.shutdownDeadlineSeconds`

Every log line carries a `[subsystem]` tag: `[preflight]`, `[db]`, `[server]`, `[auth]`, `[graphql]`, `[email]`.

## HTTP

| Route                              | What answers                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/graphql`                         | Yoga, behind `express.json({ limit: HTTP_DEFAULTS.bodyLimit })` (1 MB; over it is 413). GraphiQL outside production          |
| `GET /healthz`                     | `{ ok, version }`, or 503 with `error` when Postgres doesn't answer                                                          |
| `GET /sso/:provider`               | Starts a sign-in with Google, Facebook or the OIDC provider (`oidc`): a 302 to the provider, with better-auth's state cookie |
| `GET /api/auth/callback/:provider` | Where the provider sends the browser back: better-auth's own callback, then a 302 to the app                                 |
| everything else                    | The SPA: a file from `app/dist`, or `index.html`                                                                             |

No CORS headers are sent: Yoga's `cors` is off. Production serves the app and the API from one origin, and in development the app reaches the API through Vite's proxy (`app/vite.config.ts`), which forwards `/graphql`, `/sso/` and `/api/auth/`. So `SERVER_URL` defaults to `APP_URL` in both, and a provider's state cookie comes back to the origin that set it.

`trust proxy` is `TRUST_PROXY` (default false): set it to the number of proxies in front, so `ctx.ip` is the client's address. The sign-in throttle keys on it: behind a proxy with it unset, every client shares the proxy's address and one budget.

better-auth's REST routes (`/api/auth/*`) are not mounted: its endpoints are served as GraphQL fields. The one exception is a provider's callback, which a browser has to be redirected to.

## Schema

`graphql/build-schema.ts` exports `createSchema(db)`, which builds the one schema `/graphql` serves:

1. drizzle-graphql's `buildSchema(db, …)` generates queries, filters, aggregates and the writes `features` allows, over every table but the ones `exclude` names. `scope` and `contextValues` (tenancy.ts) and each domain's `onWrite` hooks go in here, with `limits` (`OPERATION_LIMIT_DEFAULTS.defaultPageSize` / `maxPageSize`), `complexity: true` and a default ordering for vote slots (ballot `position`), votes (newest first), time blocks and members
2. Each generated single-row update and delete is wrapped to throw `NOT_FOUND` when its `where` matched no row
3. `applyAuthExtension` adds `authConfig`, and `applyBetterAuthExtension(schema, db)` adds better-auth's endpoints
4. `applyGroupsExtension`, `applyInvitesExtension` and `applyVotesExtension` add the hand-written mutations (graphql-js `extendSchema`, then resolvers assigned through `objectType`)
5. `applyAppPermissions` guards the result with graphql-casl's `applyPermissions`

`npm run codegen` runs `graphql/write-schema.ts`, which prints that schema to `server/src/__generated__/schema.graphql` for both codegen configs. It needs no database: with `DATABASE_URL` unset it uses a placeholder it never connects to.

### Access

Rows are shared by group membership. `scope` ANDs a filter into every generated read, update and delete, on every path a table is reached (a root list, `group(where:)`, a relation field, an aggregate), so a member reads everything in their groups and nothing outside them; a client `OR` can only narrow it. `contextValues` stamps `timeBlocks.userId` and takes `groups.ownerId` out of the update input. The per-table rules are in AGENTS.md.

`scope` can't tell a read from a write, and a member may read a row they may not change. graphql-casl (`permissions.ts`) is that second lock: the abilities say who may change what (`Group` by `ownerId`, `TimeBlock` by `userId`, `User` by `id`), and `scopeArgs` ANDs them into the generated write's `where` with the `drizzleFilters` adapter. drizzle-graphql 19's filters have `AND`, `OR` and `NOT` at every level, so the merge is a plain `{ AND: [clientWhere, conditions] }`, and a client `OR` stays inside it.

The permission map is `'*': accept` for reads (the scope refuses an anonymous caller with `UNAUTHENTICATED`) and an allow-list for `Mutation`: `'*': deny`, better-auth's served mutations (read off the schema, so a better-auth upgrade keeps them) and `pairSso`/`unpairSso` (`SSO_MUTATIONS`; open, because a new instance is set up signed out, and the resolvers decide), the hand-written mutations behind a signed-in check, and six generated writes (`createTimeBlock`, `updateTimeBlock`, `deleteTimeBlock`, `updateGroup`, `deleteGroup`, `updateUser`). Everything else drizzle-graphql generates, the bulk forms included, is `FORBIDDEN`.

### Write hooks

`onWrite` hooks run inside the write's transaction, so a throw rolls it back. They check; they never rewrite what is written (drizzle-graphql writes from a copy of the arguments).

- `groups` update, `users` update: `assertWritableColumns` refuses any column but the ones a client may set (name and threshold; the name), then the zod rules
- `timeBlocks` insert and update: `before` refuses server-owned columns; `after` (with `columns` naming `groupId`, `startsAt`, `endsAt`) checks the row as written, so an update that changes one end is checked against the whole row: the caller must be a member of its group (`NOT_FOUND` otherwise, moving a block included), and both ends must sit on the 30-minute grid **in UTC** with the end after the start (`BAD_USER_INPUT`)

None has a side effect outside the database; one that needs it goes through the payload's `onCommit`.

### Hand-written fields

A domain folder's `resolvers.ts` extends the schema with SDL and assigns resolvers. They don't inherit `scope`, so they reach a group through `groups/access.ts` (`loadMemberGroup`, `loadOwnedGroup`, both `NOT_FOUND` for a group out of reach), write in one transaction, send their emails after it commits (`sendEach(ctx.mailer, …)`), and read their result back with `graphql/read-back.ts`, so the caller's selection resolves exactly as the generated query would, through the same scope.

Adding a table: add it to `scope` (tenancy.test.ts fails until you do), decide its generated writes in `features` and, for any to serve, put them on the permission map; then its domain folder's hooks and hand-written fields.

## Operation limits

`useOperationLimits` refuses an operation as `QUERY_TOO_COMPLEX` before any resolver runs when its document is longer than `maxTokens` (1,000, counted while parsing, so ten thousand copies of one field are refused before graphql-js's pairwise field comparison can spend seconds on them), is deeper than `maxDepth` (8; inline fragments and spreads count as a level), has more than `maxAliases` aliases (15), or costs more than `maxCost` (10,000). drizzle-graphql prices each generated list by the page it can return (its `limit`, else `defaultPageSize`, 50) times one row; any other field costs `defaultFieldCost` (1). A `limit` over `maxPageSize` (500) is refused by drizzle-graphql as `DRIZZLE_LIMIT_EXCEEDED`. The numbers are `OPERATION_LIMIT_DEFAULTS` in `core/defaults.ts`.

## Context

`createContextFactory({ db, authHost, limiter, mailer? })` builds each request's `Context`, asking the host for the current auth instance every time:

```typescript
interface Context {
  db: DB;
  auth: Auth; // authHost.current(); the auth operations call ctx.auth.api.*
  authHost: AuthHost; // which providers are offered, and rebuild()
  limiter: RateLimiter; // the sign-in throttle
  mailer: Mailer; // the invite and vote emails; sendMail unless a test passes its own
  userId: string | null;
  ip: string;
  headers: Headers;
  setCookie: (cookie: string) => void; // only a provider link's state cookie is ever sent
}
```

Auth: `Authorization: Bearer <token>` → `sessionUserId(auth, headers)` (`auth/better-auth.ts`), which asks better-auth for the session in Postgres. A missing, ended or expired session is `userId: null`. Sessions last `AUTH_DEFAULTS.sessionTtlDays` (30) after their last use.

## Errors

Yoga masks every error that is not a `GraphQLError` as `Unexpected error.` (`INTERNAL_SERVER_ERROR`) and logs the original, with its cause, under `[graphql]`. So every failure a client should read is thrown with a helper from `core/errors.ts`, which sets `extensions.code`:

| Code                | Helper                                                     | When                                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHENTICATED`   | `requireAuth(ctx)`, `unauthenticated()`                    | No session. The app drops its token on this code, so a bad sign-in link is never this                                                                                                             |
| `NOT_FOUND`         | `notFound(message)`                                        | The row doesn't exist, **or the caller can't reach it**: another group's, a member's block they didn't make, an owner-only action by someone else. One code, so ids can't be probed               |
| `FORBIDDEN`         | the permission map's `fallbackError`, `forbidden(message)` | A mutation off the allow-list, or changing the instance's sign-in without being allowed to (`sso/resolvers.ts`): a role refusal, never a row                                                      |
| `CONFLICT`          | `conflict(message)`                                        | The instance has to change first: pairing a provider over one already paired                                                                                                                      |
| `BAD_USER_INPUT`    | `badInput(message)`, `parseOrThrow`                        | Arguments the caller can fix, a spent or expired link or invite, accepting an invite while already a member, a vote in the wrong state, a pairing the provider refused (with `extensions.reason`) |
| `TOO_MANY_REQUESTS` | `rateLimited(message, retryAfter)`                         | The sign-in throttle, with `extensions.retryAfter` in seconds; and a provider rate-limiting a pairing (`extensions.reason: RATE_LIMITED`)                                                         |
| `QUERY_TOO_COMPLEX` | `tooComplex(message)`                                      | Only `operation-limits.ts`                                                                                                                                                                        |

drizzle-graphql's own errors keep their `DRIZZLE_*` codes (`DRIZZLE_LIMIT_EXCEEDED`, `DRIZZLE_MULTI_ROW_MATCH`, …). Its `onError` hands every other error on to Yoga, which masks it and logs its innermost cause; the library's own sanitizer would have answered it as a coded error and left nothing in the log.

Read a caught value with `errorMessage(error)`, which follows the `cause` chain (Drizzle puts the real reason there).

## Resolver Authoring

Guard clause order: auth, then the caller's reach (one `NOT_FOUND` for missing and out of reach), then the rule:

```typescript
const ownerId = requireAuth(context);
const group = await loadOwnedGroup(tx, args.groupId, ownerId); // NOT_FOUND unless they own it
if (args.userId === ownerId) {
  throw badInput("You own this group, so you can't remove yourself. Delete the group instead.");
}
```

Validate input with zod 4 at the resolver boundary, or in the table's `onWrite` hook for a generated write. Every rule carries a sentence the app can show:

```typescript
const input = parseOrThrow(createGroupInput, args);
```

## Auth Flow

better-auth (`auth/better-auth.ts`) keeps users, sessions and pending links in Postgres, with uuid ids, and signs with `BETTER_AUTH_SECRET`.

1. Client calls `signInMagicLink(email)`. Its `around` throttles, normalizes and checks the address, then better-auth stores the link's hashed token in `verifications` and `sendMagicLinkEmail` mails `${APP_URL}/auth/verify?token=…`
2. User opens the link → the app's `/auth/verify` page
3. Client calls `magicLinkVerify(token)`. better-auth spends the token, creates the user on first sign-in (named for the address's local part), and answers with a session `token`
4. Client stores the token and sends `Authorization: Bearer <token>`
5. `signOut` deletes the session row, so the token stops working everywhere

Under `SECURE_LOCAL_NET=true`, step 1 signs the address in at once: the account is found or created through better-auth's adapter (unverified), and the session comes back in `token` and `userId`. With no `SMTP_URL` and no `SECURE_LOCAL_NET`, `signInMagicLink` is refused as `BAD_USER_INPUT` and nobody can sign in.

Sign-in links expire in `AUTH_DEFAULTS.magicLinkTtlMinutes` (15) and work once. Invite links expire in `GROUP_DEFAULTS.inviteTtlDays` (7) and work once; the row makes its own token (32 random bytes) when it is inserted.

### Google and Facebook

`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and `FACEBOOK_CLIENT_ID`/`FACEBOOK_CLIENT_SECRET` turn each provider on; `.env.example` says how to get them. Both run through better-auth's `genericOAuth` plugin (`auth/providers.ts`): Google from its discovery document, with its id token verified against its keys and PKCE; Facebook from explicit endpoints, with the profile read from the Graph API's `/me`. `createAuth`'s `providerEndpoints` points them elsewhere, which only the tests do.

1. The login page's button is a link to `${SERVER_URL}/sso/<provider>` (`authConfig.providers[].signInUrl`). `http/sso.ts` calls `signInSocial`, forwards the state cookie, and redirects to the provider
2. The provider sends the browser to `/api/auth/callback/<provider>`. `http/sso.ts` hands it to `auth.handler`, which checks the state, swaps the code and opens a session; the session cookie is dropped, a one-time token (`AUTH_DEFAULTS.oneTimeTokenTtlMinutes`, 3) is minted for it, and the browser goes to `${APP_URL}/auth/sso?token=…`
3. The app's `/auth/sso` page calls `verifyOneTimeToken(token)` once, and keeps the bearer token it answers with. A spent, expired or unknown token is `BAD_USER_INPUT`
4. A refusal goes to `${APP_URL}/login?error=<code>&provider=<id>`, with better-auth's code. A provider that is unknown or not set up is `?error=sso_off`

Linking by address (`account.accountLinking` in `auth/better-auth.ts`):

- **No provider is trusted by name.** A sign-in reaches the account that has its address only when the provider says it checked the address.
- **Google** and the **OIDC provider** pass their own `email_verified` claim through (a missing claim counts as unchecked). A Google-checked address signs in to the account that has it, even one made under `SECURE_LOCAL_NET` that nobody confirmed, and confirms it. An unchecked one that an account already has is refused as `account_not_linked`. `requireLocalEmailVerified` is off whichever providers are set up: one rule, keyed on the provider's claim, never on its name.
- **Facebook** never counts as checking an address, so a Facebook sign-in whose address an account already has is refused as `account_not_linked`; the reader signs in by email and connects Facebook in Settings.
- A new address makes a new account, with the address unconfirmed. No address at all is `email_not_found`.
- **The first proof of an address** (a magic link, or a Google or OIDC sign-in whose provider checked it; `SECURE_LOCAL_NET` proves nothing) ends every session the account had and deletes every provider account but the one proving it (`auth/unproven-access.ts`: better-auth database hooks that see the proof wherever better-auth confirms an address; the magic link also does it itself, `revokeUnprovenAccountAccess`). So whoever made an account with someone else's address keeps no way in once its owner arrives. A provider connected from Settings after the proof is kept: an address is proven only once. Group memberships are not touched.
- **Connecting in Settings** is `linkSocialAccount(provider)` over GraphQL, as the signed-in reader. Its `around` points the provider back at `/settings`, and puts the state cookie on the GraphQL response (`ctx.setCookie`). The callback then links the provider to that reader, whatever address it has. Facebook's profile counts as checked only here, where `getOAuthState()` says the callback finishes a link, because better-auth links only trusted or checked providers.
- **Disconnecting** is `unlinkAccount(accountId)`. It is refused as `BAD_USER_INPUT` when it would leave no provider this instance offers connected and no email way in (a confirmed address while links are sent, or `SECURE_LOCAL_NET`). better-auth also wants a session from the last day (`session.freshAge`); an older one is asked to sign in again.
- `listUserAccounts` lists the providers connected.

`AuthHost.rebuild()` builds a new instance from the providers set now, and the next request uses it; sessions are rows in Postgres, so nobody is signed out. `pairSso` and `unpairSso` call it before they answer.

### The OIDC provider, and pairing

A generic OpenID Connect provider (heautou, Keycloak, Authentik, …) under the id `oidc`, through `genericOAuth` like the others: `discoveryUrl` `<issuer>/.well-known/openid-configuration`, `requireIdTokenVerification` and `pkce` stated, scopes `openid profile email`, `tokenEndpointAuth` `none` for a public client with no secret and otherwise `client_secret_basic` or `client_secret_post`. The user is named from `name`, then `preferred_username`, then the address's local part. Its button, `/sso/oidc`, the callback and Settings are the same loops over `authHost.providers()` as Google's.

Where it comes from is decided only by `sso/settings.ts` `effectiveOidc(db)`:

1. **The environment wins.** `OIDC_ISSUER` and `OIDC_CLIENT_ID` (with `OIDC_CLIENT_SECRET`, `OIDC_CLIENT_AUTH` default `client_secret_basic`, and `OIDC_NAME` default `AUTH_DEFAULTS.oidcName`, `SSO`) are `SsoSource.ENV`, and the app cannot change them.
2. Otherwise the `oidc_settings` row a pairing wrote (`PAIRED`).
3. Otherwise none (`NONE`).

**Pairing** (`sso/pairing.ts`). A provider that does Dynamic Client Registration hands its admin a setup URL, `<issuer>#setup=<initial access token>&name=<label>`. The token is in the fragment, so no server logs it on the way. `parseSetupUrl` wants an http(s) URL with `setup`; the issuer is the URL without its fragment, query and trailing slashes, and the name falls back to `SSO`. `pair(db, setupUrl)`:

1. Fetches the discovery document, and **checks that its `issuer` is the pasted issuer before the token goes anywhere**; it must name a `registration_endpoint`.
2. POSTs `{ client_name: 'Ravocal', redirect_uris: ['<SERVER_URL>/api/auth/callback/oidc'], token_endpoint_auth_method: 'client_secret_basic', grant_types: ['authorization_code'], response_types: ['code'] }` with `Authorization: Bearer <token>` (RFC 7591).
3. Keeps `client_id` (required), `client_secret`, the auth method the provider actually registered, `registration_access_token` and `registration_client_uri` in the one `oidc_settings` row.

Every call goes through one `call()` with `AbortSignal.timeout(AUTH_DEFAULTS.oidcPairingTimeoutMs)` (10 s). The setup token is never stored or logged, and no message carries it. A failure is a `PairingError`, answered with its `reason` in `extensions.reason`:

| reason            | when                                                                                | code                |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------- |
| `BAD_URL`         | not a URL, not http(s), or no `setup`                                               | `BAD_USER_INPUT`    |
| `NOT_A_PROVIDER`  | unreachable, no discovery, another issuer, no `client_id`, or an unexpected status  | `BAD_USER_INPUT`    |
| `NO_REGISTRATION` | no `registration_endpoint`: register by hand and use `OIDC_ISSUER`/`OIDC_CLIENT_ID` | `BAD_USER_INPUT`    |
| `EXPIRED`         | 401, or `invalid_token`                                                             | `BAD_USER_INPUT`    |
| `REFUSED`         | 400, with the provider's `error_description`                                        | `BAD_USER_INPUT`    |
| `RATE_LIMITED`    | 429                                                                                 | `TOO_MANY_REQUESTS` |

`unpair(db)` sends an RFC 7592 `DELETE` to the registration client URI with the registration access token (a 2xx, 401 or 404 counts as gone), then forgets the row whatever the answer, warning under `[auth]` when it could not confirm.

**GraphQL** (`sso/resolvers.ts`): `ssoSetup { source issuer name canPair redirectUri }`, readable signed out, with `issuer` only for a caller who may pair; `pairSso(setupUrl)` and `unpairSso` answer the same type, after `authHost.rebuild()`. All three are on the permission map's allow-list; the resolvers decide:

- **Who may pair** (`canPairSso`): nobody when the source is `ENV`; the admin; or anyone while the instance has no accounts at all, so whoever installs it can set sign-in up from the login page. Once anyone has an account, a stranger's provider could vouch for an existing address, so only the admin may.
- A refusal is `FORBIDDEN` with a sentence ("Sign-in is set by OIDC_ISSUER in the server's environment. Change it there." / "Only the admin can change how people sign in."): it is about the instance, not a row, so the NOT_FOUND rule does not apply. Pairing over a pairing is `CONFLICT` ("Disconnect it first"); an empty URL is `BAD_USER_INPUT`.

**The admin** (`auth/admin.ts`): `users.is_admin`. better-auth's `databaseHooks.user.create.after` runs `claimFirstAdmin(db, userId)` for every new account, whichever way it signed in: one `UPDATE … WHERE NOT EXISTS (an admin)`, and the partial unique index `uq_users_one_admin` refuses the later of two first sign-ups that commit together. The `oidc_pairing` migration made the oldest account the admin on an instance that already had accounts. The column is readable like the rest of `users`, and the users update hook keeps it out of `updateUser`.

Rate limit: `signInMagicLink`, `magicLinkVerify` and `verifyOneTimeToken` call `throttle(ctx, flow, email?)` first. The limiter (`RATE_LIMIT_DEFAULTS`, 5 per 15 minutes per key) counts by client address and, for `signInMagicLink`, by normalized email, and refuses past the budget as `TOO_MANY_REQUESTS`. better-auth's own limiter only runs on its REST routes, which are not mounted. The counts are in process.

## Email Service

`server/src/auth/email.ts` sends every email (sign-in links, invites, votes) through one nodemailer transport over `SMTP_URL`, from `SMTP_FROM` (default `ravocal@` the host of `APP_URL`). The invite and vote messages are written in `invites/email.ts` and `votes/email.ts`, and sent through `ctx.mailer` (`sendMail` unless a test passes its own) once the write they announce has committed; `sendEach` logs a failed send under `[email]` by subject, without the address, rather than fail a write that has happened. Times in the result email are in UTC. With `SMTP_URL` unset, invite and vote emails are printed to the console under `[email]`, and no sign-in link is sent at all: links are never printed or logged. In development `npm run db:up` starts Mailpit, which `.env.example`'s `SMTP_URL` points at; read the mail at http://localhost:8036.

## Testing

- `__tests__/helpers.ts`: `createClient(db, userId, { auth, authHost, limiter, ip, headers, cookies, mail })` runs operations in-process against the real, guarded schema, and `mail` collects what its mailer sent; `expectError` returns `{ message, code, extensions }`. `createTestAuth(db, { providers, providerEndpoints })` is real better-auth on PGlite with sign-in links captured in `links` (no provider unless given), `createLinklessAuth(db)` has no way to send one, and `createSessionToken(auth, userId)` starts a real session
- `__tests__/graphql/access.test.ts`: every row of the access table, as owner, member and outsider: reads, every write, a client `OR` that can't widen a read or a write, and `NOT_FOUND` for a filtered single-row write
- `__tests__/graphql/tenancy.test.ts`: every exposed table has a scope, the auth and server tables (`oidc_settings`) are unreachable, no input takes a nested relation, every generated write the map doesn't name is refused, and every served better-auth operation, `ssoSetup`, `pairSso` and `unpairSso` are allowed
- `__tests__/groups/`, `invites/`, `time-blocks/`, `votes/`: `createGroup` and `removeMember`; inviting, accepting (once, before expiry, from any address, not while already a member) and cancelling; the UTC grid; starting, forcing (the owner-first order read back from the stored positions), ranking and closing a vote. `votes/tally.test.ts` is the pure algorithm
- `__tests__/auth/endpoints.test.ts`: sign-in, verify, bad links as `BAD_USER_INPUT`, sign-out, sessions, `SECURE_LOCAL_NET` and `authConfig`
- `__tests__/auth/rate-limit.test.ts`: the limiter's window, and the sixth sign-in refused by address and by email
- `__tests__/auth/admin.test.ts`: the first account becomes the admin and no other, even signing up at once; a second admin is refused; the `oidc_pairing` migration on PGlite makes the oldest account the admin
- `__tests__/http/app.test.ts`: the real `createApp` over HTTP against PGlite: health, the body cap, the operation limits (with introspection and every document in `app/src` let through), masking, the SPA and CORS
- `__tests__/http/sso.test.ts`: Google and Facebook sign-in through the real app over HTTP, against a stand-in for both on a loopback port (`http/fixtures/fake-provider.ts`: Google's half is `http/fixtures/oidc-issuer.ts`, discovery, a JWKS from jose and a token endpoint checking the client secret and PKCE; Facebook's a Graph-style `/me`). The one-time token, linking by address, the first proof of an address, connecting and disconnecting, `sso_off`, `authConfig.providers` and `AuthHost.rebuild()`
- `__tests__/sso/pairing.test.ts`: pairing through the real app over HTTP against a Dynamic Client Registration stand-in (`sso/fixtures/fake-dcr.ts`, whose sign-in half is `oidc-issuer.ts`): setup URLs, the registered redirect URI and the button without a restart, each failure reason, a forged issuer refused before the token is sent, who may pair, unpairing (a 404 as gone, the row forgotten on a refusal), signing in through the paired provider with both linking outcomes, and the setup token in no log line or response
- `__tests__/http/shutdown.test.ts`: `stopOnSignals` in a child process, sent SIGTERM mid-request

## Running the Server

```bash
npm run dev:server    # hot-reload via --watch
npm run dev           # server + app concurrently
```

The server listens on `PORT` (default 3001). GraphiQL is at `http://localhost:3001/graphql` outside production.

In production it runs from the image (`node server/src/index.ts` as `USER node`, `NODE_ENV=production`), serving the built app from `app/dist` beside the API. `docker-compose.yml` runs it with Postgres; AGENTS.md (Deployment, CI) covers the image, the compose file and the boot job that checks both.
