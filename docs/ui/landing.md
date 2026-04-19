# Landing Page — Design Source

Source of truth for the public landing page surface at `/`. Generated via aidesigner, ported into `app/page.tsx` + `actions/sessions.ts` server action. Re-generate from this prompt if/when the design evolves.

## Prompt (verbatim, Task 28 Step 1)

```
Landing page for Edict — a multi-tenant formal document delivery platform.
Voice: authoritative but humble. Brand: professional, trust-first, developer-humble.
Dark background (#06060c), cyan accent (#00e5ff), JetBrains Mono for monospace moments, Plus Jakarta Sans for sans.
Layout: centered vertical column, max-width 560px.
Content:
- Small monospace eyebrow: "FORMAL DOCUMENT DELIVERY"
- Headline: "Edict"
- Subtitle: "A rector issues edicts. Sign in to read yours."
- Email input + "Send me my magic link" submit button
- On submit, UI shows: "If this email is on file, your link is on its way." (generic — no user enumeration)
- Small footer: "Edict — edict.rectorspace.com"
No images. No emoji. Lucide icons only if any.
```

**Repo context supplied:** Next.js 16 App Router + Tailwind v4 + TS strict. Shipped: react-email magic-link template (Phase D) — matching dark palette + Plus Jakarta Sans + JetBrains Mono + WCAG AA footer contrast. Public landing at `app/page.tsx`. Form submits via Next 16 Server Action (`requestMagicLinkAction`) with silent enumeration defense.

**Viewport:** desktop.
**Run id:** `2393b49c-1c6d-4434-82d6-d9a505df4033` (2026-04-19).

## Design language extracted from the generated HTML

- **Dark palette:** `#06060c` bg, `#0b0b12` surface (input background), `#1f1f2e` border.
- **Accent:** `#00e5ff` cyan — focus ring on input, button hover background, selection highlight.
- **Eyebrow:** 10.5px JetBrains Mono, weight 400, `#88888b` (≈5.5:1 on bg — passes AA), letter-spacing `0.25em`, uppercase — "FORMAL DOCUMENT DELIVERY". Margin-bottom 24px below header block.
- **Headline:** 2.75rem (44px) Plus Jakarta Sans, weight 600, white, `leading-none`, `tracking-tight`. Margin-bottom 16px.
- **Subtitle:** 16px (`text-base`) Plus Jakarta Sans weight 500, `#A1A1A8` (≈7.9:1 — AAA), width ~90% for soft-right ragged edge.
- **Email input:** background `#0b0b12` surface, border `#1f1f2e`, focus border `#00e5ff`, placeholder `#7a7a8c` (≈5.1:1 — passes AA, same value as email-template footer), body text white JetBrains Mono 14px, padding 14px/16px, `rounded-[3px]`. WebKit autofill overridden to surface bg.
- **Primary button:** background white, text black, Plus Jakarta Sans semibold 14px, padding 14px/16px, `rounded-[3px]`, `h-[52px]`. Hover: background `#00e5ff` cyan. Lucide `ArrowRight` icon at the right — `opacity-40` at rest, `opacity-100 + translate-x-0.5` on hover. Icon color: `text-black` (inherits from button).
- **Success copy:** "If this email is on file, your link is on its way." — plan copy verbatim, always rendered below the form (enumeration defense per spec §6.2: silent success regardless of registration). 16px slate, muted.
- **Footer:** two-part monospace 11px, `#7a7a8c` (parity with email template AA fix), 24px padding-top with border-top `#1f1f2e`. Left: "EDICT PLATFORM" uppercase tracked. Right: `edict.rectorspace.com`. Stacks on narrow widths.
- **Rounded corners:** `rounded-[3px]` throughout — institutional/minimal aesthetic. No pill buttons, no rounded cards.
- **Selection highlight:** `::selection { background-color: #00e5ff; color: black }` — brand-consistent text-select feedback.

## TSX port notes

