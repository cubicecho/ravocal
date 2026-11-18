import { timeBlocks } from '@cubicecho/ravocal-db/schema';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from '../../core/errors.ts';
import {
  closeTestDb,
  createClient,
  createGroup,
  createTestDb,
  createUser,
  resetTestDb,
  type TestClient,
  type TestDb,
} from '../helpers.ts';

const CREATE = `mutation($groupId: UUID!, $startsAt: DateTime!, $endsAt: DateTime!) {
  createTimeBlock(values: { groupId: $groupId, startsAt: $startsAt, endsAt: $endsAt }) { id startsAt endsAt }
}`;
const MOVE_END = `mutation($id: UUID!, $endsAt: DateTime!) {
  updateTimeBlock(where: { id: { eq: $id } }, set: { endsAt: $endsAt }) { id endsAt }
}`;

describe('time block writes', () => {
  let db: TestDb;
  let groupId: string;
  let member: TestClient;

  /**
   * Adds a block through the generated create.
   *
   * @param startsAt - When it starts, as sent.
   * @param endsAt - When it ends, as sent.
   * @returns The raw result.
   */
  const create = (startsAt: string, endsAt: string) => member.run(CREATE, { groupId, startsAt, endsAt });

  /**
   * Reads the first error's code off a result.
   *
   * @param result - What the operation answered.
   * @returns The code, or undefined when it succeeded.
   */
  const codeOf = (result: Awaited<ReturnType<typeof create>>) => result.errors?.[0]?.extensions.code;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(() => closeTestDb(db));

  beforeEach(async () => {
    await resetTestDb(db);
    const userId = await createUser(db, 'member@example.com');
    groupId = await createGroup(db, userId);
    member = createClient(db, userId);
  });

  describe('the 30-minute grid, in UTC', () => {
    it('accepts a block on the hour and the half hour', async () => {
      const { createTimeBlock } = await member.expectOk(CREATE, {
        groupId,
        startsAt: '2026-11-21T09:00:00.000Z',
        endsAt: '2026-11-21T10:30:00.000Z',
      });
      // A Date in-process: the DateTime scalar serializes to ISO only on the wire.
      expect(createTimeBlock).toMatchObject({
        startsAt: new Date('2026-11-21T09:00:00.000Z'),
        endsAt: new Date('2026-11-21T10:30:00.000Z'),
      });
    });

    it('judges a time by UTC, not by the offset it was written in', async () => {
      // 09:30 in India is 04:00 UTC: on the grid.
      expect(codeOf(await create('2026-11-21T09:30:00+05:30', '2026-11-21T10:30:00+05:30'))).toBeUndefined();
      // 09:00 in Nepal is 03:15 UTC: off it, though it reads as the hour where it was written.
      expect(codeOf(await create('2026-11-21T09:00:00+05:45', '2026-11-21T10:00:00+05:45'))).toBe(
        ErrorCode.BadUserInput,
      );
    });

    it('refuses a quarter hour, and a stray second', async () => {
      expect(codeOf(await create('2026-11-21T09:15:00.000Z', '2026-11-21T10:00:00.000Z'))).toBe(ErrorCode.BadUserInput);
      expect(codeOf(await create('2026-11-21T09:00:01.000Z', '2026-11-21T10:00:00.000Z'))).toBe(ErrorCode.BadUserInput);
      expect(await db.select().from(timeBlocks)).toEqual([]);
    });

    it('refuses a block that ends when or before it starts', async () => {
      const { message } = await member.expectError(CREATE, {
        groupId,
        startsAt: '2026-11-21T10:00:00.000Z',
        endsAt: '2026-11-21T10:00:00.000Z',
      });
      expect(message).toBe('A time block ends after it starts.');
      expect(codeOf(await create('2026-11-21T10:00:00.000Z', '2026-11-21T09:00:00.000Z'))).toBe(ErrorCode.BadUserInput);
    });

    it('checks an update against the whole row, not only the column it changes', async () => {
      const { createTimeBlock } = await member.expectOk(CREATE, {
        groupId,
        startsAt: '2026-11-21T09:00:00.000Z',
        endsAt: '2026-11-21T10:00:00.000Z',
      });
      const early = { id: createTimeBlock.id, endsAt: '2026-11-21T08:30:00.000Z' };
      expect((await member.expectError(MOVE_END, early)).code).toBe(ErrorCode.BadUserInput);
      const later = { id: createTimeBlock.id, endsAt: '2026-11-21T11:00:00.000Z' };
      expect((await member.expectOk(MOVE_END, later)).updateTimeBlock.endsAt).toEqual(new Date(later.endsAt));
    });
  });

  it('refuses the columns the server owns: whose it is, and when it was made', async () => {
    const forged = `mutation($groupId: UUID!, $userId: UUID!) {
      createTimeBlock(values: { groupId: $groupId, userId: $userId, startsAt: "2026-11-21T09:00:00Z", endsAt: "2026-11-21T10:00:00Z" }) { id }
    }`;
    const { message } = await member.expectError(forged, { groupId, userId: groupId });
    expect(message).toMatch(/userId/);
    const backdated = `mutation($groupId: UUID!) {
      createTimeBlock(values: { groupId: $groupId, startsAt: "2026-11-21T09:00:00Z", endsAt: "2026-11-21T10:00:00Z", createdAt: "2020-01-01T00:00:00Z" }) { id }
    }`;
    expect((await member.expectError(backdated, { groupId })).code).toBe(ErrorCode.BadUserInput);
  });
});
