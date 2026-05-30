# Edict — Design Spec

> **Historical artifact (April 2026).** This records the Phase 1 design decisions as they stood at the time, including a self-hosted Postgres-on-VPS deployment. The stack later migrated to **Vercel + Neon Postgres** (2026-05-30). Kept as a decision record — see `CLAUDE.md` and `docs/deployment-runbook.md` for the current architecture.

**Date:** 2026-04-19
**Status:** Approved for implementation planning
**Scope:** Phase 1 MVP — deliver the Adrena Trading Arena implementation plan to the Adrena team via Edict by end of month.

---

## 1. Executive Summary

Edict is a multi-tenant client docs delivery platform. Clients receive emailed magic-links to branded dashboards showing only the edicts (docs) issued to them. Admin panel lets RECTOR manage clients, share docs, and track engagement.

**Core invariant:** tenant isolation is sacred. Every DB query scoped by `client_id` at the application layer *and* enforced at the database layer via Postgres Row-Level Security. A single cross-tenant data leak is a project-ending bug.

**Phase 1 target:** host `arena-implementation-plan.html` at an Edict URL for the Adrena team, replacing raw file-attachment delivery. Same infrastructure will serve every future RECTOR LABS engagement.

---

## 2. Technical Decisions

| Decision | Choice | Why |
|---|---|---|
| Stack | Next.js 16 App Router, TypeScript strict | Server Components for per-tenant branded layouts, Server Actions for mutations, fastest MVP for a docs-viewer + admin shape |
| Tenant routing | Path: `edict.rectorspace.com/c/<slug>` | Single hostname, single cert, simpler middleware, fewer seams than subdomain; branding lives in page chrome |
| DB | Self-hosted Postgres 16 on the same VPS | Full control, RLS audit-friendly, `pg_dump` for engagement archives, fits existing VPS ops discipline |
| Email | Resend + `react-email` templates | Tiny volume, free tier, clean DX, swappable if deliverability bites |
| Auth | Custom magic-link using `oslo` primitives | ~150 LOC, fully auditable, explicit admin vs client session types, no framework opinions to fight for multi-tenant scoping |
| ORM | `drizzle-orm` | SQL-close, type-safe, no hidden magic around explicit `client_id` scoping |
| UI generation | `aidesigner` MCP for every visual surface | Production-grade design quality from day one; code-first stays for logic/state/data |
| Deployment | VPS (shared) via Docker Compose behind nginx + Cloudflare | Consistent with existing infra (per `/vps-deploy` patterns); 1 project = 1 Linux user = 1 compose project |

---

## 3. Architecture

```
        Cloudflare (DNS + proxy, full-strict SSL)
                │
                ▼
        nginx on VPS :443
                │
                ▼
        Next.js (node server 127.0.0.1:3000)
                │
                ├──► Postgres (127.0.0.1:5432, localhost-bind only)
                └──► Resend API (outbound HTTPS)
```

**Module boundaries (each unit has one purpose, clear interface, testable in isolation):**

- **`@edict/auth`** — magic-link issue/verify, session cookie handling, middleware helpers. Pure auth primitives, no business logic.
- **`@edict/db`** — Drizzle schema, migrations, query helpers. Every exported query function takes `clientId` as its first argument. No "unscoped" query helpers in the public surface.
- **`@edict/docs`** — doc storage helpers + render pipelines (HTML passthrough for iframe, Markdown → HTML via unified/remark/rehype). Pure functions, unit-testable.
- **`@edict/mail`** — Resend wrapper and `react-email` templates. Single `sendMail(kind, to, props)` surface.
- **`app/(client)/c/[slug]/...`** — client dashboard routes. All guarded by `requireClientSession(slug)` in the layout.
- **`app/(admin)/admin/...`** — admin routes. Guarded by `requireAdminSession()` in the layout.

**Session context propagation:** `AsyncLocalStorage` stores the resolved session for the request. Downstream Server Components and Server Actions read it via `getSession()`; there is no prop-drilling and no global mutable state.

---

## 4. Data Model

### 4.1 Schema

