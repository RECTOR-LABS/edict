# Magic-link Email — Design Source

Source of truth for the magic-link email surface. Generated via aidesigner, ported into `lib/mail/templates/magic-link.tsx` as a react-email component. Re-generate from this prompt if/when the design evolves.

## Prompt (verbatim, Task 25 Step 1)

```
Email template for a multi-tenant document delivery platform called Edict.
Recipient has just been invited to view a formal document. Voice: authoritative but humble, dev-humble tone.
Must render correctly in email clients (inline styles, table layout, no external CSS).
Dark-mode aware. No emoji icons.
Content blocks:
- Header: wordmark "Edict", muted subtitle "A rector issues edicts"
- Body: "{{actor_name}} has issued you an edict: {{doc_title}}"
- Primary CTA button: "Open your edict" linking to {{magic_link_url}}
- Small print: "This link is valid for 24 hours. If you did not expect this, ignore it."
- Footer: "Edict — edict.rectorspace.com"
Use a deep-background palette (#06060c) with a cyan accent (#00e5ff) for the CTA.
Brand: professional trust-first design language.
```

**Repo context supplied:** dark #06060c + cyan #00e5ff palette, Plus Jakarta Sans sans / JetBrains Mono mono, dev-humble tone, no emoji icons, react-email TSX target, ~560px content width, light+dark client support. Companion reference: arena-implementation-plan.html.

**Viewport:** desktop.
**Run id:** `29a6aa2b-c63b-412b-a234-8a3f3eec9edd` (2026-04-19).

## Design language extracted from the generated HTML

- **Wordmark:** monospace `Edict` with a cyan `.` period suffix — "Edict."
- **Header subtitle:** uppercase monospace, muted slate (`#8b8b99`), tracked `letter-spacing: 0.5px`, font-size 11px.
- **Header divider:** 1px `#1a1a24` hairline below header.
- **Primary body copy:** sans-serif, slate `#d4d4dc`, 16px, line-height 1.6. Actor name bold `#ffffff`.
- **Document title block:** slight panel `#0a0a14` with a 3px cyan left accent — panel has 24/32 padding. Title in monospace, 15px, weight 500, white. (Skip the filler "Secure Document Payload" subtitle and the CSS-constructed doc icon from the raw output — neither was in the spec and they reduce rendering robustness.)
- **CTA:** bulletproof table-based button, solid cyan fill `#00e5ff`, body text `#06060c` (background color inverted for contrast), monospace, uppercase, weight 700, tracking 1px, padding 16/32. Label: "Open your edict →".
- **Fine print:** sans-serif 12px, muted `#666677`. Tighten to the spec copy exactly: "This link is valid for 24 hours. If you did not expect this, ignore it." (The raw output expanded this with extra sentences; keep the spec wording.)
- **Footer wordmark:** monospace 11px, `#7a7a8c`, "EDICT — edict.rectorspace.com". Note: the raw aidesigner output used `#4a4a59` here, but that value yields ≈2.8:1 contrast on the `#06060c` background — below the WCAG AA 4.5:1 threshold for small text. Bumped to `#7a7a8c` (≈5.1:1) so the deployed template clears AA with margin to account for email-renderer anti-aliasing variation. The raw HTML block below is preserved as-is (historical artifact). The raw output also added a small decorative cyan 6×6 square in the bottom-right; keep it if it ports cleanly, drop if it fights the `react-email` Container.
- **Dark mode:** enforced via `prefers-color-scheme: dark` block — matters for Gmail web / Outlook light-mode inversion.

## TSX port notes

The aidesigner output is raw bulletproof HTML. The TSX port uses `@react-email/components` primitives (`Html`, `Head`, `Body`, `Container`, `Section`, `Text`, `Button`, `Hr`) so `@react-email/render` produces equivalent email-safe output. The plan's Task 25 Step 2 provides the structural TSX template; the design language above refines the typography, color, and layout choices inside that template.

Props shape: `{ recipientName?: string | null; docTitle: string; magicLinkUrl: string; actorName: string }`.

## Raw aidesigner output

The HTML below is captured verbatim for reference. Do not import or ship it — the TSX component in `lib/mail/templates/magic-link.tsx` is the deliverable.

