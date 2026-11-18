import { join } from 'node:path';
import express, { type RequestHandler } from 'express';

/** The methods a page load uses. Anything else falls through to Express's 404. */
const PAGE_METHODS = new Set(['GET', 'HEAD']);

/**
 * Serves the built SPA: its files as they are, and index.html for any other page, so a deep link loads the app.
 *
 * @remarks
 * Mounted with `app.use` and no path, since Express 5's path syntax has no bare `*`.
 *
 * @param staticDir - The built app's directory, holding index.html.
 * @returns The handler, mounted after every API route.
 */
export function createStaticHandler(staticDir: string): RequestHandler {
  const serveFile = express.static(staticDir);
  const indexHtml = join(staticDir, 'index.html');
  return (req, res, next) => {
    serveFile(req, res, (error?: unknown) => {
      if (error !== undefined) {
        next(error);
        return;
      }
      const isPageLoad = PAGE_METHODS.has(req.method);
      if (isPageLoad === false) {
        next();
        return;
      }
      res.sendFile(indexHtml);
    });
  };
}
