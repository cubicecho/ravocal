import { groupMembers, timeBlocks, voteRankings, votes } from '@cubicecho/ravocal-db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GROUP_DEFAULTS } from '../../core/defaults.ts';
import { ErrorCode } from '../../core/errors.ts';
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

/** The threshold a group gets when its creator names none (the column's default). */
const DEFAULT_THRESHOLD = 50;

const CREATE = `mutation($name: String!, $overlapThreshold: Int) {
  createGroup(name: $name, overlapThreshold: $overlapThreshold) { id name ownerId overlapThreshold members { userId } }
}`;
const UPDATE = `mutation($id: UUID!, $set: UpdateGroupInput!) { updateGroup(where: { id: { eq: $id } }, set: $set) { id } }`;
const REMOVE = `mutation($groupId: UUID!, $userId: UUID!) {
  removeMember(groupId: $groupId, userId: $userId) { id members { userId } }
}`;
const GROUP = `query($id: UUID!) { group(where: { id: { eq: $id } }) { id } }`;
const START = `mutation($groupId: UUID!) { startVote(groupId: $groupId) { id slots { id } } }`;
const SUBMIT = `mutation($voteId: UUID!, $rankings: [RankingInput!]!) { submitRankings(voteId: $voteId, rankings: $rankings) { id } }`;
const CLOSE = `mutation($voteId: UUID!) { closeVote(voteId: $voteId) { winnerSlotId } }`;

describe('groups', () => {
  let db: TestDb;
  let ownerId: string;
  let memberId: string;
  let groupId: string;
  let owner: TestClient;
  let member: TestClient;

  /**
   * Marks a member free for the first hour of a fixed day.
   *
   * @param userId - The member.
   */
  async function freeFirstHour(userId: string): Promise<void> {
    const startsAt = new Date('2026-11-21T09:00:00Z');
    const endsAt = new Date('2026-11-21T10:00:00Z');
    await db.insert(timeBlocks).values({ groupId, userId, startsAt, endsAt });
  }

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(() => closeTestDb(db));

  beforeEach(async () => {
    await resetTestDb(db);
    ownerId = await createUser(db, 'owner@example.com');
    memberId = await createUser(db, 'member@example.com');
    groupId = await createGroup(db, ownerId);
    await addMember(db, groupId, memberId);
    owner = createClient(db, ownerId);
    member = createClient(db, memberId);
  });

  describe('createGroup', () => {
    it('makes the caller its owner and first member, with the default threshold', async () => {
      const { createGroup } = await member.expectOk(CREATE, { name: 'Climbers' });
      expect(createGroup).toMatchObject({ name: 'Climbers', ownerId: memberId, overlapThreshold: DEFAULT_THRESHOLD });
      expect(createGroup.members).toEqual([{ userId: memberId }]);
    });

    it('refuses a threshold over 100 with a sentence', async () => {
      const { message, code } = await owner.expectError(CREATE, { name: 'Climbers', overlapThreshold: 150 });
      expect(code).toBe(ErrorCode.BadUserInput);
      expect(message).toBe('The overlap threshold must be a whole number from 0 to 100.');
    });

    it('refuses a name past the length limit, and a blank one', async () => {
      const name = 'x'.repeat(GROUP_DEFAULTS.maxNameLength + 1);
      const { message, code } = await owner.expectError(CREATE, { name });
      expect(code).toBe(ErrorCode.BadUserInput);
      expect(message).toBe(`Keep the group name to ${GROUP_DEFAULTS.maxNameLength} characters or fewer.`);
      expect((await owner.expectError(CREATE, { name: '   ' })).code).toBe(ErrorCode.BadUserInput);
    });

    it('refuses a caller who is not signed in', async () => {
      const { code } = await createClient(db, null).expectError(CREATE, { name: 'Climbers' });
      expect(code).toBe(ErrorCode.Unauthenticated);
    });
  });

  describe('updateGroup', () => {
    it("checks the owner's new name and threshold as createGroup does", async () => {
      expect((await owner.expectError(UPDATE, { id: groupId, set: { overlapThreshold: 101 } })).code).toBe(
        ErrorCode.BadUserInput,
      );
      expect((await owner.expectError(UPDATE, { id: groupId, set: { name: '' } })).code).toBe(ErrorCode.BadUserInput);
      await owner.expectOk(UPDATE, { id: groupId, set: { overlapThreshold: 75 } });
    });
  });

  describe('removeMember', () => {
    it('takes the member out, with their free time and their ballot in the open vote', async () => {
      await freeFirstHour(ownerId);
      await freeFirstHour(memberId);
      const { startVote } = await owner.expectOk(START, { groupId });
      await member.expectOk(SUBMIT, { voteId: startVote.id, rankings: [{ slotId: startVote.slots[0].id, rank: 1 }] });

      const { removeMember } = await owner.expectOk(REMOVE, { groupId, userId: memberId });
      expect(removeMember.members).toEqual([{ userId: ownerId }]);
      expect(await db.select().from(timeBlocks).where(eq(timeBlocks.userId, memberId))).toEqual([]);
      expect(await db.select().from(voteRankings).where(eq(voteRankings.userId, memberId))).toEqual([]);
      // The removed member no longer finds the group.
      expect((await member.expectOk(GROUP, { id: groupId })).group).toBeNull();
    });

    it("keeps a closed vote's result", async () => {
      await freeFirstHour(ownerId);
      await freeFirstHour(memberId);
      const { startVote } = await owner.expectOk(START, { groupId });
      const rankings = [{ slotId: startVote.slots[1].id, rank: 1 }];
      await member.expectOk(SUBMIT, { voteId: startVote.id, rankings });
      await owner.expectOk(SUBMIT, { voteId: startVote.id, rankings });
      const { closeVote } = await owner.expectOk(CLOSE, { voteId: startVote.id });

      await owner.expectOk(REMOVE, { groupId, userId: memberId });
      const [vote] = await db.select().from(votes).where(eq(votes.id, startVote.id));
      expect(vote.winnerSlotId).toBe(closeVote.winnerSlotId);
      expect(await db.select().from(voteRankings).where(eq(voteRankings.userId, memberId))).toHaveLength(1);
    });

    it('refuses the owner removing themselves', async () => {
      const { code } = await owner.expectError(REMOVE, { groupId, userId: ownerId });
      expect(code).toBe(ErrorCode.BadUserInput);
      expect(await db.select().from(groupMembers).where(eq(groupMembers.groupId, groupId))).toHaveLength(2);
    });

    it('answers NOT_FOUND to a member, to an outsider, and for someone not in the group', async () => {
      expect((await member.expectError(REMOVE, { groupId, userId: ownerId })).code).toBe(ErrorCode.NotFound);
      const outsiderId = await createUser(db, 'outsider@example.com');
      const outsider = createClient(db, outsiderId);
      expect((await outsider.expectError(REMOVE, { groupId, userId: memberId })).code).toBe(ErrorCode.NotFound);
      expect((await owner.expectError(REMOVE, { groupId, userId: outsiderId })).code).toBe(ErrorCode.NotFound);
      expect(await db.select().from(groupMembers).where(eq(groupMembers.groupId, groupId))).toHaveLength(2);
    });
  });
});
