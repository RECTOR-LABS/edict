import Link from "next/link";
import type { Route } from "next";
import { eq } from "drizzle-orm";
import { Plus, ArrowRight, FileText } from "lucide-react";

import { listDocs } from "@/lib/db/queries/docs";
import { adminDb, schema } from "@/lib/db";
import { getContext } from "@/lib/auth/context";
import { requireAdminSession } from "@/lib/auth/middleware";
import { AdminNav } from "@/app/(admin)/_components/admin-nav";

// ── Page (server component) ──────────────────────────────────────────────────

export default async function AdminDocsPage() {
  return requireAdminSession(async () => {
  const ctx = getContext();
  if (ctx.kind !== "admin") {
    throw new Error("unexpected: non-admin context in /admin/docs");
  }

  // Resolve admin email for nav display.
  const [adminRow] = await adminDb
    .select({ email: schema.admins.email })
    .from(schema.admins)
    .where(eq(schema.admins.id, ctx.adminId))
    .limit(1);

  const adminEmail = adminRow?.email ?? ctx.adminId;

  const docs = await listDocs();

  return (
    <div className="min-h-screen bg-[#06060c] text-white font-sans">
      <AdminNav adminEmail={adminEmail} />

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* ── Page header ── */}
        <div className="mb-8 flex items-end justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8a8a93]">
              Docs
            </p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white">Docs</h1>
          </div>

          {/* + New doc button — outlined style */}
          <Link
            href={"/admin/docs/new" as Route}
            className="group flex items-center gap-2 rounded-sm border border-[rgba(255,255,255,0.12)] px-4 py-2 font-mono text-xs text-[#8a8a93] transition-all duration-150 hover:border-[#00e5ff]/50 hover:bg-[#00e5ff]/5 hover:text-white"
          >
            <Plus
              size={13}
              strokeWidth={2}
              className="text-[#00e5ff] transition-transform duration-150 group-hover:scale-110"
            />
            New doc
          </Link>
        </div>

        {/* ── Docs table ── */}
        <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#0d0d14]">
          {docs.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <FileText
                size={40}
                strokeWidth={1.25}
                className="text-white opacity-30"
                aria-hidden="true"
              />
              <p className="font-sans text-sm text-[#8a8a93]">
                No docs yet. Create the first one.
              </p>
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              {/* Table header */}
              <thead>
                <tr className="bg-[#08080c]">
                  <th className="px-6 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
                    Slug
                  </th>
                  <th className="px-6 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
                    Title
                  </th>
                  <th className="px-6 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
                    Updated
                  </th>
                  <th className="px-6 py-3 text-right font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {docs.map((d) => (
                  <tr
                    key={d.id}
                    className="group relative border-t border-[rgba(255,255,255,0.06)] transition-colors duration-150 hover:bg-[rgba(255,255,255,0.015)]"
                  >
                    {/* Body type — mono cyan badge */}
                    <td className="px-6 py-5">
                      <span className="inline-block rounded-sm border border-[#00e5ff]/20 bg-[#00e5ff]/5 px-2 py-0.5 font-mono text-[11px] text-[#00e5ff]">
                        {d.bodyType}
                      </span>
                    </td>

                    {/* Slug — mono cyan */}
                    <td className="px-6 py-5">
                      <span className="font-mono text-[14px] text-[#00e5ff]">{d.slug}</span>
                    </td>

                    {/* Title — micro-interaction: translate-x-1 on row hover */}
                    <td className="px-6 py-5">
                      <span className="inline-block text-[14px] font-medium text-white transition-transform duration-150 group-hover:translate-x-px">
                        {d.title}
                      </span>
                    </td>

                    {/* Updated at — YYYY-MM-DD mono muted */}
                    <td className="px-6 py-5">
                      <span className="font-mono text-[12px] text-[#8a8a93]">
                        {d.updatedAt.toISOString().slice(0, 10)}
                      </span>
                    </td>

                    {/* Actions — Open link */}
                    <td className="px-6 py-5 text-right">
                      <Link
                        href={`/admin/docs/${d.id}` as Route}
                        className="group/open inline-flex items-center gap-1.5 font-mono text-xs text-[#8a8a93] transition-colors duration-150 hover:text-[#00e5ff]"
                      >
                        Open
                        <ArrowRight
                          size={14}
                          strokeWidth={1.75}
                          className="transition-transform duration-150 group-hover/open:translate-x-0.5"
                        />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
  });
}
