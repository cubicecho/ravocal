import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    env: {
      // Importing @cubicecho/ravocal-db opens its singleton at import time. In memory, a
      // test that forgets its own throwaway db can't write to ./pgdata.
      DATABASE_URL: 'memory://',
      // No SMTP host, so the email service logs instead of sending.
      SMTP_HOST: '',
    },
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './app/src') },
      // The package's main is its build output; tests run the sources, so they
      // don't need `npm run build -w db` first.
      { find: '@cubicecho/ravocal-db', replacement: path.resolve(__dirname, './db/src/index.ts') },
      // graphql ships no exports map: Vite follows `module` to index.mjs while
      // Node follows `main` to index.js, and the two copies fail each other's
      // instanceof checks.
      {
        find: /^graphql$/,
        replacement: path.resolve(__dirname, './node_modules/graphql/index.js'),
      },
    ],
  },
});
