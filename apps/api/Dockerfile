FROM node:22.22.0-bookworm-slim AS build

WORKDIR /workspace
RUN npm install --global pnpm@11.7.0 && test "$(pnpm --version)" = "11.7.0"

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/contracts packages/contracts
RUN pnpm --filter @relay/contracts build \
  && pnpm --filter @relay/api build \
  && pnpm --filter @relay/api --prod deploy --legacy /opt/relay-api

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:70a2c12a0d76018b54d7bd01c5e3677632eeed9f890ba318d6db55fc54cf3baa AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /opt/relay-api/ ./

FROM runtime AS worker

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "dist/worker-health.js"]
CMD ["dist/worker.js"]

FROM runtime AS api

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:8787/api/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]
CMD ["dist/server.js"]
