# GraphQL API — Ravocal

The hand-written part of the schema lives at `server/src/schema.graphql`. `server/src/auth/` adds `authConfig` and better-auth's own endpoints to it, and `npm run codegen` prints the whole served schema to `server/src/__generated__/schema.graphql` before generating the app's and the server's types from it. After any change, run `npm run codegen`.

## Scalars

| Scalar | Representation |
|--------|---------------|
| `DateTime` | ISO 8601 string (e.g. `"2025-06-01T10:00:00.000Z"`) |
| `JSON` | Any JSON value. Only better-auth's types use it |

## Sign-in and sessions

These fields are better-auth's endpoints, served by `@cubicecho/graphql-better-auth` (`server/src/auth/endpoints.ts`). Their arguments and result types (`Auth…`) are read off better-auth, so they move with a better-auth upgrade. Only the operations in `BETTER_AUTH_OPERATIONS` are served, and better-auth's REST routes are not mounted. A session is a bearer token: send it as `Authorization: Bearer <token>`.

| Field | Kind | Signed in? | Notes |
|-------|------|------------|-------|
| `authConfig` | query | no | `{ secureLocalNet, magicLink }`: which ways of signing in this instance offers |
| `signInMagicLink(email)` | mutation | no | Emails a link to `${APP_URL}/auth/verify?token=…` and answers `{ status: true, token: null, userId: null }`. Under `SECURE_LOCAL_NET` it sends nothing and answers with a live session in `token` and `userId`. With neither SMTP nor `SECURE_LOCAL_NET` it is refused as `BAD_USER_INPUT` |
| `magicLinkVerify(token)` | mutation | no | Spends a link for `{ token, user, session }`. A spent, expired or unknown link is `BAD_USER_INPUT` ("Invalid or expired sign-in link."), never `UNAUTHENTICATED` |
| `getSession` | query | no | The caller's `{ user, session }`, or null |
| `listSessions` | query | yes | Every live session of the caller's account |
| `signOut` | mutation | no | Ends the caller's session: `{ success: true }`, or `false` when there was none |
| `revokeSession(token)`, `revokeSessions`, `revokeOtherSessions` | mutation | yes | End one, all, or all but this one |

`signInMagicLink` and `magicLinkVerify` are rate limited by `ctx.limiter` (`RATE_LIMIT_DEFAULTS`: 5 in 15 minutes): the first by client address and by email, the second by address. Past the budget they are refused as `TOO_MANY_REQUESTS`, with `extensions.retryAfter` in seconds. Every other field starts with `requireAuth(ctx)` (`UNAUTHENTICATED`), except `me`, which answers null when signed out.

## Queries

### `me: User`
Returns the authenticated user, or null if not logged in.

### `myGroups: [Group!]!`
All groups the authenticated user belongs to (as owner or member).

### `group(id: ID!): Group`
Full group detail. Requires the caller to be a member.

## Mutations

Signing in and out are under "Sign-in and sessions" above.

### Profile

| Mutation | Returns |
|----------|---------|
| `updateMyProfile(name)` | `User!` |

### Groups

| Mutation | Returns | Auth |
|----------|---------|------|
| `createGroup(name, overlapThreshold?)` | `Group!` | any member |
| `updateGroup(id, name?, overlapThreshold?)` | `Group!` | owner only |
| `deleteGroup(id)` | `Boolean!` | owner only |

`overlapThreshold` defaults to 50 (percent).

### Invites

| Mutation | Returns | Auth |
|----------|---------|------|
| `inviteToGroup(groupId, email)` | `GroupInvite!` | owner only |
| `acceptGroupInvite(token)` | `GroupMember!` | any authenticated user |

### Time Blocks

| Mutation | Returns | Auth |
|----------|---------|------|
| `addTimeBlock(groupId, startsAt, endsAt)` | `TimeBlock!` | group member |
| `removeTimeBlock(id)` | `Boolean!` | block owner |

`startsAt` and `endsAt` must be 30-minute aligned ISO 8601 strings. Minimum duration: 30 minutes.

### Votes

| Mutation | Returns | Auth |
|----------|---------|------|
| `startVote(groupId)` | `Vote!` | owner only |
| `forceStartVote(groupId)` | `Vote!` | owner only |
| `submitRankings(voteId, rankings)` | `[VoteRanking!]!` | group member |
| `closeVote(voteId)` | `Vote!` | owner only |

`startVote` fails if no slots meet the group's `overlapThreshold`. Use `forceStartVote` to bypass.

`submitRankings` replaces any existing rankings from that user for the vote. `rankings` is `[{slotId, rank}]` where rank 1 is the top choice.

`closeVote` runs the ranked-choice tally, sets `winnerSlotId`, and emails all members.

## Types

```graphql
type Group {
  id, name, ownerId, owner, overlapThreshold,
  members, pendingInvites, timeBlocks, activeVote, createdAt
}

type Vote {
  id, groupId, status, isForced,
  slots, myRankings, winnerSlotId, closedAt, createdAt
}
```

## Codegen

Run after any schema or client operation change:

```bash
npm run codegen           # both server + app
npm run codegen:server    # server resolver types only
npm run codegen:app       # app operation types only
```

Generated files are gitignored. Use `git add -f` if you intentionally want to commit them.
