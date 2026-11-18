const WINDOW = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * A free block or a candidate slot in the reader's locale, with the date said once when both ends
 * fall on the same day: "Sat, Nov 21, 3:00 – 9:00 AM".
 */
export function formatWindow(startsAt: string, endsAt: string): string {
  return WINDOW.formatRange(new Date(startsAt), new Date(endsAt));
}

const DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** A date with no time: "Nov 24". */
export function formatDay(at: string): string {
  return DAY.format(new Date(at));
}

/** Earliest first, for a list of windows. */
export function byStart<T extends { startsAt: string }>(a: T, b: T): number {
  return Date.parse(a.startsAt) - Date.parse(b.startsAt);
}
