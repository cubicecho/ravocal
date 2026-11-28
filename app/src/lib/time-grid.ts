/**
 * The choices a free-time form offers, in the reader's own time zone, on the server's grid.
 *
 * The server takes a block only when both ends sit on the 30-minute grid **in UTC** (`time_blocks`' write hook). In
 * most zones the offset is a whole number of half hours, so the local :00 and :30 are the UTC ones. Where it isn't
 * (Nepal is +05:45, Chatham +12:45, Eucla +08:45) the local :00 would be refused, so the choices are built the other
 * way round: every UTC half hour that falls inside the chosen local day, each labelled in local time. In those zones
 * the times read :15 and :45, and every one of them is accepted.
 *
 * A choice is kept as minutes since the day's local midnight, so changing the date keeps the times. An end runs on
 * past midnight, up to a day after the start, and a time on the next day says so. A day that a daylight-saving change
 * makes 23 or 25 hours long has fewer or more choices, and the hour that repeats is labelled with its offset so its two
 * halves can be told apart.
 */

import { dayOf, dayToDate, parseDay } from '@/lib/day';

/** The server's slot length (`SCHEDULE_DEFAULTS.slotMinutes`). */
export const SLOT_MINUTES = 30;

/** The longest block the form offers: an end up to a day after the start. */
export const LONGEST_BLOCK_MINUTES = 1440;

const MS_PER_MINUTE = 60_000;
const SLOT_MS = SLOT_MINUTES * MS_PER_MINUTE;
const LONGEST_BLOCK_MS = LONGEST_BLOCK_MINUTES * MS_PER_MINUTE;

/** One time in a select: minutes since the local midnight, as the select's value, and the clock time it is. */
export interface TimeChoice {
  value: string;
  label: string;
}

/** The start and end choices for one local day. */
export interface DayChoices {
  starts: TimeChoice[];
  ends: TimeChoice[];
}

// Made per call rather than once: a formatter fixes the zone it was made in, and the reader's can change under a
// page left open (and does between tests).
const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
const TIME_WITH_ZONE: Intl.DateTimeFormatOptions = { ...TIME, timeZoneName: 'short' };
const DAY_AND_TIME: Intl.DateTimeFormatOptions = { ...TIME, weekday: 'short', month: 'short', day: 'numeric' };

/**
 * A day's local midnight, the instant the grid counts from: `@cubeui/day` checks the day and finds its midnight in the
 * reader's zone.
 *
 * @param day - `YYYY-MM-DD`.
 * @returns The instant the day starts, or undefined when the text is not a real date.
 */
function startOfDay(day: string): Date | undefined {
  const checked = parseDay(day);
  return checked === undefined ? undefined : dayToDate(checked);
}

/** The first instant on the UTC grid at or after `ms`. The epoch is on the grid, so this is the UTC one. */
const ceilToGrid = (ms: number): number => Math.ceil(ms / SLOT_MS) * SLOT_MS;

/**
 * The local midnight a number of days after another, counted on the calendar so a 23- or 25-hour day is one day.
 *
 * @param midnight - A local midnight.
 * @param days - How many days on.
 * @returns The instant that day starts.
 */
function midnightAfter(midnight: Date, days: number): number {
  return new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() + days).getTime();
}

/**
 * Labels a run of instants with their local clock times, against the chosen day. A time on the next day gets "(next
 * day)", one later still (a daylight-saving night can push the last end there) gets its date, and a label that shows
 * twice (the hour a clock goes back) gets its offset.
 *
 * @param instants - The times, in ms since the epoch.
 * @param midnight - The chosen day's local midnight.
 * @returns One choice per instant, its value still empty.
 */
