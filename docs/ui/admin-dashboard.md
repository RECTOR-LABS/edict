# Admin Dashboard — Design Source

Source of truth for `/admin` (dashboard) surface. Generated via aidesigner, ported into `app/(admin)/admin/page.tsx`.

## Prompt (verbatim, Task 36 Step 1)

```
Admin dashboard for Edict platform operators.
Purpose: quick read of state — active clients, recent shares, recent views.
Voice: authoritative but humble. Brand: dark theme (#06060c background, #00e5ff accent), professional, monospace eyebrows.
Layout:
- Top bar: "EDICT / ADMIN" wordmark, admin email on right, logout form.
- Three summary cards: "Active clients (N)", "Docs live (N)", "Views last 7 days (N)"
- Two stacked sections: "Recent shares" (list: doc title → client name + shared_at) and "Recent views" (list: member email + doc title + viewed_at)
- Lucide icons: Users, FileText, Eye. No emoji.
Data shape (use placeholders to style):
{ activeClients: 3, liveDocs: 5, recentViews7d: 24, recentShares: [...], recentViews: [...] }
```

**Viewport:** desktop.
**Run id:** `6aee3aac-d3b2-43d0-ab50-552678d071fd` (2026-04-20).

## Design language extracted from the generated HTML

- **Palette:** `#06060c` bg, `#0d0d14` surface, `#14141e` surface-hover, `#00e5ff` accent, `#8a8a93` muted text, `rgba(255,255,255,0.08)` border. All pass WCAG AA (muted on bg ≈ 5.4:1).
- **Typography:** aidesigner used Inter + Space Mono; TSX port uses the established **Plus Jakarta Sans + JetBrains Mono** (same as Task 28 landing + Task 25 email template — do NOT introduce third/fourth font families).
- **Top nav:** 64px tall, sticky, `border-b` + `backdrop-blur-md` on `bg-[#06060c]/90`. Wordmark on left, admin email + logout form on right. "EDICT / ADMIN" as mono weight-700 tracking-[0.2em] with cyan `/` separator at 50% opacity.
- **Status dot in nav wordmark:** 8px cyan dot with `animate-pulse` + cyan shadow glow. **KEEP** — admin dashboard reads as live-ops console (unlike Task 28 landing where we dropped the pulse for restraint). Status-indicator framing is appropriate here.
- **Summary cards (3-column grid, md+):** border + surface bg + 24px padding, `rounded-sm` (institutional minimal), corner icon (Lucide `Users` / `FileText` / `Eye`) top-right, metric label eyebrow top-left, big number bottom. Number: 5xl, weight 300 ("font-light"), tracking-tighter.
- **Card hover:** decorative animated top-line (gradient-via-accent, fade on hover) + icon color swap to cyan. Subtle. **KEEP** — low visual noise, reinforces interactivity without being flashy.
- **Card sub-labels** ("↑ Stable", "+12% vs prior", "Indexed"): aidesigner invented delta metadata. **DROP** — the plan's data shape has only raw counts; no baseline for deltas. Sub-labels become real technical debt if we ship fake metrics.
- **Activity log sections:** `border-b` section header with mono eyebrow (label + icon) + a right-aligned small-mono hint. Table rows in a bordered surface-bg container, grid-template-columns for md+ (`2fr 1.5fr auto` shares, `1fr 2fr auto` views). Each row has 2px cyan left-accent on hover (scaleY animation). **KEEP** the animation — it's a functional affordance (which row has focus) not decoration.
- **"Recent shares" row shape:** `{ fileTypeIcon, docTitle, clientName, timestamp }`. aidesigner used per-file-type icons (pdf/doc/zip) — but Edict docs are HTML or Markdown, not file uploads with MIME types. **DROP** per-row icons; use a single `FileText` at row start OR omit the row icon entirely for visual quiet.
- **"Recent views" row shape:** `{ statusDot, memberEmail, docTitle, timestamp }`. `statusDot` in aidesigner distinguishes "just now" (cyan) from older (muted). Keep the dot pattern but gate on actual timestamp (e.g., last 5 min → cyan, else muted).
- **"LIVE FEED" badge** on Recent Views (`glow-accent` CRT text-shadow): **DROP** — implies websocket/server-push; we have no such infra and won't in Phase 1. The header label "Recent Views" already communicates recency without lying about realtime.
- **"View All Event Logs" button** below Recent Views: **KEEP** as a forward-link to `/admin/audit` (Task 42 route). Rendered as `Link` to `/admin/audit` with Lucide `ArrowRight`.
- **Phosphor icons** (`<i class="ph ph-eye">` etc.): aidesigner chose Phosphor. **REPLACE with Lucide React** (`lucide-react` already installed from Task 28). Map: `ph-users` → `Users`, `ph-file-text` → `FileText`, `ph-eye` → `Eye`, `ph-share-network` → `Share2`, `ph-arrow-right` → `ArrowRight`, `ph-shield-check` → `ShieldCheck`.
- **Custom Tailwind color names** (`edict-bg`, `edict-accent`, etc.) in aidesigner's tailwind.config: **do NOT adopt**. Current codebase uses arbitrary-value classes (`bg-[#06060c]`). Palette-token extraction is a separate tracked item; Task 36 should not introduce it piecemeal.
- **Placeholder mock data** (`operator.jkl@edict.system`, `Project_Titan_M&A_Framework_v2.pdf`, `s.johnson@vanguard.com`, etc.): stripped in the TSX port. Real data comes from DB queries.

