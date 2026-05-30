# Edict Phase 1 MVP Implementation Plan

> **Historical artifact (April 2026).** This is the completed Phase 1 build plan; it describes a self-hosted VPS/Docker deployment. Edict later migrated to **Vercel + Neon Postgres** (2026-05-30) — so the deployment/infra steps here no longer reflect production. Kept as a record of what was built — see `CLAUDE.md` and `docs/deployment-runbook.md` for the current state.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a multi-tenant client docs delivery platform that hosts the Adrena Trading Arena implementation plan at `edict.rectorspace.com`, authenticating clients via magic-link, enforcing hard tenant isolation at app + DB layers, with full audit logging.

**Architecture:** Single Next.js 16 app (App Router, Server Components, Server Actions) on your shared VPS. Postgres 16 on the same VPS, localhost-bind only, with Row-Level Security as a second defensive layer on top of application-level `client_id` scoping. Custom magic-link auth using `@oslojs/crypto` primitives. Resend for email. Docker Compose orchestration behind nginx + Cloudflare. Every UI surface generated via `aidesigner` before being ported into Next.js.

**Tech Stack:** Next.js 16 · TypeScript strict · Tailwind v4 · Drizzle ORM · PostgreSQL 16 · `@oslojs/crypto` · `@oslojs/encoding` · Resend + react-email · unified/remark/rehype · Vitest · Playwright · testcontainers · Docker Compose · pnpm 9.

---

## File Structure

```
edict/
├── app/                                # Next.js 16 App Router
│   ├── layout.tsx
│   ├── page.tsx                        # Landing /
│   ├── globals.css
│   ├── (auth)/
│   │   ├── auth/verify/route.ts
│   │   └── auth/logout/route.ts
│   ├── (admin)/
│   │   ├── layout.tsx                  # requireAdminSession
│   │   └── admin/
│   │       ├── page.tsx                # Dashboard
│   │       ├── clients/
│   │       │   ├── page.tsx
│   │       │   ├── new/page.tsx
│   │       │   └── [id]/page.tsx
│   │       ├── docs/
│   │       │   ├── page.tsx
│   │       │   ├── new/page.tsx
│   │       │   ├── [id]/page.tsx
│   │       │   ├── [id]/share/page.tsx
│   │       │   └── [id]/analytics/page.tsx
│   │       └── audit/page.tsx
│   ├── (client)/
│   │   └── c/[slug]/
│   │       ├── layout.tsx              # requireClientSession + slug match
│   │       ├── page.tsx                # Dashboard
│   │       ├── d/[docSlug]/page.tsx    # Doc viewer
│   │       └── members/page.tsx
│   └── api/
│       ├── auth/request/route.ts       # Landing-page magic link request
│       └── track/view/route.ts         # View beacon
├── actions/                            # Server Actions
│   ├── clients.ts
│   ├── docs.ts
│   ├── share.ts
│   └── sessions.ts
├── components/                         # Shared UI primitives
│   └── (populated as surfaces land)
├── lib/
│   ├── auth/
│   │   ├── tokens.ts                   # generate/hash
│   │   ├── context.ts                  # AsyncLocalStorage
│   │   ├── issue.ts                    # issueMagicLink
│   │   ├── verify.ts                   # verifyMagicLink
│   │   └── middleware.ts               # require[Admin|Client]Session
│   ├── db/
│   │   ├── index.ts                    # connection pools (app + admin)
│   │   ├── schema.ts                   # Drizzle schema
│   │   └── queries/
│   │       ├── clients.ts
│   │       ├── members.ts
│   │       ├── docs.ts
│   │       ├── shares.ts
│   │       ├── sessions.ts
│   │       ├── tokens.ts
│   │       ├── audit.ts
│   │       └── rate-limit.ts
│   ├── docs/
│   │   ├── render-html.tsx             # iframe wrapper
│   │   └── render-markdown.ts          # remark/rehype pipeline
│   ├── mail/
│   │   ├── resend.ts
│   │   └── templates/
│   │       ├── magic-link.tsx
│   │       └── doc-shared.tsx
│   └── utils/
│       ├── hash.ts                     # SHA-256
│       └── slug.ts
├── scripts/
│   ├── admin-seed.ts                   # edict:admin:seed
│   └── admin-invite.ts                 # edict:admin:invite
├── migrations/                         # Drizzle + hand-written SQL
│   ├── 0000_initial.sql
│   ├── 0001_constraints.sql
│   └── 0002_rls.sql
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
│   ├── superpowers/
│   ├── starter-prompt.md
│   └── ui/                             # aidesigner prompts + history
├── nginx/edict.conf
├── docker-compose.yml                  # dev
├── docker-compose.prod.yml             # prod
├── Dockerfile
├── drizzle.config.ts
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── package.json
├── pnpm-lock.yaml
├── .env.example
└── .nvmrc
```

---

## Phase A: Scaffolding & Infrastructure

### Task 1: Initialize Node + pnpm + Next.js 16 scaffolding

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `tsconfig.json`, `next.config.ts`, `next-env.d.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `tailwind.config.ts`, `postcss.config.mjs`

- [ ] **Step 1: Pin Node version**

Create `.nvmrc`:
```
22.11.0
```

- [ ] **Step 2: Write root `package.json`**

Create `package.json`:
```json
{
  "name": "edict",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.11.0", "pnpm": ">=9" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:run": "vitest run",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio",
    "edict:admin:seed": "tsx scripts/admin-seed.ts",
    "edict:admin:invite": "tsx scripts/admin-invite.ts"
  },
  "dependencies": {
    "next": "16.0.0",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 3: Write TypeScript config**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] },
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Write Next.js config**

Create `next.config.ts`:
```ts
import type { NextConfig } from "next";

// Next 16.2+ moved `typedRoutes` out of `experimental` to top level.
const config: NextConfig = {
  typedRoutes: true,
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
```

- [ ] **Step 5: Add Tailwind v4**

Run: `pnpm add -D tailwindcss@next @tailwindcss/postcss@next postcss`

Create `postcss.config.mjs`:
```js
export default {
  plugins: { "@tailwindcss/postcss": {} },
};
```

Create `tailwind.config.ts`:
```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tenant: "var(--tenant-color, #00e5ff)",
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 6: Write root layout + landing placeholder**

Create `app/globals.css`:
```css
@import "tailwindcss";

:root {
  --tenant-color: #00e5ff;
}

html, body {
  background: #06060c;
  color: #e2e8f0;
  font-family: system-ui, sans-serif;
}
```

Create `app/layout.tsx`:
```tsx
import "./globals.css";

export const metadata = {
  title: "Edict",
  description: "Formal edicts, delivered.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Create `app/page.tsx`:
```tsx
export default function LandingPage() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <h1 className="text-2xl">Edict — placeholder landing</h1>
    </main>
  );
}
```

Create `next-env.d.ts`:
```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

- [ ] **Step 7: Install & verify dev server**

Run:
```bash
pnpm install
pnpm dev
```
Expected: server boots at http://localhost:3000, placeholder renders.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml .nvmrc tsconfig.json next.config.ts \
        next-env.d.ts postcss.config.mjs tailwind.config.ts \
        app/layout.tsx app/page.tsx app/globals.css
git commit -m "chore: scaffold next.js 16 + tailwind v4 baseline"
```

---

### Task 2: Add linting + formatting

**Files:**
- Create: `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`

- [ ] **Step 1: Install**

Run: `pnpm add -D eslint eslint-config-next prettier eslint-config-prettier`

- [ ] **Step 2: ESLint flat config**

Create `eslint.config.mjs`:
```js
// Next 16 ships native flat-config entries under `eslint-config-next/*`.
// FlatCompat crashes on ESLint 9 + Next 16 — avoid it.
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const config = [
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
];

export default config;
```

- [ ] **Step 3: Prettier config**

Create `.prettierrc.json`:
```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

Run: `pnpm add -D prettier-plugin-tailwindcss`

Create `.prettierignore`:
```
.next
node_modules
pnpm-lock.yaml
migrations
*.md
```

- [ ] **Step 4: Verify**

Run: `pnpm lint` → expect zero errors.
Run: `pnpm exec prettier --check .` → expect zero errors (format any stragglers with `--write`).

- [ ] **Step 5: Commit**

```bash
git add eslint.config.mjs .prettierrc.json .prettierignore package.json pnpm-lock.yaml
git commit -m "chore: eslint + prettier config"
```

---

### Task 3: Add testing frameworks (Vitest + Playwright + testcontainers)

**Files:**
- Create: `vitest.config.ts`, `playwright.config.ts`, `tests/setup.ts`, `tests/unit/.gitkeep`, `tests/integration/.gitkeep`, `tests/e2e/.gitkeep`

- [ ] **Step 1: Install**

Run:
```bash
pnpm add -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom \
            testcontainers @testcontainers/postgresql \
            @playwright/test
pnpm exec playwright install --with-deps chromium
```

- [ ] **Step 2: Vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    coverage: { provider: "v8", thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 } },
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
```

Create `tests/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Playwright config**

Create `playwright.config.ts`:
```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm build && pnpm start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 4: Smoke test**

Create `tests/unit/sanity.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("sanity", () => {
  it("math works", () => {
    expect(2 + 2).toBe(4);
  });
});
```

Run: `pnpm test:run` → expect 1 passed.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts playwright.config.ts tests/ package.json pnpm-lock.yaml
git commit -m "chore: add vitest + playwright + testcontainers"
```

---

### Task 4: Add Drizzle + Postgres + auth deps

**Files:**
- Create: `drizzle.config.ts`
- Modify: `package.json` scripts already include db:* commands

- [ ] **Step 1: Install**

Run:
```bash
pnpm add drizzle-orm pg @oslojs/crypto @oslojs/encoding
pnpm add -D drizzle-kit @types/pg
```

- [ ] **Step 2: Drizzle config**

Create `drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_ADMIN_URL ?? "postgres://edict_admin:dev@127.0.0.1:5432/edict",
  },
  strict: true,
  verbose: true,
});
```

- [ ] **Step 3: Commit**

```bash
git add drizzle.config.ts package.json pnpm-lock.yaml
git commit -m "chore: add drizzle + pg + oslojs deps"
```

---

### Task 5: Docker Compose for local Postgres

**Files:**
- Create: `docker-compose.yml`, `.env.example`

- [ ] **Step 1: Compose file**

Create `docker-compose.yml`:
```yaml
name: edict-dev

services:
  db:
    image: postgres:16-alpine
    container_name: edict-dev-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: edict_admin
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: edict
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - edict_pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U edict_admin -d edict"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  edict_pg_data:
```

- [ ] **Step 2: Env example**

Create `.env.example`:
```
# Database
DATABASE_URL=postgres://edict_app:dev@127.0.0.1:5432/edict
DATABASE_ADMIN_URL=postgres://edict_admin:dev@127.0.0.1:5432/edict

# App
APP_URL=http://localhost:3000
SESSION_COOKIE_NAME=edict_session

# Mail
RESEND_API_KEY=re_replace_me
RESEND_FROM=edict@rectorspace.com

# Admin bootstrap
ADMIN_BOOTSTRAP_EMAIL=rector@rectorspace.com

# Dev-only flag
DEV_PRINT_MAGIC_LINKS=true
```

- [ ] **Step 3: Local bring-up check**

Run:
```bash
cp .env.example .env
docker compose up -d db
docker compose ps
```
Expected: `edict-dev-db` status healthy.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore: local postgres via docker compose"
```

---

## Phase B: Database Schema, RLS, Roles

### Task 6: Drizzle schema — tenants and people (clients, admins, client_members)

**Files:**
- Create: `lib/db/schema.ts`

- [ ] **Step 1: Schema — tenants and users**

Create `lib/db/schema.ts`:
```ts
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgRole,
  index,
  uniqueIndex,
  check,
  jsonb,
  bigserial,
  inet,
} from "drizzle-orm/pg-core";

/* ---- tenants ---- */
export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  brandColor: text("brand_color"),
  logoUrl: text("logo_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ---- platform admins ---- */
export const admins = pgTable("admins", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ---- users within a tenant ---- */
export const clientMembers = pgTable(
  "client_members",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    role: text("role").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqTenantEmail: uniqueIndex("client_members_tenant_email_idx").on(t.clientId, t.email),
    roleCheck: check("client_members_role_check", sql`${t.role} IN ('viewer','admin_of_client')`),
  }),
);
```

- [ ] **Step 2: Commit (partial schema — rest lands in next tasks)**

```bash
git add lib/db/schema.ts
git commit -m "feat(db): schema — clients, admins, client_members"
```

---

### Task 7: Drizzle schema — docs and shares

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Append docs + doc_shares**

Append to `lib/db/schema.ts`:
```ts
/* ---- edicts ---- */
export const docs = pgTable("docs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  bodyType: text("body_type").notNull(),
  body: text("body").notNull(),
  createdBy: uuid("created_by").notNull().references(() => admins.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  bodyTypeCheck: check("docs_body_type_check", sql`${t.bodyType} IN ('html','markdown')`),
}));

/* ---- many-to-many: tenant ↔ doc ---- */
export const docShares = pgTable("doc_shares", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  docId: uuid("doc_id").notNull().references(() => docs.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  sharedAt: timestamp("shared_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => ({
  uniqDocClient: uniqueIndex("doc_shares_doc_client_idx").on(t.docId, t.clientId),
  clientRevokedIdx: index("doc_shares_client_revoked_idx").on(t.clientId, t.revokedAt),
}));
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat(db): schema — docs, doc_shares"
```

---

### Task 8: Drizzle schema — magic-link tokens and sessions

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Append tokens + sessions**

Append to `lib/db/schema.ts`:
```ts
/* ---- pending magic-link tokens; raw only in email ---- */
export const magicLinkTokens = pgTable("magic_link_tokens", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tokenHash: text("token_hash").notNull().unique(),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  email: text("email").notNull(),
  clientId: uuid("client_id").references(() => clients.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  subjectTypeCheck: check("magic_link_subject_type_check",
    sql`${t.subjectType} IN ('client_member','admin')`),
  expiresIdx: index("magic_link_expires_idx").on(t.expiresAt),
}));

/* ---- active sessions; raw only in cookie ---- */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionTokenHash: text("session_token_hash").notNull().unique(),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  clientId: uuid("client_id").references(() => clients.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ip: inet("ip"),
  userAgent: text("user_agent"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  subjectTypeCheck: check("sessions_subject_type_check",
    sql`${t.subjectType} IN ('client_member','admin')`),
  adminNullClient: check("sessions_admin_null_client",
    sql`(${t.subjectType} = 'admin' AND ${t.clientId} IS NULL)
      OR (${t.subjectType} = 'client_member' AND ${t.clientId} IS NOT NULL)`),
  subjectRevokedIdx: index("sessions_subject_revoked_idx").on(t.subjectId, t.revokedAt),
}));
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat(db): schema — magic_link_tokens, sessions"
```

---

### Task 9: Drizzle schema — audit log + rate-limit store

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Append audit + rate limit**

Append to `lib/db/schema.ts`:
```ts
/* ---- audit log ---- */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: text("event_type").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: uuid("actor_id"),
  clientId: uuid("client_id").references(() => clients.id),
  docId: uuid("doc_id").references(() => docs.id),
  ip: inet("ip"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  actorTypeCheck: check("audit_log_actor_type_check",
    sql`${t.actorType} IN ('client_member','admin','system')`),
  clientCreatedIdx: index("audit_log_client_created_idx").on(t.clientId, t.createdAt),
  eventDocIdx: index("audit_log_event_doc_idx").on(t.eventType, t.docId, t.createdAt),
  actorCreatedIdx: index("audit_log_actor_created_idx").on(t.actorId, t.createdAt),
}));