function label(instants: readonly number[], midnight: Date): TimeChoice[] {
  const time = new Intl.DateTimeFormat(undefined, TIME);
  const withZone = new Intl.DateTimeFormat(undefined, TIME_WITH_ZONE);
  const dayAndTime = new Intl.DateTimeFormat(undefined, DAY_AND_TIME);
  const nextDay = midnightAfter(midnight, 1);
  const dayAfter = midnightAfter(midnight, 2);
  const describe = (at: number, clock: Intl.DateTimeFormat) => {
    if (at >= dayAfter) {
      return dayAndTime.format(at);
    }
    return at >= nextDay ? `${clock.format(at)} (next day)` : clock.format(at);
  };
  const plain = instants.map((at) => describe(at, time));
  const counts = new Map<string, number>();
  for (const text of plain) {
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return instants.map((at, index) => {
    const text = plain[index] ?? '';
    return { value: '', label: (counts.get(text) ?? 0) > 1 ? describe(at, withZone) : text };
  });
}

/**
 * The times a block on `day` can start and end at, all on the server's grid.
 *
 * @param day - `YYYY-MM-DD`, in the reader's zone.
 * @param [start] - The chosen start, a start choice's value. Without one, the ends follow the day's first start.
 * @returns Starts from the day's first grid time to its last; ends from half an hour after the start to a day after
 *   it, on into the next day. Both empty for a day that isn't one.
 */
export function dayChoices(day: string, start = ''): DayChoices {
  const midnight = startOfDay(day);
  if (midnight === undefined) {
    return { starts: [], ends: [] };
  }
  const dayStart = midnight.getTime();
  const nextDay = midnightAfter(midnight, 1);
  const first = ceilToGrid(dayStart);
  const starts: number[] = [];
  for (let at = first; at < nextDay; at += SLOT_MS) {
    starts.push(at);
  }
  const chosen = instantOf(day, start)?.getTime();
  const isAStart = chosen !== undefined && starts.includes(chosen);
  const from = isAStart ? chosen : first;
  const ends: number[] = [];
  for (let at = from + SLOT_MS; at <= from + LONGEST_BLOCK_MS; at += SLOT_MS) {
    ends.push(at);
  }
  const toChoices = (instants: number[]) =>
    label(instants, midnight).map((choice, index) => ({
      ...choice,
      value: String(((instants[index] ?? 0) - dayStart) / MS_PER_MINUTE),
    }));
  return { starts: toChoices(starts), ends: toChoices(ends) };
}

/**
 * The instant a choice stands for.
 *
 * @param day - `YYYY-MM-DD`.
 * @param minutes - A choice's value: minutes since that day's local midnight.
 * @returns The instant, or undefined when the day or the value is not one.
 */
export function instantOf(day: string, minutes: string): Date | undefined {
  const midnight = startOfDay(day);
  const offset = Number(minutes);
  if (midnight === undefined || minutes === '' || Number.isInteger(offset) === false) {
    return undefined;
  }
  return new Date(midnight.getTime() + offset * MS_PER_MINUTE);
}

/**
 * Whether an instant is one the server takes.
 *
 * @param at - The instant.
 * @returns true on the UTC half hour, to the millisecond.
 */
export function isOnGrid(at: Date): boolean {
  return at.getTime() % SLOT_MS === 0;
}

/**
 * A block's ends as the form holds them: its start's local day, and each end as minutes since that day began.
 *
 * @param startsAt - The block's start.
 * @param endsAt - The block's end.
 * @returns The form's values, and the end as a choice of its own when it is past what the start offers (a block made
 *   another way, longer than a day), so the select can still show it.
 */
export function blockValues(
  startsAt: string,
  endsAt: string,
): { day: string; start: string; end: string; extraEnd: TimeChoice | undefined } {
  const startInstant = new Date(startsAt);
  const day = dayOf(startInstant) ?? '';
  const dayStart = startOfDay(day)?.getTime() ?? startInstant.getTime();
  const minutesOf = (at: string) => String((Date.parse(at) - dayStart) / MS_PER_MINUTE);
  const start = minutesOf(startsAt);
  const end = minutesOf(endsAt);
  const isOffered = dayChoices(day, start).ends.some((choice) => choice.value === end);
  return {
    day,
    start,
    end,
    extraEnd: isOffered
      ? undefined
      : { value: end, label: new Intl.DateTimeFormat(undefined, DAY_AND_TIME).format(new Date(endsAt)) },
  };
}
