// Runs before anything connects or signs a token, so a misconfigured instance fails with a sentence, not a stack trace.
import { configuredJwtSecret, describeWeakSecret, isProduction } from './config.ts';

/**
 * Logs and exits 1.
 *
 * @param message - What's wrong and how to fix it.
 * @returns Never.
 */
function fatal(message: string): never {
  console.error(`[preflight] ${message}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL ?? '';
if (databaseUrl === '') {
  fatal('DATABASE_URL is required. Copy .env.example to .env, then run `npm run db:up` for a local Postgres.');
}

if (isProduction()) {
  // A known or guessable secret means anyone can forge a session for any account.
  const weakness = describeWeakSecret(configuredJwtSecret());
  if (weakness !== undefined) {
    fatal(`JWT_SECRET ${weakness}. Set a strong random value: generate one with \`openssl rand -hex 32\`.`);
  }
}
