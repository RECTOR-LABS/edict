import { eq, isNull, desc, sql } from "drizzle-orm";
import Link from "next/link";
import type { Route } from "next";
import { Users, FileText, Eye, Share2, ArrowRight } from "lucide-react";

import { listClients } from "@/lib/db/queries/clients";
import { listDocs } from "@/lib/db/queries/docs";
import { adminDb, schema } from "@/lib/db";
import { getContext } from "@/lib/auth/context";
import { requireAdminSession } from "@/lib/auth/middleware";
import { AdminNav } from "@/app/(admin)/_components/admin-nav";

// ── Internal sub-components ──────────────────────────────────────────────────

type SummaryCardProps = {
  label: string;
  count: number;
  icon: React.ReactNode;
  // Route cast: downstream routes (Tasks 37-42) don't exist yet; typed-route assertion is intentional.
  href: Route;
};

function SummaryCard({ label, count, icon, href }: SummaryCardProps) {
  return (
    <Link href={href} className="group relative block overflow-hidden rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#0d0d14] p-6 transition-colors duration-200 hover:bg-[#14141e]">
      {/* Animated top-line gradient on hover */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px] origin-left scale-x-0 bg-gradient-to-r from-transparent via-[#00e5ff] to-transparent opacity-0 transition-all duration-300 group-hover:scale-x-100 group-hover:opacity-100"
        aria-hidden="true"
      />

      {/* Icon — top-right */}
      <div className="absolute right-5 top-5 text-[#8a8a93] transition-colors duration-200 group-hover:text-[#00e5ff]">
        {icon}
      </div>

      {/* Eyebrow label */}
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">{label}</p>

      {/* Big number */}
      <p className="mt-3 font-sans text-5xl font-light tracking-tighter text-white">{count}</p>
    </Link>
  );
}

type ShareRowProps = {
  docTitle: string;
  clientName: string;
  clientSlug: string;
  sharedAt: Date;
};

function ShareRow({ docTitle, clientName, clientSlug, sharedAt }: ShareRowProps) {
  const ts = sharedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return (
    <div className="group grid grid-cols-[1fr_1.5fr_auto] items-center gap-4 border-b border-[rgba(255,255,255,0.06)] px-4 py-3 last:border-b-0 relative">
      {/* Left-accent on hover */}
      <div
        className="pointer-events-none absolute left-0 inset-y-0 w-[2px] origin-center scale-y-0 bg-[#00e5ff] transition-transform duration-150 group-hover:scale-y-100"
        aria-hidden="true"
      />

      <span className="flex items-center gap-2 truncate text-sm text-white">
        <FileText size={13} strokeWidth={1.5} className="shrink-0 text-[#8a8a93]" />
        <span className="truncate">{docTitle}</span>
      </span>

      <Link
        href={`/admin/clients/${clientSlug}` as Route}
        className="truncate font-mono text-xs text-[#8a8a93] transition-colors duration-150 hover:text-[#00e5ff]"
      >
        {clientName}
      </Link>

      <span className="font-mono text-[11px] text-[#8a8a93] tabular-nums">{ts}</span>
    </div>
  );
}

type ViewRowProps = {
  memberEmail: string;
  docTitle: string;
  viewedAt: Date;
  /** Snapshot of Date.now() from the parent — avoids calling an impure function inside render. */
  nowMs: number;
};

function ViewRow({ memberEmail, docTitle, viewedAt, nowMs }: ViewRowProps) {
  const ts = viewedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  // Status dot: cyan if viewed in the last 5 minutes, muted otherwise.
  const isRecent = nowMs - viewedAt.getTime() < 5 * 60 * 1_000;

  return (
    <div className="group grid grid-cols-[1fr_2fr_auto] items-center gap-4 border-b border-[rgba(255,255,255,0.06)] px-4 py-3 last:border-b-0 relative">
      {/* Left-accent on hover */}
      <div
        className="pointer-events-none absolute left-0 inset-y-0 w-[2px] origin-center scale-y-0 bg-[#00e5ff] transition-transform duration-150 group-hover:scale-y-100"
        aria-hidden="true"
      />

      <span className="flex items-center gap-2 truncate">
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${isRecent ? "bg-[#00e5ff]" : "bg-[#8a8a93]"}`}
          aria-hidden="true"
        />
        <span className="truncate font-mono text-xs text-[#8a8a93]">{memberEmail}</span>
      </span>

      <span className="truncate text-sm text-white">{docTitle}</span>

      <span className="font-mono text-[11px] text-[#8a8a93] tabular-nums">{ts}</span>
    </div>
  );
}

// ── Page (server component) ──────────────────────────────────────────────────

export default async function AdminDashboard() {
  return requireAdminSession(async () => {
  const ctx = getContext();
  if (ctx.kind !== "admin") {
    throw new Error("unexpected: non-admin context in /admin");
  }

  // Fetch admin email for nav meta (single-query, negligible overhead).
  const [adminRow] = await adminDb
    .select({ email: schema.admins.email })
    .from(schema.admins)
    .where(eq(schema.admins.id, ctx.adminId))
    .limit(1);

  const adminEmail = adminRow?.email ?? ctx.adminId;

  // Core counts.
  const [clients, docs, viewsResult] = await Promise.all([
    listClients(),
    listDocs(),
    adminDb
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.auditLog)
      .where(
        sql`${schema.auditLog.eventType} = 'doc_viewed'
            AND ${schema.auditLog.createdAt} > now() - interval '7 days'`,
      ),
  ]);

  const views7d: number = viewsResult[0]?.n ?? 0;

  // Recent shares (top 5, non-revoked).
  const recentShares = await adminDb
    .select({
      docTitle: schema.docs.title,
      clientName: schema.clients.name,
      clientSlug: schema.clients.slug,
      sharedAt: schema.docShares.sharedAt,
    })
    .from(schema.docShares)
    .innerJoin(schema.docs, eq(schema.docShares.docId, schema.docs.id))
    .innerJoin(schema.clients, eq(schema.docShares.clientId, schema.clients.id))
    .where(isNull(schema.docShares.revokedAt))
    .orderBy(desc(schema.docShares.sharedAt))
    .limit(5);

  // Snapshot of now for ViewRow isRecent comparison.
  // Server component, no re-renders — Date.now() is safe here.
  const nowMs = Date.now();

  // Recent views (top 5). auditLog.docId is a direct FK column — no json extraction needed.
  // auditLog.actorId = clientMember UUID for doc_viewed events.
  // Note: no doc_viewed events exist in Phase F1 (Task 47 writes them). Empty state expected.
  const recentViews = await adminDb
    .select({
      memberEmail: schema.clientMembers.email,
      docTitle: schema.docs.title,
      viewedAt: schema.auditLog.createdAt,
    })
    .from(schema.auditLog)
    .innerJoin(schema.clientMembers, eq(schema.auditLog.actorId, schema.clientMembers.id))
    .innerJoin(schema.docs, eq(schema.auditLog.docId, schema.docs.id))
    .where(eq(schema.auditLog.eventType, "doc_viewed"))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(5);

  return (
    <div className="min-h-screen bg-[#06060c] text-white font-sans">
      <AdminNav adminEmail={adminEmail} />

      {/* ── Main content ── */}
      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* Page heading */}
        <div className="mb-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8a8a93]">
            Platform overview
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white">Dashboard</h1>
        </div>

        {/* ── Summary cards ── */}
        <section aria-label="Summary metrics" className="mb-10">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <SummaryCard
              label="Active clients"
              count={clients.length}
              icon={<Users size={18} strokeWidth={1.5} />}
              href={"/admin/clients" as Route}
            />
            <SummaryCard
              label="Docs live"
              count={docs.length}
              icon={<FileText size={18} strokeWidth={1.5} />}
              href={"/admin/docs" as Route}
            />
            <SummaryCard
              label="Views last 7 days"
              count={views7d}
              icon={<Eye size={18} strokeWidth={1.5} />}
              href={"/admin/audit?event=doc_viewed" as Route}
            />
          </div>
        </section>

        {/* ── Recent Shares ── */}
        <section aria-label="Recent shares" className="mb-8">
          <div className="mb-3 flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] pb-2">
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
              <Share2 size={12} strokeWidth={1.5} />
              Recent shares
            </span>
            <span className="font-mono text-[10px] text-[#8a8a93]">top 5</span>
          </div>

          <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#0d0d14]">
            {recentShares.length === 0 ? (
              <p className="px-4 py-6 font-mono text-xs text-[#8a8a93]">No shares yet.</p>
            ) : (
              recentShares.map((row, i) => (
                <ShareRow
                  key={i}
                  docTitle={row.docTitle}
                  clientName={row.clientName}
                  clientSlug={row.clientSlug}
                  sharedAt={row.sharedAt}
                />
              ))
            )}
          </div>
        </section>

        {/* ── Recent Views ── */}
        <section aria-label="Recent views">
          <div className="mb-3 flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] pb-2">
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
              <Eye size={12} strokeWidth={1.5} />
              Recent views
            </span>
            <span className="font-mono text-[10px] text-[#8a8a93]">top 5</span>
          </div>

          <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#0d0d14]">
            {recentViews.length === 0 ? (
              <p className="px-4 py-6 font-mono text-xs text-[#8a8a93]">No recent views yet.</p>
            ) : (
              recentViews.map((row, i) => (
                <ViewRow
                  key={i}
                  memberEmail={row.memberEmail}
                  docTitle={row.docTitle}
                  viewedAt={row.viewedAt}
                  nowMs={nowMs}
                />
              ))
            )}
          </div>

          {/* View All Event Logs */}
          <div className="mt-4 flex justify-end">
            <Link
              href={"/admin/audit" as Route}
              className="group flex items-center gap-1.5 font-mono text-xs text-[#8a8a93] transition-colors duration-150 hover:text-[#00e5ff]"
            >
              View all event logs
              <ArrowRight
                size={12}
                strokeWidth={2}
                className="transition-transform duration-150 group-hover:translate-x-0.5"
              />
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
  });
}
