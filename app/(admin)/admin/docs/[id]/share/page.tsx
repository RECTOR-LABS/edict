import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, Check, Send, Trash2 } from "lucide-react";

import { adminDb, schema } from "@/lib/db";
import { getContext } from "@/lib/auth/context";
import { requireAdminSession } from "@/lib/auth/middleware";
import { getDocById } from "@/lib/db/queries/docs";
import { listClients } from "@/lib/db/queries/clients";
import { listSharesForDoc } from "@/lib/db/queries/shares";
import { AdminNav } from "@/app/(admin)/_components/admin-nav";

// ── Page (server component) ──────────────────────────────────────────────────

export default async function AdminDocSharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return requireAdminSession(async () => {
  const ctx = getContext();
  if (ctx.kind !== "admin") {
    throw new Error("unexpected: non-admin context in /admin/docs/[id]/share");
  }

  // Resolve admin email for nav display.
  const [adminRow] = await adminDb
    .select({ email: schema.admins.email })
    .from(schema.admins)
    .where(eq(schema.admins.id, ctx.adminId))
    .limit(1);

  const adminEmail = adminRow?.email ?? ctx.adminId;

  const doc = await getDocById(id);
  if (!doc) notFound();

  const clients = await listClients();
  const shares = await listSharesForDoc(id);

  // Build a lookup: clientId → share row (active only).
  const activeShareByClientId = new Map(
    shares
      .filter((s) => s.revokedAt === null)
      .map((s) => [s.clientId, s]),
  );

  return (
    <div className="min-h-screen bg-[#06060c] text-white font-sans">
      <AdminNav adminEmail={adminEmail} />

      <main className="mx-auto max-w-3xl px-10 py-10">
        {/* Back link */}
        <Link
          href={`/admin/docs/${doc.id}` as Route}
          className="group mb-8 inline-flex items-center gap-1.5 font-mono text-[11px] text-[#8a8a93] transition-colors duration-150 hover:text-white"
        >
          <ArrowLeft
            size={13}
            strokeWidth={2}
            className="transition-transform duration-150 group-hover:-translate-x-0.5"
          />
          /admin/docs/{doc.slug}
        </Link>

        {/* Page header */}
        <div className="mb-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8a8a93]">
            Share
          </p>
          <h1 className="mt-1.5 flex flex-wrap items-baseline gap-2 text-2xl font-semibold tracking-tight text-white">
            Share
            <span className="font-mono text-[15px] font-normal text-[#00e5ff]">{doc.title}</span>
          </h1>
        </div>

        {/* Clients list */}
        <div className="border border-[rgba(255,255,255,0.08)] bg-[#0d0d14]">
          {clients.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
              <p className="font-sans text-sm text-[#8a8a93]">
                No clients yet.{" "}
                <Link
                  href={"/admin/clients/new" as Route}
                  className="text-[#00e5ff] transition-opacity duration-150 hover:opacity-75"
                >
                  Create one first.
                </Link>
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[rgba(255,255,255,0.06)]">
              {clients.map((client) => {
                const activeShare = activeShareByClientId.get(client.id) ?? null;

                return (
                  <li key={client.id} className="px-6 py-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      {/* Left: slug + name + shared date */}
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          {activeShare !== null && (
                            <Check
                              size={12}
                              strokeWidth={2.5}
                              className="text-[#00e5ff] shrink-0"
                              aria-label="Shared"
                            />
                          )}
                          <span className="font-mono text-[13px] text-[#00e5ff]">
                            {client.slug}
                          </span>
                          <span className="text-[13px] font-medium text-white">{client.name}</span>
                        </div>
                        {activeShare !== null && (
                          <p className="font-mono text-[11px] text-[#8a8a93] pl-[20px]">
                            Shared on{" "}
                            {activeShare.sharedAt.toISOString().slice(0, 10)}
                          </p>
                        )}
                      </div>

                      {/* Right: unshare button + share form */}
                      <div className="flex flex-wrap items-center gap-3">
                        {/* Unshare button — shown only when actively shared */}
                        {activeShare !== null && (
                          <form action={`/api/admin/docs/${doc.id}/share/revoke`} method="POST">
                            <input type="hidden" name="docId" value={doc.id} />
                            <input type="hidden" name="clientId" value={client.id} />
                            <button
                              type="submit"
                              className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#8a8a93] transition-colors duration-150 hover:text-[#ef4444]"
                            >
                              <Trash2 size={12} strokeWidth={1.75} />
                              Unshare
                            </button>
                          </form>
                        )}

                        {/* Share form — always visible (can add new recipients to active share too) */}
                        <form action={`/api/admin/docs/${doc.id}/share`} method="POST" className="flex items-center gap-2">
                          <input type="hidden" name="docId" value={doc.id} />
                          <input type="hidden" name="clientId" value={client.id} />
                          <input
                            name="emails"
                            type="text"
                            required
                            placeholder="name@company.com, another@company.com"
                            aria-label={`Recipient emails for ${client.name}`}
                            className="w-[260px] rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#030305] px-3 py-2 font-mono text-[12px] text-white placeholder:text-[#8a8a93]/50 focus:border-[#00e5ff] focus:outline-none focus:[box-shadow:0_0_0_1px_#00e5ff,0_0_12px_rgba(0,229,255,0.10)] transition-colors duration-150"
                          />
                          <button
                            type="submit"
                            className="inline-flex items-center gap-1.5 bg-[#00e5ff] px-4 py-2 font-mono text-[11px] font-bold text-[#06060c] transition-opacity duration-150 hover:opacity-90"
                            style={{
                              boxShadow:
                                "0 0 16px rgba(0,229,255,0.20), 0 0 32px rgba(0,229,255,0.08)",
                            }}
                          >
                            <Send size={12} strokeWidth={2} />
                            Send links
                          </button>
                        </form>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
  });
}
