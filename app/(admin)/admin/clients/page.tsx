import Link from "next/link";
import type { Route } from "next";
import { eq } from "drizzle-orm";
import { Plus, ArrowRight, FolderSearch } from "lucide-react";

import { listClients } from "@/lib/db/queries/clients";
import { adminDb, schema } from "@/lib/db";
import { getContext } from "@/lib/auth/context";
import { AdminNav } from "@/app/(admin)/_components/admin-nav";

// ── Page (server component) ──────────────────────────────────────────────────

export default async function AdminClientsPage() {
  const ctx = getContext();
  if (ctx.kind !== "admin") {
    throw new Error("unexpected: non-admin context in /admin/clients");
  }

  // Resolve admin email for nav display.
  const [adminRow] = await adminDb
    .select({ email: schema.admins.email })
    .from(schema.admins)
    .where(eq(schema.admins.id, ctx.adminId))
    .limit(1);

  const adminEmail = adminRow?.email ?? ctx.adminId;

  const clients = await listClients();

  return (
    <div className="min-h-screen bg-[#06060c] text-white font-sans">
      <AdminNav adminEmail={adminEmail} />

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* ── Page header ── */}
        <div className="mb-8 flex items-end justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8a8a93]">
              Clients
            </p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white">Clients</h1>
          </div>

          {/* + New client button — outlined style */}
          <Link
            href={"/admin/clients/new" as Route}
            className="group flex items-center gap-2 rounded-sm border border-[rgba(255,255,255,0.12)] px-4 py-2 font-mono text-xs text-[#8a8a93] transition-all duration-150 hover:border-[#00e5ff]/50 hover:bg-[#00e5ff]/5 hover:text-white"
          >
            <Plus
              size={13}
              strokeWidth={2}
              className="text-[#00e5ff] transition-transform duration-150 group-hover:scale-110"
            />
            New client
          </Link>
        </div>

        {/* ── Clients table ── */}
        <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#0d0d14]">
          {clients.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <FolderSearch
                size={40}
                strokeWidth={1.25}
                className="text-white opacity-30"
                aria-hidden="true"
              />
              <p className="font-sans text-sm text-[#8a8a93]">
                No clients yet. Create the first one.
              </p>
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              {/* Table header */}
              <thead>
                <tr className="bg-[#08080c]">
                  <th className="px-6 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
                    Slug
                  </th>
                  <th className="px-6 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
                    Brand color
                  </th>
                  <th className="px-6 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
                    Created
                  </th>
                  <th className="px-6 py-3 text-right font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {clients.map((c) => (
                  <tr
                    key={c.id}
                    className="group relative border-t border-[rgba(255,255,255,0.06)] transition-colors duration-150 hover:bg-[rgba(255,255,255,0.015)]"
                  >
                    {/* Slug — mono cyan */}
                    <td className="px-6 py-5">
                      <span className="font-mono text-[14px] text-[#00e5ff]">{c.slug}</span>
                    </td>

                    {/* Name — micro-interaction: translate-x-1 on row hover */}
                    <td className="px-6 py-5">
                      <span className="inline-block text-[14px] font-medium text-white transition-transform duration-150 group-hover:translate-x-px">
                        {c.name}
                      </span>
                    </td>

                    {/* Brand color — swatch circle + hex */}
                    <td className="px-6 py-5">
                      {c.brandColor ? (
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/10"
                            style={{ backgroundColor: c.brandColor }}
                            aria-hidden="true"
                          />
                          <span className="font-mono text-[12px] text-[#8a8a93]">
                            {c.brandColor}
                          </span>
                        </span>
                      ) : (
                        <span className="font-mono text-[12px] text-[#8a8a93]/40">—</span>
                      )}
                    </td>

                    {/* Created at — YYYY-MM-DD mono muted */}
                    <td className="px-6 py-5">
                      <span className="font-mono text-[12px] text-[#8a8a93]">
                        {c.createdAt.toISOString().slice(0, 10)}
                      </span>
                    </td>

                    {/* Actions — Open link */}
                    <td className="px-6 py-5 text-right">
                      <Link
                        href={`/admin/clients/${c.id}` as Route}
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
}