```html
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<!--
  aesthetic_dna: Cyber-Brutalist Legal Tech / Dev-Humble
  ui_paradigm: Bulletproof Transactional Email Workflow
  palette choice: Deep Space (#06060c), Cyan Accent (#00e5ff), Monochrome text layering.
-->
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>Edict: Document Delivery</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    /* Reset & Email Client Fixes */
    table, td, div, h1, p { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"; }
    body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; background-color: #06060c; color: #f0f0f5; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    a { color: #00e5ff; text-decoration: none; }
    a:hover { text-decoration: underline; color: #5ce6f8 !important; }

    /* Interactive States for Webmail */
    .cta-button:hover { background-color: #00c0d4 !important; border-color: #00c0d4 !important; }
    .doc-box:hover { border-left-color: #ffffff !important; }

    /* Responsive */
    @media screen and (max-width: 600px) {
      .container { width: 100% !important; padding: 0 20px !important; }
      .content-padding { padding-left: 20px !important; padding-right: 20px !important; }
      .header-padding { padding-top: 40px !important; }
      .mobile-full { width: 100% !important; display: block !important; }
    }

    /* Dark Mode Enforcement for clients that invert */
    @media (prefers-color-scheme: dark) {
      body, table, td { background-color: #06060c !important; color: #f0f0f5 !important; }
      .doc-bg { background-color: #0a0a14 !important; }
      .text-muted { color: #8b8b99 !important; }
      .divider { border-color: #1a1a24 !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; width: 100%; word-break: break-word; -webkit-font-smoothing: antialiased; background-color: #06060c; color: #f0f0f5;">

  <!-- Hidden Preheader Text -->
  <div style="display: none; max-height: 0px; overflow: hidden; font-size: 0px; line-height: 0px; color: #06060c; opacity: 0;">
    {{actor_name}} has issued you an edict: {{doc_title}}
  </div>

  <!-- Main Background Wrapper -->
  <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #06060c;">
    <tr>
      <td align="center" style="padding: 40px 0;">

        <!-- Container -->
        <table class="container" width="600" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin: 0 auto; width: 600px; max-width: 600px; background-color: #06060c;">

          <!-- Header Area -->
          <tr>
            <td class="content-padding header-padding" align="left" style="padding: 0 40px 40px 40px;">
              <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td align="left">
                    <div style="font-family: ui-monospace, Menlo, Monaco, 'Cascadia Mono', 'Segoe UI Mono', 'Roboto Mono', monospace; font-size: 28px; font-weight: 700; color: #ffffff; letter-spacing: -1px; margin: 0; line-height: 1;">
                      Edict<span style="color: #00e5ff;">.</span>
                    </div>
                  </td>
                  <td align="right" valign="bottom">
                    <div class="text-muted" style="font-family: ui-monospace, Menlo, Monaco, 'Cascadia Mono', 'Segoe UI Mono', 'Roboto Mono', monospace; font-size: 11px; font-weight: 400; color: #8b8b99; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; line-height: 1;">
                      A rector issues edicts
                    </div>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top: 24px;">
                    <hr class="divider" style="border: 0; border-top: 1px solid #1a1a24; margin: 0;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content Area -->
          <tr>
            <td class="content-padding" align="left" style="padding: 0 40px;">
              <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td align="left" style="padding-bottom: 24px;">
                    <p style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; font-weight: 400; color: #d4d4dc; line-height: 1.6; margin: 0;">
                      <strong style="color: #ffffff; font-weight: 600;">{{actor_name}}</strong> has issued you an edict:
                    </p>
                  </td>
                </tr>
              </table>

              <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td class="doc-bg doc-box" align="left" style="background-color: #0a0a14; padding: 24px 32px; border-left: 3px solid #00e5ff; border-top: 1px solid #1a1a24; border-right: 1px solid #1a1a24; border-bottom: 1px solid #1a1a24;">
                    <div style="font-family: ui-monospace, Menlo, Monaco, 'Cascadia Mono', 'Segoe UI Mono', 'Roboto Mono', monospace; font-size: 15px; font-weight: 500; color: #ffffff; line-height: 1.5; margin: 0; word-break: break-all;">
                      {{doc_title}}
                    </div>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr><td height="40" style="font-size:40px; line-height:40px;">&nbsp;</td></tr>

          <!-- Primary CTA -->
          <tr>
            <td class="content-padding" align="left" style="padding: 0 40px;">
              <table border="0" cellspacing="0" cellpadding="0" role="presentation">
                <tr>
                  <td align="center" style="background-color: #00e5ff; border: 1px solid #00e5ff;">
                    <a href="{{magic_link_url}}" target="_blank" class="cta-button" style="display: inline-block; font-family: ui-monospace, Menlo, Monaco, 'Cascadia Mono', 'Segoe UI Mono', 'Roboto Mono', monospace; font-size: 13px; font-weight: 700; color: #06060c; text-decoration: none; padding: 16px 32px; text-transform: uppercase; letter-spacing: 1px; line-height: 100%;">
                      Open your edict &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr><td height="48" style="font-size:48px; line-height:48px;">&nbsp;</td></tr>

          <!-- Footer -->
          <tr>
            <td class="content-padding" align="left" style="padding: 0 40px 40px 40px;">
              <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="padding-top: 24px; border-top: 1px solid #1a1a24;">
                    <p class="text-muted" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; color: #666677; line-height: 1.6; margin: 0 0 16px 0;">
                      This link is valid for 24 hours. If you did not expect this, ignore it.
                    </p>
                    <p style="font-family: ui-monospace, Menlo, Monaco, 'Cascadia Mono', 'Segoe UI Mono', 'Roboto Mono', monospace; font-size: 11px; color: #4a4a59; margin: 0; letter-spacing: 0.5px;">
                      EDICT — <a href="https://edict.rectorspace.com" target="_blank" style="color: #666677; text-decoration: none; border-bottom: 1px solid #333342;">edict.rectorspace.com</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
```

## Iteration history

- 2026-04-19 — initial generation from Task 25 Step 1 prompt (run id above). Accepted. The TSX port trims three elements from the raw output: (a) the "Secure Document Payload" subtitle below the doc title (not in spec), (b) the CSS-constructed doc icon (fragile in email clients), (c) the embellished disclaimer copy (restored to spec wording).