```sql
-- Tenants
clients (
  id uuid PRIMARY KEY,
  slug text UNIQUE NOT NULL,           -- "adrena"
  name text NOT NULL,                  -- "Adrena Trading"
  brand_color text,                    -- hex for accent
  logo_url text,
  created_at timestamptz DEFAULT now()
)

-- Users within a tenant
client_members (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text,
  role text NOT NULL CHECK (role IN ('viewer','admin_of_client')),
  revoked_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(client_id, email)              -- same email allowed across tenants
)

-- Platform admins (RECTOR + future)
admins (
  id uuid PRIMARY KEY,
  email text UNIQUE NOT NULL,
  name text,
  created_at timestamptz DEFAULT now()
)

-- The edicts themselves (authored by admins)
docs (
  id uuid PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  body_type text NOT NULL CHECK (body_type IN ('html','markdown')),
  body text NOT NULL,
  created_by uuid NOT NULL REFERENCES admins(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)

-- Many-to-many: which tenants see which docs
doc_shares (
  id uuid PRIMARY KEY,
  doc_id uuid NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  shared_at timestamptz DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(doc_id, client_id)
)

-- Pending magic-link tokens; raw token only lives in the email
magic_link_tokens (
  id uuid PRIMARY KEY,
  token_hash text UNIQUE NOT NULL,     -- SHA-256(raw)
  subject_type text NOT NULL CHECK (subject_type IN ('client_member','admin')),
  subject_id uuid NOT NULL,
  email text NOT NULL,
  client_id uuid REFERENCES clients(id),  -- null for admin tokens
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz DEFAULT now()
)

-- Active sessions; raw token lives in cookie
sessions (
  id uuid PRIMARY KEY,
  session_token_hash text UNIQUE NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('client_member','admin')),
  subject_id uuid NOT NULL,
  client_id uuid REFERENCES clients(id),  -- null for admin
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip inet,
  user_agent text,
  last_seen_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  CHECK (
    (subject_type = 'admin' AND client_id IS NULL) OR
    (subject_type = 'client_member' AND client_id IS NOT NULL)
  )
)

-- All auth events, views, admin actions
audit_log (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('client_member','admin','system')),
  actor_id uuid,
  client_id uuid REFERENCES clients(id),  -- affected tenant for filtering
  doc_id uuid REFERENCES docs(id),
  ip inet,
  user_agent text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
)

-- Sliding-window rate limit store (see §5.5)
rate_limit_events (
  id bigserial PRIMARY KEY,
  bucket_key text NOT NULL,             -- e.g. "verify:email:alice@adrena.xyz"
  created_at timestamptz DEFAULT now()
)
```

**Indexes:**
- `client_members (client_id)` (already implied by FK)
- `doc_shares (client_id, revoked_at)` — the core client-dashboard query
- `sessions (session_token_hash)` (UNIQUE already)
- `sessions (subject_id, revoked_at)` — session lookup for logout/revoke
- `magic_link_tokens (token_hash)` (UNIQUE already)
- `magic_link_tokens (expires_at)` — cleanup cron target
- `audit_log (client_id, created_at DESC)`
- `audit_log (event_type, doc_id, created_at)` — analytics
- `audit_log (actor_id, created_at DESC)`
- `rate_limit_events (bucket_key, created_at DESC)`

### 4.2 Row-Level Security

Two database roles:

- **`edict_app`** — default application role; RLS policies apply.
- **`edict_admin`** — used only by admin-session request handlers; `BYPASSRLS` attribute.

RLS enabled on: `client_members`, `doc_shares`, `audit_log`. Policy pattern:

```sql
ALTER TABLE client_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON client_members
  USING (client_id = nullif(current_setting('edict.client_id', true), '')::uuid);
```

`nullif(..., '')` handles the case where the GUC is unset (empty string default). An unset context → the comparison is against `NULL` → no rows returned. Per-request middleware executes `SET LOCAL edict.client_id = :id` after resolving the client session, before any application query runs. A query missing the WHERE clause returns zero rows — the DB refuses before app bugs can leak.

### 4.3 Security Invariants (enforced by constraints + tests)

- Raw tokens never in DB (only SHA-256 hashes).
- `sessions.subject_type='admin' ⇒ client_id IS NULL` (CHECK constraint).
- `sessions.subject_type='client_member' ⇒ client_id = client_member.client_id` (trigger).
- Magic-link tokens are single-use: `consumed_at` set atomically with session creation inside one transaction.
- `doc_shares.revoked_at IS NOT NULL` filtered in every client-visible query.
- No public `INSERT`/`UPDATE`/`DELETE` helper that takes no `client_id` — type system enforces the signature.

---

## 5. Auth & Request Flow

### 5.1 Issue magic link (admin shares doc)

```
Server Action: shareDoc(docId, clientId, memberEmails[])

for each email:
  1. UPSERT client_members (client_id, email)
  2. token = oslo.generateRandomString(32 bytes, alphanumeric)
  3. INSERT magic_link_tokens {
       token_hash: sha256(token),
       subject_type: 'client_member',
       subject_id: member.id,
       email,
       client_id,
       expires_at: now + 24h
     }
  4. UPSERT doc_shares (doc_id, client_id) — resets revoked_at to NULL on conflict
  5. Resend.send(magic-link email → /auth/verify?token=<raw>)
  6. audit_log: 'magic_link_sent' { doc_id, recipient_email, ttl_hours }
```

