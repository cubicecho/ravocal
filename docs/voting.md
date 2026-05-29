# Voting — Ravocal

Logic lives in `server/src/services/voting.ts`.

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
6. Return as `VoteSlot` candidates (each exactly 30 minutes).

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
- Requires caller to be group owner.
- Calls `computeVoteSlots` with the group's `overlapThreshold`.
- Throws if no slots qualify → client should surface "no overlapping slots; use force vote?" UI.
- Creates a `Vote` row + `VoteSlot` rows.
- Sends "vote started" email to all members.

**Forced vote** (`forceStartVote`):
- Same as above but passes `threshold = 0` and `isForced = true`.
- Slots sorted so owner-free slots appear first.
- Throws only if there are zero time blocks in the group.

## Closing a Vote

`closeVote`:
- Requires caller to be group owner.
- Fetches all slots and rankings for the vote.
- Runs `tallyRankedChoice`.
- Sets `status = 'closed'`, `winnerSlotId`, `closedAt`.
- Sends "vote result" email to all members with the winning slot's time range.

The winning slot is displayed in the group detail UI. No calendar integration — users handle the actual event themselves.
