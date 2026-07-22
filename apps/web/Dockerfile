FROM node:22.22.0-bookworm-slim AS build

WORKDIR /workspace
RUN npm install --global pnpm@11.7.0 && test "$(pnpm --version)" = "11.7.0"

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages/contracts packages/contracts

ARG VITE_OIDC_AUTHORITY
ARG VITE_OIDC_CLIENT_ID
ARG VITE_OIDC_AUDIENCE
ARG VITE_OIDC_SCOPE="openid profile email"
ARG VITE_OIDC_REDIRECT_URI
ARG VITE_OIDC_POST_LOGOUT_REDIRECT_URI
ARG VITE_OIDC_SILENT_REDIRECT_URI
ARG VITE_API_BASE_URL
ARG VITE_API_ALLOWED_ORIGINS
ARG VITE_AUTH_MODE=oidc
ARG VITE_DEMO_MODE=false
ARG VITE_DEVELOPMENT_ACTOR_ID=user-local-admin
ARG VITE_ALLOW_PRODUCTION_DEVELOPMENT_AUTH=false
RUN VITE_AUTH_MODE=$VITE_AUTH_MODE \
  VITE_DEMO_MODE=$VITE_DEMO_MODE \
  VITE_DEVELOPMENT_ACTOR_ID=$VITE_DEVELOPMENT_ACTOR_ID \
  VITE_ALLOW_PRODUCTION_DEVELOPMENT_AUTH=$VITE_ALLOW_PRODUCTION_DEVELOPMENT_AUTH \
  VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY \
  VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID \
  VITE_OIDC_AUDIENCE=$VITE_OIDC_AUDIENCE \
  VITE_OIDC_SCOPE=$VITE_OIDC_SCOPE \
  VITE_OIDC_REDIRECT_URI=$VITE_OIDC_REDIRECT_URI \
  VITE_OIDC_POST_LOGOUT_REDIRECT_URI=$VITE_OIDC_POST_LOGOUT_REDIRECT_URI \
  VITE_OIDC_SILENT_REDIRECT_URI=$VITE_OIDC_SILENT_REDIRECT_URI \
  VITE_API_BASE_URL=$VITE_API_BASE_URL \
  VITE_API_ALLOWED_ORIGINS=$VITE_API_ALLOWED_ORIGINS \
  sh -c 'pnpm --filter @cosmos/contracts build && pnpm --filter @cosmos/web build'

FROM nginxinc/nginx-unprivileged:1.29.5-alpine-slim AS runtime

USER root
RUN apk upgrade --no-cache
USER nginx

ENV COSMOS_API_UPSTREAM=http://api:8787 \
  COSMOS_CSP_CONNECT_SRC="'self'" \
  COSMOS_CSP_FRAME_SRC="'self'" \
  NGINX_ENVSUBST_FILTER="^(COSMOS_API_UPSTREAM|COSMOS_CSP_CONNECT_SRC|COSMOS_CSP_FRAME_SRC)$"

COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
