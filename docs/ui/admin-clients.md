# Admin — Clients List + Create Form — Design Source

Source of truth for `/admin/clients` (list) and `/admin/clients/new` (create) surfaces. Generated via aidesigner, ported into `app/(admin)/admin/clients/page.tsx` + `app/(admin)/admin/clients/new/page.tsx` + `actions/clients.ts`.

## Prompt (verbatim, Task 37 Step 1)

```
Admin → Clients list + create form for Edict platform.
Same dark palette / cyan accent as already-shipped admin dashboard.

Two related surfaces in one generation:
1. List page (/admin/clients):
   - Page header: eyebrow "Clients", right side: "+ New client" button (Lucide Plus icon) linking to /admin/clients/new.
   - Table: columns = slug (mono, cyan), name, brand color swatch (small circle), members count, created at (mono, muted), actions column with "Open →" link using Lucide ArrowRight.
   - Empty state: "No clients yet. Create the first one." — centered, muted.

2. Create form (/admin/clients/new):
   - Page header: eyebrow "New client", h1 "Create client".
   - Form fields (stacked, labels are mono uppercase eyebrows):
     - Slug (required, monospace input, placeholder "adrena", hint "lowercase letters, numbers, dashes only")
     - Name (required, placeholder "Adrena Trading")
     - Brand color (optional, placeholder "#00e5ff", hint "hex color for client-branded dashboard")
     - Logo URL (optional, placeholder "https://…")
   - Submit button (bottom-left, cyan background, text "Create client").
   - Back link to /admin/clients at top.

Voice: authoritative but humble. Brand: dark (#06060c bg, #00e5ff accent, #0d0d14 surface, #8a8a93 muted, rgba(255,255,255,0.08) border). Plus Jakarta Sans sans + JetBrains Mono mono. Lucide icons only.

No emoji. No per-file-type icons. No fake delta metadata. Design consistency with existing /admin dashboard surface.
```

**Viewport:** desktop.
**Run id:** `60b499b4-1677-4bcc-ac58-25ab45de79e2` (2026-04-20).

## Design language extracted

