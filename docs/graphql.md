# GraphQL API — Ravocal

Most of the API is **generated** from the Drizzle tables by `@vantreeseba/drizzle-graphql` (`server/src/graphql/build-schema.ts`). What CRUD can't express is hand-written, in the domain folders, and better-auth's endpoints are added by `server/src/auth/`. `npm run codegen` prints the whole served schema to `server/src/__generated__/schema.graphql`, then generates the app's and the server's types from it; run it after changing a model, a hand-written SDL extension, or a document in `app/src/`. The printed schema is the reference for every argument and type.

Who may read and write what is in AGENTS.md ("Access"). In short: every query answers only rows in the caller's groups, a row out of reach is `NOT_FOUND` (or simply absent from a list, or `null` from a single read), and a mutation not on the allow-list is `FORBIDDEN`.

## Scalars

| Scalar | Representation |
|--------|---------------|
| `DateTime` | ISO 8601 string (e.g. `"2026-06-01T10:00:00.000Z"`) |
| `UUID` | Every id |
| `JSON` | Any JSON value. Only better-auth's types use it |

## What is generated

Types and single-row fields are singular, lists plural: table `time_blocks` is type `TimeBlock`, query `timeBlocks` and `timeBlock`.

- **Queries**, for every exposed table: `groups(where, orderBy, limit, offset, after, distinct)`, `group(where)`, `groupsAggregate`, `groupsGroupBy`, and the same for `groupMembers`, `groupInvites`, `timeBlocks`, `votes`, `voteSlots`, `voteRankings` and `users`. Relations are fields: `group { members { user { name } } votes { slots { startsAt } rankings { rank } } }`, with the same arguments, and `<relation>Aggregate { count }`.
- **Filters**: `where: { id: { eq: $id } }`, with `eq`, `ne`, `lt`/`lte`/`gt`/`gte`, `inArray`, `isNull`, the pattern operators on strings, `AND`/`OR`/`NOT`, and relation filters (`some`/`none`/`every` on to-many). A client filter only ever narrows what the caller may see.
- **Ordering**: `orderBy: { startsAt: { direction: asc, priority: 1 } }`. Without one, vote slots come in ballot order (`position`), votes newest first, time blocks by start, members by when they joined.
- **Pages**: every list, root or relation, returns `limit` rows, 50 when none is named, and refuses more than 500 with `DRIZZLE_LIMIT_EXCEEDED`. `after` takes a row's `cursor` for the next page.
- **Writes** served: `createTimeBlock(values)`, `updateTimeBlock(where, set)`, `deleteTimeBlock(where)`, `updateGroup(where, set)` (name, overlap threshold), `deleteGroup(where)`, `updateUser(where, set)` (your name). Each targets one row and answers `NOT_FOUND` when its `where` matches none the caller may change. The plural forms the library also generates (`updateGroups`, `deleteTimeBlocks`, …) are refused as `FORBIDDEN`.
- `vote.status` is the enum `VotesStatusEnum`: `active` or `closed`.

Not in the schema at all: better-auth's `sessions`, `accounts` and `verifications`, and an invite's `token`.

Common reads:

```graphql
query MyGroups { groups { id name membersAggregate { count } votes(where: { status: { eq: active } }, limit: 1) { id } } }

query Group($id: UUID!) {
  group(where: { id: { eq: $id } }) {        # null for a group you are not in
    name ownerId
    members { userId user { name email } }
    invites(where: { acceptedAt: { isNull: true } }) { id email expiresAt }   # the owner's alone; [] for anyone else
    timeBlocks { userId startsAt endsAt }
    votes(limit: 1) { status winnerSlotId slots(limit: 500) { id startsAt overlapCount } rankings { slotId rank } }  # rankings: your own ballot
  }
}
```

### Generated writes, and their rules

| Write | Who | Checked |
|-------|-----|---------|
| `createTimeBlock(values: { groupId, startsAt, endsAt })` | a member of the group | `userId` is the caller (not in the input). Both ends on the 30-minute grid **in UTC** (`:00` or `:30`, no seconds), the end after the start. A group you aren't in is `NOT_FOUND` |
| `updateTimeBlock(where, set)` | whoever made the block | The same, against the row as written, so moving one end is checked against the other. Moving it into a group you aren't in is `NOT_FOUND` |
| `deleteTimeBlock(where)` | whoever made the block | |
| `updateGroup(where, set: { name?, overlapThreshold? })` | the owner | Name 1–100 characters, threshold 0–100. The owner can't be changed |
| `deleteGroup(where)` | the owner | Everything in the group goes with it |
| `updateUser(where, set: { name })` | yourself | 1–100 characters. The address and its proof are better-auth's |

