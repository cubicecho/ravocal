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
      // No SMTP, so invite and vote emails are printed, and tests capture sign-in links (createTestAuth).
      SMTP_URL: '',
      // Sign-in sends links unless a test turns this on itself.
      SECURE_LOCAL_NET: '',
      // No provider, and none from the developer's shell: a test that wants one names it.
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      FACEBOOK_CLIENT_ID: '',
      FACEBOOK_CLIENT_SECRET: '',
      OIDC_ISSUER: '',
      OIDC_CLIENT_ID: '',
      OIDC_CLIENT_SECRET: '',
      OIDC_CLIENT_AUTH: '',
      OIDC_NAME: '',
      SERVER_URL: '',
    },
    // Threads share one process, where a fork per file each loads its own copy of everything.
    pool: 'threads',
    // Every test db is a fresh in-memory PGlite, and starting one takes about 2 s on PGlite 0.5
    // (1.5 s on 0.2). With every file starting its own at once, a test or hook that makes a db
    // can pass Vitest's 5 s / 10 s defaults under load without anything being wrong.
    testTimeout: 20_000,
    hookTimeout: 30_000,
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
      {
        extends: true,
        // The app's `@/` imports, as its tsconfig and Vite resolve them (a helper using a cubeui lib, `@/lib/day`).
        resolve: { alias: [{ find: /^@\//, replacement: `${path.resolve(__dirname, './app/src')}/` }] },
        test: {
          name: 'app',
          environment: 'node',
          // The app's pure helpers. A fork per file, because their tests move the process's time zone (TZ).
          pool: 'forks',
          include: ['app/**/*.test.ts'],
        },
      },
    ],
  },
});
