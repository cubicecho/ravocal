import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as relations from "./relations.ts";
import * as schema from "./schema.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const migrationsFolder = path.resolve(__dirname, "../drizzle");

const DATABASE_URL = process.env.DATABASE_URL ?? path.join(projectRoot, "pgdata");
const isPostgres =
  DATABASE_URL.startsWith("postgres://") || DATABASE_URL.startsWith("postgresql://");

/** Tables and their relations: what `db.query` is typed and built from. */
const fullSchema = { ...schema, ...relations };
type FullSchema = typeof fullSchema;

/** The database handle, whichever driver opened it. */
export type DB = PgDatabase<PgQueryResultHKT, FullSchema>;

/** An open database, tagged with the driver that opened it so the matching migrator runs. */
type Connection =
  | { driver: "postgres"; db: PostgresJsDatabase<FullSchema> }
  | { driver: "pglite"; db: PgliteDatabase<FullSchema> };

/**
 * Opens the database `DATABASE_URL` names: a Postgres server for a
 * `postgres://` URL, otherwise an embedded PGlite data directory.
 *
 * @returns The open database and the driver behind it.
 */
async function connect(): Promise<Connection> {
  if (isPostgres) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const isProduction = process.env.NODE_ENV === "production";
    const connection = isProduction ? { url: DATABASE_URL, ssl: "require" as const } : DATABASE_URL;
    return { driver: "postgres", db: drizzle({ connection, schema: fullSchema }) };
  }
  const { drizzle } = await import("drizzle-orm/pglite");
  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = DATABASE_URL.startsWith("file:") ? DATABASE_URL.slice(5) : DATABASE_URL;
  const client = new PGlite(dataDir);
  await client.waitReady;
  return { driver: "pglite", db: drizzle({ client, schema: fullSchema }) };
}

const connection = await connect();

export const db: DB = connection.db;

/**
 * Applies the pending migrations in `db/drizzle` with the migrator that
 * matches the open driver.
 *
 * @returns Resolves once every migration has run.
 */
export async function migrateDb(): Promise<void> {
  if (connection.driver === "postgres") {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(connection.db, { migrationsFolder });
    return;
  }
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(connection.db, { migrationsFolder });
}

export * from "./relations.ts";
export * from "./schema.ts";
export { schema };
