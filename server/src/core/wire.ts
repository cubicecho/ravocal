/** The HTTP statuses this server sends or reads, and its tests expect. */
export const HttpStatus = {
  Ok: 200,
  Created: 201,
  NoContent: 204,
  Found: 302,
  BadRequest: 400,
  Unauthorized: 401,
  NotFound: 404,
  PayloadTooLarge: 413,
  TooManyRequests: 429,
  InternalServerError: 500,
  ServiceUnavailable: 503,
} as const;
export type HttpStatus = (typeof HttpStatus)[keyof typeof HttpStatus];

/** Milliseconds in one second. */
export const MS_PER_SECOND = 1000;
/** Milliseconds in one minute. */
export const MS_PER_MINUTE = 60_000;
/** Milliseconds in one day. */
export const MS_PER_DAY = 86_400_000;
/** Seconds in one minute. */
export const SECONDS_PER_MINUTE = 60;
/** Seconds in one day. */
export const SECONDS_PER_DAY = 86_400;
/** What a ratio is multiplied by to read as a percentage. */
export const PERCENT = 100;
