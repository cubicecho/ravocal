import { groupInvites, groupMembers } from '@cubicecho/ravocal-db/schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MailMessage } from '../../auth/email.ts';
import { GROUP_DEFAULTS } from '../../core/defaults.ts';
import { ErrorCode } from '../../core/errors.ts';
import { MS_PER_DAY } from '../../core/wire.ts';
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

const INVITE = `mutation($groupId: UUID!, $email: String!) { inviteToGroup(groupId: $groupId, email: $email) { id email } }`;
const ACCEPT = `mutation($token: String!) { acceptGroupInvite(token: $token) { groupId userId group { name } } }`;
const CANCEL = `mutation($id: UUID!) { cancelInvite(id: $id) { id invites { id } } }`;
const PENDING = `query($id: UUID!) { group(where: { id: { eq: $id } }) { invites(where: { acceptedAt: { isNull: true } }) { email } } }`;
const GROUP = `query($id: UUID!) { group(where: { id: { eq: $id } }) { id } }`;

describe('invites', () => {
  let db: TestDb;
  let ownerId: string;
  let memberId: string;
  let groupId: string;
  let mail: MailMessage[];
  let owner: TestClient;
  let member: TestClient;

  /**
   * Reads the token out of the link the last invite email carried, as the invitee's browser would.
   *
   * @returns The token.
   */
  function tokenFromLastEmail(): string {
    const text = mail.at(-1)?.text ?? '';
    const link = text.split(/\s+/).find((word) => word.includes('/invite?token='));
    return new URL(link ?? 'http://missing/').searchParams.get('token') ?? '';
  }

  /**
   * Whether a user is a member of the group.
   *
   * @param userId - The user.
   * @returns true when they are.
   */
  async function isMember(userId: string): Promise<boolean> {
    const isTheirs = and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId));
    return (await db.select().from(groupMembers).where(isTheirs)).length > 0;
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
    groupId = await createGroup(db, ownerId);
    await addMember(db, groupId, memberId);
    owner = createClient(db, ownerId, { mail });
    member = createClient(db, memberId, { mail });
  });

  describe('inviteToGroup', () => {
    it('emails the address a link to join', async () => {
      const { inviteToGroup } = await owner.expectOk(INVITE, { groupId, email: ' New@Example.com ' });
      expect(inviteToGroup.email).toBe('new@example.com');
      expect(mail).toHaveLength(1);
      expect(mail[0].to).toBe('new@example.com');
      expect(tokenFromLastEmail()).toMatch(/^[0-9a-f]{64}$/);
    });

    it('answers NOT_FOUND to a member who is not the owner, and sends nothing', async () => {
      const { code } = await member.expectError(INVITE, { groupId, email: 'new@example.com' });
      expect(code).toBe(ErrorCode.NotFound);
      expect(await db.select().from(groupInvites)).toEqual([]);
      expect(mail).toEqual([]);
    });

    it('refuses an address that is not one', async () => {
      const { code } = await owner.expectError(INVITE, { groupId, email: 'not an address' });
      expect(code).toBe(ErrorCode.BadUserInput);
    });
  });

  describe('acceptGroupInvite', () => {
    let inviteeId: string;
    let invitee: TestClient;

    beforeEach(async () => {
      inviteeId = await createUser(db, 'invitee@example.com');
      invitee = createClient(db, inviteeId);
      await owner.expectOk(INVITE, { groupId, email: 'invitee@example.com' });
    });

    it('makes whoever opens the link a member, whichever address it went to', async () => {
      const someoneElseId = await createUser(db, 'someone-else@example.com');
      const { acceptGroupInvite } = await createClient(db, someoneElseId).expectOk(ACCEPT, {
        token: tokenFromLastEmail(),
      });
      expect(acceptGroupInvite).toEqual({ groupId, userId: someoneElseId, group: { name: 'Book club' } });
    });

    it('drops the invite from the pending ones once used', async () => {
      await invitee.expectOk(ACCEPT, { token: tokenFromLastEmail() });
      expect((await owner.expectOk(PENDING, { id: groupId })).group.invites).toEqual([]);
    });

    it('works once', async () => {
      const token = tokenFromLastEmail();
      await invitee.expectOk(ACCEPT, { token });
      const outsiderId = await createUser(db, 'outsider@example.com');
      const { code } = await createClient(db, outsiderId).expectError(ACCEPT, { token });
      expect(code).toBe(ErrorCode.BadUserInput);
      expect(await isMember(outsiderId)).toBe(false);
    });

    it('tells someone already in the group so, and leaves the link for whoever it was meant for', async () => {
      const token = tokenFromLastEmail();
      const { code, message } = await member.expectError(ACCEPT, { token });
      expect(code).toBe(ErrorCode.BadUserInput);
      expect(message).toMatch(/already a member/);
      await invitee.expectOk(ACCEPT, { token });
      expect(await isMember(inviteeId)).toBe(true);
    });

    it('refuses an expired link', async () => {
      await db.update(groupInvites).set({ expiresAt: new Date(Date.now() - MS_PER_DAY) });
      const { code } = await invitee.expectError(ACCEPT, { token: tokenFromLastEmail() });
      expect(code).toBe(ErrorCode.BadUserInput);
      expect(await isMember(inviteeId)).toBe(false);
    });

    it('answers NOT_FOUND to a link that names no invite', async () => {
      expect((await invitee.expectError(ACCEPT, { token: 'not-a-token' })).code).toBe(ErrorCode.NotFound);
    });

    it(`lasts ${GROUP_DEFAULTS.inviteTtlDays} days`, async () => {
      const [invite] = await db.select().from(groupInvites);
      const lifetimeDays = (invite.expiresAt.getTime() - invite.createdAt.getTime()) / MS_PER_DAY;
      expect(Math.round(lifetimeDays)).toBe(GROUP_DEFAULTS.inviteTtlDays);
    });
  });

  describe('cancelInvite', () => {
    let inviteId: string;

    beforeEach(async () => {
      inviteId = (await owner.expectOk(INVITE, { groupId, email: 'invitee@example.com' })).inviteToGroup.id;
    });

    it('stops the link working, with the same answer as a link that never existed', async () => {
      const token = tokenFromLastEmail();
      const { cancelInvite } = await owner.expectOk(CANCEL, { id: inviteId });
      expect(cancelInvite).toEqual({ id: groupId, invites: [] });
      const invitee = createClient(db, await createUser(db, 'invitee@example.com'));
      const { code, message } = await invitee.expectError(ACCEPT, { token });
      expect(code).toBe(ErrorCode.NotFound);
      expect(message).toMatch(/cancelled/);
      expect((await invitee.expectOk(GROUP, { id: groupId })).group).toBeNull();
    });

    it('answers NOT_FOUND to a member, and leaves the invite', async () => {
      expect((await member.expectError(CANCEL, { id: inviteId })).code).toBe(ErrorCode.NotFound);
      expect(await db.select().from(groupInvites)).toHaveLength(1);
    });

    it('answers NOT_FOUND for an invite already used', async () => {
      const invitee = createClient(db, await createUser(db, 'invitee@example.com'));
      await invitee.expectOk(ACCEPT, { token: tokenFromLastEmail() });
      expect((await owner.expectError(CANCEL, { id: inviteId })).code).toBe(ErrorCode.NotFound);
    });
  });
});
