import type { DB } from '@cubicecho/ravocal-db';
import { users } from '@cubicecho/ravocal-db/schema';
import { and, eq, sql } from 'drizzle-orm';

// Who runs the instance. One thing needs it so far: changing how people sign in (sso/resolvers.ts). Whoever sets an
// instance up is its first account, so that account becomes the admin, and nobody is asked to edit a database row. An
// instance that had accounts before there was an admin got its oldest one as the admin (the oidc_pairing migration).

/** Postgres's code for a unique index refusing a row. */
const UNIQUE_VIOLATION = '23505';

/**
 * Whether a user is the admin.
 *
 * @param db - The database.
 * @param userId - The user.
 * @returns Their flag; false for a user that does not exist.
 */
export async function isAdmin(db: DB, userId: string): Promise<boolean> {
  const [user] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId));
  return user?.isAdmin === true;
}

/**
 * Whether a failure, or anything in its `cause` chain, is a unique index refusing a row.
 *
 * @param error - What was thrown.
 * @returns true for Postgres's 23505.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if ('code' in current && current.code === UNIQUE_VIOLATION) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

/**
 * Makes a new account the admin when the instance has none. better-auth runs it after creating any user, whichever way
 * they signed in.
 *
 * @remarks
 * One statement, so the check and the claim cannot be split by another sign-up. Two that commit at the same moment
 * each see no admin, so `uq_users_one_admin` (one `is_admin` row at most) refuses the later one, which is then just
 * not the admin.
 *
 * @param db - The database.
 * @param userId - The account just created.
 */
export async function claimFirstAdmin(db: DB, userId: string): Promise<void> {
  try {
    await db
      .update(users)
      .set({ isAdmin: true })
      .where(and(eq(users.id, userId), sql`NOT EXISTS (SELECT 1 FROM "users" AS "admins" WHERE "admins"."is_admin")`));
  } catch (error) {
    if (isUniqueViolation(error) === false) {
      throw error;
    }
  }
}

/**
 * Whether anyone has an account yet.
 *
 * @param db - The database.
 * @returns true once the first account exists.
 */
export async function hasUsers(db: DB): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).limit(1);
  return row !== undefined;
}
