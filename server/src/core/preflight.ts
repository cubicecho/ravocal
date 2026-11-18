// Runs before anything connects or signs a session, so a misconfigured instance fails with a sentence, not a stack trace.
import { hostOf, isPrivateHost } from '@cubicecho/ravocal-db/ssl';
import {
  allowsPublicLocalNet,
  appUrl,
  configuredAuthSecret,
  describeWeakSecret,
  halfSetProviders,
  isProduction,
  oidcConfigProblems,
  secureLocalNet,
} from './config.ts';

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
  const weakness = describeWeakSecret(configuredAuthSecret());
  if (weakness !== undefined) {
    fatal(`BETTER_AUTH_SECRET ${weakness}. Set a strong random value: generate one with \`openssl rand -hex 32\`.`);
  }
}

if (secureLocalNet()) {
  // With SECURE_LOCAL_NET, typing any email signs in as that account.
  const isExposed = isPrivateHost(hostOf(appUrl())) === false && allowsPublicLocalNet() === false;
  if (isExposed) {
    fatal(
      `SECURE_LOCAL_NET is on but APP_URL (${appUrl()}) is not a private address. Turn it off, or set I_KNOW_SECURE_LOCAL_NET_IS_PUBLIC=true if nothing hostile can reach this port.`,
    );
  }
}

// Half a provider's client leaves the login page without its button, and nothing says why.
const [halfSet] = halfSetProviders();
if (halfSet !== undefined) {
  fatal(halfSet);
}

// Half an OIDC setup leaves the login page without its button, and an unknown client auth fails at the first sign-in.
const [oidcProblem] = oidcConfigProblems();
if (oidcProblem !== undefined) {
  fatal(oidcProblem);
}

// Every redirect URI a provider is given is built from it.
const configuredServerUrl = process.env.SERVER_URL ?? '';
if (configuredServerUrl !== '' && URL.canParse(configuredServerUrl) === false) {
  fatal(
    `SERVER_URL (${configuredServerUrl}) is not a URL. Set it to where a browser reaches this server, or unset it.`,
  );
}