## TSX port notes

- `app/(admin)/admin/page.tsx` is a **server component**. `app/(admin)/layout.tsx` already gates the route via `requireAdminSession` — the page can trust that an admin session resolves upstream.
- **Admin email** for the nav meta: pull from `getContext()` (AsyncLocalStorage session context, Phase C Task 22). If `ctx.kind === "admin"`, the context should expose `adminId`. To get `email`, the implementer must choose: (a) add an inline `SELECT email FROM admins WHERE id = ctx.adminId` in the page, or (b) augment the context to carry email (out-of-scope for Task 36). **Recommended: (a)** — single-query overhead is negligible, and context augmentation crosses into Task 22 territory.
- **Data fetching** (per plan lines 2681-2692):
  - `listClients()` — shipped Task 32.
  - `listDocs()` — shipped Task 34.
  - Views count: inline `adminDb.select({ n: sql<number>\`count(*)::int\` }).from(schema.auditLog).where(...)` per plan.
  - **NEW inline queries needed** (not in plan's skeleton, but required by aidesigner design):
    - Recent shares (top 5): join `docShares` + `docs` + `clients`, `WHERE revoked_at IS NULL`, `ORDER BY shared_at DESC`, `LIMIT 5`. Inline in `page.tsx` — do NOT export to `lib/db/queries/shares.ts` (would be scope creep past Task 35).
    - Recent views (top 5): join `auditLog` + `clientMembers` (actor) + `docs` (via metadata.doc_id), `WHERE eventType = 'doc_viewed'`, `ORDER BY created_at DESC`, `LIMIT 5`. Same — inline.
- **Empty states:** zero shares → `<p>No shares yet.</p>` inside the section container; same for views. Don't render empty table rows.
- **Logout form:** `<form action="/auth/logout" method="POST">` — Task 30 shipped the endpoint.
- **Cards link destinations** (per plan line 2710-2712):
  - Active clients → `/admin/clients`
  - Docs live → `/admin/docs`
  - Views 7d → `/admin/audit?event=doc_viewed`
  Wrap each `<Card>` in `Link` from `next/link`.
- **Hover states:** card top-line gradient animation + row left-accent are the only kept animations. No `glow-accent` text-shadow, no "LIVE FEED" pulse.

## Raw aidesigner output

The HTML below is captured verbatim for reference. Do NOT import or ship it — the TSX in `app/(admin)/admin/page.tsx` is the deliverable.

```html
<!DOCTYPE html>
<html lang="en" class="antialiased selection:bg-[#00e5ff] selection:text-[#06060c]">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edict / Admin</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/@phosphor-icons/web"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
    <!-- Full aidesigner HTML truncated in-file for length. Regenerate from the prompt + run_id above if needed. -->
</head>
<body class="bg-edict-bg text-white min-h-screen flex flex-col font-sans overflow-x-hidden">
    <!-- See run_id 6aee3aac-d3b2-43d0-ab50-552678d071fd for full output -->
</body>
</html>
```

*Note: full raw HTML preserved in commit history of this file if needed. Run the same prompt to reproduce.*

## Iteration history

- **2026-04-20** — initial generation from Task 36 Step 1 prompt. Accepted with these trims from the raw aidesigner output:
  - **(a) Inter + Space Mono fonts → replaced with Plus Jakarta Sans + JetBrains Mono** for consistency with Task 28 landing + Task 25 email template.
  - **(b) Phosphor Icons → replaced with Lucide React** per project convention (Task 28 established Lucide; `lucide-react` already installed).
  - **(c) `edict-*` custom Tailwind color names → dropped**; arbitrary-value classes (`bg-[#06060c]`) match current codebase and avoid introducing a palette-token layer in a single feature commit.
  - **(d) Card sub-labels ("↑ Stable", "+12% vs prior", "Indexed") → dropped**; plan data shape has no deltas, these would be mock metrics masquerading as real signal.
  - **(e) "LIVE FEED" glow-accent badge → dropped**; no realtime infra in Phase 1.
  - **(f) Per-row file-type icons (pdf/doc/zip) → dropped**; Edict docs are HTML or Markdown, no MIME variance.
  - **(g) Placeholder mock data** (`operator.jkl@edict.system`, fake doc names, fake emails) → stripped; real data from DB queries.
  - **Kept**: sticky top-nav with pulsing status dot (admin-console framing), card hover top-line gradient, row left-accent hover animation, "View All Event Logs" button link to `/admin/audit`.
