import { migrateDb } from "./index.ts";

await migrateDb();

console.log("Migration complete.");
