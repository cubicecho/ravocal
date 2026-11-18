import { groupInvites, groups, timeBlocks, users } from '@cubicecho/ravocal-db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OPERATION_LIMIT_DEFAULTS, USER_DEFAULTS } from '../../core/defaults.ts';
import { ErrorCode } from '../../core/errors.ts';
import { createRankedCountLoader } from '../../votes/loaders.ts';
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

// The access rules, one table at a time: who reads a row, and who may write it. Alice owns "Book club" and Bob is a
// member of it; Carol owns "Solo", a group of her own, and is in no other.

/** drizzle-graphql's code for a `limit` past the largest page. */
const DRIZZLE_LIMIT_EXCEEDED = 'DRIZZLE_LIMIT_EXCEEDED';

/**
 * An instant on the half-hour grid, on one fixed day.
 *
 * @param halfHours - Half hours after 09:00 UTC.
 * @returns The instant, as the wire carries it.
 */
const at = (halfHours: number): string => new Date(Date.UTC(2026, 10, 21, 9, halfHours * 30)).toISOString();

const GROUPS = '{ groups { id name } }';
const GROUP = `query($id: UUID!) { group(where: { id: { eq: $id } }) { id name } }`;
const MEMBERS = `query($id: UUID!) {
  group(where: { id: { eq: $id } }) { members { userId } }
  groupMembers { userId groupId }
}`;
const INVITES = `query($id: UUID!) {
  group(where: { id: { eq: $id } }) { invites { email } }
  groupInvites { email }
}`;
const TIME_BLOCKS = '{ timeBlocks { id userId } }';
const UPDATE_GROUP = `mutation($where: GroupFilters!, $name: String!) { updateGroup(where: $where, set: { name: $name }) { id name } }`;
const DELETE_GROUP = `mutation($id: UUID!) { deleteGroup(where: { id: { eq: $id } }) { id } }`;
const CREATE_BLOCK = `mutation($groupId: UUID!, $startsAt: DateTime!, $endsAt: DateTime!) {
  createTimeBlock(values: { groupId: $groupId, startsAt: $startsAt, endsAt: $endsAt }) { id userId }
}`;
const UPDATE_BLOCK = `mutation($where: TimeBlockFilters!, $endsAt: DateTime!) {
  updateTimeBlock(where: $where, set: { endsAt: $endsAt }) { id userId }
}`;
const DELETE_BLOCK = `mutation($id: UUID!) { deleteTimeBlock(where: { id: { eq: $id } }) { id } }`;
const START_VOTE = `mutation($groupId: UUID!) { startVote(groupId: $groupId) { id slots { id } } }`;
const VOTE = `query($id: UUID!) { vote(where: { id: { eq: $id } }) { id slots { id } rankings { userId } } }`;
const SUBMIT = `mutation($voteId: UUID!, $rankings: [RankingInput!]!) {
  submitRankings(voteId: $voteId, rankings: $rankings) { userId slotId }
}`;
const RANKINGS = '{ voteRankings { userId } }';
const USERS = '{ users { email } }';
const UPDATE_USER = `mutation($where: UserFilters!, $set: UpdateUserInput!) { updateUser(where: $where, set: $set) { id name } }`;

