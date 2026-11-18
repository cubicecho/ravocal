import { timeBlocks, voteSlots, votes } from '@cubicecho/ravocal-db/schema';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MailMessage } from '../../auth/email.ts';
import { ErrorCode } from '../../core/errors.ts';
import { MS_PER_MINUTE } from '../../core/wire.ts';
import {
  addMember,
  closeTestDb,
  createClient,
  createGroup,
  createTestDb,
  createUser,
  resetTestDb,
  type TestClient,
  type TestDb,
} from '../helpers.ts';

/** A half hour. */
const HALF_HOUR_MS = 30 * MS_PER_MINUTE;
const BASE_MS = Date.parse('2026-01-05T09:00:00Z');

/**
 * The start of a half hour, as the wire carries it.
 *
 * @param index - Half hours after BASE_MS.
 * @returns The instant.
 */
const at = (index: number): string => new Date(BASE_MS + index * HALF_HOUR_MS).toISOString();

const START = `mutation($groupId: UUID!) { startVote(groupId: $groupId) { id isForced status } }`;
const FORCE = `mutation($groupId: UUID!) { forceStartVote(groupId: $groupId) { id isForced } }`;
const SUBMIT = `mutation($voteId: UUID!, $rankings: [RankingInput!]!) {
  submitRankings(voteId: $voteId, rankings: $rankings) { slotId rank }
}`;
const CLOSE = `mutation($voteId: UUID!) { closeVote(voteId: $voteId) { status winnerSlotId closedAt } }`;
/** What the group page reads: the group's latest vote, its slots in ballot order, and the reader's own ballot. */
const LATEST_VOTE = `query($id: UUID!) {
  group(where: { id: { eq: $id } }) {
    votes(limit: 1) { id status isForced winnerSlotId slots { id startsAt overlapCount } rankings { slotId rank } }
  }
}`;

interface Slot {
  id: string;
  /** A Date in-process: the DateTime scalar serializes to ISO only on the wire. */
  startsAt: Date;
  overlapCount: number;
}

/**
 * Lists slots' starts as the wire would carry them.
 *
 * @param slots - The slots, in the order read.
 * @returns Their starts, as ISO strings.
 */
const startsOf = (slots: Slot[]): string[] => slots.map((slot) => slot.startsAt.toISOString());

