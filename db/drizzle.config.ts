import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const DATABASE_URL = process.env.DATABASE_URL ?? "";
const isPostgres =
  DATABASE_URL.startsWith("postgres://") || DATABASE_URL.startsWith("postgresql://");
const dataDir = isPostgres ? DATABASE_URL : path.join(projectRoot, "pgdata");

export default defineConfig({
  out: "./drizzle",
  schema: "./src/schema.ts",
  dialect: "postgresql",
  ...(isPostgres ? {} : { driver: "pglite" as const }),
  dbCredentials: {
    url: dataDir,
  },
});
