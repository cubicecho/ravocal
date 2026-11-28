import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { blockValues, dayChoices, instantOf, isOnGrid, LONGEST_BLOCK_MINUTES, SLOT_MINUTES } from './time-grid.ts';

const HALF_HOURS_A_DAY = 48;
/** 10 PM, as a choice's value: minutes since midnight. */
const TEN_PM = '1320';

/** Whether every choice is an instant the server takes. */
function allOnGrid(day: string, choices: ReadonlyArray<{ value: string }>): boolean {
  return choices.every((choice) => isOnGrid(instantOf(day, choice.value) ?? new Date(1)));
}

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

  it('runs the ends past midnight, up to a day after the start', () => {
    const { ends } = dayChoices('2026-06-10', TEN_PM);
    expect(ends).toHaveLength(LONGEST_BLOCK_MINUTES / SLOT_MINUTES);
    expect(ends[0]?.value).toBe('1350');
    expect(ends.at(-1)?.value).toBe(String(Number(TEN_PM) + LONGEST_BLOCK_MINUTES));
    const oneAm = ends.find((choice) => choice.value === '1500');
    expect(oneAm?.label).toMatch(/^1:00\sAM \(next day\)$/);
    expect(instantOf('2026-06-10', '1500')?.toISOString()).toBe('2026-06-11T05:00:00.000Z');
    expect(ends.filter((choice) => /next day/.test(choice.label) === false).map((choice) => choice.value)).toEqual([
      '1350',
      '1380',
      '1410',
    ]);
    expect(allOnGrid('2026-06-10', ends)).toBe(true);
  });

  it('offers the day until midnight when no start is chosen', () => {
    const { ends } = dayChoices('2026-06-10');
    expect(ends[0]?.value).toBe(String(SLOT_MINUTES));
    expect(ends.at(-1)?.value).toBe(String(LONGEST_BLOCK_MINUTES));
  });

  it('reads a block that ends after midnight back onto the same choices', () => {
    const values = blockValues('2026-06-11T02:00:00.000Z', '2026-06-11T05:00:00.000Z');
    expect(values).toMatchObject({ day: '2026-06-10', start: TEN_PM, end: '1500', extraEnd: undefined });
  });

  it('counts a night the clocks go forward in hours that pass, not hours on the clock', () => {
    const { ends } = dayChoices('2026-03-07', TEN_PM);
    expect(ends).toHaveLength(LONGEST_BLOCK_MINUTES / SLOT_MINUTES);
    // 2:00 to 3:00 AM never happens that night, so a day after 10 PM is 11 PM.
    expect(ends.at(-1)?.label).toMatch(/^11:00\sPM \(next day\)$/);
    expect(ends.some((choice) => /^2:\d\d\sAM/.test(choice.label))).toBe(false);
  });

  it('names the date of an end two days on, which only a short night reaches', () => {
    const lastEnd = dayChoices('2026-03-07', '1410').ends.at(-1);
    const expected = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(instantOf('2026-03-07', lastEnd?.value ?? '') ?? new Date(1));
    expect(lastEnd?.label).toBe(expected);
  });

  it('tells the repeated hour apart on the night the clocks go back', () => {
    const labels = dayChoices('2026-10-31', TEN_PM).ends.map((choice) => choice.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.filter((text) => /^1:00\sAM .+ \(next day\)$/.test(text))).toHaveLength(2);
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

  it('reads a block that starts just after the local midnight onto that local day, the evening before in UTC', () => {
    // 12:15 to 12:45 AM on June 10 in Kathmandu is still June 9 in UTC.
    const values = blockValues('2026-06-09T18:30:00.000Z', '2026-06-09T19:00:00.000Z');
    expect(values).toMatchObject({ day: '2026-06-10', start: '15', end: '45', extraEnd: undefined });
  });

  it('runs an end past midnight on the quarter hours', () => {
    // 11:15 PM to 12:45 AM.
    const { ends } = dayChoices('2026-06-10', '1395');
    expect(ends[0]?.label).toMatch(/^11:45\sPM$/);
    expect(ends.find((choice) => choice.value === '1485')?.label).toMatch(/^12:45\sAM \(next day\)$/);
    expect(allOnGrid('2026-06-10', ends)).toBe(true);
    const values = blockValues('2026-06-10T17:30:00.000Z', '2026-06-10T19:00:00.000Z');
    expect(values).toMatchObject({ day: '2026-06-10', start: '1395', end: '1485', extraEnd: undefined });
  });
});

describe('dayChoices in a zone a half hour off the hour', () => {
  inZone('Asia/Kolkata');

  it('keeps the local half hours, past midnight too', () => {
    const { starts, ends } = dayChoices('2026-06-10', '1410');
    expect(starts[0]?.value).toBe('0');
    expect(ends.map((choice) => choice.label).slice(0, 2)).toEqual([
      expect.stringMatching(/^12:00\sAM \(next day\)$/),
      expect.stringMatching(/^12:30\sAM \(next day\)$/),
    ]);
    expect(allOnGrid('2026-06-10', [...starts, ...ends])).toBe(true);
    // 11:30 PM to 1:00 AM, India time.
    const values = blockValues('2026-06-10T18:00:00.000Z', '2026-06-10T19:30:00.000Z');
    expect(values).toMatchObject({ day: '2026-06-10', start: '1410', end: '1500', extraEnd: undefined });
  });
});

describe('blockValues', () => {
  inZone('UTC');

  it('keeps an end the day does not offer as a choice of its own', () => {
    const values = blockValues('2026-06-10T09:00:00.000Z', '2026-06-12T10:00:00.000Z');
    expect(values.extraEnd?.value).toBe(values.end);
  });
});
