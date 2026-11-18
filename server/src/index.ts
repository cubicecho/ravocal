import './core/preflight.ts';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, db } from '@cubicecho/ravocal-db';
import { waitForDatabase } from '@cubicecho/ravocal-db/wait';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createAuth, sendsMagicLinks } from './auth/better-auth.ts';
import { appUrl, dbConnectTimeoutMs, port, secureLocalNet } from './core/config.ts';
import { errorMessage } from './core/errors.ts';
import { createApp } from './http/app.ts';
import { stopOnSignals } from './http/shutdown.ts';

/** Postgres's port, shown when DATABASE_URL names none. */
const DEFAULT_POSTGRES_PORT = '5432';
/** Every interface. The container's port mapping decides who can reach it. */
const LISTEN_HOST = '0.0.0.0';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const auth = createAuth(db);
const app = createApp({ db, auth, staticDir: join(__dirname, '../../app/dist') });

const server = app.listen(port(), LISTEN_HOST, (error) => {
  if (error !== undefined) {
    console.error(`[server] cannot listen on port ${port()}: ${errorMessage(error)}`);
    process.exit(1);
  }
  console.log(`[server] ready on port ${port()}: GraphQL at /graphql, health at /healthz`);
  console.log(`[server] links in emails point at ${appUrl()}`);
  if (secureLocalNet()) {
    console.warn('[auth] SECURE_LOCAL_NET is on: any email signs in without a link. Private networks only.');
  } else if (sendsMagicLinks(auth) === false) {
    console.warn(
      '[auth] nobody can sign in: set SMTP_URL to email sign-in links, or SECURE_LOCAL_NET=true on a private network.',
    );
  }
});
stopOnSignals(server, { after: closeDatabase });
