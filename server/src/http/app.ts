import type { DB } from '@cubicecho/ravocal-db';
import express, { type Express } from 'express';
import type { AuthHost } from '../auth/auth-host.ts';
import type { Mailer } from '../auth/email.ts';
import { createRateLimiter, type RateLimiter } from '../auth/rate-limit.ts';
import { trustProxy } from '../core/config.ts';
import { HTTP_DEFAULTS } from '../core/defaults.ts';
import { HttpStatus } from '../core/wire.ts';
import { createGraphQLHandler } from '../graphql/handler.ts';
import { checkHealth } from './health.ts';
import { mountSso } from './sso.ts';
import { createStaticHandler } from './static.ts';

/** What the app talks to. Tests pass PGlite and a test auth. */
export interface AppDeps {
  db: DB;
  /**
   * Where each request's better-auth instance comes from: `createAuthHost(db)`, or `fixedAuthHost(auth)` in tests.
   * /graphql serves its endpoints, and of its REST routes only a provider's callback is mounted (sso.ts).
   */
  authHost: AuthHost;
  /**
   * Sign-in throttle. Tests pass a tighter one.
   * @defaultValue `createRateLimiter()`
   */
  limiter?: RateLimiter;
  /**
   * Sends the invite and vote emails. Tests pass one that captures them.
   * @defaultValue `sendMail`, over `SMTP_URL`
   */
  mailer?: Mailer;
  /** The built SPA's directory. Left out in tests that don't serve it. */
  staticDir?: string;
}

/**
 * Builds the Express app: /graphql, /healthz, a provider's sign-in redirects, and the SPA.
 *
 * @param deps - What the app talks to.
 * @returns The app, not listening.
 */
export function createApp({ db, authHost, limiter = createRateLimiter(), mailer, staticDir }: AppDeps): Express {
  const app = express();
  // Which proxy hops may set X-Forwarded-For, and so what `ctx.ip` is. The sign-in throttle keys on it.
  app.set('trust proxy', trustProxy());
  const graphql = createGraphQLHandler({ db, authHost, limiter, mailer });

  // Yoga reads a body Express already parsed, so this is where the size cap goes. Over it: 413.
  app.use(graphql.graphqlEndpoint, express.json({ limit: HTTP_DEFAULTS.bodyLimit }));
  // `all`, not `use`: a mounted `use` strips the path, and Yoga matches graphqlEndpoint itself.
  app.all(graphql.graphqlEndpoint, (req, res) => graphql(req, res));
  // Before the static handler, whose SPA fallback would answer 200 while the database is down.
  app.get('/healthz', async (_req, res) => {
    const health = await checkHealth(db);
    const status = health.ok ? HttpStatus.Ok : HttpStatus.ServiceUnavailable;
    res.status(status).json(health);
  });
  // Before the static handler too, whose SPA fallback would answer both of its paths.
  mountSso(app, authHost);
  if (staticDir !== undefined) {
    app.use(createStaticHandler(staticDir));
  }
  return app;
}
