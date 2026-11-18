import type { DB } from '@cubicecho/ravocal-db';
import { groupMembers, voteRankings, votes } from '@cubicecho/ravocal-db/schema';
import DataLoader from 'dataloader';
import { and, countDistinct, eq, inArray } from 'drizzle-orm';
import { requireAuth } from '../core/errors.ts';

/**
 * Counts, per vote, the people with a ballot in it, for the votes of the caller's own groups.
 *
 * @param db - The db.
 * @param userId - The caller.
 * @param voteIds - The votes.
 * @returns One count per vote, in order: 0 for a vote nobody ranked, or one in a group the caller isn't in.
 */
async function countRankedMembers(db: DB, userId: string, voteIds: readonly string[]): Promise<number[]> {
  const isCallersGroup = and(eq(groupMembers.groupId, votes.groupId), eq(groupMembers.userId, userId));
  const rows = await db
    .select({ voteId: voteRankings.voteId, ranked: countDistinct(voteRankings.userId) })
    .from(voteRankings)
    .innerJoin(votes, eq(votes.id, voteRankings.voteId))
    .innerJoin(groupMembers, isCallersGroup)
    .where(inArray(voteRankings.voteId, [...voteIds]))
    .groupBy(voteRankings.voteId);
  const byVote = new Map(rows.map((row) => [row.voteId, row.ranked]));
  return voteIds.map((id) => byVote.get(id) ?? 0);
}

/**
 * Batches `Vote.rankedCount` for one request: every vote it reads is counted in one query.
 *
 * @param db - The db.
 * @param userId - The caller, or null when nobody is signed in.
 * @returns The loader. Signed out, every load is refused as UNAUTHENTICATED.
 */
export function createRankedCountLoader(db: DB, userId: string | null): DataLoader<string, number> {
  return new DataLoader((voteIds) => countRankedMembers(db, requireAuth({ userId }), voteIds));
}
