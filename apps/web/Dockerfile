# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/clients/package.json packages/clients/package.json
COPY packages/lexicons/package.json packages/lexicons/package.json
COPY e2e/package.json e2e/package.json
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm --filter @openxiv/shared build \
 && pnpm --filter @openxiv/web build

# ---- Runtime ----
# Same rationale as apps/api/Dockerfile — copy the full /app tree so pnpm
# workspace symlinks resolve at runtime.
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321

COPY --from=build /app /app

EXPOSE 4321
ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/web/dist/server/entry.mjs"]
