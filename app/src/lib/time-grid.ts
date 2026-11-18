/**
 * The choices a free-time form offers, in the reader's own time zone, on the server's grid.
 *
 * The server takes a block only when both ends sit on the 30-minute grid **in UTC** (`time_blocks`' write hook). In
 * most zones the offset is a whole number of half hours, so the local :00 and :30 are the UTC ones. Where it isn't
 * (Nepal is +05:45, Chatham +12:45, Eucla +08:45) the local :00 would be refused, so the choices are built the other
 * way round: every UTC half hour that falls inside the chosen local day, each labelled in local time. In those zones
 * the times read :15 and :45, and every one of them is accepted.
 *
 * A choice is kept as minutes since the day's local midnight, so changing the date keeps the times. A day that a
 * daylight-saving change makes 23 or 25 hours long has fewer or more choices, and the hour that repeats is labelled
 * with its offset so its two halves can be told apart.
 */

/** The server's slot length (`SCHEDULE_DEFAULTS.slotMinutes`). */
export const SLOT_MINUTES = 30;

const MS_PER_MINUTE = 60_000;
const SLOT_MS = SLOT_MINUTES * MS_PER_MINUTE;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const PAD = 2;

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
 * Reads a date input's value as that day's local midnight.
 *
 * @param day - `YYYY-MM-DD`.
 * @returns The instant the day starts, or undefined when the text is not a real date.
 */
export function startOfLocalDay(day: string): Date | undefined {
  const match = DATE_PATTERN.exec(day);
  if (match === null) {
    return undefined;
  }
  const [year, month, date] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const midnight = new Date(year, month, date);
  const isSameDay = midnight.getFullYear() === year && midnight.getMonth() === month && midnight.getDate() === date;
  return isSameDay ? midnight : undefined;
}

/**
 * Writes an instant's local date the way a date input holds it.
 *
 * @param at - The instant.
 * @returns `YYYY-MM-DD` in the reader's zone.
 */
export function localDayOf(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(PAD, '0');
  const date = String(at.getDate()).padStart(PAD, '0');
  return `${at.getFullYear()}-${month}-${date}`;
}

/** The first instant on the UTC grid at or after `ms`. The epoch is on the grid, so this is the UTC one. */
const ceilToGrid = (ms: number): number => Math.ceil(ms / SLOT_MS) * SLOT_MS;

/**
 * Labels a run of instants with their local clock times. A time that shows twice (the hour a clock goes back) gets
 * its offset, and one past the day gets "next day".
 */
function label(instants: readonly number[], nextDay: number): TimeChoice[] {
  const time = new Intl.DateTimeFormat(undefined, TIME);
  const withZone = new Intl.DateTimeFormat(undefined, TIME_WITH_ZONE);
  const plain = instants.map((at) => time.format(at));
  const counts = new Map<string, number>();
  for (const text of plain) {
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return instants.map((at, index) => {
    const text = plain[index] ?? '';
    const shown = (counts.get(text) ?? 0) > 1 ? withZone.format(at) : text;
    return { value: '', label: at >= nextDay ? `${shown} (next day)` : shown };
  });
}

/**
 * The times a block on `day` can start and end at, all on the server's grid.
 *
 * @param day - `YYYY-MM-DD`, in the reader's zone.
 * @returns Starts from the day's first grid time to its last; ends from half an hour in to the first grid time of the
 *   next day. Both empty for a day that isn't one.
 */
export function dayChoices(day: string): DayChoices {
  const midnight = startOfLocalDay(day);
  if (midnight === undefined) {
    return { starts: [], ends: [] };
  }
  const dayStart = midnight.getTime();
  const nextDay = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() + 1).getTime();
  const first = ceilToGrid(dayStart);
  const starts: number[] = [];
  for (let at = first; at < nextDay; at += SLOT_MS) {
    starts.push(at);
  }
  const ends: number[] = [];
  for (let at = first + SLOT_MS; at <= ceilToGrid(nextDay); at += SLOT_MS) {
    ends.push(at);
  }
  const toChoices = (instants: number[]) =>
    label(instants, nextDay).map((choice, index) => ({
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
  const midnight = startOfLocalDay(day);
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
 * @returns The form's values, and the end as a choice of its own when it is past what the day offers (a block made
 *   another way, longer than a day), so the select can still show it.
 */
export function blockValues(
  startsAt: string,
  endsAt: string,
): { day: string; start: string; end: string; extraEnd: TimeChoice | undefined } {
  const start = new Date(startsAt);
  const day = localDayOf(start);
  const dayStart = startOfLocalDay(day)?.getTime() ?? start.getTime();
  const minutesOf = (at: string) => String((Date.parse(at) - dayStart) / MS_PER_MINUTE);
  const end = minutesOf(endsAt);
  const isOffered = dayChoices(day).ends.some((choice) => choice.value === end);
  return {
    day,
    start: minutesOf(startsAt),
    end,
    extraEnd: isOffered
      ? undefined
      : { value: end, label: new Intl.DateTimeFormat(undefined, DAY_AND_TIME).format(new Date(endsAt)) },
  };
}
