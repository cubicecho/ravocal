# GraphQL API — Ravocal

Schema lives at `server/src/schema.graphql`. After any change, run `npm run codegen` to regenerate types.

## Scalars

| Scalar | Representation |
|--------|---------------|
| `DateTime` | ISO 8601 string (e.g. `"2025-06-01T10:00:00.000Z"`) |

## Queries

### `me: User`
Returns the authenticated user, or null if not logged in.

### `myGroups: [Group!]!`
All groups the authenticated user belongs to (as owner or member).

### `group(id: ID!): Group`
Full group detail. Requires the caller to be a member.

## Mutations

### Auth (no authentication required)

| Mutation | Returns | Notes |
|----------|---------|-------|
| `requestMagicLink(email)` | `Boolean!` | Sends sign-in email |
| `verifyMagicLink(token)` | `AuthPayload!` | Returns JWT + user |

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
