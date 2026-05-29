import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, Users, UserPlus, Trash2 } from "lucide-react";

import { adminDb, schema } from "@/lib/db";
import { getContext } from "@/lib/auth/context";
import { requireAdminSession } from "@/lib/auth/middleware";
import { getClientBySlug } from "@/lib/db/queries/clients";
import { listMembersForClient } from "@/lib/db/queries/members";
import { AdminNav } from "@/app/(admin)/_components/admin-nav";

// ── Page (server component) ──────────────────────────────────────────────────

export default async function AdminClientDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return requireAdminSession(async () => {
  const ctx = getContext();
  if (ctx.kind !== "admin") {
    throw new Error("unexpected: non-admin context in /admin/clients/[slug]");
  }

  // Resolve admin email for nav.
  const [adminRow] = await adminDb
    .select({ email: schema.admins.email })
    .from(schema.admins)
    .where(eq(schema.admins.id, ctx.adminId))
    .limit(1);

  const adminEmail = adminRow?.email ?? ctx.adminId;

  const client = await getClientBySlug(slug);
  if (!client) notFound();

  const members = await listMembersForClient(client.id);

  return (
    <div className="min-h-screen bg-[#06060c] text-white font-sans">
      <AdminNav adminEmail={adminEmail} />

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* Back link */}
        <Link
          href={"/admin/clients" as Route}
          className="group mb-8 inline-flex items-center gap-1.5 font-mono text-[11px] text-[#8a8a93] transition-colors duration-150 hover:text-white"
        >
          <ArrowLeft
            size={13}
            strokeWidth={2}
            className="transition-transform duration-150 group-hover:-translate-x-0.5"
          />
          /admin/clients
        </Link>

        {/* ── Page header ── */}
        <div className="mb-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8a8a93]">
            Client
          </p>
          <h1 className="mt-1.5 flex items-baseline gap-2 text-2xl font-semibold tracking-tight text-white">
            {client.name}
            <span className="font-mono text-[15px] font-normal text-[#8a8a93]">
              /{client.slug}
            </span>
          </h1>
        </div>

        {/* ── Client metadata ── */}
        {(client.brandColor !== null || client.logoUrl !== null) && (
          <div className="mb-8 flex flex-col gap-3 rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#0d0d14] p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
              Metadata
            </p>
            <div className="flex flex-wrap gap-6">
              {client.brandColor !== null && (
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-white/10"
                    style={{ backgroundColor: client.brandColor }}
                    aria-hidden="true"
                  />
                  <span className="font-mono text-[12px] text-[#8a8a93]">{client.brandColor}</span>
                </div>
              )}
              {client.logoUrl !== null && (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#8a8a93]/60">
                    Logo
                  </span>
                  <span className="font-mono text-[12px] text-[#8a8a93]">{client.logoUrl}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Members section ── */}
        <section aria-labelledby="members-heading">
          <div className="mb-4 flex items-center gap-2">
            <Users
              size={14}
              strokeWidth={1.75}
              className="text-[#00e5ff]"
              aria-hidden="true"
            />
            <h2
              id="members-heading"
              className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8a8a93]"
            >
              Members
              {members.length > 0 && (
                <span className="ml-2 text-[#8a8a93]/60">({members.length})</span>
              )}
            </h2>
          </div>

          <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#0d0d14]">
            {members.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center gap-2 py-12">
                <Users
                  size={32}
                  strokeWidth={1.25}
                  className="text-white opacity-20"
                  aria-hidden="true"
                />
                <p className="font-sans text-sm text-[#8a8a93]">
                  No members yet. Add the first one below.
                </p>
              </div>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-[#08080c]">
                    <th className="px-6 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
                      Role
                    </th>
                    <th className="px-6 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
                      Added
                    </th>
                    <th className="px-6 py-3 text-right font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr
                      key={m.id}
                      className="border-t border-[rgba(255,255,255,0.06)] transition-colors duration-150 hover:bg-[rgba(255,255,255,0.015)]"
                    >
                      {/* Email */}
                      <td className="px-6 py-4">
                        <span className="text-[14px] font-medium text-white">{m.email}</span>
                      </td>

                      {/* Role */}
                      <td className="px-6 py-4">
                        <span className="font-mono text-[12px] text-[#8a8a93]">{m.role}</span>
                      </td>

                      {/* Added at */}
                      <td className="px-6 py-4">
                        <span className="font-mono text-[12px] text-[#8a8a93]">
                          {m.createdAt.toISOString().slice(0, 10)}
                        </span>
                      </td>

                      {/* Revoke */}
                      <td className="px-6 py-4 text-right">
                        <form action={`/api/admin/clients/${slug}/members/revoke`} method="POST">
                          <input type="hidden" name="memberId" value={m.id} />
                          <input type="hidden" name="clientId" value={client.id} />
                          <button
                            type="submit"
                            className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#8a8a93] transition-colors duration-150 hover:text-[#ef4444]"
                          >
                            <Trash2 size={12} strokeWidth={1.75} />
                            Revoke
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* ── Add member form ── */}
        <section aria-labelledby="add-member-heading" className="mt-8">
          <div className="mb-4 flex items-center gap-2">
            <UserPlus
              size={14}
              strokeWidth={1.75}
              className="text-[#00e5ff]"
              aria-hidden="true"
            />
            <h2
              id="add-member-heading"
              className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8a8a93]"
            >
              Add member
            </h2>
          </div>

          <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#0d0d14] p-6">
            <form action={`/api/admin/clients/${slug}/members`} method="POST" className="flex flex-wrap items-end gap-4">
              <input type="hidden" name="clientId" value={client.id} />

              {/* Email (required) */}
              <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
                <label
                  htmlFor="email"
                  className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]"
                >
                  Email <span className="text-[#00e5ff]">*</span>
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="member@example.com"
                  className="w-full rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#030305] px-4 py-2.5 text-sm text-white placeholder:text-[#8a8a93]/50 focus:border-[#00e5ff] focus:outline-none focus:[box-shadow:0_0_0_1px_#00e5ff,0_0_12px_rgba(0,229,255,0.10)] transition-colors duration-150"
                />
              </div>

              {/* Name (optional) */}
              <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
                <label
                  htmlFor="name"
                  className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]"
                >
                  Name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  placeholder="Optional display name"
                  className="w-full rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#030305] px-4 py-2.5 text-sm text-white placeholder:text-[#8a8a93]/50 focus:border-[#00e5ff] focus:outline-none focus:[box-shadow:0_0_0_1px_#00e5ff,0_0_12px_rgba(0,229,255,0.10)] transition-colors duration-150"
                />
              </div>

              {/* Role select */}
              <div className="flex min-w-[180px] flex-col gap-1.5">
                <label
                  htmlFor="role"
                  className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]"
                >
                  Role
                </label>
                <select
                  id="role"
                  name="role"
                  defaultValue="viewer"
                  className="w-full rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#030305] px-4 py-2.5 text-sm text-white focus:border-[#00e5ff] focus:outline-none focus:[box-shadow:0_0_0_1px_#00e5ff,0_0_12px_rgba(0,229,255,0.10)] transition-colors duration-150"
                >
                  <option value="viewer">viewer</option>
                  <option value="admin_of_client">admin_of_client</option>
                </select>
              </div>

              {/* Submit */}
              <div className="flex items-end">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-md bg-[#00e5ff] px-5 py-2.5 font-sans text-sm font-semibold text-[#06060c] transition-opacity duration-150 hover:opacity-90"
                  style={{
                    boxShadow: "0 0 20px rgba(0,229,255,0.25), 0 0 40px rgba(0,229,255,0.10)",
                  }}
                >
                  <UserPlus size={14} strokeWidth={2.5} />
                  Add
                </button>
              </div>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
  });
}