Any other column in `values` or `set` is `BAD_USER_INPUT`.

## Hand-written

| Field | Kind | Who | Answers |
|-------|------|-----|---------|
| `createGroup(name, overlapThreshold?)` | mutation | anyone signed in | `Group!`: the group, with the caller as owner and first member. Threshold defaults to 50 |
| `removeMember(groupId, userId)` | mutation | the owner | `Group!`. Takes the member's time blocks in the group and their ballot in its open vote with them; a closed vote's result stays. Removing yourself is `BAD_USER_INPUT` |
| `inviteToGroup(groupId, email)` | mutation | the owner | `GroupInvite!`, and emails `${APP_URL}/invite?token=…`. The link works once, for 7 days, for whoever opens it while signed in |
| `acceptGroupInvite(token)` | mutation | anyone signed in | `GroupMember!`. A spent or expired link is `BAD_USER_INPUT`; a cancelled or unknown one `NOT_FOUND`; accepting while already a member is `BAD_USER_INPUT`, and leaves the link unspent |
| `cancelInvite(id)` | mutation | the owner | `Group!`. The link stops working |
| `startVote(groupId)` | mutation | the owner | `Vote!` over the times at least `overlapThreshold`% of members are free. None is `BAD_USER_INPUT` (use `forceStartVote`); so is a second open vote. Emails the members |
| `forceStartVote(groupId)` | mutation | the owner | `Vote!` over every time anyone is free, the owner's first. The order is stored (`VoteSlot.position`) |
| `submitRankings(voteId, rankings: [{ slotId, rank }])` | mutation | members | `[VoteRanking!]!`: your ballot, replacing any earlier one. Each slot once, from this vote, while it is open. `[]` withdraws it |
| `closeVote(voteId)` | mutation | the owner | `Vote!` with `winnerSlotId` set by instant runoff (`docs/voting.md`), and emails the result |
| `authConfig` | query | anyone | `{ secureLocalNet, magicLink, providers { id name signInUrl } }` |

The owner-only and member-only refusals are `NOT_FOUND`, the same as a group or vote that doesn't exist.

## Sign-in and sessions

These fields are better-auth's endpoints, served by `@cubicecho/graphql-better-auth` (`server/src/auth/endpoints.ts`). Their arguments and result types (`Auth…`) are read off better-auth, so they move with a better-auth upgrade. Only the operations in `BETTER_AUTH_OPERATIONS` are served, and better-auth's REST routes are not mounted. A session is a bearer token: send it as `Authorization: Bearer <token>`.

| Field | Kind | Signed in? | Notes |
|-------|------|------------|-------|
| `signInMagicLink(email)` | mutation | no | Emails a link to `${APP_URL}/auth/verify?token=…` and answers `{ status: true, token: null, userId: null }`. Under `SECURE_LOCAL_NET` it sends nothing and answers with a live session in `token` and `userId`. With neither SMTP nor `SECURE_LOCAL_NET` it is refused as `BAD_USER_INPUT` |
| `magicLinkVerify(token)` | mutation | no | Spends a link for `{ token, user, session }`. A spent, expired or unknown link is `BAD_USER_INPUT` ("Invalid or expired sign-in link."), never `UNAUTHENTICATED` |
| `verifyOneTimeToken(token)` | mutation | no | Swaps a provider sign-in's one-time token for `{ token, userId }` |
| `getSession` | query | no | The caller's `{ user, session }`, or null. **This is how the app reads its own user**; there is no `me` |
| `listSessions` | query | yes | Every live session of the caller's account |
| `signOut` | mutation | no | Ends the caller's session: `{ success: true }`, or `false` when there was none |
| `revokeSession(token)`, `revokeSessions`, `revokeOtherSessions` | mutation | yes | End one, all, or all but this one |
| `linkSocialAccount(provider)`, `listUserAccounts`, `unlinkAccount(accountId)` | | yes | Connecting Google or Facebook in Settings |

`signInMagicLink`, `magicLinkVerify` and `verifyOneTimeToken` are rate limited by `ctx.limiter` (`RATE_LIMIT_DEFAULTS`: 5 in 15 minutes): by client address, and the first by email too. Past the budget they are refused as `TOO_MANY_REQUESTS`, with `extensions.retryAfter` in seconds.

## Codegen

```bash
npm run codegen           # both server + app
npm run codegen:server    # print the schema, then the server's resolver types
npm run codegen:app       # app operation types only
```

Generated files are gitignored.