describe('access rules', () => {
  let db: TestDb;
  let aliceId: string;
  let bobId: string;
  let carolId: string;
  let bookClub: string;
  let solo: string;
  let alice: TestClient;
  let bob: TestClient;
  let carol: TestClient;

  /**
   * Marks a member free in a group, straight through Drizzle.
   *
   * @param groupId - The group.
   * @param userId - The member.
   * @param from - First half hour.
   * @param to - The half hour it ends at.
   * @returns The block's id.
   */
  async function free(groupId: string, userId: string, from: number, to: number): Promise<string> {
    const [block] = await db
      .insert(timeBlocks)
      .values({ groupId, userId, startsAt: new Date(at(from)), endsAt: new Date(at(to)) })
      .returning();
    return block.id;
  }

  /**
   * Reads a group's name straight from the database.
   *
   * @param id - The group.
   * @returns Its name, or undefined once it is gone.
   */
  async function groupName(id: string): Promise<string | undefined> {
    const [row] = await db.select().from(groups).where(eq(groups.id, id));
    return row?.name;
  }

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(() => closeTestDb(db));

  beforeEach(async () => {
    await resetTestDb(db);
    aliceId = await createUser(db, 'alice@example.com');
    bobId = await createUser(db, 'bob@example.com');
    carolId = await createUser(db, 'carol@example.com');
    bookClub = await createGroup(db, aliceId);
    await addMember(db, bookClub, bobId);
    solo = await createGroup(db, carolId);
    alice = createClient(db, aliceId);
    bob = createClient(db, bobId);
    carol = createClient(db, carolId);
  });

  it('refuses every read and write to a caller who is not signed in', async () => {
    const anonymous = createClient(db, null);
    expect((await anonymous.expectError(GROUPS)).code).toBe(ErrorCode.Unauthenticated);
    const write = { groupId: bookClub, startsAt: at(0), endsAt: at(1) };
    expect((await anonymous.expectError(CREATE_BLOCK, write)).code).toBe(ErrorCode.Unauthenticated);
  });

  it('refuses a page past the largest one', async () => {
    const { code } = await alice.expectError(`{ groups(limit: ${OPERATION_LIMIT_DEFAULTS.maxPageSize + 1}) { id } }`);
    expect(code).toBe(DRIZZLE_LIMIT_EXCEEDED);
  });

  describe('groups', () => {
    it('lists only the groups the caller is a member of', async () => {
      expect((await bob.expectOk(GROUPS)).groups).toEqual([{ id: bookClub, name: 'Book club' }]);
      expect((await carol.expectOk(GROUPS)).groups).toEqual([{ id: solo, name: 'Book club' }]);
    });

    it("answers a non-member's read of one group with null, not an error", async () => {
      expect((await carol.expectOk(GROUP, { id: bookClub })).group).toBeNull();
      expect((await bob.expectOk(GROUP, { id: bookClub })).group).toEqual({ id: bookClub, name: 'Book club' });
    });

    it("can't be widened by a client OR", async () => {
      const where = { OR: [{ id: { eq: bookClub } }, { id: { eq: solo } }] };
      const { groups: seen } = await carol.expectOk('query($where: GroupFilters) { groups(where: $where) { id } }', {
        where,
      });
      expect(seen).toEqual([{ id: solo }]);
    });

    it('lets the owner rename it', async () => {
      const where = { id: { eq: bookClub } };
      const { updateGroup } = await alice.expectOk(UPDATE_GROUP, { where, name: 'Readers' });
      expect(updateGroup).toEqual({ id: bookClub, name: 'Readers' });
    });

    it('answers NOT_FOUND to a member or an outsider who renames it, and changes nothing', async () => {
      const where = { id: { eq: bookClub } };
      expect((await bob.expectError(UPDATE_GROUP, { where, name: "Bob's" })).code).toBe(ErrorCode.NotFound);
      expect((await carol.expectError(UPDATE_GROUP, { where, name: "Carol's" })).code).toBe(ErrorCode.NotFound);
      expect(await groupName(bookClub)).toBe('Book club');
    });

    it("can't be widened to a group the caller doesn't own by an OR in the write's where", async () => {
      const where = { OR: [{ id: { eq: bookClub } }, { id: { eq: solo } }] };
      const { updateGroup } = await carol.expectOk(UPDATE_GROUP, { where, name: 'Mine' });
      expect(updateGroup).toEqual({ id: solo, name: 'Mine' });
      expect(await groupName(bookClub)).toBe('Book club');
      const { code } = await bob.expectError(UPDATE_GROUP, { where, name: 'Mine' });
      expect(code).toBe(ErrorCode.NotFound);
    });

    it('refuses a column the owner may not set', async () => {
      const update = `mutation($id: UUID!) {
        updateGroup(where: { id: { eq: $id } }, set: { createdAt: "2020-01-01T00:00:00.000Z" }) { id }
      }`;
      expect((await alice.expectError(update, { id: bookClub })).code).toBe(ErrorCode.BadUserInput);
      const handOver = `mutation($id: UUID!, $to: UUID!) { updateGroup(where: { id: { eq: $id } }, set: { ownerId: $to }) { id } }`;
      const { message } = await alice.expectError(handOver, { id: bookClub, to: bobId });
      // ownerId is not in the input at all.
      expect(message).toMatch(/ownerId/);
    });

    it('lets only the owner delete it, one row at a time', async () => {
      expect((await bob.expectError(DELETE_GROUP, { id: bookClub })).code).toBe(ErrorCode.NotFound);
      expect((await carol.expectError(DELETE_GROUP, { id: bookClub })).code).toBe(ErrorCode.NotFound);
      expect(await groupName(bookClub)).toBe('Book club');
      expect((await alice.expectOk(DELETE_GROUP, { id: bookClub })).deleteGroup).toEqual({ id: bookClub });
      expect(await groupName(bookClub)).toBeUndefined();
    });

    it('refuses the bulk forms to everyone, the owner included', async () => {
      const bulk = `mutation { deleteGroups(where: {}) { id } }`;
      expect((await alice.expectError(bulk)).code).toBe(ErrorCode.Forbidden);
      expect(await groupName(bookClub)).toBe('Book club');
    });
  });

  describe('group_members', () => {
    it('shows a member who else is in their groups, and an outsider nobody', async () => {
      const { group, groupMembers } = await bob.expectOk(MEMBERS, { id: bookClub });
      expect(group.members.map((member: { userId: string }) => member.userId)).toEqual([aliceId, bobId]);
      expect(groupMembers).toHaveLength(2);
      const outsider = await carol.expectOk(MEMBERS, { id: bookClub });
      expect(outsider.group).toBeNull();
      expect(outsider.groupMembers).toEqual([{ userId: carolId, groupId: solo }]);
    });

    it('has no generated writes', async () => {
      const join = `mutation($g: UUID!, $u: UUID!) { createGroupMember(values: { groupId: $g, userId: $u }) { id } }`;
      const { message } = await carol.expectError(join, { g: bookClub, u: carolId });
      expect(message).toMatch(/Cannot query field "createGroupMember"/);
    });
  });

  describe('group_invites', () => {
    beforeEach(async () => {
      await db
        .insert(groupInvites)
        .values({ groupId: bookClub, email: 'dan@example.com', expiresAt: new Date(Date.now() + 60_000) });
    });

    it("shows a group's invites to its owner alone", async () => {
      const owner = await alice.expectOk(INVITES, { id: bookClub });
      expect(owner.group.invites).toEqual([{ email: 'dan@example.com' }]);
      expect(owner.groupInvites).toEqual([{ email: 'dan@example.com' }]);
      const member = await bob.expectOk(INVITES, { id: bookClub });
      expect(member.group.invites).toEqual([]);
      expect(member.groupInvites).toEqual([]);
      expect((await carol.expectOk(INVITES, { id: bookClub })).groupInvites).toEqual([]);
    });

    it("never serves an invite's token", async () => {
      const { message } = await alice.expectError('{ groupInvites { token } }');
      expect(message).toMatch(/Cannot query field "token"/);
    });
  });

  describe('time_blocks', () => {
    let aliceBlock: string;
    let bobBlock: string;

    beforeEach(async () => {
      aliceBlock = await free(bookClub, aliceId, 0, 4);
      bobBlock = await free(bookClub, bobId, 2, 6);
      await free(solo, carolId, 0, 2);
    });

    it("shows a member every block in their groups, and none of another group's", async () => {
      expect((await bob.expectOk(TIME_BLOCKS)).timeBlocks).toHaveLength(2);
      expect((await carol.expectOk(TIME_BLOCKS)).timeBlocks).toEqual([{ id: expect.any(String), userId: carolId }]);
    });

    it('lets owner and member alike add a block, stamped as theirs', async () => {
      const write = { groupId: bookClub, startsAt: at(8), endsAt: at(10) };
      expect((await bob.expectOk(CREATE_BLOCK, write)).createTimeBlock.userId).toBe(bobId);
      expect((await alice.expectOk(CREATE_BLOCK, write)).createTimeBlock.userId).toBe(aliceId);
    });

    it("refuses a block in a group the caller isn't in as NOT_FOUND, and writes nothing", async () => {
      const write = { groupId: bookClub, startsAt: at(8), endsAt: at(10) };
      expect((await carol.expectError(CREATE_BLOCK, write)).code).toBe(ErrorCode.NotFound);
      const carols = await db.select().from(timeBlocks).where(eq(timeBlocks.userId, carolId));
      expect(carols).toHaveLength(1);
    });

    it("lets a member change and delete their own blocks, and answers NOT_FOUND for anyone else's", async () => {
      const where = { id: { eq: aliceBlock } };
      expect((await bob.expectError(UPDATE_BLOCK, { where, endsAt: at(5) })).code).toBe(ErrorCode.NotFound);
      expect((await carol.expectError(UPDATE_BLOCK, { where, endsAt: at(5) })).code).toBe(ErrorCode.NotFound);
      expect((await bob.expectError(DELETE_BLOCK, { id: aliceBlock })).code).toBe(ErrorCode.NotFound);
      // Even the group's owner may not change a member's free time.
      expect((await alice.expectError(DELETE_BLOCK, { id: bobBlock })).code).toBe(ErrorCode.NotFound);
      const own = await bob.expectOk(UPDATE_BLOCK, { where: { id: { eq: bobBlock } }, endsAt: at(8) });
      expect(own.updateTimeBlock).toEqual({ id: bobBlock, userId: bobId });
      expect((await bob.expectOk(DELETE_BLOCK, { id: bobBlock })).deleteTimeBlock).toEqual({ id: bobBlock });
      const remaining = await db.select().from(timeBlocks).where(eq(timeBlocks.groupId, bookClub));
      expect(remaining.map((block: { id: string }) => block.id)).toEqual([aliceBlock]);
    });

    it("can't be widened to another member's block by an OR in the write's where", async () => {
      const where = { OR: [{ id: { eq: aliceBlock } }, { id: { eq: bobBlock } }] };
      const { updateTimeBlock } = await bob.expectOk(UPDATE_BLOCK, { where, endsAt: at(8) });
      expect(updateTimeBlock).toEqual({ id: bobBlock, userId: bobId });
      const [untouched] = await db.select().from(timeBlocks).where(eq(timeBlocks.id, aliceBlock));
      expect(untouched.endsAt.toISOString()).toBe(at(4));
    });

    it("refuses moving a block into a group the caller isn't in", async () => {
      const move = `mutation($id: UUID!, $groupId: UUID!) {
        updateTimeBlock(where: { id: { eq: $id } }, set: { groupId: $groupId }) { id }
      }`;
      expect((await bob.expectError(move, { id: bobBlock, groupId: solo })).code).toBe(ErrorCode.NotFound);
      const [unmoved] = await db.select().from(timeBlocks).where(eq(timeBlocks.id, bobBlock));
      expect(unmoved.groupId).toBe(bookClub);
    });
  });

  describe('votes and vote_slots', () => {
    let voteId: string;

    beforeEach(async () => {
      await free(bookClub, aliceId, 0, 2);
      await free(bookClub, bobId, 0, 2);
      voteId = (await alice.expectOk(START_VOTE, { groupId: bookClub })).startVote.id;
    });

    it("shows a vote and its slots to the group's members, and to nobody else", async () => {
      expect((await bob.expectOk(VOTE, { id: voteId })).vote.slots).toHaveLength(2);
      expect((await carol.expectOk(VOTE, { id: voteId })).vote).toBeNull();
      expect((await carol.expectOk('{ votes { id } voteSlots { id } }')).votes).toEqual([]);
    });

    it('lets only the owner start one', async () => {
      await alice.expectOk(`mutation($id: UUID!) { closeVote(voteId: $id) { id } }`, { id: voteId });
      expect((await bob.expectError(START_VOTE, { groupId: bookClub })).code).toBe(ErrorCode.NotFound);
      expect((await carol.expectError(START_VOTE, { groupId: bookClub })).code).toBe(ErrorCode.NotFound);
    });

    it('has no generated writes', async () => {
      const close = `mutation($id: UUID!) { updateVote(where: { id: { eq: $id } }, set: { status: closed }) { id } }`;
      const { message } = await alice.expectError(close, { id: voteId });
      expect(message).toMatch(/Cannot query field "updateVote"/);
    });
  });

  describe('vote_rankings', () => {
    let voteId: string;
    let slotIds: string[];

    beforeEach(async () => {
      await free(bookClub, aliceId, 0, 2);
      await free(bookClub, bobId, 0, 2);
      const { startVote } = await alice.expectOk(START_VOTE, { groupId: bookClub });
      voteId = startVote.id;
      slotIds = startVote.slots.map((slot: { id: string }) => slot.id);
    });

    it("shows each member their own ballot and nobody else's", async () => {
      await bob.expectOk(SUBMIT, { voteId, rankings: [{ slotId: slotIds[0], rank: 1 }] });
      expect((await bob.expectOk(VOTE, { id: voteId })).vote.rankings).toEqual([{ userId: bobId }]);
      expect((await alice.expectOk(VOTE, { id: voteId })).vote.rankings).toEqual([]);
      expect((await alice.expectOk(RANKINGS)).voteRankings).toEqual([]);
      expect((await carol.expectOk(RANKINGS)).voteRankings).toEqual([]);
    });

    it('tells every member how many have ranked, never who, and an outsider nothing', async () => {
      await bob.expectOk(SUBMIT, { voteId, rankings: [{ slotId: slotIds[0], rank: 1 }] });
      const progress = `query($id: UUID!) { vote(where: { id: { eq: $id } }) { id rankedCount } }`;
      expect((await alice.expectOk(progress, { id: voteId })).vote).toEqual({ id: voteId, rankedCount: 1 });
      expect((await bob.expectOk(progress, { id: voteId })).vote.rankedCount).toBe(1);
      expect((await carol.expectOk(progress, { id: voteId })).vote).toBeNull();
      // Even handed the id, the count is only of the caller's own groups.
      expect(await createRankedCountLoader(db, carolId).load(voteId)).toBe(0);
    });

    it('refuses a ballot from outside the group as NOT_FOUND', async () => {
      const rankings = [{ slotId: slotIds[0], rank: 1 }];
      expect((await carol.expectError(SUBMIT, { voteId, rankings })).code).toBe(ErrorCode.NotFound);
    });
  });

  describe('users', () => {
    it('shows the caller themselves and the people they share a group with', async () => {
      const emails = (data: { users: Array<{ email: string }> }) => data.users.map((user) => user.email).sort();
      expect(emails(await bob.expectOk(USERS))).toEqual(['alice@example.com', 'bob@example.com']);
      expect(emails(await carol.expectOk(USERS))).toEqual(['carol@example.com']);
      const loner = createClient(db, await createUser(db, 'dan@example.com'));
      expect(emails(await loner.expectOk(USERS))).toEqual(['dan@example.com']);
    });

    it('lets a user rename themselves, and answers NOT_FOUND for anyone else', async () => {
      const own = await bob.expectOk(UPDATE_USER, { where: { id: { eq: bobId } }, set: { name: 'Bob' } });
      expect(own.updateUser).toEqual({ id: bobId, name: 'Bob' });
      const other = { where: { id: { eq: aliceId } }, set: { name: 'Mallory' } };
      expect((await bob.expectError(UPDATE_USER, other)).code).toBe(ErrorCode.NotFound);
      expect((await carol.expectError(UPDATE_USER, other)).code).toBe(ErrorCode.NotFound);
    });

    it("can't be widened to another user by an OR in the write's where", async () => {
      const where = { OR: [{ id: { eq: aliceId } }, { id: { eq: bobId } }] };
      const { updateUser } = await bob.expectOk(UPDATE_USER, { where, set: { name: 'Bob' } });
      expect(updateUser).toEqual({ id: bobId, name: 'Bob' });
      const [untouched] = await db.select().from(users).where(eq(users.id, aliceId));
      expect(untouched.name).toBe('alice@example.com');
    });

    it('refuses a name past the length limit', async () => {
      const set = { name: 'x'.repeat(USER_DEFAULTS.maxNameLength + 1) };
      const { code } = await bob.expectError(UPDATE_USER, { where: { id: { eq: bobId } }, set });
      expect(code).toBe(ErrorCode.BadUserInput);
    });

    it.each([
      ['the address', { email: 'bob@elsewhere.example' }],
      ['being the admin', { isAdmin: true }],
    ])('refuses changing anything but the name: %s', async (_what, set) => {
      const { code } = await bob.expectError(UPDATE_USER, { where: { id: { eq: bobId } }, set });
      expect(code).toBe(ErrorCode.BadUserInput);
      const [unchanged] = await db.select().from(users).where(eq(users.id, bobId));
      expect(unchanged).toMatchObject({ email: 'bob@example.com', isAdmin: false });
    });
  });
});
