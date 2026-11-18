# syntax=docker/dockerfile:1

FROM node:26-slim AS builder
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run codegen && npm run build:app

FROM node:26-slim AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
COPY db/package.json db/
COPY server/package.json server/
COPY app/package.json app/
RUN npm ci --omit=dev --include-workspace-root --workspace @cubicecho/ravocal-db --workspace @cubicecho/ravocal-server \
 && npm cache clean --force

# The server isn't compiled. Its sources are the build output.
COPY db/src db/src
COPY db/drizzle db/drizzle
COPY server/src server/src
COPY --from=builder /app/app/dist app/dist

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# No --preserve-symlinks: it would resolve the db workspace to its path inside
# node_modules, and Node refuses to strip types from anything under there.
# Exec form, so node is PID 1 and gets SIGTERM itself (stopOnSignals, server/src/http/shutdown.ts).
CMD ["node", "server/src/index.ts"]
