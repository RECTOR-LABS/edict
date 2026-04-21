# syntax=docker/dockerfile:1.7

# ── base: node LTS + pnpm ────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
# Pin to 10.33.0 to match local dev toolchain (engines: >=9 is satisfied).
# Keeps "works locally ↔ works in container" symmetry.
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# ── deps: install all dependencies (cached layer) ────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── build: compile Next.js ────────────────────────────────────────────────────
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# lib/db initialises pg Pool at module-load time, so Next's static-analysis pass
# throws "missing env: DATABASE_URL" even for fully dynamic routes.
# We supply dummy DSNs so the build completes; no real data is read.
# Real URLs are injected at runtime only — never baked into the image.
ARG DATABASE_URL=postgres://build:build@localhost:5432/build
ARG DATABASE_ADMIN_URL=postgres://build:build@localhost:5432/build
ENV DATABASE_URL=${DATABASE_URL} \
    DATABASE_ADMIN_URL=${DATABASE_ADMIN_URL}

RUN pnpm build

# Unset the build-time env so it cannot leak into the runtime stage via ENV.
# (The runtime stage redefines its own ENV block; this is belt-and-suspenders.)
ENV DATABASE_URL="" \
    DATABASE_ADMIN_URL=""

# ── runtime: lean production image ───────────────────────────────────────────
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Next.js artefacts
COPY --from=build /app/.next ./.next
# public/ is optional — only copy if it exists at build time.
# The project currently has no public/ dir; this is a no-op placeholder.
# Uncomment when assets are added: COPY --from=build /app/public ./public

# Runtime dependencies (includes devDeps for drizzle-kit migrate at startup)
COPY --from=build /app/node_modules ./node_modules

# Migration artefacts
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts

# Admin scripts (needed for edict:admin:seed / edict:admin:invite post-deploy)
COPY --from=build /app/scripts ./scripts

# lib/ (drizzle-kit reads schema path from drizzle.config.ts → ./lib/db/schema.ts)
COPY --from=build /app/lib ./lib

# Manifest
COPY --from=build /app/package.json ./package.json

# Run as non-root
USER node

EXPOSE 3000

# Run migrations then start the server.
# Phase I = single instance, so migration-on-startup is safe.
# For multi-instance scale-out, extract migrations to a one-shot init container.
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
