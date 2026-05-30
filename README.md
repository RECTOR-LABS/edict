# Edict

> Multi-tenant client docs delivery platform. Issued by RECTOR.

**Status:** Live in production at [edict.rectorspace.com](https://edict.rectorspace.com).

---

## Concept

A rector issues edicts. Edict delivers formal, authoritative documents to clients — branded dashboards, per-client isolation, magic-link access. It replaces ad-hoc file sharing with a proper product for RECTOR LABS client engagements.

Each client receives an emailed magic-link to a branded dashboard showing only the edicts (docs) issued to them. An admin panel manages clients, shares docs, and tracks engagement.

## Brand

**Edict** — from Latin *edictum*, a formal proclamation issued by a ruler. Tied directly to RECTOR (Latin *rector*, "ruler/governor").

## Stack

- **Next.js 16** (App Router, React Server Components). Admin and auth writes go through Route Handlers under `app/api/**` (not Server Actions — avoids a Next 16 streaming bug on Vercel).
- **Neon Postgres** + **Drizzle ORM**, with **Postgres Row-Level Security** as a second defensive layer on top of application-level `client_id` scoping (`withClientScope`). `lib/db` selects its driver by host: `@neondatabase/serverless` for `*.neon.tech`, `node-postgres` for local/CI.
- **Magic-link auth** (no passwords), custom-built on `@oslojs/crypto` primitives, with a two-step verify flow that defeats email-scanner pre-fetching.
- **Resend** + `react-email` for transactional email.
- **Tailwind v4** styling; **Lucide** icons.
- **Hosting:** Vercel (native Git) behind a Cloudflare proxy (Full-strict TLS).

## Security model

Tenant isolation is the project's sacred invariant: every tenant-scoped query is constrained by `client_id` at the application layer *and* enforced at the database layer via Postgres RLS. A single cross-tenant data leak is treated as a project-ending bug.

## Local development

```bash
pnpm install
cp .env.example .env          # fill in local values; see .env.example header
# Bring up a local Postgres (any local 16+ instance on :5432), then:
pnpm db:migrate               # apply schema + RLS migrations
pnpm edict:admin:seed <email> # seed the first admin (emails a magic-link)
pnpm dev                      # http://localhost:3000
```

Set `DEV_PRINT_MAGIC_LINKS=true` locally to print magic-links to stdout instead of relying on email delivery.

### Common scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Local dev server |
| `pnpm build` | Production build (Turbopack) |
| `pnpm test:run` | Unit + integration tests (Vitest; integration uses testcontainers) |
| `pnpm test:e2e` | Playwright end-to-end tests |
| `pnpm typecheck` / `pnpm lint` | Static checks |
| `pnpm db:migrate` / `pnpm db:generate` | Drizzle migrations |
| `pnpm edict:admin:seed <email>` | Seed an admin |
| `pnpm edict:admin:invite <email>` | Invite an additional admin |

## Deployment

Production runs on Vercel via native Git: push to `main` → production deploy; open a PR → preview deploy. See [`docs/deployment-runbook.md`](docs/deployment-runbook.md) for the full procedure (env vars, migrations, DNS, rollback).

The repository is **public** — a `gitleaks` pre-commit hook and a CI `secret-scan` job guard against committed secrets. Never commit secrets, internal hostnames, or cross-project paths.

## Repo

- **GitHub:** `RECTOR-LABS/edict` (public). Mirrored to GitLab via `.github/workflows/mirror-gitlab.yml`.
- **Domain:** `edict.rectorspace.com`.

## License

MIT — see [LICENSE](LICENSE).