- **Palette + fonts:** same as dashboard (`#06060c`/`#0d0d14`/`#14141e` bg scale, `#00e5ff` accent, `#8a8a93` muted, `rgba(255,255,255,0.08)` border, Plus Jakarta Sans + JetBrains Mono).
- **Page header:** eyebrow "Clients" (mono, muted, 11px, uppercase, tracked) + h1 "Clients" (white, 2xl, medium, tracking-tight). Mirrors dashboard's header pattern.
- **Action button (+ New client):** outlined style (transparent bg, border → border-cyan/50 on hover, cyan/5 tint hover fill), Lucide `Plus` icon (cyan) with 110% scale-on-hover. 
- **Table container:** surface bg, border, table inner border-bottom per row. NOT `rounded-xl shadow-2xl` (aidesigner's excessive polish); use `rounded-sm` + no shadow to match dashboard's card austerity.
- **Table header row:** `bg-[#08080c]` (slightly darker than surface — subtle elevation), mono eyebrow labels 10px uppercase tracked, muted text.
- **Table row:** `px-8 py-5`, hover bg `rgba(255,255,255,0.015)`, group hover: name cell translates +1px (micro-interaction). Left-accent on hover NOT added here (dashboard pattern reserved for log rows). KEEP the gentle name-translate.
- **Row cells:**
  - slug: mono cyan 14px
  - name: sans white 14px medium
  - brand color: 2.5×2.5 circle swatch (ring-1 ring-white/10) + hex in mono muted 12px
  - created at: mono muted 12px, `YYYY-MM-DD` format
  - actions: right-aligned "Open" link, muted → cyan hover, Lucide `ArrowRight` 14px
- **Empty state** (`listClients()` returns `[]`): centered in table container with `folder-search` Lucide icon at 30% opacity + "No clients yet. Create the first one." muted text. DROP the "dashed border" artifact from aidesigner's stacked demo layout.
- **Form page layout:** centered column max-w-[800px], page header mirrors list page pattern, back-link at top ("← /admin/clients" mono muted), form in `p-10` surface container.
- **Form fields (4 stacked):**
  - Label row: mono uppercase eyebrow + right-aligned "REQUIRED" cyan badge (10px) on required fields (slug, name). Optional fields (brandColor, logoUrl) have no badge.
  - Input: `bg-[#030305]` (even darker than surface for input depth), border → border-cyan on focus, subtle `input-glow` box-shadow on focus (`0 0 0 1px + 12px glow @ 10% opacity`).
  - Hint text below input: 12px muted.
- **Slug input:** includes Lucide `Link2` icon at left (adornment at 50% opacity). Mono input.
- **Brand color input:** includes inline preview swatch at left (placeholder dark gradient when empty, becomes selected color when filled — implementer discretion on whether to wire this up; acceptable to show a neutral swatch always for Phase 1).
- **Logo URL input:** aidesigner adds a `https://` static prefix in a separate left-compartment. **DROP** this prefix — it restricts flexibility (some CDNs are `//` protocol-relative, some are `http://` in internal dev). Plain URL input with `placeholder="https://..."` is fine.
- **Submit button:** full cyan bg (`#00e5ff`), void-black text, `font-semibold`, `px-6 py-3 rounded-md`. Includes Lucide `Check` icon. Subtle cyan glow shadow — KEEP (matches landing page button style).

## TSX port notes

### Three files ship together

1. **`app/(admin)/admin/clients/page.tsx`** (server component — list)
   - Fetches `listClients()` (Task 32).
   - Renders page header, "+ New client" link, table, empty state.
   - DROP `members count` column (not in plan's `listClients` data shape; adding a subquery is scope creep — defer member-count display to Task 38 client detail).
   - KEEP: slug (cyan mono), name, brand color (swatch + hex), created at (YYYY-MM-DD), Open arrow.

2. **`app/(admin)/admin/clients/new/page.tsx`** (server component — create form)
   - Renders form with 4 fields posting to a **Route Handler**: `<form action="/api/admin/clients" method="POST">`.
   - Back link to `/admin/clients` at top.
   - No client-side JS — plain HTML form POST.
   - **Migration note (2026-05-30):** originally a direct Server Action (`<form action={createClientAction}>`); rewired during the Vercel migration to a Route Handler that calls the same `createClientAction` (logic unchanged, only the form target moved — avoids a Next 16 Server-Action streaming bug on Vercel). Applies to all admin write forms in this doc.

3. **`actions/clients.ts`** (server action)
   - Per plan lines 2753-2784 verbatim. Gates on `getContext().kind === "admin"`. Validates slug regex `/^[a-z0-9-]+$/`. Validates name non-empty. Calls `createClient()` (Task 32). Writes `admin_action` audit event. Redirects to `/admin/clients/${c.id}` via `redirect()` from `next/navigation`.

### Deviations from plan's TSX skeleton

- Plan's list skeleton (lines 2793-2822) uses a simpler `divide-y` pattern without a table header row. Ported version adds a proper header row with mono eyebrow column labels (per aidesigner design). The aidesigner's richer column set (slug + name + brand + created_at + actions) is a strict superset of plan's (slug + name + brand) — keep the superset.
- Plan's form skeleton (lines 2827-2859) has a `<Field>` helper with `pattern="[a-z0-9-]+"` on the slug input. Keep the helper; it's a clean pattern. Extend with the aidesigner visual polish (mono eyebrow label, REQUIRED badge, hint text below, input icon for slug).
- DROP `typedRoutes` casts where possible — `/admin/clients` + `/admin/clients/new` exist within this commit so are type-valid. `/admin/clients/${id}` redirect target in the action still needs the cast (Task 38 lands the route).

### Validation + error handling

Per CLAUDE.md "no silent failures":
- `createClientAction` throws on invalid slug / empty name / non-admin. The throws surface via Next.js error boundary or the form's native error display.
- DB unique-constraint violation (duplicate slug) propagates from `createClient()` (Task 32). No catch-wrap.
- Do NOT add a try/catch in the action — CLAUDE.md bars swallowing, and specific error handling at this layer doesn't add value until Phase F2 UI has an error toast component (Phase I concern).

## Raw aidesigner output

Full HTML captured in commit history of this file. Run id `60b499b4-1677-4bcc-ac58-25ab45de79e2` is reproducible from the prompt above.

## Iteration history

- **2026-04-20** — initial generation. Trims applied:
  - **(a) "Demo labels" overlay** showing `Route: /admin/clients` / `Route: /admin/clients/new` → dropped (aidesigner preview aid, not part of the deliverable).
  - **(b) Members count column** → dropped (not in plan's `listClients` data; subquery is scope creep for Task 37; member counts belong on `/admin/clients/:id` Task 38).
  - **(c) `rounded-xl shadow-2xl` container styling** → softened to `rounded-sm` + no shadow, matching dashboard's austerity.
  - **(d) Duplicate stacked demo layout** (filled-state + empty-state both shown) → only one renders at a time in real code.
  - **(e) `https://` static prefix on Logo URL input** → dropped (restricts flexibility).
  - **(f) Fake client data** (adrena/1402, nex-core/84, sentinel/312 with named brand colors) → stripped; real data from `listClients()`.
  - **(g) Custom `void`/`surface`/`cyan`/`muted`/`borderline` Tailwind theme names** → dropped (arbitrary-value classes match codebase convention).
  - **(h) Lucide CDN script** → replaced with `lucide-react` imports (already installed via Task 28).
  - Kept: eyebrow + h1 header shape, outlined "+ New client" button with Plus icon, table structure, row micro-interaction (name translate-x-1 on hover), brand color swatch + hex, Open link with ArrowRight, `folder-search` icon for empty state, input-glow focus shadow, REQUIRED badge on label, slug Link2 adornment, submit button cyan glow.