Admin bootstrap uses the same mechanics with `subject_type='admin'`, triggered by CLI: `pnpm edict:admin:invite <email>`. No self-signup UI in the app.

**First-admin seed:** if the `admins` table is empty, `pnpm edict:admin:seed` inserts the record for `ADMIN_BOOTSTRAP_EMAIL` (no auth required — the table being empty is the auth) and issues the first magic-link. Subsequent admin invites require an authenticated admin session and go through `/admin/admins` (Phase 2 UI) or direct SQL in Phase 1.

### 5.2 Verify & establish session (client clicks link)

```
GET /auth/verify?token=<raw>

BEGIN TRANSACTION
  1. hash = sha256(token)
  2. SELECT magic_link_tokens
     WHERE token_hash=hash AND consumed_at IS NULL AND expires_at > now()
  3. if miss → render generic "link invalid or expired" + audit 'magic_link_failed'
  4. UPDATE magic_link_tokens SET consumed_at = now()
  5. session_token = oslo.generateRandomString(64 bytes)
  6. INSERT sessions {
       session_token_hash: sha256(session_token),
       subject_type, subject_id, client_id,
       expires_at: now + 30d,
       ip, user_agent
     }
  7. audit_log: 'session_created'
COMMIT

Set-Cookie: edict_session=<raw>;
            HttpOnly; Secure; SameSite=Lax; Max-Age=2592000; Path=/

302 →  subject_type='admin'  → /admin
       subject_type='client' → /c/<slug>
```

`SameSite=Lax` is the correct choice: magic-links arrive via external GET, Lax attaches the cookie on that navigation; Strict would break the flow.

### 5.3 Per-request session resolution

Next.js 16 layouts run server-side; the root of each protected route group resolves the session once per request:

```typescript
// app/(admin)/layout.tsx
await requireAdminSession();

// app/(client)/c/[slug]/layout.tsx
await requireClientSession(params.slug);
```

`requireClientSession(slug)` does:
1. Read `edict_session` cookie; if missing → redirect `/`.
2. `SELECT session WHERE token_hash=? AND revoked_at IS NULL AND expires_at > now()`.
3. Verify `session.subject_type = 'client_member'` AND the slug matches `session.client_id` (prevents using one tenant's cookie on another tenant's URL).
4. Choose DB connection pool by session type (`edict_app` for clients, `edict_admin` for admins).
5. For client sessions, inside a transaction: `SET LOCAL edict.client_id = :id` — downstream queries run RLS-scoped.
6. Store session in `AsyncLocalStorage`.
7. `audit_log: 'session_touched'` (throttled to 1/hour/session to avoid log bloat).

### 5.4 Logout + revocation

- **Logout:** `POST /auth/logout` → `UPDATE sessions SET revoked_at=now()` + clear cookie + audit.
- **Admin kick:** `UPDATE sessions SET revoked_at=now() WHERE id=:id` from admin UI.
- **Member revocation:** `UPDATE client_members SET revoked_at=now()` + invalidate all their sessions in one transaction.
- **Share revocation:** `UPDATE doc_shares SET revoked_at=now()` → doc vanishes from client's list immediately.

### 5.5 CSRF & rate limiting

- **CSRF:** Next.js 16 Server Actions include origin-check + action-id tokens by default. We rely on that; no custom CSRF layer.
- **Rate limiting:** small Postgres table `rate_limit_events (id, bucket_key text, created_at timestamptz)` with index on `(bucket_key, created_at)`. Sliding-window counts by `bucket_key` (e.g. `verify:email:alice@adrena.xyz` or `share:admin:<admin_id>`). Caps `/auth/verify` at 10/hour/email, `shareDoc` at 30/hour/admin, landing-page send at 5/hour/email+IP. Stops ops mistakes and link-spam; token brute-force is already infeasible (2^256 space). Row cleanup via weekly cron (`DELETE WHERE created_at < now() - interval '14 days'`).

---

## 6. Surfaces

### 6.1 Admin (`/admin`, admin session required)

