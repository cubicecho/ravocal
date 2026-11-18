import type { DB } from '@cubicecho/ravocal-db';
import express, { type Express } from 'express';
import type { Auth } from '../auth/better-auth.ts';
import { createRateLimiter, type RateLimiter } from '../auth/rate-limit.ts';
import { trustProxy } from '../core/config.ts';
import { HTTP_DEFAULTS } from '../core/defaults.ts';
import { HttpStatus } from '../core/wire.ts';
import { createGraphQLHandler } from '../graphql/handler.ts';
import { checkHealth } from './health.ts';
import { createStaticHandler } from './static.ts';

/** What the app talks to. Tests pass PGlite and a test auth. */
export interface AppDeps {
  db: DB;
  /** better-auth, from `createAuth(db)`. Its REST routes are not mounted: /graphql serves its endpoints. */
  auth: Auth;
  /**
   * Sign-in throttle. Tests pass a tighter one.
   * @defaultValue `createRateLimiter()`
   */
  limiter?: RateLimiter;
  /** The built SPA's directory. Left out in tests that don't serve it. */
  staticDir?: string;
}

/**
 * Builds the Express app: /graphql, /healthz and the SPA.
 *
 * @param deps - What the app talks to.
 * @returns The app, not listening.
 */
export function createApp({ db, auth, limiter = createRateLimiter(), staticDir }: AppDeps): Express {
  const app = express();
  // Which proxy hops may set X-Forwarded-For, and so what `ctx.ip` is. The sign-in throttle keys on it.
  app.set('trust proxy', trustProxy());
  const graphql = createGraphQLHandler({ db, auth, limiter });

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
  if (staticDir !== undefined) {
    app.use(createStaticHandler(staticDir));
  }
  return app;
}
