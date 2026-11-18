import { timeBlocks, votes } from '@cubicecho/ravocal-db/schema';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
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
} from './helpers.ts';

const HALF_HOUR_MS = 30 * 60 * 1000;
const BASE_MS = Date.parse('2026-01-05T09:00:00Z');
const at = (index: number): Date => new Date(BASE_MS + index * HALF_HOUR_MS);

const START = `mutation($groupId: ID!) { startVote(groupId: $groupId) { id isForced status } }`;
const FORCE = `mutation($groupId: ID!) { forceStartVote(groupId: $groupId) { id isForced } }`;
const SUBMIT = `mutation($voteId: ID!, $rankings: [RankingInput!]!) {
  submitRankings(voteId: $voteId, rankings: $rankings) { slotId rank }
}`;
const CLOSE = `mutation($voteId: ID!) { closeVote(voteId: $voteId) { status winnerSlotId } }`;
/** The fields the group page reads off the active vote. */
const ACTIVE_VOTE = `query($id: ID!) {
  group(id: $id) {
    activeVote { id slots { id startsAt overlapCount } myRankings { slotId rank } }
  }
}`;

interface Slot {
  id: string;
  /** A Date in-process: the DateTime scalar serializes to ISO only on the wire. */
  startsAt: Date;
  overlapCount: number;
}

describe('vote resolvers', () => {
  let db: TestDb;
  let ownerId: string;
  let memberId: string;
  let groupId: string;
  let owner: TestClient;
  let member: TestClient;
  let logged: MockInstance<typeof console.log>;

  /**
   * Marks a member free from half hour `from` up to half hour `to`.
   *
   * @param userId - The member.
   * @param from - First half hour, counted from BASE_MS.
   * @param to - The half hour the block ends at.
   */
  async function free(userId: string, from: number, to: number): Promise<void> {
    await db.insert(timeBlocks).values({ groupId, userId, startsAt: at(from), endsAt: at(to) });
  }

  /** The active vote's slots, as a member sees them on the group page. */
  async function activeSlots(client: TestClient): Promise<Slot[]> {
    const { group } = await client.expectOk(ACTIVE_VOTE, { id: groupId });
    return group.activeVote.slots;
  }

  /** Email recipients the console transport logged. */
  const recipients = () =>
    logged.mock.calls.filter(([tag]) => tag === '[email]').map(([, message]) => (message as { to: string }).to);

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(() => closeTestDb(db));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await resetTestDb(db);
    // With SMTP unset the email service logs each message instead of sending it.
    logged = vi.spyOn(console, 'log').mockImplementation(() => {});
    ownerId = await createUser(db, 'owner@example.com');
    memberId = await createUser(db, 'member@example.com');
    groupId = await createGroup(db, ownerId, 100);
    await addMember(db, groupId, memberId);
    owner = createClient(db, ownerId);
    member = createClient(db, memberId);
  });

  describe('startVote', () => {
    it('opens a vote on the slots every member is free for, and emails the members', async () => {
      await free(ownerId, 0, 2);
      await free(memberId, 1, 3);
      const { startVote } = await owner.expectOk(START, { groupId });
      expect(startVote).toMatchObject({ isForced: false, status: 'active' });
      const slots = await activeSlots(member);
      expect(slots.map((slot) => slot.startsAt)).toEqual([at(1)]);
      expect(recipients().sort()).toEqual(['member@example.com', 'owner@example.com']);
    });

    it('refuses when no slot meets the threshold', async () => {
      await free(ownerId, 0, 1);
      await free(memberId, 1, 2);
      const message = await owner.expectError(START, { groupId });
      expect(message).toMatch(/forceStartVote/);
      expect(await db.select().from(votes)).toEqual([]);
    });

    it('refuses a member who is not the owner', async () => {
      await free(ownerId, 0, 1);
      await free(memberId, 0, 1);
      const message = await member.expectError(START, { groupId });
      expect(message).toMatch(/forbidden/i);
      expect(await db.select().from(votes)).toEqual([]);
    });
  });

  describe('forceStartVote', () => {
    it('puts the slots the owner is free for first', async () => {
      // Half hour 0: the member alone. Half hour 1: the owner alone.
      await free(memberId, 0, 1);
      await free(ownerId, 1, 2);
      const { forceStartVote } = await owner.expectOk(FORCE, { groupId });
      expect(forceStartVote.isForced).toBe(true);
      const slots = await activeSlots(owner);
      expect(slots.map((slot) => slot.startsAt)).toEqual([at(1), at(0)]);
    });

    it('refuses a member who is not the owner', async () => {
      await free(memberId, 0, 1);
      const message = await member.expectError(FORCE, { groupId });
      expect(message).toMatch(/forbidden/i);
      expect(await db.select().from(votes)).toEqual([]);
    });
  });

  describe('submitRankings and closeVote', () => {
    let voteId: string;
    let slots: Slot[];

    beforeEach(async () => {
      await free(ownerId, 0, 2);
      await free(memberId, 0, 2);
      const { startVote } = await owner.expectOk(START, { groupId });
      voteId = startVote.id;
      slots = await activeSlots(owner);
    });

    it('shows a member their own rankings on the active vote', async () => {
      const [first, second] = slots;
      const rankings = [
        { slotId: second.id, rank: 1 },
        { slotId: first.id, rank: 2 },
      ];
      await member.expectOk(SUBMIT, { voteId, rankings });
      const { group } = await member.expectOk(ACTIVE_VOTE, { id: groupId });
      expect(group.activeVote.myRankings).toEqual(expect.arrayContaining(rankings));
      const { group: ownerView } = await owner.expectOk(ACTIVE_VOTE, { id: groupId });
      expect(ownerView.activeVote.myRankings).toEqual([]);
    });

    it('refuses rankings from someone outside the group', async () => {
      const outsider = createClient(db, await createUser(db, 'outsider@example.com'));
      const rankings = [{ slotId: slots[0].id, rank: 1 }];
      const message = await outsider.expectError(SUBMIT, { voteId, rankings });
      expect(message).toMatch(/forbidden/i);
    });

    it('closes with the ranked-choice winner', async () => {
      const [, second] = slots;
      const rankings = [{ slotId: second.id, rank: 1 }];
      await owner.expectOk(SUBMIT, { voteId, rankings });
      await member.expectOk(SUBMIT, { voteId, rankings });
      const { closeVote } = await owner.expectOk(CLOSE, { voteId });
      expect(closeVote).toEqual({ status: 'closed', winnerSlotId: second.id });
    });

    it('refuses to close for a member who is not the owner', async () => {
      const message = await member.expectError(CLOSE, { voteId });
      expect(message).toMatch(/forbidden/i);
      const [vote] = await db.select().from(votes);
      expect(vote.status).toBe('active');
    });
  });
});