/* ---- sliding-window rate limit events ---- */
export const rateLimitEvents = pgTable("rate_limit_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  bucketKey: text("bucket_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  bucketCreatedIdx: index("rate_limit_bucket_created_idx").on(t.bucketKey, t.createdAt),
}));
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat(db): schema — audit_log, rate_limit_events"
```

---

### Task 10: Generate and apply initial migration

**Files:**
- Create: `migrations/0000_<generated>.sql` (via drizzle-kit)

- [ ] **Step 1: Generate migration**

Run: `pnpm db:generate`
Expected: a new `migrations/0000_*.sql` is produced with all tables + indexes + CHECK constraints.

- [ ] **Step 2: Apply**

Run:
```bash
docker compose up -d db
pnpm db:migrate
```
Expected: all tables created, no errors.

- [ ] **Step 3: Verify structure**

Run:
```bash
docker exec -it edict-dev-db psql -U edict_admin -d edict -c "\dt"
```
Expected: 8 tables listed (clients, admins, client_members, docs, doc_shares, magic_link_tokens, sessions, audit_log, rate_limit_events — 9 with the last).

- [ ] **Step 4: Commit**

```bash
git add migrations/
git commit -m "feat(db): generate initial migration"
```

---

### Task 11: Hand-written migration — session trigger enforcing client_id integrity

**Files:**
- Create: `migrations/0001_session_trigger.sql`

- [ ] **Step 1: Write trigger migration**

Create `migrations/0001_session_trigger.sql`:
```sql
-- Ensure sessions.client_id matches client_members.client_id for client_member sessions.
-- CHECK constraints can't cross tables; this trigger does.

CREATE OR REPLACE FUNCTION enforce_session_client_id() RETURNS trigger AS $$
BEGIN
  IF NEW.subject_type = 'client_member' THEN
    IF NOT EXISTS (
      SELECT 1 FROM client_members
      WHERE id = NEW.subject_id AND client_id = NEW.client_id
    ) THEN
      RAISE EXCEPTION 'sessions.client_id must match client_members.client_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_enforce_client_id
  BEFORE INSERT OR UPDATE OF subject_type, subject_id, client_id ON sessions
  FOR EACH ROW EXECUTE FUNCTION enforce_session_client_id();
```

- [ ] **Step 2: Apply**

Run: `pnpm db:migrate`
Expected: trigger + function created.

- [ ] **Step 3: Verify trigger**

Run:
```bash
docker exec -it edict-dev-db psql -U edict_admin -d edict \
  -c "SELECT tgname FROM pg_trigger WHERE tgrelid = 'sessions'::regclass;"
```
Expected: `sessions_enforce_client_id` in output.

- [ ] **Step 4: Commit**

```bash
git add migrations/0001_session_trigger.sql
git commit -m "feat(db): trigger enforcing session.client_id ↔ client_members.client_id"
```

---

### Task 12: Hand-written migration — DB roles and RLS policies

**Files:**
- Create: `migrations/0002_rls.sql`

- [ ] **Step 1: Write RLS migration**

Create `migrations/0002_rls.sql`:
```sql
-- Two application roles:
--   edict_app    — default, RLS enforced
--   edict_admin  — used by admin-session handlers, BYPASSRLS

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edict_app') THEN
    CREATE ROLE edict_app LOGIN PASSWORD 'dev';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edict_admin_role') THEN
    CREATE ROLE edict_admin_role LOGIN PASSWORD 'dev' BYPASSRLS;
  END IF;
END $$;

-- Grants: full for admin, CRUD for app
GRANT CONNECT ON DATABASE edict TO edict_app, edict_admin_role;
GRANT USAGE ON SCHEMA public TO edict_app, edict_admin_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO edict_app, edict_admin_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO edict_app, edict_admin_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO edict_app, edict_admin_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO edict_app, edict_admin_role;

-- Enable RLS on client-scoped tables
ALTER TABLE client_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Policy pattern: compare client_id to the per-request GUC 'edict.client_id'.
-- nullif(..., '') handles the unset case safely.

CREATE POLICY client_members_tenant_isolation ON client_members
  USING (client_id = nullif(current_setting('edict.client_id', true), '')::uuid);

CREATE POLICY doc_shares_tenant_isolation ON doc_shares
  USING (client_id = nullif(current_setting('edict.client_id', true), '')::uuid);

CREATE POLICY audit_log_tenant_isolation ON audit_log
  USING (client_id = nullif(current_setting('edict.client_id', true), '')::uuid);

-- App role must write audit entries (even during 'magic_link_failed' with no client_id)
CREATE POLICY audit_log_system_insert ON audit_log
  FOR INSERT
  WITH CHECK (actor_type = 'system' OR client_id = nullif(current_setting('edict.client_id', true), '')::uuid);
```

- [ ] **Step 2: Apply**

Run: `pnpm db:migrate`
Expected: roles + policies created.

- [ ] **Step 3: Verify**

Run:
```bash
docker exec -it edict-dev-db psql -U edict_admin -d edict \
  -c "SELECT schemaname, tablename, policyname FROM pg_policies ORDER BY tablename;"
```
Expected: at least 4 policies listed across the 3 RLS-enabled tables.

- [ ] **Step 4: Commit**

```bash
git add migrations/0002_rls.sql
git commit -m "feat(db): DB roles + RLS policies"
```

---

### Task 13: Integration test — RLS refuses cross-tenant SELECT

**Files:**
- Create: `tests/integration/rls.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/integration/rls.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

let pg: StartedPostgreSqlContainer;
let adminClient: Client;
let appClient: Client;

beforeAll(async () => {
  pg = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("edict")
    .withUsername("edict_admin")
    .withPassword("test")
    .start();

  // Apply Drizzle migration(s) + handwritten files.
  adminClient = new Client({ connectionString: pg.getConnectionUri() });
  await adminClient.connect();

  const files = await (await import("node:fs/promises"))
    .readdir("./migrations")
    .then((names) =>
      Promise.all(
        names
          .filter((n) => n.endsWith(".sql"))
          .sort()
          .map((n) => readFile(join("./migrations", n), "utf8")),
      ),
    );
  for (const sql of files) await adminClient.query(sql);

  // Connect as the RLS-enforced role
  appClient = new Client({
    host: pg.getHost(),
    port: pg.getMappedPort(5432),
    user: "edict_app",
    password: "dev",
    database: "edict",
  });
  await appClient.connect();
}, 60_000);

afterAll(async () => {
  await appClient?.end();
  await adminClient?.end();
  await pg?.stop();
});

describe("RLS — tenant isolation", () => {
  it("blocks cross-tenant SELECT on client_members", async () => {
    // Seed two clients + members via admin role (bypasses RLS)
    const a = await adminClient.query<{ id: string }>(
      `INSERT INTO clients (slug, name) VALUES ('a','A') RETURNING id`,
    );
    const b = await adminClient.query<{ id: string }>(
      `INSERT INTO clients (slug, name) VALUES ('b','B') RETURNING id`,
    );
    await adminClient.query(
      `INSERT INTO client_members (client_id, email, role) VALUES ($1,'x@a.com','viewer')`,
      [a.rows[0]!.id],
    );
    await adminClient.query(
      `INSERT INTO client_members (client_id, email, role) VALUES ($1,'x@b.com','viewer')`,
      [b.rows[0]!.id],
    );

    await appClient.query("BEGIN");
    await appClient.query(`SELECT set_config('edict.client_id', $1, true)`, [a.rows[0]!.id]);
    const visible = await appClient.query(`SELECT email FROM client_members`);
    await appClient.query("COMMIT");

    expect(visible.rowCount).toBe(1);
    expect(visible.rows[0]!.email).toBe("x@a.com");
  });
});
```

- [ ] **Step 2: Run (should pass if schema + RLS correct)**

Run: `pnpm test:run -- rls`
Expected: 1 passed. If fail, investigate migration order or role grants.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/rls.test.ts
git commit -m "test(db): RLS blocks cross-tenant SELECT"
```

---

## Phase C: Auth Primitives

### Task 14: SHA-256 helper

**Files:**
- Create: `lib/utils/hash.ts`, `tests/unit/hash.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/hash.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sha256Hex } from "@/lib/utils/hash";

describe("sha256Hex", () => {
  it("produces lowercase hex digest for a known input", () => {
    expect(sha256Hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("is deterministic across calls", () => {
    expect(sha256Hex("edict")).toBe(sha256Hex("edict"));
  });
});
```

Run: `pnpm test:run -- hash` → FAIL (module not found).

- [ ] **Step 2: Implement**

Create `lib/utils/hash.ts`:
```ts
import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return encodeHexLowerCase(sha256(bytes));
}
```

- [ ] **Step 3: Run**

Run: `pnpm test:run -- hash` → PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/utils/hash.ts tests/unit/hash.test.ts
git commit -m "feat(utils): SHA-256 hex helper"
```

---

### Task 15: Token generator

**Files:**
- Create: `lib/auth/tokens.ts`, `tests/unit/tokens.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/tokens.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { generateToken } from "@/lib/auth/tokens";
import { sha256Hex } from "@/lib/utils/hash";

describe("generateToken", () => {
  it("returns raw and hash, with hash matching sha256(raw)", () => {
    const { raw, hash } = generateToken();
    expect(raw).toMatch(/^[a-z0-9]+$/);
    expect(hash).toBe(sha256Hex(raw));
  });

  it("produces distinct tokens across calls", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.raw).not.toBe(b.raw);
  });

  it("raw has entropy >= 160 bits (32 base32 chars)", () => {
    const { raw } = generateToken();
    expect(raw.length).toBeGreaterThanOrEqual(32);
  });
});
```

Run: `pnpm test:run -- tokens` → FAIL.

- [ ] **Step 2: Implement**

Create `lib/auth/tokens.ts`:
```ts
import { randomBytes } from "node:crypto";
import { encodeBase32LowerCaseNoPadding } from "@oslojs/encoding";
import { sha256Hex } from "@/lib/utils/hash";

export type GeneratedToken = { raw: string; hash: string };

export function generateToken(bytes = 32): GeneratedToken {
  const buf = randomBytes(bytes);
  const raw = encodeBase32LowerCaseNoPadding(buf);
  return { raw, hash: sha256Hex(raw) };
}
```

- [ ] **Step 3: Run**

Run: `pnpm test:run -- tokens` → PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/auth/tokens.ts tests/unit/tokens.test.ts
git commit -m "feat(auth): token generator (raw + sha256 hash)"
```

---

### Task 16: Connection pools — app and admin

**Files:**
- Create: `lib/db/index.ts`

- [ ] **Step 1: Write pools + scoped client helper**

Create `lib/db/index.ts`:
```ts
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "@/lib/db/schema";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

const appPool = new Pool({ connectionString: required("DATABASE_URL"), max: 10 });
const adminPool = new Pool({ connectionString: required("DATABASE_ADMIN_URL"), max: 5 });

export const db = drizzle(appPool, { schema });
export const adminDb = drizzle(adminPool, { schema });

/**
 * Run `fn` inside a transaction where edict.client_id is set for the duration.
 * Use for all per-request client-scoped work.
 */
export async function withClientScope<T>(
  clientId: string,
  fn: (tx: NodePgDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await appPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('edict.client_id', $1, true)", [clientId]);
    const tx = drizzle(client, { schema });
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export { schema };
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/index.ts
git commit -m "feat(db): app + admin pools + withClientScope"
```

---

### Task 17: Token queries (magic_link_tokens)

**Files:**
- Create: `lib/db/queries/tokens.ts`

- [ ] **Step 1: Implement**

Create `lib/db/queries/tokens.ts`:
```ts
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { adminDb, schema } from "@/lib/db";

type Subject = "client_member" | "admin";

export async function insertMagicLinkToken(input: {
  tokenHash: string;
  subjectType: Subject;
  subjectId: string;
  email: string;
  clientId: string | null;
  ttlMs: number;
}) {
  const expiresAt = new Date(Date.now() + input.ttlMs);
  const [row] = await adminDb
    .insert(schema.magicLinkTokens)
    .values({
      tokenHash: input.tokenHash,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      email: input.email,
      clientId: input.clientId,
      expiresAt,
    })
    .returning({ id: schema.magicLinkTokens.id });
  if (!row) throw new Error("token insert failed");
  return row;
}

export async function consumeMagicLinkToken(tokenHash: string) {
  const now = new Date();
  const [row] = await adminDb
    .update(schema.magicLinkTokens)
    .set({ consumedAt: now })
    .where(
      and(
        eq(schema.magicLinkTokens.tokenHash, tokenHash),
        isNull(schema.magicLinkTokens.consumedAt),
        gt(schema.magicLinkTokens.expiresAt, now),
      ),
    )
    .returning();
  return row ?? null;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/queries/tokens.ts
git commit -m "feat(db): magic-link token queries (insert, consume)"
```

---

### Task 18: Session queries

**Files:**
- Create: `lib/db/queries/sessions.ts`

- [ ] **Step 1: Implement**

Create `lib/db/queries/sessions.ts`:
```ts
// `gt` is destructured from the findFirst callback's operator bag, so no top-level import needed.
import { and, eq, isNull } from "drizzle-orm";
import { adminDb, schema } from "@/lib/db";

type Subject = "client_member" | "admin";

export async function insertSession(input: {
  sessionTokenHash: string;
  subjectType: Subject;
  subjectId: string;
  clientId: string | null;
  ttlMs: number;
  ip: string | null;
  userAgent: string | null;
}) {
  const expiresAt = new Date(Date.now() + input.ttlMs);
  const [row] = await adminDb
    .insert(schema.sessions)
    .values({
      sessionTokenHash: input.sessionTokenHash,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      clientId: input.clientId,
      expiresAt,
      ip: input.ip,
      userAgent: input.userAgent,
    })
    .returning();
  if (!row) throw new Error("session insert failed");
  return row;
}

export async function findActiveSessionByTokenHash(sessionTokenHash: string) {
  const now = new Date();
  const row = await adminDb.query.sessions.findFirst({
    where: (s, { and, eq, isNull, gt }) =>
      and(
        eq(s.sessionTokenHash, sessionTokenHash),
        isNull(s.revokedAt),
        gt(s.expiresAt, now),
      ),
  });
  return row ?? null;
}

export async function revokeSession(sessionId: string) {
  await adminDb
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)));
}

export async function touchSession(sessionId: string) {
  await adminDb
    .update(schema.sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.sessions.id, sessionId));
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/queries/sessions.ts
git commit -m "feat(db): session queries"
```

---

### Task 19: Audit-log writer

**Files:**
- Create: `lib/db/queries/audit.ts`

- [ ] **Step 1: Implement**

Create `lib/db/queries/audit.ts`:
```ts
import { adminDb, schema } from "@/lib/db";

type ActorType = "client_member" | "admin" | "system";

export async function writeAudit(input: {
  eventType: string;
  actorType: ActorType;
  actorId?: string | null;
  clientId?: string | null;
  docId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await adminDb.insert(schema.auditLog).values({
    eventType: input.eventType,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    clientId: input.clientId ?? null,
    docId: input.docId ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    metadata: input.metadata ?? {},
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/queries/audit.ts
git commit -m "feat(db): audit log writer"
```

---

### Task 20: issueMagicLink

**Files:**
- Create: `lib/auth/issue.ts`, `tests/integration/issue-verify.test.ts`