describe('votes', () => {
  let db: TestDb;
  let ownerId: string;
  let memberId: string;
  let groupId: string;
  let mail: MailMessage[];
  let owner: TestClient;
  let member: TestClient;

  /**
   * Marks a member free from half hour `from` up to half hour `to`.
   *
   * @param userId - The member.
   * @param from - First half hour, counted from BASE_MS.
   * @param to - The half hour the block ends at.
   */
  async function free(userId: string, from: number, to: number): Promise<void> {
    await db.insert(timeBlocks).values({ groupId, userId, startsAt: new Date(at(from)), endsAt: new Date(at(to)) });
  }

  /**
   * Reads the group's latest vote as a member sees it.
   *
   * @param client - Who reads it.
   * @returns The vote.
   */
  async function latestVote(client: TestClient) {
    const { group } = await client.expectOk(LATEST_VOTE, { id: groupId });
    return group.votes[0];
  }

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(() => closeTestDb(db));

  beforeEach(async () => {
    await resetTestDb(db);
    mail = [];
    ownerId = await createUser(db, 'owner@example.com');
    memberId = await createUser(db, 'member@example.com');
    groupId = await createGroup(db, ownerId, 100);
    await addMember(db, groupId, memberId);
    owner = createClient(db, ownerId, { mail });
    member = createClient(db, memberId, { mail });
  });

  describe('startVote', () => {
    it('opens a vote on the slots every member is free for, and emails the members', async () => {
      await free(ownerId, 0, 2);
      await free(memberId, 1, 3);
      const { startVote } = await owner.expectOk(START, { groupId });
      expect(startVote).toMatchObject({ isForced: false, status: 'active' });
      const vote = await latestVote(member);
      expect(startsOf(vote.slots)).toEqual([at(1)]);
      expect(mail.map((message) => message.to).sort()).toEqual(['member@example.com', 'owner@example.com']);
    });

    it('refuses when no slot meets the threshold', async () => {
      await free(ownerId, 0, 1);
      await free(memberId, 1, 2);
      const { message, code } = await owner.expectError(START, { groupId });
      expect(message).toMatch(/forceStartVote/);
      expect(code).toBe(ErrorCode.BadUserInput);
      expect(await db.select().from(votes)).toEqual([]);
    });

    it('refuses a second open vote', async () => {
      await free(ownerId, 0, 1);
      await free(memberId, 0, 1);
      await owner.expectOk(START, { groupId });
      expect((await owner.expectError(FORCE, { groupId })).code).toBe(ErrorCode.BadUserInput);
      expect(await db.select().from(votes)).toHaveLength(1);
    });
  });

  describe('forceStartVote', () => {
    it("stores the owner's slots first, and the page reads them back in that order", async () => {
      // Half hours 0 and 1: the member alone. Half hour 2: the owner alone. Sorting by time would put 2 last.
      await free(memberId, 0, 2);
      await free(ownerId, 2, 3);
      const { forceStartVote } = await owner.expectOk(FORCE, { groupId });
      expect(forceStartVote.isForced).toBe(true);

      const stored = await db
        .select()
        .from(voteSlots)
        .where(eq(voteSlots.voteId, forceStartVote.id))
        .orderBy(asc(voteSlots.position));
      expect(stored.map((slot: { startsAt: Date }) => slot.startsAt.toISOString())).toEqual([at(2), at(0), at(1)]);
      // A fresh read, nothing cached: the order is the stored one.
      const vote = await latestVote(createClient(db, memberId));
      expect(startsOf(vote.slots)).toEqual([at(2), at(0), at(1)]);
    });
  });

  describe('submitRankings and closeVote', () => {
    let voteId: string;
    let slots: Slot[];

    beforeEach(async () => {
      await free(ownerId, 0, 2);
      await free(memberId, 0, 2);
      voteId = (await owner.expectOk(START, { groupId })).startVote.id;
      slots = (await latestVote(owner)).slots;
    });

    it('replaces a ballot, and shows each member only their own', async () => {
      const [first, second] = slots;
      await member.expectOk(SUBMIT, { voteId, rankings: [{ slotId: first.id, rank: 1 }] });
      const rankings = [
        { slotId: second.id, rank: 1 },
        { slotId: first.id, rank: 2 },
      ];
      const { submitRankings } = await member.expectOk(SUBMIT, { voteId, rankings });
      expect(submitRankings).toEqual(expect.arrayContaining(rankings));
      expect((await latestVote(member)).rankings).toHaveLength(2);
      expect((await latestVote(owner)).rankings).toEqual([]);
    });

    it('refuses a ballot that ranks a slot twice, or one from another vote', async () => {
      const [first] = slots;
      const twice = [
        { slotId: first.id, rank: 1 },
        { slotId: first.id, rank: 2 },
      ];
      expect((await member.expectError(SUBMIT, { voteId, rankings: twice })).code).toBe(ErrorCode.BadUserInput);
      const foreign = [{ slotId: voteId, rank: 1 }];
      expect((await member.expectError(SUBMIT, { voteId, rankings: foreign })).code).toBe(ErrorCode.BadUserInput);
    });

    it('closes with the ranked-choice winner, emails the result, and keeps it readable', async () => {
      const [, second] = slots;
      const rankings = [{ slotId: second.id, rank: 1 }];
      await owner.expectOk(SUBMIT, { voteId, rankings });
      await member.expectOk(SUBMIT, { voteId, rankings });
      mail.length = 0;
      const { closeVote } = await owner.expectOk(CLOSE, { voteId });
      expect(closeVote).toMatchObject({ status: 'closed', winnerSlotId: second.id });
      expect(mail).toHaveLength(2);
      expect((await latestVote(member)).winnerSlotId).toBe(second.id);
    });

    it('refuses a ballot once the vote has closed', async () => {
      await owner.expectOk(CLOSE, { voteId });
      const rankings = [{ slotId: slots[0].id, rank: 1 }];
      expect((await member.expectError(SUBMIT, { voteId, rankings })).code).toBe(ErrorCode.BadUserInput);
    });

    it('answers NOT_FOUND to a member who closes it', async () => {
      expect((await member.expectError(CLOSE, { voteId })).code).toBe(ErrorCode.NotFound);
      const [vote] = await db.select().from(votes);
      expect(vote.status).toBe('active');
    });
  });
});
