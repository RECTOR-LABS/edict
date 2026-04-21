// Sandboxed iframe renderer for admin-authored HTML docs.
// Security model (defense-in-depth):
//   sandbox="allow-scripts" permits JS but deliberately omits allow-same-origin,
//   so the iframe cannot touch parent cookies/storage/DOM even if hostile. Full
//   CSS isolation + XSS containment. Admin is trusted as the HTML source; this
//   sandbox is a belt-and-suspenders layer beneath that trust.
export function RenderHtmlDoc({ body }: { body: string }) {
  return (
    <iframe
      title="Edict document"
      srcDoc={body}
      sandbox="allow-scripts"
      className="w-full h-[90vh] border-0 rounded-lg bg-[#06060c]"
      loading="eager"
    />
  );
}
