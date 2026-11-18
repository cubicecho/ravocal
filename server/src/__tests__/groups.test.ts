import { groupInvites, groupMembers } from '@cubicecho/ravocal-db/schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GROUP_DEFAULTS } from '../core/defaults.ts';
import { ErrorCode } from '../core/errors.ts';
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

const DAY_MS = 24 * 60 * 60 * 1000;

const GROUP = `query($id: ID!) {
  group(id: $id) { id name owner { id } members { userId user { email } } pendingInvites { email } }
}`;
const INVITE = `mutation($groupId: ID!, $email: String!) {
  inviteToGroup(groupId: $groupId, email: $email) { id }
}`;
const ACCEPT = `mutation($token: String!) { acceptGroupInvite(token: $token) { groupId userId } }`;

describe('group resolvers', () => {
  let db: TestDb;
  let ownerId: string;
  let memberId: string;
  let outsiderId: string;
  let groupId: string;
  let owner: TestClient;
  let member: TestClient;
  let outsider: TestClient;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(() => closeTestDb(db));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await resetTestDb(db);
    // The email service logs to the console when SMTP is unset.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    ownerId = await createUser(db, 'owner@example.com');
    memberId = await createUser(db, 'member@example.com');
    outsiderId = await createUser(db, 'outsider@example.com');
    groupId = await createGroup(db, ownerId);
    await addMember(db, groupId, memberId);
    owner = createClient(db, ownerId);
    member = createClient(db, memberId);
    outsider = createClient(db, outsiderId);
  });

  describe('group', () => {
    it('lets a member read the group with its members', async () => {
      const { group } = await member.expectOk(GROUP, { id: groupId });
      expect(group.owner.id).toBe(ownerId);
      const memberIds = group.members.map((m: { userId: string }) => m.userId);
      expect(memberIds).toEqual(expect.arrayContaining([ownerId, memberId]));
    });

    it('refuses a user who is not a member', async () => {
      const { message, code } = await outsider.expectError(GROUP, { id: groupId });
      expect(message).toMatch(/forbidden/i);
      expect(code).toBe(ErrorCode.Forbidden);
    });

    it('refuses an anonymous caller', async () => {
      const { message, code } = await createClient(db, null).expectError(GROUP, { id: groupId });
      expect(message).toMatch(/not authenticated/i);
      expect(code).toBe(ErrorCode.Unauthenticated);
    });
  });

  describe('createGroup', () => {
    const CREATE = `mutation($name: String!, $overlapThreshold: Int) {
      createGroup(name: $name, overlapThreshold: $overlapThreshold) { id overlapThreshold }
    }`;

    it('gives a group created without a threshold the default one', async () => {
      const { createGroup } = await owner.expectOk(CREATE, { name: 'Climbers' });
      expect(createGroup.overlapThreshold).toBe(50);
    });

    it('refuses a threshold over 100 with a sentence', async () => {
      const { message, code } = await owner.expectError(CREATE, { name: 'Climbers', overlapThreshold: 150 });
      expect(code).toBe(ErrorCode.BadUserInput);
      expect(message).toBe('The overlap threshold must be a whole number from 0 to 100.');
    });

    it('refuses a name past the length limit', async () => {
      const name = 'x'.repeat(GROUP_DEFAULTS.maxNameLength + 1);
      const { message, code } = await owner.expectError(CREATE, { name });
      expect(code).toBe(ErrorCode.BadUserInput);
      expect(message).toBe(`Keep the group name to ${GROUP_DEFAULTS.maxNameLength} characters or fewer.`);
    });
  });

  describe('inviteToGroup', () => {
    it('refuses a member who is not the owner', async () => {
      const { message, code } = await member.expectError(INVITE, { groupId, email: 'new@example.com' });
      expect(message).toMatch(/forbidden/i);
      expect(code).toBe(ErrorCode.Forbidden);
      expect(await db.select().from(groupInvites)).toEqual([]);
    });
  });

  describe('acceptGroupInvite', () => {
    let inviteeId: string;
    let invitee: TestClient;

    /** The token of the one invite in the db. It only leaves the server by email. */
    async function inviteToken(): Promise<string> {
      const [invite] = await db.select().from(groupInvites);
      return invite.token;
    }

    async function isMember(userId: string): Promise<boolean> {
      const rows = await db
        .select()
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
      return rows.length > 0;
    }

    beforeEach(async () => {
      inviteeId = await createUser(db, 'invitee@example.com');
      invitee = createClient(db, inviteeId);
      await owner.expectOk(INVITE, { groupId, email: 'invitee@example.com' });
    });

    it('makes the invitee a member who can read the group', async () => {
      const { acceptGroupInvite } = await invitee.expectOk(ACCEPT, { token: await inviteToken() });
      expect(acceptGroupInvite).toEqual({ groupId, userId: inviteeId });
      await invitee.expectOk(GROUP, { id: groupId });
    });

    it('drops the invite from pendingInvites once accepted', async () => {
      await invitee.expectOk(ACCEPT, { token: await inviteToken() });
      const { group } = await owner.expectOk(GROUP, { id: groupId });
      expect(group.pendingInvites).toEqual([]);
    });

    it('refuses a token that was already used', async () => {
      const token = await inviteToken();
      await invitee.expectOk(ACCEPT, { token });
      const { message, code } = await outsider.expectError(ACCEPT, { token });
      expect(message).toMatch(/already accepted/i);
      expect(code).toBe(ErrorCode.BadUserInput);
      expect(await isMember(outsiderId)).toBe(false);
    });

    it('refuses an expired token', async () => {
      await db.update(groupInvites).set({ expiresAt: new Date(Date.now() - DAY_MS) });
      const { message, code } = await invitee.expectError(ACCEPT, { token: await inviteToken() });
      expect(message).toMatch(/expired/i);
      expect(code).toBe(ErrorCode.BadUserInput);
      expect(await isMember(inviteeId)).toBe(false);
    });

    it('refuses an unknown token', async () => {
      const { message, code } = await invitee.expectError(ACCEPT, { token: 'not-a-token' });
      expect(message).toMatch(/not found/i);
      expect(code).toBe(ErrorCode.NotFound);
    });
  });
});
