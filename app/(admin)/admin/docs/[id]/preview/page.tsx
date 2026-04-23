import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";

import { adminDb, schema } from "@/lib/db";
import { getContext } from "@/lib/auth/context";
import { requireAdminSession } from "@/lib/auth/middleware";
import { getDocById } from "@/lib/db/queries/docs";
import { AdminNav } from "@/app/(admin)/_components/admin-nav";
import { RenderHtmlDoc } from "@/lib/docs/render-html";
import { renderMarkdown } from "@/lib/docs/render-markdown";

export default async function AdminDocPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return requireAdminSession(async () => {
    const ctx = getContext();
    if (ctx.kind !== "admin") {
      throw new Error("unexpected: non-admin context in /admin/docs/[id]/preview");
    }

    const [adminRow] = await adminDb
      .select({ email: schema.admins.email })
      .from(schema.admins)
      .where(eq(schema.admins.id, ctx.adminId))
      .limit(1);

    const adminEmail = adminRow?.email ?? ctx.adminId;

    const doc = await getDocById(id);
    if (!doc) notFound();

    const rendered = doc.bodyType === "markdown" ? await renderMarkdown(doc.body) : null;

    return (
      <div className="min-h-screen bg-[#06060c] font-sans text-white">
        <AdminNav adminEmail={adminEmail} />

        <main className="mx-auto max-w-5xl px-6 py-10">
          <Link
            href={`/admin/docs/${doc.id}` as Route}
            className="group mb-8 inline-flex items-center gap-1.5 font-mono text-[11px] text-[#8a8a93] transition-colors duration-150 hover:text-white"
          >
            <ArrowLeft
              size={13}
              strokeWidth={2}
              className="transition-transform duration-150 group-hover:-translate-x-0.5"
            />
            /admin/docs/{doc.id}
          </Link>

          <header className="mb-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8a8a93]">
              Preview — {doc.bodyType.toUpperCase()} · /{doc.slug}
            </p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white">{doc.title}</h1>
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
      </div>
    );
  });
}
