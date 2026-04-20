# Client Dashboard — Design Source

Source of truth for `/c/:slug` (tenant-branded client dashboard). Generated via aidesigner, ported into `app/(client)/c/[slug]/page.tsx`.

## Prompt (verbatim, Task 44 Step 1)

```
Branded client dashboard in Edict.
Voice: authoritative but warm. Brand: tenant color injected via CSS var `--tenant-color` (accent usage only; primary background stays #06060c).
Layout:
- Top area already rendered by parent layout (tenant logo + name + log out).
- Page header: "Your edicts" + subtitle "Documents issued to {{tenant_name}}"
- List of doc cards: title (large), body type badge ("HTML" / "MD"), last-viewed indicator ("You read this 3 hours ago" or "New")
- Empty state: "No edicts yet." centered, muted.
Data shape: { tenant: { name }, docs: [{ slug, title, bodyType, lastViewedAt?: ISO }] }
```

**Viewport:** desktop. **Run id:** `d59d0ac2-0f2d-4712-8a65-ec9f8c64a340` (2026-04-20).

## Design language extracted

- **Palette:** `#06060c` bg, cards at 1.5% white alpha, `var(--tenant-color,#00e5ff)` for accents (tenant-branded).
- **Fonts:** Plus Jakarta Sans sans + JetBrains Mono mono (inherited). **DROP aidesigner's Instrument Serif** — product typography is consistent sans throughout (matches Task 28 landing + admin surfaces).
- **Page header:** h1 "Your edicts" (3xl, semibold, white, tracking-tight). Subtitle "Documents issued to `{tenant.name}`" (base, `#8a8a93`, mt-2 mb-10). NO serif italic, NO pill-wrapped tenant name.
- **Doc card (the card-level micro-architecture):**
  - Container: `rounded-md` (NOT `rounded-2xl` — dashboard's austerity) + 1% white bg + border at 5% white, padding 6/8.
  - Tenant-color hover glow: gradient border effect on `::after` pseudo-element fading in on hover (KEEP — signals tenant identity on interaction).
  - Hover: subtle `translateY(-2px)` + soft shadow. KEEP.
  - Title: 2xl font-medium sans white (was 3xl serif in aidesigner — trimmed).
  - BodyType badge: mono 10px uppercase tracked, muted text, subtle white bg. Renders "HTML" or "MD" (map `bodyType === "html"` → "HTML", `"markdown"` → "MD").
  - Last-viewed indicator:
    - Unread (no `lastViewedAt`): tenant-color pulsing dot + "New" badge with subtle glow.
    - Recent (< 1h): "just now"
    - < 24h: "Xh ago"
    - < 7d: "Xd ago"
    - ≥ 7d: absolute date via `toLocaleDateString()` — extends plan's `formatRelative` with this branch (small UX polish, trivially contained).
  - Right-side action: circular outline with Lucide `ArrowUpRight` icon. Hover: tenant-color background fill + translate.
- **Empty state:** centered Lucide `FileX` or `FileQuestion` icon at 20% opacity, "No edicts yet." heading (sans, 2xl), subtitle explaining "When `{tenant.name}` issues documents, they appear here." No refresh button (no purpose). DROP aidesigner's rotated-card visual stack (overwrought).
- **Staggered entrance animation:** subtle fadeUp with staggered delays per card. KEEP — it's a classy micro-interaction that doesn't feel showy.
- **Selection color:** `var(--tenant-color)` bg + `#06060c` fg — tenant-branded text-select feedback. KEEP.
- **Fixed parent nav** in aidesigner: DROP — Task 43 layout already renders the header above `children`, aidesigner's was a preview aid.
- **"Glare overlay" radial gradient** at top: DROP — decorative weight without content.
- **Icons:** Lucide React (swap from Phosphor): `FileText`, `ArrowUpRight`, `Clock`, `CheckCircle`, `FileQuestion` / `FileX` for empty state.

## TSX port notes

- Server component. Parent layout already gated via `requireClientSession`. Fetches via `getContext()` for `clientId` + `memberId`.
- Consume `listDocsForClientWithLastViewed(ctx.clientId, ctx.memberId)` (new query added to `lib/db/queries/docs.ts`).
- `formatRelative` extended: `< 7d` returns "Xd ago", else `toLocaleDateString()` (handles older dates gracefully).
- Container max-w-4xl mx-auto, px-10 py-10 (matches established admin main-container scale).
- Links point to `/c/${slug}/d/${d.slug}` — Task 47 route, use `as Route` cast.
- `getContext().kind !== "client"` throws defensive error ("client only") — parent layout should prevent reaching here otherwise, but paranoid guard is cheap.

## Iteration history

- **2026-04-20** — initial generation. Trims applied:
  - **(a) Mock parent layout** preview → DROP (Task 43 already renders the header).
  - **(b) Instrument Serif font** + italic "edicts" decoration → DROP (product typography consistent sans).
  - **(c) Phosphor Icons** → swap to Lucide React.
  - **(d) `rounded-2xl` cards** → soften to `rounded-md` (matches admin dashboard austerity).
  - **(e) Tenant-name pill with Buildings icon** → DROP (plain inline `{tenant.name}`).
  - **(f) `text-5xl/6xl` headline** → scale down to 3xl sans.
  - **(g) Elaborate empty-state visual** (stacked rotated cards + Refresh button) → simplify to single Lucide icon + heading + subtitle. Drop Refresh button.
  - **(h) Stacked filled+empty demo** → render only one at a time.
  - **(i) "Glare overlay" radial gradient** → DROP (decorative weight without purpose).
  - Kept: tenant-color hover glow on cards (`::after` gradient), staggered fade-up entrance, New badge with tenant-color pulsing dot, last-viewed indicator with Lucide Clock icon, ArrowUpRight corner action, selection color via var(--tenant-color).
