import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, Eye, Users } from "lucide-react";

import { adminDb, schema } from "@/lib/db";
import { getContext } from "@/lib/auth/context";
import { getDocById } from "@/lib/db/queries/docs";
import { docAnalytics } from "@/lib/db/queries/analytics";
import { AdminNav } from "@/app/(admin)/_components/admin-nav";

// ── Sub-components ────────────────────────────────────────────────────────────

type StatCardProps = {
  label: string;
  value: number;
  icon: React.ReactNode;
};

function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <div className="relative overflow-hidden rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#0d0d14] p-6">
      {/* Icon — top-right */}
      <div className="absolute right-5 top-5 text-[#8a8a93]">{icon}</div>

      {/* Eyebrow */}
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">{label}</p>

      {/* Big number */}
      <p className="mt-3 font-sans text-5xl font-light tracking-tighter text-white">{value}</p>
    </div>
  );
}

// ── Page (server component) ──────────────────────────────────────────────────

export default async function AdminDocAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const ctx = getContext();
  if (ctx.kind !== "admin") {
    throw new Error("unexpected: non-admin context in /admin/docs/[id]/analytics");
  }

  // Resolve admin email for nav.
  const [adminRow] = await adminDb
    .select({ email: schema.admins.email })
    .from(schema.admins)
    .where(eq(schema.admins.id, ctx.adminId))
    .limit(1);

  const adminEmail = adminRow?.email ?? ctx.adminId;

  const doc = await getDocById(id);
  if (!doc) notFound();

  const { totals, byMember } = await docAnalytics(id);

  return (
    <div className="min-h-screen bg-[#06060c] font-sans text-white">
      <AdminNav adminEmail={adminEmail} />

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* Back link → doc edit page */}
        <Link
          href={`/admin/docs/${id}` as Route}
          className="group mb-8 inline-flex items-center gap-1.5 font-mono text-[11px] text-[#8a8a93] transition-colors duration-150 hover:text-white"
        >
          <ArrowLeft
            size={13}
            strokeWidth={2}
            className="transition-transform duration-150 group-hover:-translate-x-0.5"
          />
          /admin/docs/{id}
        </Link>

        {/* ── Page header ── */}
        <div className="mb-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8a8a93]">
            Analytics
          </p>
          <h1 className="mt-1.5 flex flex-wrap items-baseline gap-2 text-2xl font-semibold tracking-tight text-white">
            {doc.title}
            <span className="font-mono text-[15px] font-normal text-[#00e5ff]">/{doc.slug}</span>
          </h1>
        </div>

        {/* ── Summary cards ── */}
        <section aria-label="Analytics summary" className="mb-10">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              label="Total views"
              value={totals.views}
              icon={<Eye size={18} strokeWidth={1.5} />}
            />
            <StatCard
              label="Unique viewers"
              value={totals.uniqueViewers}
              icon={<Users size={18} strokeWidth={1.5} />}
            />
          </div>
        </section>

        {/* ── By-member breakdown ── */}
        <section aria-labelledby="by-member-heading">
          <div className="mb-3 flex items-center gap-2 border-b border-[rgba(255,255,255,0.08)] pb-2">
            <Users size={12} strokeWidth={1.5} className="text-[#00e5ff]" aria-hidden="true" />
            <h2
              id="by-member-heading"
              className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]"
            >
              By member
              {byMember.length > 0 && (
                <span className="ml-2 text-[#8a8a93]/60">({byMember.length})</span>
              )}
            </h2>
          </div>

          <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#0d0d14]">
            {byMember.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center gap-2 py-12">
                <Eye
                  size={30}
                  strokeWidth={1.25}
                  className="text-white opacity-30"
                  aria-hidden="true"
                />
                <p className="font-sans text-sm text-[#8a8a93]">No views yet.</p>
              </div>
            ) : (
              byMember.map((row, i) => {
                const ts = row.lastViewedAt
                  ? new Date(row.lastViewedAt).toISOString().replace("T", " ").slice(0, 16) +
                    " UTC"
                  : "—";
                const label = row.memberEmail ?? row.actorId ?? "unknown";
                const isEmail = !!row.memberEmail;

                return (
                  <div
                    key={i}
                    className="group relative flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] px-4 py-3 last:border-b-0"
                  >
                    {/* Left-accent on hover */}
                    <div
                      className="pointer-events-none absolute inset-y-0 left-0 w-[2px] origin-center scale-y-0 bg-[#00e5ff] transition-transform duration-150 group-hover:scale-y-100"
                      aria-hidden="true"
                    />

                    {/* Actor identity */}
                    <span
                      className={`truncate font-mono text-xs ${isEmail ? "text-[#00e5ff]" : "text-[#8a8a93]"}`}
                      title={label}
                    >
                      {label}
                    </span>

                    {/* View count + last-seen */}
                    <span className="ml-4 shrink-0 font-mono text-[11px] tabular-nums text-[#8a8a93]">
                      {row.views} {row.views === 1 ? "view" : "views"} · last {ts}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
