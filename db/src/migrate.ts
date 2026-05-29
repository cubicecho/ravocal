import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, "../drizzle");

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const isPostgres =
  DATABASE_URL.startsWith("postgres://") || DATABASE_URL.startsWith("postgresql://");

if (isPostgres) {
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  // biome-ignore lint/suspicious/noExplicitAny: union db type
  await migrate(db as any, { migrationsFolder });
} else {
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  // biome-ignore lint/suspicious/noExplicitAny: union db type
  await migrate(db as any, { migrationsFolder });
}

console.log("Migration complete.");
