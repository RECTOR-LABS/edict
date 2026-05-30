# Edict — Deployment Runbook

Production deployment procedure for `edict.rectorspace.com`. Edict runs on **Vercel** (native Git) with **Neon Postgres**, behind a **Cloudflare** proxy on Full (Strict) TLS.

> Migrated off the self-hosted VPS/Docker stack on 2026-05-30. For the historical VPS procedure, see the git history of this file before that date.

---

## Architecture

```
Internet → Cloudflare (Proxied, Full-strict TLS)
        → Vercel (Next.js on Fluid Compute; static assets on the edge)
        → Neon Postgres (serverless driver over WebSocket)
```

- **App:** Next.js 16 (App Router). Admin + auth writes go through Route Handlers under `app/api/**`.
- **DB:** Neon Postgres. `lib/db` picks its driver by host — `@neondatabase/serverless` for `*.neon.tech`, `node-postgres` for local/CI.
- **Tenant isolation:** application-level `client_id` scoping *plus* Postgres Row-Level Security (`withClientScope`).
- **Email:** Resend + `react-email` templates.

---

## Deploy model

Vercel is connected to `RECTOR-LABS/edict` via native Git:

- **Push to `main` → production deploy** at `edict.rectorspace.com`.
- **Open a PR → preview deploy** at a unique `*.vercel.app` URL (with a comment on the PR).

There is no manual deploy step in the normal flow. Merging a PR to `main` is the deploy.

```bash
# Typical change flow
git switch -c feat/my-change
# ...edit, commit...
git push -u origin feat/my-change      # → preview deploy
gh pr create                            # CI runs; review the preview
gh pr merge --merge --delete-branch     # merge → production deploy
```

Watch a deploy:

```bash
vercel ls                # recent deployments + state
vercel inspect <url>     # detail for one deployment
vercel logs <url>        # runtime logs
```

---

## Environment variables

Production values live in the **Vercel project env** (Settings → Environment Variables), never in git. `.env.example` is the local-dev template only.

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (per-tenant RLS role). Use the `-pooler` host for serverless. |
| `DATABASE_ADMIN_URL` | Neon connection string for the admin role (migrations + runtime admin queries + audit writes). See *Database roles & migrations* below. |
| `APP_URL` | `https://edict.rectorspace.com`. Magic-link origin used in email templates **and** as the post-verify redirect origin behind the proxy. Set as a `plain` value. |
| `SESSION_COOKIE_NAME` | `edict_session` (default). |
| `RESEND_API_KEY` | Production Resend key scoped to `rectorspace.com`. |
| `RESEND_FROM` | `edict@rectorspace.com` (verified sender). |
| `ADMIN_BOOTSTRAP_EMAIL` | First admin to seed on an empty DB. |

**Do NOT set** `DEV_PRINT_MAGIC_LINKS=true` in production — it prints tokens to stdout. It's a local-dev convenience only.

Pull production env locally when you need to reproduce an issue:

```bash
vercel env pull .env.production.local   # gitignored
```

---

## Database roles & migrations

Two roles, both provisioned on Neon:

- **`edict_app`** — RLS-enforced; used for all per-tenant queries.
- **`edict_admin`** — elevated; used for migrations and admin/audit writes.

Migrations are Drizzle SQL files under `migrations/`. They are **not** auto-run on deploy (Vercel builds are stateless). Apply them explicitly against Neon from a trusted shell when a release includes schema changes:

```bash
# DATABASE_ADMIN_URL must point at Neon (pull it from Vercel or your secret store)
DATABASE_URL="$DATABASE_ADMIN_URL" pnpm db:migrate
```

Verify the applied set:

```bash
psql "$DATABASE_ADMIN_URL" -c "SELECT id FROM drizzle_migrations ORDER BY id DESC LIMIT 5;"
```

> **`edict_admin_role` / BYPASSRLS history.** `migrations/0002_rls.sql` originally created a narrower BYPASSRLS role that the VPS bootstrap couldn't self-provision (a chicken-and-egg on `CREATE ROLE`). Migration `0003` drops BYPASSRLS from it for Neon compatibility. The runtime admin identity is `edict_admin` via `DATABASE_ADMIN_URL`.

---

## First-time / new-environment setup

1. **Neon:** create the project + database; create the `edict_app` and `edict_admin` roles; capture both connection strings (pooled host for `DATABASE_URL`).
2. **Vercel:** import `RECTOR-LABS/edict`; set the env vars above for Production (and Preview if previews should hit a branch DB); confirm `productionBranch = main`.
3. **Migrate:** run `pnpm db:migrate` against the new Neon DB (see above).
4. **Seed the first admin:**
   ```bash
   DATABASE_URL="$DATABASE_ADMIN_URL" pnpm edict:admin:seed rector@rectorspace.com
   ```
   This writes the first `admins` row and emails a magic-link. Open it, land at `/admin`.
5. **Domain + DNS:** see below.

---

## Domain & DNS (Cloudflare)

`edict.rectorspace.com` is a **proxied CNAME → `cname.vercel-dns.com`** on RECTOR's personal Cloudflare account, zone on **Full (Strict)** with `always_use_https` on.

