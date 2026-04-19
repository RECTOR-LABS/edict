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

- GitHub: `RECTOR-LABS/edict`
- Mirror to GitLab via existing mirror-gitlab.yml workflow (to be added during setup).
- Target domain: `edict.rectorspace.com`.

## Non-Negotiables

- **Tenant isolation is sacred.** Every DB query scoped by `client_id`. A single cross-tenant data leak is a project-ending bug. Treat this as the security invariant above all others.
- **Magic-link auth only.** No passwords. No shared creds.
- **No AI attribution** in commits, PRs, or docs.
- **Production-grade from day one.** Per RECTOR global standard. No "demo quality" shortcuts.
- **Dev-humble tone** in all user-facing copy.
- **No Unicode emojis as icons** in UI. Use Lucide React or Phosphor.
- **No hardcoded secrets.** Env vars only. Use `~/Documents/secret/.env` pattern where applicable.
- **Dual remote push** — always push to GitHub and GitLab (via mirror workflow).

## Target Use Cases

1. **Adrena delivery (Q2 2026):** host the `arena-implementation-plan.html` doc at an Edict URL for the Adrena team instead of raw file attachment.
2. **Future client engagements:** every new RECTOR LABS client gets their own Edict tenant — isolated docs, branded dashboard, audit trail.
3. **Archive:** closed engagements keep their docs accessible for historical reference (with access revocation optional).

## Current Status

Bootstrapping. See [docs/starter-prompt.md](docs/starter-prompt.md) for the kickoff prompt. Tech stack, routing, and architecture decisions will be made via the brainstorming skill in the first working session.

## References

- `/Users/rector/local-dev/adrena-trading-arena/docs/arena-implementation-plan.html` — the first real doc Edict will host; design language reference.
- `/Users/rector/local-dev/VOT-Labs/Dex-Bot-V2/apps/api/src/middleware/ops_auth.rs` — existing single-creds auth pattern we're evolving from.
- `/Users/rector/local-dev/core` — Rails monolith for rectorspace.com (separate from Edict; Edict is its own standalone app).

## Workflow Conventions

- Branch prefixes: `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`.
- One commit per feature/fix — never batch.
- Pre-commit hooks: enable before first real commit.
- Tests mandatory for every function/hook/component (per global standard — 80% coverage new code).
- Check CI status before starting new work (per global standard).
