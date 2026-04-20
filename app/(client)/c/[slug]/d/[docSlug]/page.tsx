import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/auth/context";
import { getDocForClient } from "@/lib/db/queries/docs";
import { RenderHtmlDoc } from "@/lib/docs/render-html";
import { renderMarkdown } from "@/lib/docs/render-markdown";
import { ViewBeacon } from "@/components/ViewBeacon";

export default async function DocViewerPage({
  params,
}: {
  params: Promise<{ slug: string; docSlug: string }>;
}) {
  const { slug, docSlug } = await params;
  const ctx = getContext();
  if (ctx.kind !== "client") throw new Error("client only");

  const doc = await getDocForClient(ctx.clientId, docSlug);
  if (!doc) notFound();

  const rendered = doc.bodyType === "markdown" ? await renderMarkdown(doc.body) : null;

  return (
    <main className="px-4 py-8 max-w-5xl mx-auto">
      <ViewBeacon docId={doc.id} />

      <nav className="mb-6">
        <Link
          href={`/c/${slug}` as Route}
          className="text-sm text-[#8a8a93] hover:text-[var(--tenant-color,#00e5ff)] transition-colors inline-flex items-center gap-1"
        >
          ← Back to dashboard
        </Link>
      </nav>

      <header className="mb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--tenant-color,#00e5ff)] mb-1">
          {doc.bodyType.toUpperCase()} · /{doc.slug}
        </p>
        <h1 className="text-3xl font-semibold">{doc.title}</h1>
      </header>

      {doc.bodyType === "html" ? (
        <RenderHtmlDoc body={doc.body} />
      ) : (
        <article
          className="prose prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: rendered ?? "" }}
        />
      )}
    </main>
  );
}
