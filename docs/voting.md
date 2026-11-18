# Voting — Ravocal

The algorithm lives in `server/src/votes/tally.ts`: pure functions, with no database, tested in `__tests__/votes/tally.test.ts`. The mutations that use it are in `server/src/votes/resolvers.ts`.

Times are instants. A time block's ends sit on the 30-minute grid **in UTC** (`:00` or `:30`, to the millisecond), checked by the `time_blocks` write hook, so a block written as 09:00 in a zone half an hour off UTC lines up, and one written in a zone a quarter hour off (Nepal, +05:45) is refused. The slots below are the same UTC grid.

## Overlap Computation (`computeVoteSlots`)

Given a list of members, their time blocks, the group's `overlapThreshold`, and an `isForced` flag:

1. Iterate every submitted time block and enumerate all 30-minute windows within it.
2. Build a map: `windowStart → Set<userId>` tracking which members are free in each window.
3. **Normal mode** (`isForced = false`): keep only windows where `|freeMembers| / totalMembers >= threshold / 100`.
4. **Forced mode** (`isForced = true`): keep all windows with at least one free member.
5. Sort the remaining windows:
   - If forced: owner's windows come first (owner is free in that slot).
   - Then by descending `overlapCount`.
   - Then by ascending `startsAt` as a tiebreaker.
6. Return as `VoteSlot` candidates (each exactly 30 minutes), in that order.

### Edge cases

- If no time blocks exist → returns `[]`. The resolver throws an error before creating the vote.
- If normal mode yields no slots → `startVote` throws; client should offer `forceStartVote`.
- All slots have `overlapCount >= 1` in forced mode (at least the owner or one member is free).

## Ranked-Choice Tally (`tallyRankedChoice`)

Instant-runoff voting (IRV) over the candidate slots:

1. Collect all unique voters who submitted rankings.
2. Each round: count first-choice votes among remaining slots (ignoring eliminated slots).
3. If any slot has > 50% of votes → that slot wins.
4. Otherwise: eliminate all slots tied for the minimum vote count.
5. Repeat until one slot remains or a majority is reached.
6. Returns the winning slot ID, or `null` if no rankings were submitted.

### Notes

- A voter's effective first choice is their lowest `rank` value among non-eliminated slots.
- Ties at the bottom are all eliminated simultaneously.
- If all slots are eliminated (pathological case with all ties), returns `null`.
- The tally runs synchronously in memory — slot counts are expected to be small (tens, not thousands).

## Starting a Vote

**Normal vote** (`startVote`):

- Requires the caller to own the group (`NOT_FOUND` otherwise, as for a group that doesn't exist).
- Refuses while the group already has an open vote (`BAD_USER_INPUT`). The database holds it too: `uq_votes_group_id_active` allows one `active` vote per group.
- Calls `computeVoteSlots` with the group's `overlapThreshold`.
- Throws if no slots qualify → client should surface "no overlapping slots; use force vote?" UI.
- Creates a `Vote` row and its `VoteSlot` rows in one transaction, each slot with its `position` on the ballot (0 first): `computeVoteSlots`' order, stored rather than left to insert order.
- Once that commits, emails every member that the vote has started.

**Forced vote** (`forceStartVote`):

- Same as above but passes `threshold = 0` and `isForced = true`.
- Slots sorted so owner-free slots appear first, and that order is what `position` stores. `Vote.slots` comes back in `position` order unless the request names another, so the owner-first order survives a reload.
- Throws only if there are zero time blocks in the group.

**Ranking** (`submitRankings`): a member of the vote's group replaces their whole ballot while the vote is open. Each slot at most once, and only this vote's slots; `[]` withdraws the ballot. A member reads back only their own rankings.

## Closing a Vote

`closeVote`:

- Requires the caller to own the vote's group (`NOT_FOUND` otherwise).
- Fetches all slots and rankings for the vote.
- Runs `tallyRankedChoice`.
- Sets `status = 'closed'`, `winnerSlotId`, `closedAt`, in one transaction.
- Once that commits, emails every member the winning slot's time range, in UTC.

The group page shows the group's newest vote: its candidates while it is open, and the winner once it has closed. No calendar integration — users handle the actual event themselves.

Removing a member (`removeMember`) deletes their rankings in the group's open vote. A closed vote's rankings and result stay as they were.