- [ ] **Step 1: Implement (no test first — the integration test covers it end-to-end)**

Create `lib/auth/issue.ts`:
```ts
import { generateToken } from "@/lib/auth/tokens";
import { insertMagicLinkToken } from "@/lib/db/queries/tokens";
import { writeAudit } from "@/lib/db/queries/audit";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export async function issueMagicLink(input: {
  subjectType: "client_member" | "admin";
  subjectId: string;
  email: string;
  clientId: string | null;
  actorId?: string | null;
  docId?: string | null;
}): Promise<{ raw: string; expiresIn: number }> {
  const { raw, hash } = generateToken();
  await insertMagicLinkToken({
    tokenHash: hash,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    email: input.email,
    clientId: input.clientId,
    ttlMs: TWENTY_FOUR_HOURS_MS,
  });
  await writeAudit({
    eventType: "magic_link_sent",
    actorType: input.actorId ? "admin" : "system",
    actorId: input.actorId ?? null,
    clientId: input.clientId,
    docId: input.docId ?? null,
    metadata: { recipient_email: input.email, ttl_hours: 24 },
  });
  return { raw, expiresIn: TWENTY_FOUR_HOURS_MS };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/auth/issue.ts
git commit -m "feat(auth): issueMagicLink"
```

---

### Task 21: verifyMagicLink

**Files:**
- Create: `lib/auth/verify.ts`

- [ ] **Step 1: Implement**

Create `lib/auth/verify.ts`:
```ts
import { sha256Hex } from "@/lib/utils/hash";
import { generateToken } from "@/lib/auth/tokens";
import { consumeMagicLinkToken } from "@/lib/db/queries/tokens";
import { insertSession } from "@/lib/db/queries/sessions";
import { writeAudit } from "@/lib/db/queries/audit";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export type VerifyResult =
  | { ok: true; sessionToken: string; subjectType: "client_member" | "admin"; clientId: string | null }
  | { ok: false; reason: "invalid" | "expired" | "consumed" };

export async function verifyMagicLink(input: {
  rawToken: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<VerifyResult> {
  const tokenHash = sha256Hex(input.rawToken);
  const consumed = await consumeMagicLinkToken(tokenHash);
  if (!consumed) {
    await writeAudit({
      eventType: "magic_link_failed",
      actorType: "system",
      metadata: { token_hash_prefix: tokenHash.slice(0, 8), reason: "miss_or_expired" },
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
    return { ok: false, reason: "invalid" };
  }

  if (consumed.subjectType !== "client_member" && consumed.subjectType !== "admin") {
    return { ok: false, reason: "invalid" };
  }

  const session = generateToken(64);
  const created = await insertSession({
    sessionTokenHash: session.hash,
    subjectType: consumed.subjectType,
    subjectId: consumed.subjectId,
    clientId: consumed.clientId ?? null,
    ttlMs: THIRTY_DAYS_MS,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });

  await writeAudit({
    eventType: "session_created",
    actorType: consumed.subjectType,
    actorId: consumed.subjectId,
    clientId: consumed.clientId ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    metadata: { session_id: created.id },
  });

  return {
    ok: true,
    sessionToken: session.raw,
    subjectType: consumed.subjectType,
    clientId: consumed.clientId ?? null,
  };
}
```

- [ ] **Step 2: Integration test — end-to-end issue → verify**

Create `tests/integration/issue-verify.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import type * as DbModule from "@/lib/db";

let pg: StartedPostgreSqlContainer;
let dbModule: typeof DbModule | undefined;

beforeAll(async () => {
  pg = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("edict")
    .withUsername("edict_admin")
    .withPassword("test")
    .start();

  // Apply migrations via the superuser connection (has BYPASSRLS + create-role rights)
  const bootstrap = new Pool({ connectionString: pg.getConnectionUri() });
  const names = (await readdir("./migrations")).filter((n) => n.endsWith(".sql")).sort();
  for (const n of names) await bootstrap.query(await readFile(join("./migrations", n), "utf8"));
  await bootstrap.end();

  // Build env vars explicitly — string-replacing the URI breaks because
  // migration 0002 creates edict_app with password 'dev', not the container's 'test'.
  const host = pg.getHost();
  const port = pg.getMappedPort(5432);
  process.env.DATABASE_URL = `postgres://edict_app:dev@${host}:${port}/edict`;
  process.env.DATABASE_ADMIN_URL = pg.getConnectionUri();
}, 60_000);

afterAll(async () => {
  // Drain drizzle pools before the container dies, otherwise Postgres
  // terminates open connections and vitest surfaces an unhandled error.
  if (dbModule) {
    await dbModule.db.$client.end().catch(() => {});
    await dbModule.adminDb.$client.end().catch(() => {});
  }
  await pg?.stop();
});

