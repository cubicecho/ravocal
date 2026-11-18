import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import { db, migrateDb } from "@cubicecho/ravocal-db";
import cors from "cors";
import express from "express";
import { createContext } from "./context.ts";
import { buildSchema } from "./schema/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? 3001;

if (
  process.env.NODE_ENV === "production" &&
  (!process.env.JWT_SECRET || process.env.JWT_SECRET === "dev-secret-change-in-production")
) {
  console.error("FATAL: JWT_SECRET must be set to a strong random value in production.");
  process.exit(1);
}

await migrateDb();

const schema = buildSchema();

const apolloServer = new ApolloServer({ schema });
await apolloServer.start();

const app = express();
const httpServer = createServer(app);

const staticDir = join(__dirname, "../../app/dist");

app.use(cors());
app.use(express.json());
app.use(
  "/graphql",
  expressMiddleware(apolloServer, {
    context: async ({ req }) => createContext(req, db),
  }),
);

app.use(express.static(staticDir));
app.get("*", (_req, res) => {
  res.sendFile(join(staticDir, "index.html"));
});

httpServer.listen(PORT, () => {
  console.log(`Server ready at http://localhost:${PORT}/graphql`);
  console.log(`App served at http://localhost:${PORT}`);
});
