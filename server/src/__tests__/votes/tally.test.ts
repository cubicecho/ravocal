import type { TimeBlock, VoteRanking, VoteSlot } from '@cubicecho/ravocal-db/schema';
import { describe, expect, it } from 'vitest';
import { computeVoteSlots, tallyRankedChoice } from '../../votes/tally.ts';

const HALF_HOUR_MS = 30 * 60 * 1000;
/** A Monday morning, so every window in these tests is a plain offset from it. */
const BASE_MS = Date.parse('2026-01-05T09:00:00Z');

const OWNER = 'owner';
const ALICE = 'alice';
const BOB = 'bob';
const CAROL = 'carol';

/** The start of the half hour `index` half hours after BASE_MS. */
const at = (index: number): Date => new Date(BASE_MS + index * HALF_HOUR_MS);

/**
 * A time block for one member, from half hour `from` up to half hour `to`.
 *
 * @param userId - The member who is free.
 * @param from - First half hour, counted from BASE_MS.
 * @param to - The half hour the block ends at.
 */
function block(userId: string, from: number, to: number): TimeBlock {
  return {
    id: `${userId}-${from}-${to}`,
    groupId: 'group',
    userId,
    startsAt: at(from),
    endsAt: at(to),
    createdAt: at(0),
  };
}

const membersOf = (...userIds: string[]) => userIds.map((userId) => ({ userId }));

/** The half-hour index of each slot, in the order returned. */
const startsOf = (slots: Array<{ startsAt: Date }>) =>
  slots.map((slot) => (slot.startsAt.getTime() - BASE_MS) / HALF_HOUR_MS);