- `app/page.tsx` is a **server component** (Next 16 default). Uses existing Tailwind v4 setup + global fonts (Plus Jakarta Sans sans, JetBrains Mono mono).
- `<form action={requestMagicLinkAction}>` — Next 16 Server Action. **No client-side state, no Alpine.js, no `useFormStatus`.** Success message is always visible below the form (the spec's enumeration-defense model — we don't branch on email match). If the user double-submits, that's fine: server action is idempotent-enough (one token per match each call; Phase D already accepted token accumulation as a trade-off for CLI simplicity, same reasoning applies here).
- Lucide React icon: `import { ArrowRight } from "lucide-react"` — adds `lucide-react` as a runtime dependency. Single icon only; tree-shaken by Next.
- `actions/sessions.ts` follows plan lines 2093-2161 verbatim, including `revalidatePath("/")` after dispatch and `writeAudit({ eventType: "magic_link_requested", ... metadata: { email_hash_prefix: email.slice(0, 2) + "***" } })` regardless of lookup outcome (audit marker that doesn't reveal whether match succeeded).
- Empty-email guard: the server action's `if (!email) return` short-circuits without audit. The plan intends silent handling for empty/whitespace; we extend `.trim()` coverage to match the Phase D admin-seed/invite pattern (`!email || !email.trim()`).

## Raw aidesigner output

The HTML below is captured verbatim for reference. Do **not** import or ship it — the TSX in `app/page.tsx` is the deliverable.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edict | Formal Document Delivery</title>

    <!--
    aesthetic_dna: Hyper-Minimalist Institutional, Secure Terminal
    ui_paradigm: Centered Focal Plane / Access Gate
    palette_choice: Obsidian Void (#06060c), Quantum Cyan (#00e5ff), Titanium Whites
    -->

    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap" rel="stylesheet">
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>

    <script>
        tailwind.config = {
            theme: {
                extend: {
                    fontFamily: {
                        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
                        mono: ['"JetBrains Mono"', 'monospace'],
                    },
                    colors: {
                        bg: '#06060c',
                        accent: '#00e5ff',
                        surface: '#0b0b12',
                        border: '#1f1f2e',
                        text: {
                            dim: '#88888b',
                            muted: '#A1A1A8'
                        }
                    }
                }
            }
        }
    </script>

    <style>
        [x-cloak] { display: none !important; }

        body {
            background-color: theme('colors.bg');
            color: white;
            font-family: theme('fontFamily.sans');
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }

        ::selection {
            background-color: theme('colors.accent');
            color: black;
        }

        input:-webkit-autofill,
        input:-webkit-autofill:hover,
        input:-webkit-autofill:focus,
        input:-webkit-autofill:active {
            -webkit-box-shadow: 0 0 0 30px theme('colors.surface') inset !important;
            -webkit-text-fill-color: white !important;
            transition: background-color 5000s ease-in-out 0s;
        }

        .grid-stack {
            display: grid;
            grid-template-areas: 'stack';
        }
        .grid-stack > * {
            grid-area: stack;
        }
    </style>
</head>
<body class="min-h-screen w-full flex items-center justify-center p-4">

    <main class="w-full max-w-[560px] pb-[10vh]" x-data="{ submitted: false, email: '', loading: false }">

        <header class="mb-10">
            <div class="font-mono text-[10.5px] tracking-[0.25em] text-text-dim uppercase mb-6 flex items-center gap-3">
                <span class="relative flex h-2 w-2">
                    <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-20"></span>
                    <span class="relative inline-flex rounded-full h-2 w-2 bg-accent opacity-80"></span>
                </span>
                Formal Document Delivery
            </div>

            <h1 class="text-[2.75rem] leading-none font-semibold text-white tracking-tight mb-4">
                Edict
            </h1>
            <p class="text-base text-text-muted font-medium w-[90%]">
                A rector issues edicts. Sign in to read yours.
            </p>
        </header>

        <div class="grid-stack items-start">
            <form
                x-show="!submitted"
                x-transition:leave="transition ease-out duration-200"
                x-transition:leave-start="opacity-100 translate-y-0"
                x-transition:leave-end="opacity-0 -translate-y-2 pointer-events-none"
                @submit.prevent="loading = true; setTimeout(() => { loading = false; submitted = true }, 750)"
                class="w-full z-10"
            >
                <div class="flex flex-col gap-4">
                    <div class="relative group">
                        <input
                            type="email"
                            required
                            x-model="email"
                            :disabled="loading"
                            class="w-full bg-surface border border-border focus:border-accent text-white px-4 py-3.5 rounded-[3px] outline-none transition-colors duration-300 placeholder:text-[#444452] font-mono text-sm shadow-sm disabled:opacity-50"
                            placeholder="user@domain.tld"
                            spellcheck="false"
                        >
                    </div>

                    <button
                        type="submit"
                        :disabled="loading"
                        class="w-full bg-white text-black font-semibold text-sm px-4 py-3.5 rounded-[3px] hover:bg-accent transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-wait group h-[52px]"
                    >
                        <span x-show="!loading" class="flex items-center gap-2">
                            Send me my magic link
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" class="opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-black duration-300" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                        </span>

                        <span x-show="loading" x-cloak class="flex items-center gap-3 font-mono text-xs uppercase tracking-wider">
                            <svg class="animate-spin h-4 w-4 text-black" viewBox="0 0 24 24" fill="none">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Authenticating
                        </span>
                    </button>
                </div>
            </form>

            <div
                x-show="submitted"
                x-cloak
                x-transition:enter="transition ease-out duration-400 delay-200"
                x-transition:enter-start="opacity-0 translate-y-3"
                x-transition:enter-end="opacity-100 translate-y-0"
                class="w-full z-0 p-5 border border-border bg-surface rounded-[3px] flex items-start gap-4 shadow-[0_0_40px_-15px_rgba(0,229,255,0.1)] relative overflow-hidden"
            >
                <div class="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-accent to-transparent opacity-30"></div>

                <div class="mt-0.5 text-accent shrink-0">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                </div>
                <div class="space-y-1.5 flex-1">
                    <p class="text-[15px] font-semibold text-white">Request processed.</p>
                    <p class="text-sm text-text-dim leading-relaxed">
                        If <span class="font-mono text-text-muted px-1 py-0.5 bg-black/50 rounded border border-white/5" x-text="email + ' '"></span>is on file, your link is on its way. Ensure to check appropriate filters.
                    </p>
                </div>
            </div>
        </div>

        <footer class="mt-20 pt-6 border-t border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 font-mono text-[11px] text-[#444452] tracking-wide">
            <span class="uppercase">Edict Platform</span>
            <span>edict.rectorspace.com</span>
        </footer>

    </main>

</body>
</html>
```

## Iteration history

- **2026-04-19** — initial generation from Task 28 Step 1 prompt (run id above). Accepted with four trims:
  - **(a) Alpine.js client-side state + animated success panel → dropped.** The plan skeleton uses a pure server action with `<form action={requestMagicLinkAction}>` and an always-visible success message below the form (enumeration-defense model: we emit identical UI whether the email matches or not — branching on success state would leak information to network observers timing the render). Also: no `useFormStatus` pending state — adding client-component overhead for a single "Sending..." label is over-building per the YAGNI rule.
  - **(b) Eyebrow pulsing dot → dropped.** The animated `bg-accent opacity-20` ping feels like a live-status indicator that doesn't match the voice ("authoritative but humble"). A public landing page for a formal document platform should read as restrained/trustworthy on first paint, not as a "system is live" dashboard. Static eyebrow row only.
  - **(c) Success-state "Ensure to check appropriate filters." flourish → dropped.** The plan specifies exact copy ("If this email is on file, your link is on its way."). The aidesigner flourish would add a second sentence that (i) isn't in spec, (ii) reads patronizingly. Restore plan copy verbatim.
  - **(d) Footer color `#444452` (≈2.0:1 on `#06060c` — fails WCAG AA 4.5:1) → bumped to `#7a7a8c` (≈5.1:1, passes AA).** Parity with the email-template footer hygiene fix from Phase D (commit `15d71ca`). Same bump also applied to input placeholder text (also `#444452` in raw output).
