import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { blockValues, dayChoices, instantOf, isOnGrid } from './time-grid.ts';

const HALF_HOURS_A_DAY = 48;

/** Runs a describe block's tests with the process in another time zone. */
function inZone(zone: string) {
  beforeAll(() => {
    vi.stubEnv('TZ', zone);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });
}

describe('dayChoices in a zone a whole number of half hours off UTC', () => {
  inZone('America/New_York');

  it('offers every half hour of the day, each on the UTC grid', () => {
    const { starts, ends } = dayChoices('2026-06-10');
    expect(starts).toHaveLength(HALF_HOURS_A_DAY);
    expect(ends).toHaveLength(HALF_HOURS_A_DAY);
    expect(starts[0]?.value).toBe('0');
    expect(ends.at(-1)?.label).toMatch(/next day/);
    for (const choice of [...starts, ...ends]) {
      expect(isOnGrid(instantOf('2026-06-10', choice.value) ?? new Date(1))).toBe(true);
    }
  });

  it('turns a choice into the local instant it names', () => {
    expect(instantOf('2026-06-10', '540')?.toISOString()).toBe('2026-06-10T13:00:00.000Z');
  });

  it('has 23 hours on the day the clocks go forward and 25 on the day they go back', () => {
    expect(dayChoices('2026-03-08').starts).toHaveLength(HALF_HOURS_A_DAY - 2);
    const fallBack = dayChoices('2026-11-01').starts;
    expect(fallBack).toHaveLength(HALF_HOURS_A_DAY + 2);
    // The repeated hour says which offset each half is in.
    const labels = fallBack.map((choice) => choice.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('refuses a date that is not one', () => {
    expect(dayChoices('2026-02-30').starts).toHaveLength(0);
    expect(instantOf('', '0')).toBeUndefined();
  });
});

describe('dayChoices in a zone a quarter hour off UTC', () => {
  inZone('Asia/Kathmandu');

  it('offers the local quarter past and quarter to, which are the UTC half hours', () => {
    const { starts } = dayChoices('2026-06-10');
    expect(starts).toHaveLength(HALF_HOURS_A_DAY);
    expect(starts[0]?.value).toBe('15');
    for (const choice of starts) {
      expect(isOnGrid(instantOf('2026-06-10', choice.value) ?? new Date(1))).toBe(true);
    }
  });

  it('reads a block back onto the same choices', () => {
    const values = blockValues('2026-06-10T03:30:00.000Z', '2026-06-10T05:00:00.000Z');
    expect(values).toMatchObject({ day: '2026-06-10', start: '555', end: '645', extraEnd: undefined });
  });
});

describe('blockValues', () => {
  inZone('UTC');

  it('keeps an end the day does not offer as a choice of its own', () => {
    const values = blockValues('2026-06-10T09:00:00.000Z', '2026-06-12T10:00:00.000Z');
    expect(values.extraEnd?.value).toBe(values.end);
  });
});
