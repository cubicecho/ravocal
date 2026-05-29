import type { TimeBlock, VoteRanking, VoteSlot } from "@ravocal/db";

type Member = { userId: string };
type SlotCandidate = { startsAt: Date; endsAt: Date; overlapCount: number };

/**
 * Build candidate vote slots from submitted time blocks.
 *
 * In normal mode (isForced=false): only returns slots where the fraction of
 * members who are free meets or exceeds thresholdPct (0–100).
 *
 * In forced mode (isForced=true): returns all distinct 30-min windows that
 * at least one member marked free, sorted so owner's slots appear first,
 * then by descending overlap count.
 */
export function computeVoteSlots(
  members: Member[],
  timeBlocks: TimeBlock[],
  thresholdPct: number,
  isForced: boolean,
  ownerId?: string,
): SlotCandidate[] {
  if (timeBlocks.length === 0) return [];

  const memberCount = members.length;
  const windowMs = 30 * 60 * 1000;

  // Collect all 30-min windows across all blocks
  const windowMap = new Map<string, Set<string>>();
  for (const block of timeBlocks) {
    let t = block.startsAt.getTime();
    const end = block.endsAt.getTime();
    while (t + windowMs <= end) {
      const key = String(t);
      if (!windowMap.has(key)) windowMap.set(key, new Set());
      windowMap.get(key)!.add(block.userId);
      t += windowMs;
    }
  }

  const threshold = (thresholdPct / 100) * memberCount;
  const slots: SlotCandidate[] = [];

  for (const [tsStr, userIds] of windowMap) {
    const overlapCount = userIds.size;
    if (!isForced && overlapCount < threshold) continue;
    const startsAt = new Date(Number(tsStr));
    const endsAt = new Date(Number(tsStr) + windowMs);
    slots.push({ startsAt, endsAt, overlapCount });
  }

  slots.sort((a, b) => {
    if (isForced && ownerId) {
      const aHasOwner = timeBlocks.some(
        (tb) =>
          tb.userId === ownerId &&
          tb.startsAt <= a.startsAt &&
          tb.endsAt >= a.endsAt,
      );
      const bHasOwner = timeBlocks.some(
        (tb) =>
          tb.userId === ownerId &&
          tb.startsAt <= b.startsAt &&
          tb.endsAt >= b.endsAt,
      );
      if (aHasOwner !== bHasOwner) return aHasOwner ? -1 : 1;
    }
    if (b.overlapCount !== a.overlapCount) return b.overlapCount - a.overlapCount;
    return a.startsAt.getTime() - b.startsAt.getTime();
  });

  return slots;
}

/**
 * Instant-runoff ranked-choice tally.
 * Returns the winning slot ID, or null if no rankings were submitted.
 */
export function tallyRankedChoice(
  slots: VoteSlot[],
  rankings: VoteRanking[],
): string | null {
  if (slots.length === 0 || rankings.length === 0) return null;

  const voters = [...new Set(rankings.map((r) => r.userId))];
  const totalVoters = voters.length;
  const remaining = new Set(slots.map((s) => s.id));

  while (remaining.size > 1) {
    const tally = new Map<string, number>();
    for (const slotId of remaining) tally.set(slotId, 0);

    for (const voter of voters) {
      const topChoice = rankings
        .filter((r) => r.userId === voter && remaining.has(r.slotId))
        .sort((a, b) => a.rank - b.rank)[0];
      if (topChoice) tally.set(topChoice.slotId, (tally.get(topChoice.slotId) ?? 0) + 1);
    }

    const winner = [...tally.entries()].find(([, count]) => count > totalVoters / 2);
    if (winner) return winner[0];

    const minVotes = Math.min(...tally.values());
    const toEliminate = [...tally.entries()]
      .filter(([, count]) => count === minVotes)
      .map(([id]) => id);
    for (const id of toEliminate) remaining.delete(id);
  }

  return remaining.size === 1 ? [...remaining][0] : null;
}
