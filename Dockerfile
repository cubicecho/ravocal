FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY . .

RUN npm ci
RUN npm run build -w db && npm run codegen && npm run build -w app && npm run build -w server

FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app .

RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_URL=/data/pgdata

RUN mkdir -p /data

EXPOSE 3001

VOLUME ["/data"]

CMD ["node", "--experimental-strip-types", "--preserve-symlinks", "server/src/index.ts"]
