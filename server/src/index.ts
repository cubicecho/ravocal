import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { closeDatabase, db } from '@cubicecho/ravocal-db';
import { waitForDatabase } from '@cubicecho/ravocal-db/wait';
import cors from 'cors';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import express from 'express';
import { createContext } from './context.ts';
import { dbConnectTimeoutMs, port } from './core/config.ts';
import { buildSchema } from './schema/index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = port();
/** Postgres's port, shown when DATABASE_URL names none. */
const DEFAULT_POSTGRES_PORT = '5432';
/** How long shutdown may take in all before a hard exit. Under Docker's 10 s stop grace period. */
const SHUTDOWN_DEADLINE_MS = 8000;

/**
 * Reads a caught value's message.
 *
 * @param error - Anything that was thrown.
 * @returns The error's message, or the value as a string.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-change-in-production')
) {
  console.error('FATAL: JWT_SECRET must be set to a strong random value in production.');
  process.exit(1);
}

try {
  await waitForDatabase(db, { connectTimeoutMs: dbConnectTimeoutMs() });
} catch (error) {
  const { hostname, port: urlPort } = new URL(process.env.DATABASE_URL ?? '');
  const dbPort = urlPort === '' ? DEFAULT_POSTGRES_PORT : urlPort;
  console.error(`[db] cannot reach Postgres at ${hostname}:${dbPort}: ${errorMessage(error)}`);
  console.error('[db] check DATABASE_URL in .env, and that `npm run db:up` has started it.');
  process.exit(1);
}

// At boot, so a fresh database is set up by starting the server.
await migrate(db, { migrationsFolder: join(__dirname, '../../db/drizzle') });

const schema = buildSchema();

// Shutdown is handled below. Apollo's own handler re-raises the signal, which would read as a second one.
const apolloServer = new ApolloServer({ schema, stopOnTerminationSignals: false });
await apolloServer.start();

const app = express();
const httpServer = createServer(app);

const staticDir = join(__dirname, '../../app/dist');

app.use(cors());
app.use(express.json());
app.use(
  '/graphql',
  expressMiddleware(apolloServer, {
    context: async ({ req }) => createContext(req, db),
  }),
);

app.use(express.static(staticDir));
app.get('*', (_req, res) => {
  res.sendFile(join(staticDir, 'index.html'));
});

httpServer.listen(PORT, () => {
  console.log(`Server ready at http://localhost:${PORT}/graphql`);
  console.log(`App served at http://localhost:${PORT}`);
});

let isStopping = false;

/**
 * Stops taking requests, lets the open ones finish, closes the database and exits. A second signal exits at once.
 *
 * @param signal - The signal that asked the process to stop.
 */
function stop(signal: NodeJS.Signals): void {
  if (isStopping) {
    process.exit(1);
  }
  isStopping = true;
  console.log(`[server] ${signal}: draining`);
  setTimeout(() => {
    console.error('[server] shutdown took too long, exiting');
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS).unref();
  httpServer.close(() => {
    apolloServer
      .stop()
      .then(closeDatabase)
      .then(
        () => {
          console.log('[server] stopped');
          process.exit(0);
        },
        (error: unknown) => {
          console.error(`[server] shutdown failed: ${errorMessage(error)}`);
          process.exit(1);
        },
      );
  });
  httpServer.closeIdleConnections();
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);
