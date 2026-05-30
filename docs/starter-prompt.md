# Edict — Starter Prompt

> **Historical artifact (April 2026).** This is the original kickoff prompt used to bootstrap Edict — written before any stack decisions were made (it literally asks "VPS? Vercel? Fly?"). All of those questions are long since answered: Edict is live on **Vercel + Neon Postgres**. Kept as the project's origin record. For the current state see `README.md`, `CLAUDE.md`, and `docs/deployment-runbook.md`.

Paste the prompt below into a fresh Claude Code session opened in this directory. Edit anything you'd like to refine before firing.

---

```
Bismillah. Starting Edict — a new RECTOR LABS side project.

═══ PROJECT: EDICT ═══
Multi-tenant client docs delivery platform. You issue formal edicts (docs) to
clients. Each client gets a branded, private dashboard showing only their edicts.
Replaces ad-hoc raw HTML/PDF sharing with a proper product.

Name etymology: RECTOR = Latin "ruler/governor" (from regere, to guide). An
edict is what a rector issues — a formal, authoritative document. Perfect
semantic loop: RECTOR-LABS ships Edict, and Edict delivers edicts from RECTOR
to clients.

═══ CONTEXT / ORIGIN ═══
Trigger: Need to deliver Adrena Trading Arena implementation plan to their team
professionally — not as a raw .html attachment. This will scale to every future
RECTOR LABS client engagement (Adrena today, X tomorrow, future clients forever).

Existing precedent: a prior internal team-docs site used a single shared
HTTP Basic Auth credential. Edict is a proper multi-tenant evolution of that
pattern — per-client isolation, magic-link auth, analytics, admin panel.

═══ DOMAIN & DEPLOYMENT ═══
- Target: edict.rectorspace.com (subdomain on existing Cloudflare + VPS infra)
- Repo: RECTOR-LABS/edict on GitHub (new repo under the org)
- Mirror to GitLab via existing mirror workflow

═══ CORE REQUIREMENTS ═══
1. Multi-tenant with hard isolation — Adrena users can NEVER see another
   client's docs. Enforced at query layer (client_id scoping on every query).
   This is security-critical: a single cross-tenant leak is a project-ending bug.
2. Magic-link email auth — no passwords. Clients click emailed link, session
   created scoped to their client_id.
3. Per-client branded dashboard — clients see their org's name + only their docs.
4. Admin panel (RECTOR only) — create clients, add team members, upload/share
   docs, see analytics (who viewed what, when, for how long).
5. HTML + Markdown support — HTML for pre-designed docs (like the Adrena
   walkthrough I already built), Markdown for quick writeups (auto-rendered).
6. Audit log — every view logged with timestamp, user, IP.
7. Revocable access — I can invalidate sessions or links at any time.

═══ USER FLOW (ALREADY DESIGNED) ═══
Client side:
  RECTOR shares doc → system emails client team → they click magic link →
  authenticated as their client_id → lands on their dashboard → reads docs.

Admin side:
  /admin → list of clients → click client → manage members, docs, access →
  upload doc → auto-emails client members → track analytics.

═══ WHAT TO DO FIRST ═══
1. Invoke superpowers:brainstorming skill — make these technical decisions:
   - Tech stack (Next.js? Rails? Go? Hono? — RECTOR is fluent in multiple)
   - DB choice (Postgres via Supabase? SQLite? Self-hosted Postgres?)
   - Email provider (Resend? Postmark? SES? Mailgun?)
   - Magic-link: library or custom?
   - Routing: subdomain per client (adrena.edict.rectorspace.com) vs path
     (edict.rectorspace.com/c/adrena)?
   - Deployment: VPS (shared with rectorspace.com)? Vercel? Fly?
2. Once decided, write design spec to
   docs/superpowers/specs/YYYY-MM-DD-edict-design.md
3. Use writing-plans skill → implementation plan
4. Execute Phase 1: auth + tenant isolation + doc viewer + admin basics
5. Host the Adrena implementation plan doc on Edict as the first real use case

═══ TIMELINE AMBITION ═══
Phase 1 MVP in ~1-2 weeks part-time. Goal: serve the Adrena
arena-implementation-plan.html via Edict by end of month, not raw file.

═══ NON-NEGOTIABLES ═══
- Security-first: tenant isolation is sacred. Every query scoped by client_id.
- No AI attribution in commits / README / code.
- Production-grade from day one (per RECTOR's global standard).
- Dev-humble tone in any user-facing copy.
- No Unicode emojis as icons in UI — use Lucide React (or equivalent).
- No hardcoded secrets — env vars only (untracked .env locally, platform env in production).

═══ ASSETS TO REFERENCE ═══
- The Adrena walkthrough + implementation-plan HTML docs (kept locally) — the
  first docs to host on Edict; they show the design language expected.
- An earlier single-shared-credential basic-auth middleware in a separate
  private service — the pattern Edict evolves from.

Let's start with the brainstorm. First question: what tech stack feels right?
```

---

## How to Use

```bash
cd ~/local-dev/edict
# Open Claude Code here (fresh session, not a continuation)
# Paste the prompt above
```

Edit the prompt freely before firing — it's a starting point, not a contract.