| Route | Purpose |
|---|---|
| `/admin` | Dashboard — active clients, recent shares, recent views |
| `/admin/clients` | List + create client (slug, name, brand color, logo) |
| `/admin/clients/:id` | Edit; members list + add/revoke; active sessions list |
| `/admin/docs` | All docs |
| `/admin/docs/new` | Create — HTML upload (file/paste) or Markdown editor |
| `/admin/docs/:id` | Edit body + metadata; delete |
| `/admin/docs/:id/share` | Pick target client(s); select members; "Send" fires magic-link flow |
| `/admin/docs/:id/analytics` | Views, unique viewers, avg time, by-member breakdown |
| `/admin/audit` | Filterable log (actor, event_type, client, date range) |

### 6.2 Client (`/c/:slug`, client session required)

| Route | Purpose |
|---|---|
| `/` | Landing — email input, "Send me my magic link" |
| `/auth/verify` | Token consumption + session creation |
| `/c/:slug` | Branded dashboard — logo/name, doc list, last-viewed |
| `/c/:slug/d/:docSlug` | Doc viewer (see 6.3) |
| `/c/:slug/members` | Visible only when `role='admin_of_client'` — invite teammate; active sessions |
| `/auth/logout` | Revoke session, clear cookie, redirect `/` |

**Landing-page enumeration defense:** email lookup returns silent success regardless of whether the email is registered. Real registered emails get mail; unknown emails get nothing but also no error.

**Branding:** `clients.brand_color` + `logo_url` applied via CSS variables on the client layout root. No per-tenant stylesheet files; Tailwind + var-based theming handles it.

### 6.3 Doc rendering

**HTML docs** (like `arena-implementation-plan.html`):
- Stored as full-document HTML including `<style>` and `<script>`.
- Rendered in a sandboxed iframe: `<iframe sandbox="allow-scripts" srcdoc={body} />`.
- Sandbox deliberately omits `allow-same-origin` → iframe cannot touch parent cookies/storage even if hostile. Full CSS isolation, XSS containment.
- Admin authored; admin is trusted to include only known-good HTML. The iframe is defense-in-depth.

**Markdown docs:**
- Pipeline: `unified → remark-parse → remark-gfm → rehype-sanitize → rehype-stringify`.
- Output rendered inline in the dashboard layout with a prose stylesheet.
- Sanitizer passes the default safe allowlist.

**View tracking:**
- Beacon on doc open: `POST /api/track/view { docId }` → `audit_log: 'doc_viewed'`.
- `navigator.sendBeacon` on `visibilitychange` (tab hide) + `beforeunload` → sends `{ duration_ms, scroll_depth }`.
- Analytics view queries `audit_log` on demand; no separate stats table. Indexes on `(event_type, doc_id, created_at)` keep it fast.

---

## 7. UI Workflow (aidesigner-first)

**Every visual surface** in Edict — admin dashboard, client dashboard, doc viewer chrome, email templates, landing, error/empty states — is generated by the `aidesigner` MCP tool (`generate_design` / `refine_design`) before being ported into Next.js components.

**Process per surface:**
1. Prompt `aidesigner` with: purpose, data shape, brand constraints (Lucide icons only, no emoji icons, dev-humble copy, dark-mode aware, tenant brand color applied via CSS var).
2. Review generated HTML/CSS locally (preview stays in-repo).
3. Iterate via `refine_design` for typography, density, hierarchy adjustments.
4. Port into Next.js: convert to Tailwind + TSX, extract reusable primitives, wire live data.
5. Archive the original aidesigner prompt + iteration history in `docs/ui/<surface>.md` so future regenerations start from captured intent.

**What stays code-first, not aidesigner-generated:** component logic, state, data fetching, form handling, server actions, auth, DB queries — anything non-visual.

**Email templates** (magic-link, doc-shared) are seeded by aidesigner output, then adopted into `react-email` React components so they compile into deliverable HTML at send time.

---

## 8. Ops

### 8.1 Audit event taxonomy

| event_type | actor | metadata shape |
|---|---|---|
| `magic_link_sent` | admin | `{ doc_id, recipient_email, ttl_hours }` |
| `magic_link_failed` | system | `{ token_hash_prefix, reason }` |
| `session_created` | client_member / admin | `{ session_id, ip, ua }` |
| `session_touched` | session subject (1/hr throttle) | `{ path }` |
| `session_revoked` | actor | `{ session_id, reason }` |
| `doc_viewed` | client_member | `{ doc_id, duration_ms?, scroll_depth? }` |
| `doc_shared` | admin | `{ doc_id, client_id, new_members[] }` |
| `doc_unshared` | admin | `{ doc_id, client_id }` |
| `admin_action` | admin | `{ target_type, target_id, before, after }` |

Retention: indefinite in Phase 1. Partition by month if volume demands it later.

### 8.2 Deployment

