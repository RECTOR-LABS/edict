// Sandboxed iframe renderer for admin-authored HTML docs.
// Security model (defense-in-depth):
//   sandbox="allow-scripts" permits JS but deliberately omits allow-same-origin,
//   so the iframe cannot touch parent cookies/storage/DOM even if hostile. Full
//   CSS isolation + XSS containment. Admin is trusted as the HTML source; this
//   sandbox is a belt-and-suspenders layer beneath that trust.

// Without an explicit <base>, a srcdoc iframe inherits its base URL from the
// parent. In-doc anchor links like href="#phase3" then resolve to the parent
// page URL + #phase3, and clicking re-navigates the iframe to that URL — which
// is blocked by our X-Frame-Options: deny header. Pinning base to about:srcdoc
// keeps hash navigation same-document so the iframe just scrolls.
export function injectIframeBase(html: string): string {
  const tag = '<base href="about:srcdoc">';
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}${tag}`);
  }
  return tag + html;
}

export function RenderHtmlDoc({ body }: { body: string }) {
  return (
    <iframe
      title="Edict document"
      srcDoc={injectIframeBase(body)}
      sandbox="allow-scripts"
      className="w-full h-[90vh] border-0 rounded-lg bg-[#06060c]"
      loading="eager"
    />
  );
}
