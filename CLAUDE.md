# CLAUDE.md — Edict

Project-specific instructions for Edict. Inherits and overrides from the global `~/.claude/CLAUDE.md`.

---

## Project

**Edict** — multi-tenant client docs delivery platform. Clients receive magic-link access to branded dashboards showing only the edicts (docs) issued to them. Admin panel lets RECTOR manage clients, share docs, and track engagement.

Origin: born from the need to deliver consulting/engagement docs (Adrena Trading Arena plan, future clients) as a proper product rather than raw file attachments.

## Name & Brand

- **Edict** from Latin *edictum* (formal proclamation issued by a ruler).
- Ties to RECTOR etymology (Latin *rector*, "ruler/governor").
- Sentence test: *"I just sent you an edict."*
- Tone: authoritative but humble, professional, trust-first.

## Repo

- GitHub: `RECTOR-LABS/edict` — **public** repository.
- Production domain: `edict.rectorspace.com`.
- Deploy: **Vercel native Git** — push to `main` → production deploy; PR → preview deploy.
- Secret hygiene: `gitleaks` pre-commit hook + CI `secret-scan` job. The repo is public — never commit secrets, internal hostnames, or cross-project paths.
- GitLab mirror: `mirror-gitlab.yml` force-pushes `main` to GitLab on each push (backup).

## Non-Negotiables

- **Tenant isolation is sacred.** Every DB query scoped by `client_id`. A single cross-tenant data leak is a project-ending bug. Treat this as the security invariant above all others.
- **Magic-link auth only.** No passwords. No shared creds.
- **No AI attribution** in commits, PRs, or docs.
- **Production-grade from day one.** Per RECTOR global standard. No "demo quality" shortcuts.
- **Dev-humble tone** in all user-facing copy.
- **No Unicode emojis as icons** in UI. Use Lucide React or Phosphor.
- **No hardcoded secrets.** Env vars only — untracked `.env` locally, Vercel project env in production. Never commit secrets.
- **Dual remote push** — always push to GitHub and GitLab (via mirror workflow).

## Target Use Cases

1. **Adrena delivery (Q2 2026):** host the `arena-implementation-plan.html` doc at an Edict URL for the Adrena team instead of raw file attachment.
2. **Future client engagements:** every new RECTOR LABS client gets their own Edict tenant — isolated docs, branded dashboard, audit trail.
3. **Archive:** closed engagements keep their docs accessible for historical reference (with access revocation optional).

## Current Status

**Live in production on Vercel + Neon Postgres** — migrated off the VPS on 2026-05-30. `edict.rectorspace.com` is served by Vercel via Cloudflare (proxied, Full-strict TLS). The old VPS is kept ~30 days as a fallback, then decommissioned.

### Stack
- **Next.js 16** (App Router). Admin writes go through Route Handlers under `app/api/admin/**` (not Server Actions — avoids a Next 16 streaming bug on Vercel).
- **Neon Postgres** + **Drizzle ORM**, with **Postgres RLS** enforcing tenant isolation (`withClientScope`). `lib/db` selects its driver by host: `@neondatabase/serverless` for `*.neon.tech`, `node-postgres` for local/CI.
- **Magic-link auth** (no passwords) via emailed links (**Resend**).
- **Tailwind** styling; **Lucide** icons.
- **Hosting:** Vercel (Hobby) — production + preview via native Git; Cloudflare proxy in front.

## References

- The first real doc Edict hosts is the Adrena implementation plan (design-language reference; kept locally, outside this repo).
- The auth model evolved from an earlier single-shared-credential HTTP-auth pattern used in a separate private service.
- rectorspace.com itself runs on a separate private app; Edict is fully standalone.

## Workflow Conventions

- Branch prefixes: `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`.
- One commit per feature/fix — never batch.
- Pre-commit hooks: enabled — `gitleaks` secret scan (local hook + CI `secret-scan` job).
- Tests mandatory for every function/hook/component (per global standard — 80% coverage new code).
- Check CI status before starting new work (per global standard).
