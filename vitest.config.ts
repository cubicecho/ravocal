import path from 'node:path';
import { defineConfig } from 'vitest/config';

const alias = [
  // graphql ships no exports map: Vite follows `module` to index.mjs while Node
  // follows `main` to index.js, and the two copies fail each other's instanceof checks.
  { find: /^graphql$/, replacement: path.resolve(__dirname, './node_modules/graphql/index.js') },
];

export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    exclude: ['**/node_modules/**', '**/dist/**'],
    env: {
      // A test that forgets its throwaway db fails loudly instead of writing to the developer's Postgres.
      DATABASE_URL: '',
      // No SMTP host, so the email service logs instead of sending.
      SMTP_HOST: '',
    },
    // Threads share one process, where a fork per file each loads its own copy of everything.
    pool: 'threads',
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          // Diffs the models once per run, so no test file has to load drizzle-kit.
          globalSetup: ['./server/src/__tests__/global-setup.ts'],
          include: ['db/**/*.test.ts', 'server/**/*.test.ts'],
        },
      },
    ],
  },
});