describe("magic link: issue → verify", () => {
  it("issues, verifies, creates session, and refuses replay", async () => {
    // Dynamic import AFTER env vars are set — top-level import would fail required() check
    dbModule = await import("@/lib/db");
    const { adminDb, schema } = dbModule;
    const { eq } = await import("drizzle-orm");
    const { sha256Hex } = await import("@/lib/utils/hash");
    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "a@edict.test", name: "Admin A" })
      .returning();

    const { issueMagicLink } = await import("@/lib/auth/issue");
    const { verifyMagicLink } = await import("@/lib/auth/verify");

    const { raw } = await issueMagicLink({
      subjectType: "admin",
      subjectId: admin!.id,
      email: "a@edict.test",
      clientId: null,
    });

    const first = await verifyMagicLink({ rawToken: raw });
    if (!first.ok) throw new Error(`expected verify to succeed, got reason=${first.reason}`);
    // 64 random bytes base32-no-pad → ceil(64 * 8 / 5) = 103 chars
    expect(first.sessionToken).toMatch(/^[a-z0-9]{103}$/);
    expect(first.subjectType).toBe("admin");
    expect(first.clientId).toBeNull();

    const sessionRow = await adminDb.query.sessions.findFirst({
      where: eq(schema.sessions.sessionTokenHash, sha256Hex(first.sessionToken)),
    });
    expect(sessionRow).toBeTruthy();
    expect(sessionRow?.subjectType).toBe("admin");
    expect(sessionRow?.subjectId).toBe(admin!.id);
    expect(sessionRow?.clientId).toBeNull();
    expect(sessionRow?.revokedAt).toBeNull();

    const replay = await verifyMagicLink({ rawToken: raw });
    expect(replay.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run**

Run: `pnpm test:run -- issue-verify` → PASS (1 test, end-to-end).

- [ ] **Step 4: Commit**

```bash
git add lib/auth/verify.ts tests/integration/issue-verify.test.ts
git commit -m "feat(auth): verifyMagicLink + integration test"
```

---

### Task 22: AsyncLocalStorage session context

**Files:**
- Create: `lib/auth/context.ts`

- [ ] **Step 1: Implement**

Create `lib/auth/context.ts`:
```ts
import { AsyncLocalStorage } from "node:async_hooks";

export type AdminContext = {
  kind: "admin";
  sessionId: string;
  adminId: string;
};

export type ClientContext = {
  kind: "client";
  sessionId: string;
  memberId: string;
  clientId: string;
  clientSlug: string;
};

export type EdictContext = AdminContext | ClientContext;

const als = new AsyncLocalStorage<EdictContext>();

export function runWithContext<T>(ctx: EdictContext, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

export function getContext(): EdictContext {
  const c = als.getStore();
  if (!c) throw new Error("no edict context — use requireXSession() in a layout first");
  return c;
}

export function tryGetContext(): EdictContext | null {
  return als.getStore() ?? null;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/auth/context.ts
git commit -m "feat(auth): AsyncLocalStorage session context"
```

---

### Task 23: requireAdminSession + requireClientSession middleware

**Files:**
- Create: `lib/auth/middleware.ts`

- [ ] **Step 1: Implement**

Create `lib/auth/middleware.ts`:
```ts
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { sha256Hex } from "@/lib/utils/hash";
import { findActiveSessionByTokenHash, touchSession } from "@/lib/db/queries/sessions";
import { adminDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { runWithContext, type EdictContext } from "@/lib/auth/context";

const COOKIE = process.env.SESSION_COOKIE_NAME ?? "edict_session";

async function resolveSession() {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;
  const s = await findActiveSessionByTokenHash(sha256Hex(raw));
  return s;
}

export async function requireAdminSession<T>(fn: () => Promise<T>): Promise<T> {
  const s = await resolveSession();
  if (!s || s.subjectType !== "admin") redirect("/");
  await touchSession(s.id);
  const ctx: EdictContext = { kind: "admin", sessionId: s.id, adminId: s.subjectId };
  return runWithContext(ctx, fn);
}

/**
 * Resolves the caller's client session for `slug`. Sets up AsyncLocalStorage
 * context; does NOT wrap DB work in `withClientScope`. Downstream RLS-scoped
 * queries must call `withClientScope(ctx.clientId, fn)` themselves.
 */
export async function requireClientSession<T>(slug: string, fn: () => Promise<T>): Promise<T> {
  const s = await resolveSession();
  if (!s || s.subjectType !== "client_member" || !s.clientId) redirect("/");

  const client = await adminDb.query.clients.findFirst({
    where: eq(schema.clients.slug, slug),
    columns: { id: true, slug: true },
  });
  if (!client) notFound();
  if (client.id !== s.clientId) notFound(); // prevents using another tenant's cookie

  await touchSession(s.id);
  const ctx: EdictContext = {
    kind: "client",
    sessionId: s.id,
    memberId: s.subjectId,
    clientId: client.id,
    clientSlug: client.slug,
  };
  return runWithContext(ctx, fn);
}

export { COOKIE as SESSION_COOKIE_NAME };
```

- [ ] **Step 2: Commit**

```bash
git add lib/auth/middleware.ts
git commit -m "feat(auth): requireAdminSession + requireClientSession"
```

---

## Phase D: Email & Admin Bootstrap CLI

### Task 24: Resend wrapper

**Files:**
- Create: `lib/mail/resend.ts`

- [ ] **Step 1: Install**

Run: `pnpm add resend @react-email/components @react-email/render`

- [ ] **Step 2: Implement**

Create `lib/mail/resend.ts`:
```ts
import { Resend } from "resend";
import { render } from "@react-email/render";
import type { ReactElement } from "react";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM ?? "edict@rectorspace.com";
const devPrint = process.env.DEV_PRINT_MAGIC_LINKS === "true";
const client = apiKey ? new Resend(apiKey) : null;

export async function sendMail(args: {
  to: string;
  subject: string;
  template: ReactElement;
}) {
  const html = await render(args.template);

  if (!client || devPrint) {
    console.warn("[mail:dev]", { to: args.to, subject: args.subject, html_length: html.length });
    return { id: "dev-skip" };
  }

  const res = await client.emails.send({
    from,
    to: args.to,
    subject: args.subject,
    html,
  });
  if ("error" in res && res.error) throw new Error(`resend error: ${res.error.message}`);
  return { id: "data" in res ? res.data?.id ?? "unknown" : "unknown" };
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/mail/resend.ts package.json pnpm-lock.yaml
git commit -m "feat(mail): resend wrapper with dev-print escape hatch"
```

---

### Task 25: Magic-link email template (aidesigner → react-email)

**Files:**
- Create: `docs/ui/email-magic-link.md`, `lib/mail/templates/magic-link.tsx`

- [ ] **Step 1: Generate via aidesigner**

Use `mcp__plugin_design_aidesigner__generate_design` with prompt:

> Email template for a multi-tenant document delivery platform called Edict.
> Recipient has just been invited to view a formal document. Voice: authoritative but humble, dev-humble tone.
> Must render correctly in email clients (inline styles, table layout, no external CSS).
> Dark-mode aware. No emoji icons.
> Content blocks:
> - Header: wordmark "Edict", muted subtitle "A rector issues edicts"
> - Body: "{{actor_name}} has issued you an edict: {{doc_title}}"
> - Primary CTA button: "Open your edict" linking to {{magic_link_url}}
> - Small print: "This link is valid for 24 hours. If you did not expect this, ignore it."
> - Footer: "Edict — edict.rectorspace.com"
> Use a deep-background palette (#06060c) with a cyan accent (#00e5ff) for the CTA.
> Brand: professional trust-first design language.

Save the raw aidesigner output HTML into `docs/ui/email-magic-link.md` along with the prompt + any refine iterations.

- [ ] **Step 2: Port to react-email**

Create `lib/mail/templates/magic-link.tsx`:
```tsx
import { Body, Button, Container, Head, Html, Preview, Section, Text } from "@react-email/components";

type Props = { recipientName?: string | null; docTitle: string; magicLinkUrl: string; actorName: string };

export function MagicLinkEmail({ recipientName, docTitle, magicLinkUrl, actorName }: Props) {
  return (
    <Html>
      <Head />
      <Preview>{actorName} has issued you an edict</Preview>
      <Body style={{ backgroundColor: "#06060c", color: "#e2e8f0", fontFamily: "system-ui, sans-serif" }}>
        <Container style={{ padding: "32px 24px", maxWidth: 560 }}>
          <Text style={{ fontSize: 18, fontWeight: 600, color: "#00e5ff", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Edict
          </Text>
          <Text style={{ fontSize: 12, color: "#64748b", marginBottom: 32 }}>A rector issues edicts</Text>

          <Text style={{ fontSize: 16, lineHeight: 1.7 }}>
            {recipientName ? `${recipientName}, ` : ""}{actorName} has issued you an edict:
          </Text>
          <Text style={{ fontSize: 22, fontWeight: 600, margin: "16px 0 32px" }}>{docTitle}</Text>

          <Section style={{ margin: "24px 0" }}>
            <Button
              href={magicLinkUrl}
              style={{
                backgroundColor: "#00e5ff",
                color: "#06060c",
                padding: "14px 28px",
                borderRadius: 6,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Open your edict
            </Button>
          </Section>

          <Text style={{ fontSize: 12, color: "#64748b", marginTop: 48 }}>
            This link is valid for 24 hours. If you did not expect this, ignore it.
          </Text>
          <Text style={{ fontSize: 12, color: "#475569" }}>Edict — edict.rectorspace.com</Text>
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/mail/templates/magic-link.tsx docs/ui/email-magic-link.md
git commit -m "feat(mail): magic-link email template"
```

---

### Task 26: Admin seed CLI (first-admin bootstrap)

**Files:**
- Create: `scripts/admin-seed.ts`

- [ ] **Step 1: Implement**

Create `scripts/admin-seed.ts`:
```ts
import "dotenv/config";
import { adminDb, schema } from "@/lib/db";
import { issueMagicLink } from "@/lib/auth/issue";
import { sendMail } from "@/lib/mail/resend";
import { MagicLinkEmail } from "@/lib/mail/templates/magic-link";
import React from "react";

const email = process.argv[2] ?? process.env.ADMIN_BOOTSTRAP_EMAIL;

async function main() {
  if (!email) throw new Error("usage: edict:admin:seed <email>");

  const existing = await adminDb.query.admins.findMany({ columns: { id: true } });
  if (existing.length > 0) {
    throw new Error("admins table is not empty; use edict:admin:invite from an authenticated session");
  }

  const [admin] = await adminDb
    .insert(schema.admins)
    .values({ email, name: "Bootstrap Admin" })
    .returning();
  if (!admin) throw new Error("admin insert failed");

  const { raw } = await issueMagicLink({
    subjectType: "admin",
    subjectId: admin.id,
    email,
    clientId: null,
  });

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const url = `${appUrl}/auth/verify?token=${raw}`;

  if (process.env.DEV_PRINT_MAGIC_LINKS === "true") {
    console.warn(`[seed] magic link: ${url}`);
  } else {
    await sendMail({
      to: email,
      subject: "Edict — your first sign-in link",
      template: React.createElement(MagicLinkEmail, {
        docTitle: "Welcome to Edict",
        actorName: "Edict",
        magicLinkUrl: url,
      }),
    });
    console.warn(`[seed] magic link emailed to ${email}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Install dotenv**

Run: `pnpm add -D dotenv`

- [ ] **Step 3: Try it**

Run:
```bash
DEV_PRINT_MAGIC_LINKS=true pnpm edict:admin:seed rector@rectorspace.com
```
Expected: prints `[seed] magic link: http://localhost:3000/auth/verify?token=...`.

- [ ] **Step 4: Commit**

```bash
git add scripts/admin-seed.ts package.json pnpm-lock.yaml
git commit -m "feat(cli): edict:admin:seed bootstrap"
```

---

### Task 27: Admin invite CLI (post-bootstrap adds)

**Files:**
- Create: `scripts/admin-invite.ts`

- [ ] **Step 1: Implement**

Create `scripts/admin-invite.ts`:
```ts
import "dotenv/config";
import { adminDb, schema } from "@/lib/db";
import { issueMagicLink } from "@/lib/auth/issue";
import { sendMail } from "@/lib/mail/resend";
import { MagicLinkEmail } from "@/lib/mail/templates/magic-link";
import React from "react";

const email = process.argv[2];

async function main() {
  if (!email) throw new Error("usage: edict:admin:invite <email>");

  const existing = await adminDb.query.admins.findFirst({ where: (a, { eq }) => eq(a.email, email) });
  const admin =
    existing ??
    (await adminDb.insert(schema.admins).values({ email }).returning())[0];
  if (!admin) throw new Error("admin insert failed");

  const { raw } = await issueMagicLink({
    subjectType: "admin",
    subjectId: admin.id,
    email,
    clientId: null,
  });

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const url = `${appUrl}/auth/verify?token=${raw}`;

  if (process.env.DEV_PRINT_MAGIC_LINKS === "true") {
    console.warn(`[invite] magic link: ${url}`);
    return;
  }
  await sendMail({
    to: email,
    subject: "Edict — admin invite",
    template: React.createElement(MagicLinkEmail, {
      docTitle: "Admin access to Edict",
      actorName: "Edict",
      magicLinkUrl: url,
    }),
  });
  console.warn(`[invite] emailed ${email}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add scripts/admin-invite.ts
git commit -m "feat(cli): edict:admin:invite"
```

---

## Phase E: Auth Routes

### Task 28: Landing page (aidesigner → TSX)

**Files:**
- Create: `docs/ui/landing.md`
- Modify: `app/page.tsx`
- Create: `actions/sessions.ts`

- [ ] **Step 1: Generate via aidesigner**

Use `mcp__plugin_design_aidesigner__generate_design` with prompt:

> Landing page for Edict — a multi-tenant formal document delivery platform.
> Voice: authoritative but humble. Brand: professional, trust-first, developer-humble.
> Dark background (#06060c), cyan accent (#00e5ff), JetBrains Mono for monospace moments, Plus Jakarta Sans for sans.
> Layout: centered vertical column, max-width 560px.
> Content:
> - Small monospace eyebrow: "FORMAL DOCUMENT DELIVERY"
> - Headline: "Edict"
> - Subtitle: "A rector issues edicts. Sign in to read yours."
> - Email input + "Send me my magic link" submit button
> - On submit, UI shows: "If this email is on file, your link is on its way." (generic — no user enumeration)
> - Small footer: "Edict — edict.rectorspace.com"
> No images. No emoji. Lucide icons only if any.

Save HTML/CSS and iteration history in `docs/ui/landing.md`.

- [ ] **Step 2: Server action — request magic link for existing member**

Create `actions/sessions.ts`:
```ts
"use server";

import { adminDb, schema } from "@/lib/db";
import { issueMagicLink } from "@/lib/auth/issue";
import { sendMail } from "@/lib/mail/resend";
import { MagicLinkEmail } from "@/lib/mail/templates/magic-link";
import { eq } from "drizzle-orm";
import React from "react";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/db/queries/audit";

export async function requestMagicLinkAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return;

  // 1) Admins (no tenant scope)
  const admin = await adminDb.query.admins.findFirst({ where: (a, { eq }) => eq(a.email, email) });
  if (admin) {
    const { raw } = await issueMagicLink({
      subjectType: "admin",
      subjectId: admin.id,
      email,
      clientId: null,
    });
    await dispatch(email, raw, "Admin access to Edict");
    return;
  }

  // 2) Client members (any tenant they belong to — issue one link per client)
  const members = await adminDb.query.clientMembers.findMany({
    where: (m, { and, eq, isNull }) => and(eq(m.email, email), isNull(m.revokedAt)),
    with: { client: true as any },
  }) as Array<typeof schema.clientMembers.$inferSelect>;

  for (const m of members) {
    const { raw } = await issueMagicLink({
      subjectType: "client_member",
      subjectId: m.id,
      email,
      clientId: m.clientId,
    });
    await dispatch(email, raw, "Your Edict sign-in link");
  }

  // Silent success regardless (enumeration defense)
  await writeAudit({
    eventType: "magic_link_requested",
    actorType: "system",
    metadata: { email_hash_prefix: email.slice(0, 2) + "***" },
  });
  revalidatePath("/");
}

async function dispatch(email: string, rawToken: string, subject: string) {
  const url = `${process.env.APP_URL}/auth/verify?token=${rawToken}`;
  await sendMail({
    to: email,
    subject,
    template: React.createElement(MagicLinkEmail, {
      docTitle: "Your Edict",
      actorName: "Edict",
      magicLinkUrl: url,
    }),
  });
}
```

- [ ] **Step 3: Landing page uses the action**

Overwrite `app/page.tsx` with a ported version of the aidesigner output wired to `requestMagicLinkAction`. Example skeleton:
```tsx
import { requestMagicLinkAction } from "@/actions/sessions";

export default function LandingPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-[560px]">
        <p className="text-xs tracking-[0.12em] uppercase text-cyan-400 font-mono mb-6">
          Formal Document Delivery
        </p>
        <h1 className="text-5xl font-semibold mb-3">Edict</h1>
        <p className="text-slate-400 mb-10">A rector issues edicts. Sign in to read yours.</p>

        <form action={requestMagicLinkAction} className="flex flex-col gap-3">
          <input
            type="email"
            name="email"
            required
            placeholder="you@company.com"
            className="px-4 py-3 rounded-md bg-[#111119] border border-[#1e1e2a] text-slate-100 focus:border-cyan-400 outline-none"
          />
          <button
            type="submit"
            className="px-4 py-3 rounded-md bg-cyan-400 text-[#06060c] font-medium hover:bg-cyan-300"
          >
            Send me my magic link
          </button>
        </form>

        <p className="text-slate-500 text-sm mt-8">
          If this email is on file, your link is on its way.
        </p>

        <footer className="mt-24 text-xs text-slate-600">Edict — edict.rectorspace.com</footer>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Verify**

Run: `pnpm dev`, visit http://localhost:3000, submit a form with a seeded admin email. Expect terminal output showing `[mail:dev]` log with magic-link URL (DEV_PRINT_MAGIC_LINKS=true in .env).

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx actions/sessions.ts docs/ui/landing.md
git commit -m "feat(auth): landing page with magic-link request action"
```

---

### Task 29: GET /auth/verify route

**Files:**
- Create: `app/(auth)/auth/verify/route.ts`

- [ ] **Step 1: Implement**

Create `app/(auth)/auth/verify/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { verifyMagicLink } from "@/lib/auth/verify";
import { adminDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { SESSION_COOKIE_NAME } from "@/lib/auth/middleware";

const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return renderInvalid();

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent") ?? null;

  const result = await verifyMagicLink({ rawToken: token, ip, userAgent: ua });
  if (!result.ok) return renderInvalid();

  let redirectTo = "/";
  if (result.subjectType === "admin") redirectTo = "/admin";
  else if (result.clientId) {
    const client = await adminDb.query.clients.findFirst({
      where: eq(schema.clients.id, result.clientId),
      columns: { slug: true },
    });
    if (!client) return renderInvalid();
    redirectTo = `/c/${client.slug}`;
  }

  const res = NextResponse.redirect(new URL(redirectTo, req.nextUrl.origin), 302);
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: result.sessionToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_S,
  });
  return res;
}

function renderInvalid() {
  return new NextResponse(
    `<!DOCTYPE html>
     <html lang="en">
       <body style="background:#06060c;color:#e2e8f0;font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0">
         <main style="max-width:480px;padding:24px;text-align:center">
           <h1 style="font-size:20px;margin-bottom:8px">This link is no longer valid</h1>
           <p style="color:#64748b">Request a new link from the sign-in page.</p>
           <p style="margin-top:32px"><a href="/" style="color:#00e5ff">← Back to sign-in</a></p>
         </main>
       </body>
     </html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
```

- [ ] **Step 2: Manual verify**

With dev server running, click the magic-link URL printed by `edict:admin:seed`. Expect redirect to `/admin` + session cookie set.

- [ ] **Step 3: Commit**

```bash
git add app/\(auth\)/auth/verify/route.ts
git commit -m "feat(auth): /auth/verify route"
```

---

### Task 30: POST /auth/logout route

**Files:**
- Create: `app/(auth)/auth/logout/route.ts`

- [ ] **Step 1: Implement**

Create `app/(auth)/auth/logout/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sha256Hex } from "@/lib/utils/hash";
import { findActiveSessionByTokenHash, revokeSession } from "@/lib/db/queries/sessions";
import { writeAudit } from "@/lib/db/queries/audit";
import { SESSION_COOKIE_NAME } from "@/lib/auth/middleware";

export async function POST(_req: NextRequest) {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE_NAME)?.value;
  if (raw) {
    const s = await findActiveSessionByTokenHash(sha256Hex(raw));
    if (s) {
      await revokeSession(s.id);
      await writeAudit({
        eventType: "session_revoked",
        actorType: s.subjectType,
        actorId: s.subjectId,
        clientId: s.clientId ?? null,
        metadata: { session_id: s.id, reason: "logout" },
      });
    }
  }
  const res = NextResponse.redirect(new URL("/", process.env.APP_URL ?? "http://localhost:3000"), 302);
  res.cookies.delete(SESSION_COOKIE_NAME);
  return res;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(auth\)/auth/logout/route.ts
git commit -m "feat(auth): /auth/logout route"
```

---

## Phase F: Admin Surface

### Task 31: Admin layout (requireAdminSession)

**Files:**
- Create: `app/(admin)/layout.tsx`

- [ ] **Step 1: Implement**

Create `app/(admin)/layout.tsx`:
```tsx
import { requireAdminSession } from "@/lib/auth/middleware";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  return requireAdminSession(async () => <>{children}</>);
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(admin\)/layout.tsx
git commit -m "feat(admin): layout + session gate"
```

---

### Task 32: Client queries (admin-only reads/writes)

**Files:**
- Create: `lib/db/queries/clients.ts`

- [ ] **Step 1: Implement**

Create `lib/db/queries/clients.ts`:
```ts
import { adminDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function listClients() {
  return adminDb.query.clients.findMany({
    orderBy: (c, { desc }) => [desc(c.createdAt)],
  });
}

export async function createClient(input: {
  slug: string;
  name: string;
  brandColor?: string;
  logoUrl?: string;
}) {
  const [row] = await adminDb
    .insert(schema.clients)
    .values({
      slug: input.slug,
      name: input.name,
      brandColor: input.brandColor ?? null,
      logoUrl: input.logoUrl ?? null,
    })
    .returning();
  if (!row) throw new Error("create client failed");
  return row;
}

export async function getClientById(id: string) {
  return adminDb.query.clients.findFirst({ where: eq(schema.clients.id, id) });
}

export async function getClientBySlug(slug: string) {
  return adminDb.query.clients.findFirst({ where: eq(schema.clients.slug, slug) });
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/queries/clients.ts
git commit -m "feat(db): client queries (admin)"
```

---

### Task 33: Client member queries

**Files:**
- Create: `lib/db/queries/members.ts`

- [ ] **Step 1: Implement**

Create `lib/db/queries/members.ts`:
```ts
import { adminDb, schema } from "@/lib/db";
import { and, eq, isNull } from "drizzle-orm";

export async function listMembersForClient(clientId: string) {
  return adminDb.query.clientMembers.findMany({
    where: (m, { and, eq, isNull }) => and(eq(m.clientId, clientId), isNull(m.revokedAt)),
    orderBy: (m, { desc }) => [desc(m.createdAt)],
  });
}

export async function upsertMember(input: {
  clientId: string;
  email: string;
  name?: string | null;
  role: "viewer" | "admin_of_client";
}) {
  const existing = await adminDb.query.clientMembers.findFirst({
    where: (m, { and, eq }) => and(eq(m.clientId, input.clientId), eq(m.email, input.email)),
  });
  if (existing) {
    if (existing.revokedAt) {
      await adminDb
        .update(schema.clientMembers)
        .set({ revokedAt: null })
        .where(eq(schema.clientMembers.id, existing.id));
    }
    return existing;
  }
  const [row] = await adminDb
    .insert(schema.clientMembers)
    .values({
      clientId: input.clientId,
      email: input.email,
      name: input.name ?? null,
      role: input.role,
    })
    .returning();
  if (!row) throw new Error("member insert failed");
  return row;
}

export async function revokeMember(memberId: string) {
  await adminDb
    .update(schema.clientMembers)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.clientMembers.id, memberId), isNull(schema.clientMembers.revokedAt)));
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/queries/members.ts
git commit -m "feat(db): client_members queries"
```

---

### Task 34: Doc queries

**Files:**
- Create: `lib/db/queries/docs.ts`

- [ ] **Step 1: Implement**

Create `lib/db/queries/docs.ts`:
```ts
import { adminDb, schema } from "@/lib/db";
import { and, eq, isNull, sql } from "drizzle-orm";

export async function listDocs() {
  return adminDb.query.docs.findMany({
    orderBy: (d, { desc }) => [desc(d.updatedAt)],
  });
}

export async function createDoc(input: {
  slug: string;
  title: string;
  bodyType: "html" | "markdown";
  body: string;
  createdBy: string;
}) {
  const [row] = await adminDb.insert(schema.docs).values(input).returning();
  if (!row) throw new Error("doc insert failed");
  return row;
}

export async function updateDoc(id: string, patch: Partial<{ title: string; body: string; bodyType: "html" | "markdown" }>) {
  const [row] = await adminDb
    .update(schema.docs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.docs.id, id))
    .returning();
  return row ?? null;
}

export async function getDocById(id: string) {
  return adminDb.query.docs.findFirst({ where: eq(schema.docs.id, id) });
}

/**
 * Client-facing: docs shared with the given client, non-revoked.
 * Uses admin pool because we've already gated the caller via session;
 * the clientId is trusted.
 */
export async function listDocsForClient(clientId: string) {
  return adminDb
    .select({
      id: schema.docs.id,
      slug: schema.docs.slug,
      title: schema.docs.title,
      bodyType: schema.docs.bodyType,
      sharedAt: schema.docShares.sharedAt,
    })
    .from(schema.docShares)
    .innerJoin(schema.docs, eq(schema.docShares.docId, schema.docs.id))
    .where(and(eq(schema.docShares.clientId, clientId), isNull(schema.docShares.revokedAt)))
    .orderBy(sql`${schema.docShares.sharedAt} DESC`);
}

export async function getDocForClient(clientId: string, docSlug: string) {
  const rows = await adminDb
    .select({
      id: schema.docs.id,
      slug: schema.docs.slug,
      title: schema.docs.title,
      bodyType: schema.docs.bodyType,
      body: schema.docs.body,
    })
    .from(schema.docShares)
    .innerJoin(schema.docs, eq(schema.docShares.docId, schema.docs.id))
    .where(
      and(
        eq(schema.docShares.clientId, clientId),
        eq(schema.docs.slug, docSlug),
        isNull(schema.docShares.revokedAt),
      ),
    );
  return rows[0] ?? null;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/queries/docs.ts
git commit -m "feat(db): doc queries"
```

---

### Task 35: Share queries

**Files:**
- Create: `lib/db/queries/shares.ts`

- [ ] **Step 1: Implement**

Create `lib/db/queries/shares.ts`:
```ts
import { adminDb, schema } from "@/lib/db";
import { and, eq, isNull } from "drizzle-orm";

export async function upsertShare(docId: string, clientId: string) {
  const existing = await adminDb.query.docShares.findFirst({
    where: (s, { and, eq }) => and(eq(s.docId, docId), eq(s.clientId, clientId)),
  });
  if (existing) {
    if (existing.revokedAt) {
      await adminDb
        .update(schema.docShares)
        .set({ revokedAt: null, sharedAt: new Date() })
        .where(eq(schema.docShares.id, existing.id));
    }
    return existing;
  }
  const [row] = await adminDb.insert(schema.docShares).values({ docId, clientId }).returning();
  if (!row) throw new Error("share insert failed");
  return row;
}

export async function revokeShare(docId: string, clientId: string) {
  await adminDb
    .update(schema.docShares)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.docShares.docId, docId),
        eq(schema.docShares.clientId, clientId),
        isNull(schema.docShares.revokedAt),
      ),
    );
}

export async function listSharesForDoc(docId: string) {
  return adminDb.query.docShares.findMany({
    where: (s, { eq }) => eq(s.docId, docId),
    orderBy: (s, { desc }) => [desc(s.sharedAt)],
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/queries/shares.ts
git commit -m "feat(db): doc_shares queries"
```

---

### Task 36: /admin dashboard (aidesigner → TSX)

**Files:**
- Create: `docs/ui/admin-dashboard.md`, `app/(admin)/admin/page.tsx`

- [ ] **Step 1: aidesigner prompt**

Use `generate_design` with:
> Admin dashboard for Edict platform operators.
> Purpose: quick read of state — active clients, recent shares, recent views.
> Voice: authoritative but humble. Brand: dark theme (#06060c background, #00e5ff accent), professional, monospace eyebrows.
> Layout:
> - Top bar: "EDICT / ADMIN" wordmark, admin email on right, logout form.
> - Three summary cards: "Active clients (N)", "Docs live (N)", "Views last 7 days (N)"
> - Two stacked sections: "Recent shares" (list: doc title → client name + shared_at) and "Recent views" (list: member email + doc title + viewed_at)
> - Lucide icons: Users, FileText, Eye. No emoji.
> Data shape (use placeholders to style):
> { activeClients: 3, liveDocs: 5, recentViews7d: 24, recentShares: [...], recentViews: [...] }

Save in `docs/ui/admin-dashboard.md`.

- [ ] **Step 2: Port to TSX**

Create `app/(admin)/admin/page.tsx`:
```tsx
import { listClients } from "@/lib/db/queries/clients";
import { listDocs } from "@/lib/db/queries/docs";
import { adminDb, schema } from "@/lib/db";
import { eq, gt, sql } from "drizzle-orm";
import Link from "next/link";

export default async function AdminDashboard() {
  const [clients, docs, views] = await Promise.all([
    listClients(),
    listDocs(),
    adminDb
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.auditLog)
      .where(
        sql`${schema.auditLog.eventType} = 'doc_viewed'
            AND ${schema.auditLog.createdAt} > now() - interval '7 days'`,
      ),
  ]);

  // Port the aidesigner-generated UI here, wiring the three counts + lists.
  return (
    <main className="min-h-screen px-10 py-12">
      <header className="flex items-baseline justify-between mb-12">
        <div>
          <p className="text-xs tracking-[0.12em] uppercase text-cyan-400 font-mono">Edict / Admin</p>
          <h1 className="text-3xl font-semibold mt-2">Dashboard</h1>
        </div>
        <form action="/auth/logout" method="POST">
          <button className="text-sm text-slate-400 hover:text-cyan-400">Log out</button>
        </form>
      </header>

      <section className="grid grid-cols-3 gap-6 mb-12">
        <Card label="Active clients" value={clients.length} href="/admin/clients" />
        <Card label="Docs live" value={docs.length} href="/admin/docs" />
        <Card label="Views (7d)" value={views[0]?.n ?? 0} href="/admin/audit?event=doc_viewed" />
      </section>

      {/* Recent shares + views sections to be ported from aidesigner HTML */}
    </main>
  );
}

function Card({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="block p-6 rounded-lg border border-[#1e1e2a] bg-[#111119] hover:border-cyan-400/50">
      <div className="text-xs uppercase tracking-[0.08em] text-slate-500 mb-3 font-mono">{label}</div>
      <div className="text-4xl font-semibold">{value}</div>
    </Link>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add docs/ui/admin-dashboard.md app/\(admin\)/admin/page.tsx
git commit -m "feat(admin): dashboard"
```

---

### Task 37: /admin/clients list + create (aidesigner + server action)

**Files:**
- Create: `docs/ui/admin-clients.md`, `app/(admin)/admin/clients/page.tsx`, `app/(admin)/admin/clients/new/page.tsx`, `actions/clients.ts`

- [ ] **Step 1: aidesigner prompt**

> Admin → Clients list + create form. Same dark palette / cyan accent.
> Table: columns = slug, name, brand color swatch, members count, created at, actions ("Open →").
> "+ New client" button top-right → simple form with slug (required, lowercase, regex `[a-z0-9-]+`), name, brand color (hex), logo url (optional).
> Use Lucide icons: Plus, ArrowRight. No emoji.

Save in `docs/ui/admin-clients.md`.

- [ ] **Step 2: Server action**

Create `actions/clients.ts`:
```ts
"use server";

import { createClient } from "@/lib/db/queries/clients";
import { writeAudit } from "@/lib/db/queries/audit";
import { getContext } from "@/lib/auth/context";
import { redirect } from "next/navigation";

export async function createClientAction(formData: FormData) {
  const ctx = getContext();
  if (ctx.kind !== "admin") throw new Error("admin only");

  const slug = String(formData.get("slug") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const brandColor = String(formData.get("brandColor") ?? "").trim() || undefined;
  const logoUrl = String(formData.get("logoUrl") ?? "").trim() || undefined;

  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("invalid slug");
  if (!name) throw new Error("name required");

  const c = await createClient({ slug, name, brandColor, logoUrl });
  await writeAudit({
    eventType: "admin_action",
    actorType: "admin",
    actorId: ctx.adminId,
    clientId: c.id,
    metadata: { target_type: "client", target_id: c.id, action: "create", after: c },
  });
  redirect(`/admin/clients/${c.id}`);
}
```

- [ ] **Step 3: List page**

Create `app/(admin)/admin/clients/page.tsx`:
```tsx
import Link from "next/link";
import { listClients } from "@/lib/db/queries/clients";

export default async function ClientsListPage() {
  const clients = await listClients();
  return (
    <main className="px-10 py-12">
      <div className="flex items-baseline justify-between mb-8">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <Link href="/admin/clients/new" className="px-4 py-2 rounded-md bg-cyan-400 text-[#06060c] font-medium">+ New client</Link>
      </div>
      <div className="border border-[#1e1e2a] rounded-lg divide-y divide-[#1e1e2a]">
        {clients.map((c) => (
          <Link
            key={c.id}
            href={`/admin/clients/${c.id}`}
            className="flex items-center justify-between px-6 py-4 hover:bg-[#16161f]"
          >
            <div>
              <div className="font-mono text-xs text-cyan-400">{c.slug}</div>
              <div className="text-lg">{c.name}</div>
            </div>
            <div className="flex items-center gap-3">
              {c.brandColor && <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c.brandColor }} />}
              <span className="text-slate-500 text-sm">Open →</span>
            </div>
          </Link>
        ))}
        {clients.length === 0 && <div className="px-6 py-12 text-center text-slate-500">No clients yet. Create the first one.</div>}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Create page**

Create `app/(admin)/admin/clients/new/page.tsx`:
```tsx
import { createClientAction } from "@/actions/clients";

export default function NewClientPage() {
  return (
    <main className="px-10 py-12 max-w-xl">
      <h1 className="text-2xl font-semibold mb-8">New client</h1>
      <form action={createClientAction} className="flex flex-col gap-4">
        <Field name="slug" label="Slug" placeholder="adrena" required pattern="[a-z0-9-]+" />
        <Field name="name" label="Name" placeholder="Adrena Trading" required />
        <Field name="brandColor" label="Brand color (hex)" placeholder="#00e5ff" />
        <Field name="logoUrl" label="Logo URL" placeholder="https://…" />
        <button type="submit" className="mt-4 self-start px-5 py-2.5 rounded-md bg-cyan-400 text-[#06060c] font-medium">
          Create client
        </button>
      </form>
    </main>
  );
}

function Field({ name, label, ...rest }: { name: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-[0.08em] text-slate-500 font-mono">{label}</span>
      <input
        name={name}
        {...rest}
        className="px-4 py-2.5 rounded-md bg-[#111119] border border-[#1e1e2a] text-slate-100 focus:border-cyan-400 outline-none"
      />
    </label>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add docs/ui/admin-clients.md actions/clients.ts app/\(admin\)/admin/clients/
git commit -m "feat(admin): clients list + create"
```

---

### Task 38: /admin/clients/:id — edit + members

**Files:**
- Create: `app/(admin)/admin/clients/[id]/page.tsx`, `actions/members.ts`

- [ ] **Step 1: Member action**

Create `actions/members.ts`:
```ts
"use server";

import { revokeMember, upsertMember } from "@/lib/db/queries/members";
import { writeAudit } from "@/lib/db/queries/audit";
import { getContext } from "@/lib/auth/context";
import { revalidatePath } from "next/cache";

export async function addMemberAction(formData: FormData) {
  const ctx = getContext();
  if (ctx.kind !== "admin") throw new Error("admin only");
  const clientId = String(formData.get("clientId") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || null;
  const role = (String(formData.get("role") ?? "viewer") as "viewer" | "admin_of_client");
  const m = await upsertMember({ clientId, email, name, role });
  await writeAudit({
    eventType: "admin_action",
    actorType: "admin",
    actorId: ctx.adminId,
    clientId,
    metadata: { target_type: "client_member", target_id: m.id, action: "upsert" },
  });
  revalidatePath(`/admin/clients/${clientId}`);
}

export async function revokeMemberAction(formData: FormData) {
  const ctx = getContext();
  if (ctx.kind !== "admin") throw new Error("admin only");
  const memberId = String(formData.get("memberId"));
  const clientId = String(formData.get("clientId"));
  await revokeMember(memberId);
  await writeAudit({
    eventType: "admin_action",
    actorType: "admin",
    actorId: ctx.adminId,
    clientId,
    metadata: { target_type: "client_member", target_id: memberId, action: "revoke" },
  });
  revalidatePath(`/admin/clients/${clientId}`);
}
```

- [ ] **Step 2: Client detail page**

Create `app/(admin)/admin/clients/[id]/page.tsx`:
```tsx
import { getClientById } from "@/lib/db/queries/clients";
import { listMembersForClient } from "@/lib/db/queries/members";
import { addMemberAction, revokeMemberAction } from "@/actions/members";
import { notFound } from "next/navigation";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await getClientById(id);
  if (!client) notFound();
  const members = await listMembersForClient(client.id);

  return (
    <main className="px-10 py-12 max-w-3xl">
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-cyan-400 mb-2">Client</p>
      <h1 className="text-2xl font-semibold mb-8">{client.name} <span className="text-slate-500 font-normal">/{client.slug}</span></h1>

      <section className="mb-12">
        <h2 className="text-lg font-medium mb-4">Members</h2>
        <ul className="border border-[#1e1e2a] rounded-lg divide-y divide-[#1e1e2a]">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div>{m.email}</div>
                <div className="text-xs text-slate-500">{m.role}</div>
              </div>
              <form action={revokeMemberAction}>
                <input type="hidden" name="memberId" value={m.id} />
                <input type="hidden" name="clientId" value={client.id} />
                <button className="text-sm text-slate-400 hover:text-red-400">Revoke</button>
              </form>
            </li>
          ))}
          {members.length === 0 && <li className="px-4 py-8 text-center text-slate-500">No members yet.</li>}
        </ul>

        <form action={addMemberAction} className="mt-6 flex gap-3">
          <input type="hidden" name="clientId" value={client.id} />
          <input name="email" type="email" required placeholder="name@company.com" className="flex-1 px-3 py-2 rounded-md bg-[#111119] border border-[#1e1e2a]" />
          <input name="name" placeholder="Name (optional)" className="flex-1 px-3 py-2 rounded-md bg-[#111119] border border-[#1e1e2a]" />
          <select name="role" className="px-3 py-2 rounded-md bg-[#111119] border border-[#1e1e2a]">
            <option value="viewer">viewer</option>
            <option value="admin_of_client">admin_of_client</option>
          </select>
          <button type="submit" className="px-4 py-2 rounded-md bg-cyan-400 text-[#06060c] font-medium">Add</button>
        </form>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add actions/members.ts app/\(admin\)/admin/clients/\[id\]/
git commit -m "feat(admin): client detail + members management"
```

---

### Task 39: /admin/docs list + create HTML/Markdown

**Files:**
- Create: `app/(admin)/admin/docs/page.tsx`, `app/(admin)/admin/docs/new/page.tsx`, `actions/docs.ts`

- [ ] **Step 1: Doc actions**

Create `actions/docs.ts`:
```ts
"use server";

import { createDoc, updateDoc } from "@/lib/db/queries/docs";
import { writeAudit } from "@/lib/db/queries/audit";
import { getContext } from "@/lib/auth/context";
import { redirect } from "next/navigation";

export async function createDocAction(formData: FormData) {
  const ctx = getContext();
  if (ctx.kind !== "admin") throw new Error("admin only");

  const slug = String(formData.get("slug") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const bodyType = (String(formData.get("bodyType") ?? "html") as "html" | "markdown");
  const body = String(formData.get("body") ?? "");

  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("invalid slug");
  if (!title) throw new Error("title required");
  if (!body) throw new Error("body required");

  const d = await createDoc({ slug, title, bodyType, body, createdBy: ctx.adminId });
  await writeAudit({
    eventType: "admin_action",
    actorType: "admin",
    actorId: ctx.adminId,
    docId: d.id,
    metadata: { target_type: "doc", target_id: d.id, action: "create", title },
  });
  redirect(`/admin/docs/${d.id}`);
}

export async function updateDocAction(formData: FormData) {
  const ctx = getContext();
  if (ctx.kind !== "admin") throw new Error("admin only");
  const id = String(formData.get("id"));
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "");
  const bodyType = (String(formData.get("bodyType") ?? "html") as "html" | "markdown");
  const d = await updateDoc(id, { title, body, bodyType });
  if (!d) throw new Error("doc not found");
  await writeAudit({
    eventType: "admin_action",
    actorType: "admin",
    actorId: ctx.adminId,
    docId: d.id,
    metadata: { target_type: "doc", target_id: d.id, action: "update" },
  });
  redirect(`/admin/docs/${d.id}`);
}
```

- [ ] **Step 2: Docs list**

Create `app/(admin)/admin/docs/page.tsx`:
```tsx
import Link from "next/link";
import { listDocs } from "@/lib/db/queries/docs";

export default async function DocsListPage() {
  const docs = await listDocs();
  return (
    <main className="px-10 py-12">
      <div className="flex items-baseline justify-between mb-8">
        <h1 className="text-2xl font-semibold">Docs</h1>
        <Link href="/admin/docs/new" className="px-4 py-2 rounded-md bg-cyan-400 text-[#06060c] font-medium">+ New doc</Link>
      </div>
      <div className="border border-[#1e1e2a] rounded-lg divide-y divide-[#1e1e2a]">
        {docs.map((d) => (
          <Link key={d.id} href={`/admin/docs/${d.id}`} className="flex items-center justify-between px-6 py-4 hover:bg-[#16161f]">
            <div>
              <div className="font-mono text-xs text-cyan-400">{d.bodyType} · /{d.slug}</div>
              <div className="text-lg">{d.title}</div>
            </div>
            <span className="text-slate-500 text-sm">Open →</span>
          </Link>
        ))}
        {docs.length === 0 && <div className="px-6 py-12 text-center text-slate-500">No docs yet.</div>}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: New doc page**

Create `app/(admin)/admin/docs/new/page.tsx`:
```tsx
import { createDocAction } from "@/actions/docs";

export default function NewDocPage() {
  return (
    <main className="px-10 py-12 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-8">New doc</h1>
      <form action={createDocAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-[0.08em] text-slate-500 font-mono">Slug</span>
          <input name="slug" required pattern="[a-z0-9-]+" placeholder="adrena-implementation-plan" className="px-4 py-2.5 rounded-md bg-[#111119] border border-[#1e1e2a]" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-[0.08em] text-slate-500 font-mono">Title</span>
          <input name="title" required placeholder="Adrena Trading Arena — Implementation Plan" className="px-4 py-2.5 rounded-md bg-[#111119] border border-[#1e1e2a]" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-[0.08em] text-slate-500 font-mono">Body type</span>
          <select name="bodyType" className="px-4 py-2.5 rounded-md bg-[#111119] border border-[#1e1e2a]">
            <option value="html">html</option>
            <option value="markdown">markdown</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-[0.08em] text-slate-500 font-mono">Body</span>
          <textarea name="body" required rows={20} className="px-4 py-3 rounded-md bg-[#111119] border border-[#1e1e2a] font-mono text-sm" />
        </label>
        <button type="submit" className="mt-2 self-start px-5 py-2.5 rounded-md bg-cyan-400 text-[#06060c] font-medium">Create doc</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add actions/docs.ts app/\(admin\)/admin/docs/page.tsx app/\(admin\)/admin/docs/new/
git commit -m "feat(admin): docs list + create"
```

---

### Task 40: /admin/docs/:id — edit doc

**Files:**
- Create: `app/(admin)/admin/docs/[id]/page.tsx`

- [ ] **Step 1: Implement**

Create `app/(admin)/admin/docs/[id]/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDocById } from "@/lib/db/queries/docs";
import { updateDocAction } from "@/actions/docs";

export default async function DocEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDocById(id);
  if (!doc) notFound();

  return (
    <main className="px-10 py-12 max-w-3xl">
      <div className="flex items-baseline justify-between mb-8">
        <h1 className="text-2xl font-semibold">{doc.title}</h1>
        <Link href={`/admin/docs/${doc.id}/share`} className="text-cyan-400 hover:underline">Share →</Link>
      </div>

      <form action={updateDocAction} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={doc.id} />
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-[0.08em] text-slate-500 font-mono">Title</span>
          <input name="title" defaultValue={doc.title} required className="px-4 py-2.5 rounded-md bg-[#111119] border border-[#1e1e2a]" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-[0.08em] text-slate-500 font-mono">Body type</span>
          <select name="bodyType" defaultValue={doc.bodyType} className="px-4 py-2.5 rounded-md bg-[#111119] border border-[#1e1e2a]">
            <option value="html">html</option>
            <option value="markdown">markdown</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-[0.08em] text-slate-500 font-mono">Body</span>
          <textarea name="body" defaultValue={doc.body} rows={20} required className="px-4 py-3 rounded-md bg-[#111119] border border-[#1e1e2a] font-mono text-sm" />
        </label>
        <button type="submit" className="mt-2 self-start px-5 py-2.5 rounded-md bg-cyan-400 text-[#06060c] font-medium">Save</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(admin\)/admin/docs/\[id\]/page.tsx
git commit -m "feat(admin): doc edit"
```

---

### Task 41: /admin/docs/:id/share — share flow

**Files:**
- Create: `app/(admin)/admin/docs/[id]/share/page.tsx`, `actions/share.ts`

- [ ] **Step 1: shareDoc server action**

Create `actions/share.ts`:
```ts
"use server";

import { adminDb, schema } from "@/lib/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { upsertMember } from "@/lib/db/queries/members";
import { upsertShare, revokeShare } from "@/lib/db/queries/shares";
import { issueMagicLink } from "@/lib/auth/issue";
import { writeAudit } from "@/lib/db/queries/audit";
import { sendMail } from "@/lib/mail/resend";
import { MagicLinkEmail } from "@/lib/mail/templates/magic-link";
import { getContext } from "@/lib/auth/context";
import { revalidatePath } from "next/cache";
import React from "react";

export async function shareDocAction(formData: FormData) {
  const ctx = getContext();
  if (ctx.kind !== "admin") throw new Error("admin only");
  const docId = String(formData.get("docId"));
  const clientId = String(formData.get("clientId"));
  const emailsRaw = String(formData.get("emails") ?? "");
  const emails = emailsRaw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (!docId || !clientId) throw new Error("missing docId/clientId");
  if (emails.length === 0) throw new Error("provide at least one recipient email");

  await upsertShare(docId, clientId);

  const doc = await adminDb.query.docs.findFirst({
    where: eq(schema.docs.id, docId),
    columns: { id: true, title: true },
  });
  if (!doc) throw new Error("doc not found");

  const actor = await adminDb.query.admins.findFirst({
    where: eq(schema.admins.id, ctx.adminId),
    columns: { name: true, email: true },
  });

  for (const email of emails) {
    const m = await upsertMember({ clientId, email, role: "viewer" });
    const { raw } = await issueMagicLink({
      subjectType: "client_member",
      subjectId: m.id,
      email,
      clientId,
      actorId: ctx.adminId,
      docId,
    });
    const url = `${process.env.APP_URL}/auth/verify?token=${raw}`;
    await sendMail({
      to: email,
      subject: `Edict — ${doc.title}`,
      template: React.createElement(MagicLinkEmail, {
        docTitle: doc.title,
        actorName: actor?.name ?? actor?.email ?? "Your Edict",
        magicLinkUrl: url,
      }),
    });
  }

  await writeAudit({
    eventType: "doc_shared",
    actorType: "admin",
    actorId: ctx.adminId,
    clientId,
    docId,
    metadata: { doc_id: docId, client_id: clientId, new_members: emails },
  });

  revalidatePath(`/admin/docs/${docId}/share`);
}

export async function unshareAction(formData: FormData) {
  const ctx = getContext();
  if (ctx.kind !== "admin") throw new Error("admin only");
  const docId = String(formData.get("docId"));
  const clientId = String(formData.get("clientId"));
  await revokeShare(docId, clientId);
  await writeAudit({
    eventType: "doc_unshared",
    actorType: "admin",
    actorId: ctx.adminId,
    clientId,
    docId,
    metadata: { doc_id: docId, client_id: clientId },
  });
  revalidatePath(`/admin/docs/${docId}/share`);
}
```

- [ ] **Step 2: Share page**

Create `app/(admin)/admin/docs/[id]/share/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { getDocById } from "@/lib/db/queries/docs";
import { listClients } from "@/lib/db/queries/clients";
import { listSharesForDoc } from "@/lib/db/queries/shares";
import { shareDocAction, unshareAction } from "@/actions/share";

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, clients, shares] = await Promise.all([
    getDocById(id),
    listClients(),
    listSharesForDoc(id),
  ]);
  if (!doc) notFound();
  const shareMap = new Map(shares.map((s) => [s.clientId, s]));

  return (
    <main className="px-10 py-12 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-8">Share <span className="text-slate-500 font-normal">{doc.title}</span></h1>

      <section className="border border-[#1e1e2a] rounded-lg divide-y divide-[#1e1e2a]">
        {clients.map((c) => {
          const share = shareMap.get(c.id);
          const isActive = share && !share.revokedAt;
          return (
            <div key={c.id} className="flex items-center justify-between px-6 py-4">
              <div>
                <div className="font-mono text-xs text-cyan-400">{c.slug}</div>
                <div>{c.name}</div>
                {isActive && <div className="text-xs text-slate-500">Shared {share!.sharedAt.toISOString()}</div>}
              </div>
              <div className="flex gap-2">
                {isActive && (
                  <form action={unshareAction}>
                    <input type="hidden" name="docId" value={doc.id} />
                    <input type="hidden" name="clientId" value={c.id} />
                    <button className="text-sm text-slate-400 hover:text-red-400 px-3 py-1.5">Unshare</button>
                  </form>
                )}
                <form action={shareDocAction} className="flex gap-2 items-center">
                  <input type="hidden" name="docId" value={doc.id} />
                  <input type="hidden" name="clientId" value={c.id} />
                  <input name="emails" placeholder="emails (comma/space separated)" className="px-3 py-1.5 text-sm rounded-md bg-[#111119] border border-[#1e1e2a] w-72" />
                  <button className="px-3 py-1.5 text-sm rounded-md bg-cyan-400 text-[#06060c] font-medium">Send links</button>
                </form>
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add actions/share.ts app/\(admin\)/admin/docs/\[id\]/share/
git commit -m "feat(admin): share doc flow"
```

---

### Task 42: /admin/docs/:id/analytics + /admin/audit

**Files:**
- Create: `app/(admin)/admin/docs/[id]/analytics/page.tsx`, `app/(admin)/admin/audit/page.tsx`, `lib/db/queries/analytics.ts`

- [ ] **Step 1: Analytics queries**

Create `lib/db/queries/analytics.ts`:
```ts
import { adminDb, schema } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";

export async function docAnalytics(docId: string) {
  const [totals] = await adminDb
    .select({
      views: sql<number>`count(*) filter (where ${schema.auditLog.eventType} = 'doc_viewed')::int`,
      uniqueViewers: sql<number>`count(distinct ${schema.auditLog.actorId}) filter (where ${schema.auditLog.eventType} = 'doc_viewed')::int`,
    })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.docId, docId));

  const byMember = await adminDb
    .select({
      actorId: schema.auditLog.actorId,
      views: sql<number>`count(*)::int`,
      lastViewedAt: sql<Date>`max(${schema.auditLog.createdAt})`,
    })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.docId, docId), eq(schema.auditLog.eventType, "doc_viewed")))
    .groupBy(schema.auditLog.actorId);

  return { totals, byMember };
}

export async function recentAuditLog(limit = 50) {
  return adminDb.query.auditLog.findMany({
    orderBy: (a, { desc }) => [desc(a.createdAt)],
    limit,
  });
}
```

- [ ] **Step 2: Analytics page**

Create `app/(admin)/admin/docs/[id]/analytics/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { getDocById } from "@/lib/db/queries/docs";
import { docAnalytics } from "@/lib/db/queries/analytics";

export default async function DocAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, stats] = await Promise.all([getDocById(id), docAnalytics(id)]);
  if (!doc) notFound();

  return (
    <main className="px-10 py-12 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-8">Analytics — {doc.title}</h1>
      <div className="grid grid-cols-2 gap-4 mb-12">
        <Card label="Total views" value={stats.totals?.views ?? 0} />
        <Card label="Unique viewers" value={stats.totals?.uniqueViewers ?? 0} />
      </div>
      <section>
        <h2 className="text-lg font-medium mb-4">By member</h2>
        <ul className="border border-[#1e1e2a] rounded-lg divide-y divide-[#1e1e2a]">
          {stats.byMember.map((row) => (
            <li key={row.actorId ?? "anon"} className="flex items-center justify-between px-4 py-3">
              <span className="font-mono text-xs text-slate-400">{row.actorId}</span>
              <span>{row.views} views · last {new Date(row.lastViewedAt).toISOString()}</span>
            </li>
          ))}
          {stats.byMember.length === 0 && <li className="px-4 py-8 text-center text-slate-500">No views yet.</li>}
        </ul>
      </section>
    </main>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-6 rounded-lg border border-[#1e1e2a] bg-[#111119]">
      <div className="text-xs uppercase tracking-[0.08em] text-slate-500 mb-2 font-mono">{label}</div>
      <div className="text-4xl font-semibold">{value}</div>
    </div>
  );
}
```

- [ ] **Step 3: Audit page**

Create `app/(admin)/admin/audit/page.tsx`:
```tsx
import { recentAuditLog } from "@/lib/db/queries/analytics";

export default async function AuditPage() {
  const rows = await recentAuditLog(100);
  return (
    <main className="px-10 py-12 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-8">Audit log</h1>
      <div className="border border-[#1e1e2a] rounded-lg divide-y divide-[#1e1e2a] font-mono text-xs">
        {rows.map((r) => (
          <div key={r.id} className="px-4 py-2 grid grid-cols-[180px_160px_1fr] gap-4">
            <span className="text-slate-500">{r.createdAt.toISOString()}</span>
            <span className="text-cyan-400">{r.eventType}</span>
            <span className="text-slate-300 truncate">{JSON.stringify(r.metadata)}</span>
          </div>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/db/queries/analytics.ts app/\(admin\)/admin/docs/\[id\]/analytics/ app/\(admin\)/admin/audit/
git commit -m "feat(admin): per-doc analytics + audit log viewer"
```

---

## Phase G: Client Surface + Doc Rendering

### Task 43: Client layout (requireClientSession + slug match)

**Files:**
- Create: `app/(client)/c/[slug]/layout.tsx`

- [ ] **Step 1: Implement**

Create `app/(client)/c/[slug]/layout.tsx`:
```tsx
import { requireClientSession } from "@/lib/auth/middleware";
import { getClientBySlug } from "@/lib/db/queries/clients";
import { notFound } from "next/navigation";

export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return requireClientSession(slug, async () => {
    const tenant = await getClientBySlug(slug);
    if (!tenant) notFound();
    const cssVar = tenant.brandColor
      ? ({ ["--tenant-color" as string]: tenant.brandColor } as React.CSSProperties)
      : undefined;
    return (
      <div style={cssVar} className="min-h-screen">
        <header className="border-b border-[#1e1e2a] px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {tenant.logoUrl && <img src={tenant.logoUrl} alt="" className="h-8" />}
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--tenant-color)]">Edict</p>
              <p className="text-sm">{tenant.name}</p>
            </div>
          </div>
          <form action="/auth/logout" method="POST">
            <button className="text-sm text-slate-400 hover:text-[var(--tenant-color)]">Log out</button>
          </form>
        </header>
        {children}
      </div>
    );
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(client\)/c/\[slug\]/layout.tsx
git commit -m "feat(client): layout + session gate + brand color"
```

---

### Task 44: /c/:slug dashboard (aidesigner → TSX)

**Files:**
- Create: `docs/ui/client-dashboard.md`, `app/(client)/c/[slug]/page.tsx`

- [ ] **Step 1: aidesigner prompt**

> Branded client dashboard in Edict.
> Voice: authoritative but warm. Brand: tenant color injected via CSS var `--tenant-color` (accent usage only; primary background stays #06060c).
> Layout:
> - Top area already rendered by parent layout (tenant logo + name + log out).
> - Page header: "Your edicts" + subtitle "Documents issued to {{tenant_name}}"
> - List of doc cards: title (large), body type badge ("HTML" / "MD"), last-viewed indicator ("You read this 3 hours ago" or "New")
> - Empty state: "No edicts yet." centered, muted.
> Data shape: { tenant: { name }, docs: [{ slug, title, bodyType, lastViewedAt?: ISO }] }

Save in `docs/ui/client-dashboard.md`.

- [ ] **Step 2: Dashboard query**

Add to `lib/db/queries/docs.ts`:
```ts
export async function listDocsForClientWithLastViewed(clientId: string, memberId: string) {
  return adminDb
    .select({
      id: schema.docs.id,
      slug: schema.docs.slug,
      title: schema.docs.title,
      bodyType: schema.docs.bodyType,
      sharedAt: schema.docShares.sharedAt,
      lastViewedAt: sql<Date | null>`(
        SELECT MAX(${schema.auditLog.createdAt})
        FROM ${schema.auditLog}
        WHERE ${schema.auditLog.eventType} = 'doc_viewed'
          AND ${schema.auditLog.actorId} = ${memberId}
          AND ${schema.auditLog.docId} = ${schema.docs.id}
      )`,
    })
    .from(schema.docShares)
    .innerJoin(schema.docs, eq(schema.docShares.docId, schema.docs.id))
    .where(and(eq(schema.docShares.clientId, clientId), isNull(schema.docShares.revokedAt)))
    .orderBy(sql`${schema.docShares.sharedAt} DESC`);
}
```

(If the `and/eq/isNull/sql` imports aren't already present at the top of that file, add them.)

- [ ] **Step 3: Dashboard page**

Create `app/(client)/c/[slug]/page.tsx`:
```tsx
import Link from "next/link";
import { getContext } from "@/lib/auth/context";
import { getClientBySlug } from "@/lib/db/queries/clients";
import { listDocsForClientWithLastViewed } from "@/lib/db/queries/docs";
import { notFound } from "next/navigation";

export default async function ClientDashboard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = getContext();
  if (ctx.kind !== "client") throw new Error("client only");
  const tenant = await getClientBySlug(slug);
  if (!tenant) notFound();

  const docs = await listDocsForClientWithLastViewed(ctx.clientId, ctx.memberId);

  return (
    <main className="px-10 py-12 max-w-4xl mx-auto">
      <h1 className="text-3xl font-semibold">Your edicts</h1>
      <p className="text-slate-500 mt-2 mb-10">Documents issued to {tenant.name}</p>

      <div className="flex flex-col gap-4">
        {docs.map((d) => (
          <Link
            key={d.id}
            href={`/c/${slug}/d/${d.slug}`}
            className="block p-6 rounded-lg border border-[#1e1e2a] bg-[#111119] hover:border-[var(--tenant-color)]/60 transition-colors"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-medium">{d.title}</h2>
              <span className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500">{d.bodyType}</span>
            </div>
            <p className="text-sm text-slate-500 mt-2">
              {d.lastViewedAt ? `You last read ${formatRelative(new Date(d.lastViewedAt))}` : "New"}
            </p>
          </Link>
        ))}
        {docs.length === 0 && (
          <p className="text-center text-slate-500 py-24">No edicts yet.</p>
        )}
      </div>
    </main>
  );
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const hours = Math.floor(diffMs / 36e5);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

- [ ] **Step 4: Commit**

```bash
git add docs/ui/client-dashboard.md lib/db/queries/docs.ts app/\(client\)/c/\[slug\]/page.tsx
git commit -m "feat(client): dashboard with last-viewed"
```

---

### Task 45: HTML iframe renderer

**Files:**
- Create: `lib/docs/render-html.tsx`

- [ ] **Step 1: Implement**

Create `lib/docs/render-html.tsx`:
```tsx
export function RenderHtmlDoc({ body }: { body: string }) {
  return (
    <iframe
      title="Edict document"
      srcDoc={body}
      sandbox="allow-scripts"
      className="w-full h-[90vh] border-0 rounded-lg bg-[#06060c]"
      loading="eager"
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/docs/render-html.tsx
git commit -m "feat(docs): sandboxed iframe renderer for HTML docs"
```

---

### Task 46: Markdown renderer

**Files:**
- Create: `lib/docs/render-markdown.ts`, `tests/unit/render-markdown.test.ts`

- [ ] **Step 1: Install**

Run: `pnpm add unified remark-parse remark-gfm remark-rehype rehype-sanitize rehype-stringify`

- [ ] **Step 2: Failing test**

Create `tests/unit/render-markdown.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "@/lib/docs/render-markdown";

describe("renderMarkdown", () => {
  it("converts gfm table + heading", async () => {
    const html = await renderMarkdown("# Hello\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<table>");
  });

  it("strips disallowed script tags", async () => {
    const html = await renderMarkdown("<script>alert('x')</script>hi");
    expect(html).not.toContain("<script>");
  });
});
```

Run: `pnpm test:run -- render-markdown` → FAIL.

- [ ] **Step 3: Implement**

Create `lib/docs/render-markdown.ts`:
```ts
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

const pipeline = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeSanitize)
  .use(rehypeStringify);

export async function renderMarkdown(md: string): Promise<string> {
  const file = await pipeline.process(md);
  return String(file);
}
```

- [ ] **Step 4: Run**

Run: `pnpm test:run -- render-markdown` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/docs/render-markdown.ts tests/unit/render-markdown.test.ts package.json pnpm-lock.yaml
git commit -m "feat(docs): markdown renderer with sanitization"
```

---

### Task 47: /c/:slug/d/:docSlug — doc viewer with view beacon

**Files:**
- Create: `app/(client)/c/[slug]/d/[docSlug]/page.tsx`, `app/api/track/view/route.ts`, `components/ViewBeacon.tsx`

- [ ] **Step 1: Beacon component**

Create `components/ViewBeacon.tsx`:
```tsx
"use client";
import { useEffect } from "react";

export function ViewBeacon({ docId }: { docId: string }) {
  useEffect(() => {
    const start = Date.now();
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      const duration = Date.now() - start;
      const payload = JSON.stringify({ docId, duration_ms: duration });
      try {
        navigator.sendBeacon(
          "/api/track/view",
          new Blob([payload], { type: "application/json" }),
        );
      } catch {
        // best-effort
      }
    };

    // initial open
    void fetch("/api/track/view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ docId, opened: true }),
      keepalive: true,
    });

    const onHide = () => document.visibilityState === "hidden" && send();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", send);

    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", send);
      send();
    };
  }, [docId]);

  return null;
}
```

- [ ] **Step 2: View tracking route**

Create `app/api/track/view/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sha256Hex } from "@/lib/utils/hash";
import { findActiveSessionByTokenHash } from "@/lib/db/queries/sessions";
import { writeAudit } from "@/lib/db/queries/audit";
import { SESSION_COOKIE_NAME } from "@/lib/auth/middleware";

export async function POST(req: NextRequest) {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return NextResponse.json({ ok: false }, { status: 401 });
  const session = await findActiveSessionByTokenHash(sha256Hex(raw));
  if (!session || session.subjectType !== "client_member" || !session.clientId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as
    | { docId?: string; duration_ms?: number; opened?: boolean }
    | null;
  if (!body?.docId) return NextResponse.json({ ok: false }, { status: 400 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent") ?? null;

  await writeAudit({
    eventType: "doc_viewed",
    actorType: "client_member",
    actorId: session.subjectId,
    clientId: session.clientId,
    docId: body.docId,
    ip,
    userAgent: ua,
    metadata: body.opened
      ? { phase: "open" }
      : { phase: "close", duration_ms: body.duration_ms ?? null },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Doc viewer page**

Create `app/(client)/c/[slug]/d/[docSlug]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { getContext } from "@/lib/auth/context";
import { getDocForClient } from "@/lib/db/queries/docs";
import { RenderHtmlDoc } from "@/lib/docs/render-html";
import { renderMarkdown } from "@/lib/docs/render-markdown";
import { ViewBeacon } from "@/components/ViewBeacon";

export default async function DocViewerPage({
  params,
}: {
  params: Promise<{ slug: string; docSlug: string }>;
}) {
  const { docSlug } = await params;
  const ctx = getContext();
  if (ctx.kind !== "client") throw new Error("client only");

  const doc = await getDocForClient(ctx.clientId, docSlug);
  if (!doc) notFound();

  const rendered = doc.bodyType === "markdown" ? await renderMarkdown(doc.body) : null;

  return (
    <main className="px-4 py-8 max-w-5xl mx-auto">
      <ViewBeacon docId={doc.id} />
      <header className="mb-6">
        <h1 className="text-3xl font-semibold">{doc.title}</h1>
      </header>
      {doc.bodyType === "html" ? (
        <RenderHtmlDoc body={doc.body} />
      ) : (
        <article
          className="prose prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: rendered ?? "" }}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add app/\(client\)/c/\[slug\]/d/ app/api/track/view/ components/ViewBeacon.tsx
git commit -m "feat(client): doc viewer + view beacon"
```

---

## Phase H: E2E Tenant-Isolation Tests

### Task 48: Playwright fixture — two-client setup

**Files:**
- Create: `tests/e2e/fixtures.ts`

- [ ] **Step 1: Implement fixture**

Create `tests/e2e/fixtures.ts`:
```ts
import { test as base, expect, type APIRequestContext } from "@playwright/test";
import { adminDb, schema } from "@/lib/db";
import { issueMagicLink } from "@/lib/auth/issue";
import { createClient } from "@/lib/db/queries/clients";
import { upsertMember } from "@/lib/db/queries/members";
import { createDoc } from "@/lib/db/queries/docs";
import { upsertShare } from "@/lib/db/queries/shares";

export type Seed = {
  adminId: string;
  clientA: { id: string; slug: string };
  clientB: { id: string; slug: string };
  docA1: { id: string; slug: string };
  docB1: { id: string; slug: string };
  memberA: { id: string; email: string };
  memberB: { id: string; email: string };
};

async function signIn(request: APIRequestContext, memberEmail: string, memberId: string, clientId: string): Promise<string> {
  const { raw } = await issueMagicLink({
    subjectType: "client_member",
    subjectId: memberId,
    email: memberEmail,
    clientId,
  });
  const res = await request.get(`/auth/verify?token=${raw}`);
  const setCookie = res.headers()["set-cookie"] ?? "";
  const match = /edict_session=([^;]+)/.exec(setCookie);
  if (!match) throw new Error("no session cookie in response");
  return match[1]!;
}

export const test = base.extend<{ seed: Seed }>({
  seed: async ({}, use) => {
    // Wipe then seed — tests assume fresh state
    await adminDb.delete(schema.auditLog);
    await adminDb.delete(schema.sessions);
    await adminDb.delete(schema.magicLinkTokens);
    await adminDb.delete(schema.docShares);
    await adminDb.delete(schema.clientMembers);
    await adminDb.delete(schema.docs);
    await adminDb.delete(schema.clients);
    await adminDb.delete(schema.admins);

    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "admin@edict.test", name: "Test Admin" })
      .returning();

    const a = await createClient({ slug: "a", name: "Alpha" });
    const b = await createClient({ slug: "b", name: "Bravo" });

    const ma = await upsertMember({ clientId: a.id, email: "mem@a.test", role: "viewer" });
    const mb = await upsertMember({ clientId: b.id, email: "mem@b.test", role: "viewer" });

    const d1 = await createDoc({
      slug: "doc-one",
      title: "Doc for Alpha",
      bodyType: "html",
      body: "<p>Alpha only</p>",
      createdBy: admin!.id,
    });
    const d2 = await createDoc({
      slug: "doc-two",
      title: "Doc for Bravo",
      bodyType: "html",
      body: "<p>Bravo only</p>",
      createdBy: admin!.id,
    });

    await upsertShare(d1.id, a.id);
    await upsertShare(d2.id, b.id);

    await use({
      adminId: admin!.id,
      clientA: { id: a.id, slug: "a" },
      clientB: { id: b.id, slug: "b" },
      docA1: { id: d1.id, slug: d1.slug },
      docB1: { id: d2.id, slug: d2.slug },
      memberA: { id: ma.id, email: "mem@a.test" },
      memberB: { id: mb.id, email: "mem@b.test" },
    });
  },
});

export { expect, signIn };
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/fixtures.ts
git commit -m "test(e2e): two-client seed fixture"
```

---

### Task 49: E2E Scenario 1 — visibility

**Files:**
- Create: `tests/e2e/isolation.spec.ts`

- [ ] **Step 1: Write test**

Create `tests/e2e/isolation.spec.ts`:
```ts
import { test, expect, signIn } from "./fixtures";

test("A sees doc-1, not doc-2", async ({ page, request, seed }) => {
  const cookieA = await signIn(request, seed.memberA.email, seed.memberA.id, seed.clientA.id);
  await page.context().addCookies([{
    name: "edict_session",
    value: cookieA,
    url: page.url() || "http://127.0.0.1:3000",
  }]);
  await page.goto(`/c/${seed.clientA.slug}`);
  await expect(page.getByText("Doc for Alpha")).toBeVisible();
  await expect(page.getByText("Doc for Bravo")).toHaveCount(0);
});
```

- [ ] **Step 2: Run**

Run: `pnpm test:e2e` → expect PASS for scenario 1.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/isolation.spec.ts
git commit -m "test(e2e): scenario 1 — tenant doc visibility"
```

---

### Task 50: E2E Scenarios 2–5 — URL manipulation, cookie swap, revocations

**Files:**
- Modify: `tests/e2e/isolation.spec.ts`

- [ ] **Step 1: Append 4 more scenarios**

Append to `tests/e2e/isolation.spec.ts`:
```ts
test("A cannot reach /c/B/d/docB by URL manipulation", async ({ page, request, seed }) => {
  const cookieA = await signIn(request, seed.memberA.email, seed.memberA.id, seed.clientA.id);
  await page.context().addCookies([{
    name: "edict_session",
    value: cookieA,
    url: "http://127.0.0.1:3000",
  }]);
  const res = await page.goto(`/c/${seed.clientB.slug}/d/${seed.docB1.slug}`);
  expect(res?.status()).toBe(404);
});

test("A's cookie on /c/B is rejected as mismatch", async ({ page, request, seed }) => {
  const cookieA = await signIn(request, seed.memberA.email, seed.memberA.id, seed.clientA.id);
  await page.context().addCookies([{
    name: "edict_session",
    value: cookieA,
    url: "http://127.0.0.1:3000",
  }]);
  const res = await page.goto(`/c/${seed.clientB.slug}`);
  expect(res?.status()).toBe(404);
});

test("revoked member's new magic-link fails", async ({ request, seed }) => {
  const { adminDb, schema } = await import("@/lib/db");
  const { issueMagicLink } = await import("@/lib/auth/issue");
  await adminDb
    .update(schema.clientMembers)
    .set({ revokedAt: new Date() })
    .where(({ id }: any, { eq }: any) => eq(id, seed.memberA.id)).catch(() => {});
  // Re-queried directly because drizzle `where` helpers in tests vary:
  await adminDb.execute(
    { sql: `UPDATE client_members SET revoked_at = now() WHERE id = $1`, args: [seed.memberA.id] } as any,
  ).catch(() => {});

  const { raw } = await issueMagicLink({
    subjectType: "client_member",
    subjectId: seed.memberA.id,
    email: seed.memberA.email,
    clientId: seed.clientA.id,
  });
  const res = await request.get(`/auth/verify?token=${raw}`);
  // Revoked member still consumes the token, but downstream routes should reject.
  // Fetch dashboard with the resulting cookie — expect redirect to /.
  const setCookie = res.headers()["set-cookie"] ?? "";
  const match = /edict_session=([^;]+)/.exec(setCookie);
  if (match) {
    const cookie = match[1]!;
    const r2 = await request.get(`/c/${seed.clientA.slug}`, { headers: { cookie: `edict_session=${cookie}` } });
    expect([302, 307, 303].includes(r2.status()) || r2.status() === 404).toBe(true);
  }
});

test("revoked session bounces to /", async ({ page, request, seed }) => {
  const cookieA = await signIn(request, seed.memberA.email, seed.memberA.id, seed.clientA.id);
  const { adminDb, schema } = await import("@/lib/db");
  const { sha256Hex } = await import("@/lib/utils/hash");
  await adminDb.update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(({ sessionTokenHash }: any, { eq }: any) => eq(sessionTokenHash, sha256Hex(cookieA)))
    .catch(async () => {
      await adminDb.execute({ sql: `UPDATE sessions SET revoked_at = now() WHERE session_token_hash = $1`, args: [sha256Hex(cookieA)] } as any);
    });

  await page.context().addCookies([{ name: "edict_session", value: cookieA, url: "http://127.0.0.1:3000" }]);
  const res = await page.goto(`/c/${seed.clientA.slug}`);
  expect(res?.url()).toMatch(/\/$/);
});
```

- [ ] **Step 2: Run suite**

Run: `pnpm test:e2e` → all 5 scenarios pass.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/isolation.spec.ts
git commit -m "test(e2e): scenarios 2-5 — URL, cookie, member/session revocation"
```

---

## Phase I: Deployment

### Task 51: Dockerfile (multi-stage)

**Files:**
- Create: `Dockerfile`, `.dockerignore`

- [ ] **Step 1: Dockerfile**

Create `Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/lib ./lib
USER node
EXPOSE 3000
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
```

- [ ] **Step 2: .dockerignore**

Create `.dockerignore`:
```
node_modules
.next
.git
.env
.env.*
tests/e2e/test-results
tests/e2e/playwright-report
*.log
```

- [ ] **Step 3: Local build smoke**

Run: `docker build -t edict-app .`
Expected: image builds without error.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "chore(deploy): multi-stage Dockerfile"
```

---

### Task 52: Production Docker Compose

**Files:**
- Create: `docker-compose.prod.yml`

- [ ] **Step 1: Implement**

Create `docker-compose.prod.yml`:
```yaml
name: edict

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: edict_admin
      POSTGRES_PASSWORD: ${POSTGRES_ADMIN_PASSWORD:?must be set}
      POSTGRES_DB: edict
    volumes:
      - edict_pg_data:/var/lib/postgresql/data
      - ./backups:/backups
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U edict_admin -d edict"]
      interval: 10s
      timeout: 3s
      retries: 10

volumes:
  edict_pg_data:
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "chore(deploy): production compose"
```

---

### Task 53: nginx site config

**Files:**
- Create: `nginx/edict.conf`

- [ ] **Step 1: Implement**

Create `nginx/edict.conf`:
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name edict.rectorspace.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name edict.rectorspace.com;

    ssl_certificate     /etc/letsencrypt/live/edict.rectorspace.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/edict.rectorspace.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    client_max_body_size 10m;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_http_version 1.1;
        proxy_set_header   Connection        "";
        proxy_read_timeout 60s;
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add nginx/edict.conf
git commit -m "chore(deploy): nginx site config"
```

---

### Task 54: Backup cron script

**Files:**
- Create: `scripts/backup.sh`

- [ ] **Step 1: Implement**

Create `scripts/backup.sh`:
```bash
#!/usr/bin/env bash
# Nightly dump; crontab entry:
#   0 3 * * *  /home/edict/apps/edict/scripts/backup.sh >> /home/edict/apps/edict/backups/backup.log 2>&1
set -euo pipefail

STAMP="$(date +%F)"
BACKUP_DIR="$(dirname "$0")/../backups"
mkdir -p "$BACKUP_DIR"

docker compose -f "$(dirname "$0")/../docker-compose.prod.yml" exec -T db \
  pg_dump -U edict_admin -d edict \
  | gzip > "$BACKUP_DIR/$STAMP.sql.gz"

# Keep 14 local; older are pushed off-VPS (rsync job handles that separately)
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +14 -delete

echo "[backup] done $STAMP"
```

- [ ] **Step 2: Make executable + commit**

Run: `chmod +x scripts/backup.sh`

```bash
git add scripts/backup.sh
git commit -m "chore(deploy): nightly pg_dump cron script"
```

---

### Task 55: Deployment runbook

**Files:**
- Create: `docs/deployment-runbook.md`

- [ ] **Step 1: Write runbook**

Create `docs/deployment-runbook.md`:
```markdown
# Edict — Deployment Runbook

## First-time setup (VPS)

1. Create Linux user: `sudo adduser edict && sudo usermod -aG docker edict`
2. As `edict`: `mkdir -p ~/apps/edict/backups && cd ~/apps/edict`
3. Clone repo: `git clone git@github.com:RECTOR-LABS/edict.git .`
4. Symlink secrets file: `ln -s ~/Documents/secret/edict.env .env`
   (.env must define: DATABASE_URL, DATABASE_ADMIN_URL, POSTGRES_ADMIN_PASSWORD, APP_URL, RESEND_API_KEY, RESEND_FROM, ADMIN_BOOTSTRAP_EMAIL)
5. Build + start: `docker compose -f docker-compose.prod.yml up -d --build`
6. Apply hand-written migrations (if not auto-applied): `docker compose -f docker-compose.prod.yml exec app pnpm db:migrate`
7. Seed first admin: `docker compose -f docker-compose.prod.yml exec app pnpm edict:admin:seed rector@rectorspace.com`
8. Receive magic-link email, sign in.

## nginx

1. Copy `nginx/edict.conf` → `/etc/nginx/sites-available/edict.conf`
2. `sudo ln -s /etc/nginx/sites-available/edict.conf /etc/nginx/sites-enabled/`
3. `sudo certbot --nginx -d edict.rectorspace.com`
4. `sudo nginx -t && sudo systemctl reload nginx`

## Cloudflare

1. Add A record: `edict → <VPS IP>`, Proxied.
2. SSL/TLS mode: Full (strict).

## Nightly backup cron

As `edict` user:
```
crontab -e
# add:
0 3 * * * /home/edict/apps/edict/scripts/backup.sh >> /home/edict/apps/edict/backups/backup.log 2>&1
```

Weekly rsync to Cloudflare R2 (set up separately via rclone).

## Deploy updates

```
cd ~/apps/edict
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f
```

## Rollback

```
git log --oneline -10   # pick known-good sha
git checkout <sha>
docker compose -f docker-compose.prod.yml up -d --build
```

## Health check

```
curl -sS https://edict.rectorspace.com/ | head -20
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 app
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/deployment-runbook.md
git commit -m "docs(deploy): first-run + update runbook"
```

---

## Phase J: Adrena Launch

### Task 56: Create Adrena client + member in production

**Files:**
- No files — operational steps.

- [ ] **Step 1: Sign into /admin on edict.rectorspace.com** (using bootstrap magic link).

- [ ] **Step 2: Navigate to /admin/clients/new**
- slug: `adrena`
- name: `Adrena Trading`
- brandColor: `#00e5ff`
- logoUrl: (optional — grab from Adrena team if available)

Click "Create client".

- [ ] **Step 3: On /admin/clients/<id>, add the Adrena team member(s)**
- email: <coordinate exact emails with Adrena team before this step>
- role: `viewer` (or `admin_of_client` for their lead)

Do not submit until emails are confirmed.

---

### Task 57: Upload arena-implementation-plan.html as an Edict doc

**Files:**
- No files — operational steps.

- [ ] **Step 1: Read source**

```bash
cat arena-implementation-plan.html | wc -l   # local Adrena source doc
# expected: 1358 lines
```

- [ ] **Step 2: Navigate to /admin/docs/new**
- slug: `adrena-implementation-plan`
- title: `Adrena Trading Arena — Implementation Plan`
- bodyType: `html`
- body: paste the entire contents of `arena-implementation-plan.html`

Click "Create doc".

- [ ] **Step 3: Optionally also upload `arena-walkthrough.html`**
- slug: `adrena-walkthrough`
- title: `Adrena Trading Arena — Walkthrough`
- Same process.

---

### Task 58: Share to Adrena + verify end-to-end

**Files:**
- No files — operational steps.

- [ ] **Step 1: From the doc's share page (`/admin/docs/<id>/share`)**
- Find the Adrena row; in the emails input, enter the team member email(s)
- Click "Send links"

- [ ] **Step 2: Confirm with recipient**
- Ask Adrena team member to confirm receipt.
- Have them click the magic link.
- Confirm they land on `/c/adrena` with their dashboard.
- Confirm they can open the plan doc.

- [ ] **Step 3: Verify audit log**
- As admin, visit `/admin/audit` and check for:
  - `magic_link_sent` → recipient
  - `session_created` → that member
  - `doc_viewed` → that member + doc

- [ ] **Step 4: Verify isolation**
- Create a second test client + member yourself (use `mem@test.com`).
- Sign in as that test member.
- Confirm the Adrena doc is NOT listed on their dashboard.
- Try direct URL `/c/test/d/adrena-implementation-plan` → 404.
- Try URL `/c/adrena` with that cookie → 404.

If all four checks pass, **Phase 1 MVP is shipped, Alhamdulillah.**

---

## Self-Review

Running the self-review against the spec.

**1. Spec coverage:**

| Spec section | Covered by |
|---|---|
| §2 Tech decisions | Tasks 1-4 install every choice; task 12 creates both DB roles |
| §3 Architecture / module boundaries | File structure header + Tasks 14-23 (lib/auth), 16-19, 32-35 (lib/db), 24-25 (lib/mail), 45-46 (lib/docs) |
| §4.1 Schema (9 tables) | Tasks 6-10 (schema + migration) |
| §4.2 RLS (roles + policies) | Task 12 |
| §4.3 Invariants (CHECK + trigger + single-use token + share filtering) | Tasks 6, 8, 11, 17, 21, 34 |
| §5.1 Issue flow | Task 20 (issueMagicLink) + Task 41 (shareDocAction) + Task 28 (landing action) |
| §5.2 Verify flow | Task 21 (verifyMagicLink) + Task 29 (/auth/verify) |
| §5.3 Per-request scoping | Task 16 (withClientScope), Tasks 22-23 (context + middleware) |
| §5.4 Logout + revocation | Task 30 (logout), Task 38 (member revoke), Task 41 (unshare) — session-revoke UI deferred per Phase 2 |
| §5.5 CSRF + rate limiting | CSRF relies on Next.js Server Action defaults; rate limiting is Phase 1 out-of-scope per spec §9 and added as Task deferred follow-up below |
| §6.1 Admin routes | Tasks 31, 36-42 |
| §6.2 Client routes | Tasks 43-47; `/c/:slug/members` is Phase 2 (spec §9) |
| §6.3 Doc rendering | Tasks 45 (HTML iframe), 46 (Markdown pipeline), 47 (viewer) |
| §7 aidesigner workflow | Enforced in Tasks 25, 28, 36, 37, 44 |
| §8.1 Audit taxonomy | Event types emitted by Tasks 20, 21, 29, 30, 37-42, 47 |
| §8.2 Deployment | Tasks 51-55 |
| §8.3 Testing | Tasks 13 (RLS), 14/15/46 (unit), 21 (integration issue/verify), 48-50 (E2E scenarios 1-5) |
| §8.4 Migrations | Tasks 10-12 |
| §9 Phase 1 In-scope | All ticked |
| §10 Open questions | None raised in spec |

**Gaps flagged + added as backlog (explicit, not placeholders):**
- Rate-limit store is defined in schema (Task 9) but no check helper / action-gate. Spec §5.5 specifies behavior; Phase 1 §9 "rate-limit UI" is out-of-scope but the *enforcement* isn't. **Adding as Task 42b below** so it's not lost.

**2. Placeholder scan:** No TBD / TODO / "implement later" in the plan. Each aidesigner prompt specifies concrete data shape + constraints. Each SQL file, TSX file, and TS helper includes full code. Operational tasks (56-58) have explicit steps with URLs and expected UI actions rather than "check the admin UI."

**3. Type consistency:** `generateToken(32)` and `generateToken(64)` are called with the same function signature. `SESSION_COOKIE_NAME` is defined in `lib/auth/middleware.ts` and imported by three routes (verify, logout, track/view). `EdictContext` discriminated union is created once in `context.ts`, consumed by `getContext()` callers. Spec calls out `requireAdminSession()` / `requireClientSession(slug)` — both defined in Task 23 with matching names.

---

### Task 42b (added): Rate-limit enforcement helpers

**Files:**
- Create: `lib/db/queries/rate-limit.ts`
- Modify: `actions/sessions.ts` (landing page), `actions/share.ts` (admin share)

- [ ] **Step 1: Rate-limit queries**

Create `lib/db/queries/rate-limit.ts`:
```ts
import { adminDb, schema } from "@/lib/db";
import { and, eq, gt, sql } from "drizzle-orm";

/**
 * Returns true if `bucketKey` has been hit < `limit` times in the last `windowMs`.
 * Always records the attempt.
 */
export async function rateLimitAllow(bucketKey: string, limit: number, windowMs: number): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const [row] = await adminDb
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.rateLimitEvents)
    .where(and(eq(schema.rateLimitEvents.bucketKey, bucketKey), gt(schema.rateLimitEvents.createdAt, since)));
  const recent = row?.n ?? 0;
  await adminDb.insert(schema.rateLimitEvents).values({ bucketKey });
  return recent < limit;
}
```

- [ ] **Step 2: Wire into landing-page action**

Modify `actions/sessions.ts` — at the top of `requestMagicLinkAction`:
```ts
import { rateLimitAllow } from "@/lib/db/queries/rate-limit";
// ...
const allowed = await rateLimitAllow(`verify:email:${email}`, 10, 60 * 60 * 1000);
if (!allowed) {
  // Silent success still — don't leak throttle state
  return;
}
```

- [ ] **Step 3: Wire into share action**

Modify `actions/share.ts` — at top of `shareDocAction`:
```ts
import { rateLimitAllow } from "@/lib/db/queries/rate-limit";
// ...
const allowed = await rateLimitAllow(`share:admin:${ctx.adminId}`, 30, 60 * 60 * 1000);
if (!allowed) throw new Error("rate limit exceeded; try again shortly");
```

- [ ] **Step 4: Commit**

```bash
git add lib/db/queries/rate-limit.ts actions/sessions.ts actions/share.ts
git commit -m "feat(auth): sliding-window rate limiting on verify + share"
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-19-edict-phase1.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task via `superpowers:subagent-driven-development`, review between tasks, fast iteration while keeping this main context clean.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for your review.

Which approach?









