/** The HTTP statuses this server sends, and its tests expect. */
export const HttpStatus = { Ok: 200, PayloadTooLarge: 413, ServiceUnavailable: 503 } as const;
export type HttpStatus = (typeof HttpStatus)[keyof typeof HttpStatus];

/** Milliseconds in one second. */
export const MS_PER_SECOND = 1000;
/** Milliseconds in one minute. */
export const MS_PER_MINUTE = 60_000;
/** Milliseconds in one day. */
export const MS_PER_DAY = 86_400_000;
/** What a ratio is multiplied by to read as a percentage. */
export const PERCENT = 100;