describe('computeVoteSlots', () => {
  it('returns no slots when no time blocks were submitted', () => {
    expect(computeVoteSlots(membersOf(ALICE), [], 0, false)).toEqual([]);
    expect(computeVoteSlots(membersOf(ALICE), [], 0, true, ALICE)).toEqual([]);
  });

  it('splits a block into consecutive 30-minute slots', () => {
    const slots = computeVoteSlots(membersOf(ALICE), [block(ALICE, 0, 3)], 100, false);
    expect(startsOf(slots)).toEqual([0, 1, 2]);
    for (const slot of slots) {
      expect(slot.endsAt.getTime() - slot.startsAt.getTime()).toBe(HALF_HOUR_MS);
    }
  });

  it('counts a member once where their own blocks overlap', () => {
    const slots = computeVoteSlots(membersOf(ALICE, BOB), [block(ALICE, 0, 2), block(ALICE, 1, 3)], 0, false);
    expect(slots.map((slot) => slot.overlapCount)).toEqual([1, 1, 1]);
  });

  it('counts every member free in a window', () => {
    const slots = computeVoteSlots(
      membersOf(ALICE, BOB, CAROL),
      [block(ALICE, 0, 2), block(BOB, 1, 2), block(CAROL, 1, 3)],
      0,
      false,
    );
    const countAt = (index: number) =>
      slots.find((slot) => slot.startsAt.getTime() === at(index).getTime())?.overlapCount;
    expect(countAt(0)).toBe(1);
    expect(countAt(1)).toBe(3);
    expect(countAt(2)).toBe(1);
  });

  describe('in normal mode', () => {
    const fourMembers = membersOf(OWNER, ALICE, BOB, CAROL);
    // Half hour 0: two of four free. Half hour 1: one of four.
    const blocks = [block(ALICE, 0, 2), block(BOB, 0, 1)];

    it('keeps a window where exactly the threshold share is free', () => {
      const slots = computeVoteSlots(fourMembers, blocks, 50, false);
      expect(startsOf(slots)).toEqual([0]);
    });

    it('drops windows below the threshold', () => {
      const slots = computeVoteSlots(fourMembers, blocks, 51, false);
      expect(slots).toEqual([]);
    });

    it('keeps every window at a threshold of 0', () => {
      const slots = computeVoteSlots(fourMembers, blocks, 0, false);
      expect(startsOf(slots)).toEqual([0, 1]);
    });

    it('needs every member free at a threshold of 100', () => {
      const members = membersOf(ALICE, BOB);
      const slots = computeVoteSlots(members, [block(ALICE, 0, 2), block(BOB, 1, 3)], 100, false);
      expect(startsOf(slots)).toEqual([1]);
    });

    it('keeps a window that meets the threshold exactly where floats would round over it', () => {
      // 7 / 25 is exactly 28%, but 0.28 * 25 is 7.000000000000001 in floats.
      const userIds = Array.from({ length: 25 }, (_, index) => `m${index}`);
      const blocks = userIds.slice(0, 7).map((userId) => block(userId, 0, 1));
      const slots = computeVoteSlots(membersOf(...userIds), blocks, 28, false);
      expect(startsOf(slots)).toEqual([0]);
    });

    it('orders by most members free, then earliest', () => {
      const slots = computeVoteSlots(
        membersOf(ALICE, BOB, CAROL),
        [block(ALICE, 0, 4), block(BOB, 2, 4), block(CAROL, 3, 4)],
        0,
        false,
      );
      expect(startsOf(slots)).toEqual([3, 2, 0, 1]);
    });

    it('ignores the owner when ordering', () => {
      const slots = computeVoteSlots(
        membersOf(OWNER, ALICE, BOB),
        [block(OWNER, 0, 1), block(ALICE, 1, 2), block(BOB, 1, 2)],
        0,
        false,
        OWNER,
      );
      expect(startsOf(slots)).toEqual([1, 0]);
    });
  });

  describe('in forced mode', () => {
    it('keeps windows below the threshold that have one member free', () => {
      const slots = computeVoteSlots(membersOf(OWNER, ALICE, BOB, CAROL), [block(ALICE, 0, 2)], 100, true, OWNER);
      expect(startsOf(slots)).toEqual([0, 1]);
      expect(slots.every((slot) => slot.overlapCount >= 1)).toBe(true);
    });

    it('puts windows the owner is free in first, then most members free, then earliest', () => {
      const slots = computeVoteSlots(
        membersOf(OWNER, ALICE, BOB, CAROL),
        [
          // Half hours 0 and 1: owner alone. Half hour 2: owner and Alice.
          block(OWNER, 0, 3),
          block(ALICE, 2, 3),
          // Half hour 3: three members, but not the owner.
          block(ALICE, 3, 4),
          block(BOB, 3, 4),
          block(CAROL, 3, 4),
          // Half hour 4: Bob alone.
          block(BOB, 4, 5),
        ],
        0,
        true,
        OWNER,
      );
      expect(startsOf(slots)).toEqual([2, 0, 1, 3, 4]);
    });

    it('counts the owner free across adjacent blocks', () => {
      const slots = computeVoteSlots(
        membersOf(OWNER, ALICE, BOB),
        [block(OWNER, 0, 1), block(OWNER, 1, 2), block(ALICE, 2, 3), block(BOB, 2, 3)],
        0,
        true,
        OWNER,
      );
      expect(startsOf(slots)).toEqual([0, 1, 2]);
    });
  });
});

/** A candidate slot. Only its id matters to the tally. */
function slot(id: string): VoteSlot {
  return {
    id,
    voteId: 'vote',
    startsAt: at(0),
    endsAt: at(1),
    overlapCount: 1,
  };
}

/**
 * One voter's ballot: slot ids in preference order, ranked 1, 2, 3...
 *
 * @param userId - The voter.
 * @param slotIds - Most preferred first.
 */
function ballot(userId: string, ...slotIds: string[]): VoteRanking[] {
  return slotIds.map((slotId, index) => ({
    id: `${userId}-${slotId}`,
    voteId: 'vote',
    userId,
    slotId,
    rank: index + 1,
    createdAt: at(0),
  }));
}

const SLOTS = ['a', 'b', 'c', 'd', 'e'].map(slot);