```
~/apps/edict/                         (owned by `edict` Linux user)
├── docker-compose.yml                (name: edict)
├── .env                              (symlink → <secret-store>/edict.env)
└── backups/                          (nightly pg_dump destination)

Compose services:
  edict-app: next.js node server, bound 127.0.0.1:3000
  edict-db:  postgres 16, bound 127.0.0.1:5432 ONLY

Host-level nginx (shared):
  server_name edict.rectorspace.com;
  location / { proxy_pass http://127.0.0.1:3000; }

Cron (edict user):
  0 3 * * *  pg_dump edict | gzip > ~/apps/edict/backups/$(date +\%F).sql.gz
  Weekly rsync to off-VPS storage (e.g., Cloudflare R2).

Cleanup after deploy (per global standard):
  docker image prune -f
```

Cloudflare: proxied A record `edict → VPS IP`, full-strict SSL. No wildcard (path routing).

**Env vars** (from `<secret-store>/edict.env`; never committed):

| Var | Purpose |
|---|---|
| `DATABASE_URL` | `postgres://edict_app:...@127.0.0.1/edict` |
| `DATABASE_ADMIN_URL` | Same DB, `edict_admin` role (BYPASSRLS) |
| `RESEND_API_KEY` | Outbound mail |
| `APP_URL` | `https://edict.rectorspace.com` |
| `ADMIN_BOOTSTRAP_EMAIL` | First-admin email for `edict:admin:invite` default |
| `SESSION_COOKIE_NAME` | `edict_session` (constant; kept configurable for tests) |

### 8.3 Testing strategy

- **Unit (Vitest, 80%+ coverage on new code):** `@edict/auth` primitives, `@edict/docs` renderers, query helpers, audit log writers, React Email components.
- **Integration (Vitest + real Postgres via testcontainers):** RLS policy proofs. A connection with `SET LOCAL edict.client_id='A'` literally cannot `SELECT` from `client_members` where `client_id='B'`. Automated evidence that RLS is wired right.
- **E2E (Playwright):** the load-bearing test suite. Minimum five scenarios:
  1. Client-A member sees doc-1, not doc-2.
  2. Client-A member cannot reach `/c/B/d/doc-2` by URL manipulation → 404.
  3. Client-A session cookie in a request to `/c/B` → rejected (session/slug mismatch).
  4. Revoked member cannot use old magic-link → `magic_link_failed`.
  5. Revoked session → next request bounces to `/`.
- **Manual verification before each deploy:** end-to-end on staging — create test client, upload test doc, email self, click link, view.

### 8.4 Migrations & DB roles

- `drizzle-kit migrate` runs on container start (post-boot, pre-accept-traffic).
- Initial migration creates both roles, both GRANTs, RLS policies, and indexes.
- Migration script for RLS policies lives in `migrations/0002_enable_rls.sql` — reviewed by hand, not generated.

---

## 9. Phase 1 Scope

**In scope** (ship by end of month; ~1–2 weeks part-time):

- Schema + RLS (full, not retrofit)
- Magic-link flow (issue, verify, session, logout)
- Admin CRUD: clients, members, docs
- Share doc → email → client view
- HTML iframe renderer
- Basic audit log (capture all events; no UI yet)
- Nightly `pg_dump` + off-VPS copy
- 5-scenario E2E tenant isolation test suite
- Docker Compose + nginx + Cloudflare proxy
- aidesigner flow for each UI surface shipped
- Host `arena-implementation-plan.html` on Edict as first real doc

**Out of scope** (Phase 2+, each gets its own plan):

- Markdown editor UI (Phase 1 uses HTML for Adrena)
- Analytics UI (Phase 1 captures data; dashboard comes later)
- Audit log UI (psql access in Phase 1)
- `admin_of_client` self-invite UI
- Rate-limit admin panel (behavior in place, no UI)
- Session-revoke UI (SQL-only in Phase 1)
- Doc versioning / drafts
- Markdown editor with live preview
- Per-doc access expiry (time-bounded shares)
- Sliding session renewal (Phase 1 uses fixed 30-day sessions; expired → re-request magic-link)

---

## 10. Open Questions

None at spec-write time. If any emerge during planning or implementation, they get added here.

---

## 11. References

- The Adrena implementation-plan + walkthrough HTML docs (kept locally) — first docs Edict will host; design-language reference.
- An earlier single-shared-credential auth middleware in a separate private service — the precedent Edict evolves from.
- `docs/starter-prompt.md` — original kickoff prompt that seeded this spec.
- `~/.claude/projects/-Users-rector-local-dev-edict/memory/feedback_ui_workflow.md` — aidesigner workflow memory.