> **Cert-bootstrap gotcha (Full-strict).** Vercel needs a valid cert *before* you can proxy (orange). Proxying first returns **526**. The sequence that works: detach the domain from the Vercel project → flip the CNAME to **grey** (DNS-only) → wait for DNS to propagate → re-attach the domain (Vercel issues the cert on the clean first attempt, ~40s) → flip the CNAME back to **orange** (proxied). Let's Encrypt rate-limits failed validations at 5/hour/hostname, so don't repeatedly flip — wait it out if a flip fails.

---

## Rollback

**Preferred — Vercel:** instantly re-promote a previous good deployment.

```bash
vercel ls                                  # find the last-good production deployment
vercel promote <deployment-url>            # promote it to production
# or use the Vercel dashboard → Deployments → ⋯ → Promote to Production
```

A revert PR to `main` also works and is the most auditable, but promotion is faster during an incident.

**Last-resort — DNS to the VPS fallback:** while the old VPS is still alive (until decommission, ~mid-June 2026), production can be pointed back at it with an atomic Cloudflare DNS change (delete the Vercel CNAME, recreate the `edict` A record → VPS IP, proxied). **Caveat:** the VPS database froze at cutover — Neon has been authoritative since, so this loses all writes since 2026-05-30. Treat it as a break-glass for a total Vercel/Neon outage, not a routine rollback. The durable safety net is the archived DB dump + Neon's own backups. See `CLAUDE.md` for the decommission plan.

---

## Two-step magic-link verify

Magic-link sign-ins use a two-step flow to defeat email-scanner pre-fetching.

**Flow:**
1. User clicks the link in email → lands at `GET /auth/verify?token=X`.
2. The page renders a "Continue signing in" form. **No DB work happens here.**
3. User clicks Continue → browser POSTs the token to the same route.
4. `POST /auth/verify` consumes the token (atomic `UPDATE … WHERE consumed_at IS NULL`), sets the 30-day session cookie, and redirects to `/admin` (admins) or `/c/<slug>` (client members).

**Why:** Proton, Outlook ATP, Google Safe Browsing, and corporate gateways pre-fetch links via GET to scan them. Without the split, that pre-fetch burns the single-use token before the human clicks. The split keeps GET inert (scanner-safe) while POST stays the real consumption boundary.

**Operational notes:**
- Token TTL is 24h (`lib/auth/issue.ts`).
- Audit events (`magic_link_failed`, `session_created`) fire only on POST, so scanner pre-fetches add no audit noise.
- A "This link is no longer valid" report with a `consumed_at` predating the user's click means the token was legitimately already used (GET is inert, so it's not a scanner burn).

---

## Operations

### Add a new admin

```bash
DATABASE_URL="$DATABASE_ADMIN_URL" pnpm edict:admin:invite <email>
```

Emails a magic-link to the new admin; they sign in and gain `/admin` access.

### Revoke a session

Via `/admin` UI (session list), or directly:

```bash
psql "$DATABASE_ADMIN_URL" -c "UPDATE sessions SET revoked_at = now() WHERE id = '<session_id>';"
```

### Force magic-link expiry for an email

```bash
psql "$DATABASE_ADMIN_URL" \
  -c "UPDATE magic_link_tokens SET revoked_at = now() WHERE email = '<email>' AND consumed_at IS NULL;"
```

---

## Health checks

```bash
# Served by Vercel via Cloudflare? Expect 200 + x-vercel-id + cf-ray.
curl -sS -D- https://edict.rectorspace.com/ -o /dev/null | head -20

# DB reachable?
psql "$DATABASE_ADMIN_URL" -c "select 1;"

# Migrations up to date?
psql "$DATABASE_ADMIN_URL" -c "SELECT id FROM drizzle_migrations ORDER BY id DESC LIMIT 5;"
```

---

## Known gotchas

1. **`ws` / `@neondatabase/serverless` must stay external to the bundler.** They're listed in `serverExternalPackages` in `next.config.ts`; bundling them mangles the prebuilt native helpers (`bufferutil`/`utf-8-validate`) and throws `b.mask is not a function` at runtime on Vercel Functions.

2. **Build needs dummy DB URLs.** `next build` evaluates `lib/db/index.ts` during static analysis, which throws on missing `DATABASE_URL` / `DATABASE_ADMIN_URL`. CI passes throwaway values; the build never actually connects. (See `.github/workflows/ci.yml`.)

3. **Migrations are not automatic.** Vercel builds are stateless — run `pnpm db:migrate` against Neon yourself when a release adds schema. Forgetting this ships code ahead of schema.

4. **`APP_URL` drives redirects behind the proxy.** Post-verify redirects use `APP_URL`, not the request host, so the proxy can't send users to an internal origin. Keep it set to `https://edict.rectorspace.com` (plain).

5. **Rate-limit enforcement.** `requestMagicLinkAction` rate-limits send attempts per email (10/hour, silent-success to preserve enumeration defense). Cloudflare absorbs edge-level DDoS.

---

## Escalation

Production issues → check in order:
1. `vercel logs <production-url>` (runtime errors).
2. Vercel dashboard → Deployments (is the latest READY, or did a build fail?).
3. DB: `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 20;`
4. Cloudflare dashboard → Security → Events (edge-side blocks).

**Tenant-isolation incident** (e.g., one client reports seeing another's doc): **treat as critical.** Pull a full `audit_log` export immediately, then triage. Cross-tenant leaks are project-ending per `CLAUDE.md`.
