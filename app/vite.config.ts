import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The API server `npm run dev:server` starts (HTTP_DEFAULTS.port). */
const SERVER = 'http://localhost:3001';

export default defineConfig({
  plugins: [TanStackRouterVite({ routesDirectory: './src/routes' }), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Everything the browser asks of the server, on the app's own origin, as production serves it: GraphQL, and a
    // provider's sign-in start and callback, whose state cookie has to come back to the origin that set it.
    proxy: {
      '/graphql': SERVER,
      '^/sso/': SERVER,
      '/api/auth/': SERVER,
    },
  },
});