describe('tallyRankedChoice', () => {
  it('returns null when nobody ranked anything', () => {
    expect(tallyRankedChoice(SLOTS, [])).toBeNull();
  });

  it('elects the only slot once anyone ranked it', () => {
    expect(tallyRankedChoice([slot('a')], ballot('v1', 'a'))).toBe('a');
  });

  it('elects a first-round majority outright', () => {
    const rankings = [...ballot('v1', 'a', 'b'), ...ballot('v2', 'a', 'c'), ...ballot('v3', 'b', 'a')];
    expect(tallyRankedChoice(SLOTS, rankings)).toBe('a');
  });

  it('does not count exactly half as a majority', () => {
    // a and b split two-two, so neither wins round one; c and d go out with
    // no first choices, and the remaining two-two tie eliminates both.
    const rankings = [...ballot('v1', 'a'), ...ballot('v2', 'a'), ...ballot('v3', 'b'), ...ballot('v4', 'b')];
    expect(tallyRankedChoice(['a', 'b', 'c', 'd'].map(slot), rankings)).toBeNull();
  });

  it("transfers an eliminated slot's ballots to their next choice", () => {
    const rankings = [
      ...ballot('v1', 'a'),
      ...ballot('v2', 'a'),
      ...ballot('v3', 'b'),
      ...ballot('v4', 'b'),
      ...ballot('v5', 'c', 'b'),
    ];
    expect(tallyRankedChoice(['a', 'b', 'c'].map(slot), rankings)).toBe('b');
  });

  it('eliminates a slot nobody ranked first, even if everyone ranked it second', () => {
    // Round one: a 2, b 2, c 0. c goes out alone, then the a-b tie eliminates
    // both, so c's broad second-choice support never counts.
    const rankings = [
      ...ballot('v1', 'a', 'c'),
      ...ballot('v2', 'a', 'c'),
      ...ballot('v3', 'b', 'c'),
      ...ballot('v4', 'b', 'c'),
    ];
    expect(tallyRankedChoice(['a', 'b', 'c'].map(slot), rankings)).toBeNull();
  });

  it('eliminates every slot tied for fewest votes at once', () => {
    // Round one: a 3, b 2, c 1, d 1. Eliminating c alone would hand its ballot
    // to d, and a would win the a-b-d round. Eliminating c and d together
    // sends both ballots to b, which then has 4 of 7.
    const rankings = [
      ...ballot('v1', 'a'),
      ...ballot('v2', 'a'),
      ...ballot('v3', 'a'),
      ...ballot('v4', 'b'),
      ...ballot('v5', 'b'),
      ...ballot('v6', 'c', 'd', 'b'),
      ...ballot('v7', 'd', 'b'),
    ];
    expect(tallyRankedChoice(['a', 'b', 'c', 'd'].map(slot), rankings)).toBe('b');
  });

  it("reads a voter's first choice as their lowest rank still in the running", () => {
    // Ranks need not start at 1 or be consecutive.
    const sparse = (userId: string, ranks: Record<string, number>) =>
      Object.entries(ranks).map(([slotId, rank]) => ({
        ...ballot(userId, slotId)[0],
        rank,
      }));
    const rankings = [...sparse('v1', { a: 7, b: 3 }), ...sparse('v2', { b: 9, a: 2 }), ...sparse('v3', { b: 4 })];
    expect(tallyRankedChoice(['a', 'b'].map(slot), rankings)).toBe('b');
  });

  it('leaves an exhausted ballot out of later rounds', () => {
    // v5 ranked only c. Once c is out, a has 2 of the 4 ballots still counting
    // and b has 2, so the tie eliminates both rather than electing either.
    const rankings = [
      ...ballot('v1', 'a'),
      ...ballot('v2', 'a'),
      ...ballot('v3', 'b'),
      ...ballot('v4', 'b'),
      ...ballot('v5', 'c'),
    ];
    expect(tallyRankedChoice(['a', 'b', 'c'].map(slot), rankings)).toBeNull();
  });

  it('returns null when every remaining slot ties', () => {
    const rankings = [...ballot('v1', 'a', 'b'), ...ballot('v2', 'b', 'a')];
    expect(tallyRankedChoice(['a', 'b'].map(slot), rankings)).toBeNull();
  });

  it('ignores rankings for slots that are not candidates', () => {
    const rankings = [...ballot('v1', 'stale', 'a'), ...ballot('v2', 'b'), ...ballot('v3', 'a')];
    expect(tallyRankedChoice(['a', 'b'].map(slot), rankings)).toBe('a');
  });
});
