import { eq } from "drizzle-orm";

import { adminDb, schema } from "@/lib/db";
import { getContext } from "@/lib/auth/context";
import { recentAuditLog } from "@/lib/db/queries/analytics";
import { AdminNav } from "@/app/(admin)/_components/admin-nav";

// ── Page (server component) ──────────────────────────────────────────────────

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const { event } = await searchParams;

  const ctx = getContext();
  if (ctx.kind !== "admin") {
    throw new Error("unexpected: non-admin context in /admin/audit");
  }

  // Resolve admin email for nav.
  const [adminRow] = await adminDb
    .select({ email: schema.admins.email })
    .from(schema.admins)
    .where(eq(schema.admins.id, ctx.adminId))
    .limit(1);

  const adminEmail = adminRow?.email ?? ctx.adminId;

  const rows = await recentAuditLog(100, event);

  const emptyMessage = event
    ? `No events matching "${event}".`
    : "No events yet.";

  return (
    <div className="min-h-screen bg-[#06060c] font-sans text-white">
      <AdminNav adminEmail={adminEmail} />

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* ── Page header ── */}
        <div className="mb-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8a8a93]">
            Audit log
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white">
            Audit log
          </h1>
          {event && (
            <p className="mt-1.5 font-mono text-xs text-[#8a8a93]">
              Filtered by:{" "}
              <span className="font-mono text-[#00e5ff] tracking-[0.08em] uppercase text-[11px]">
                {event}
              </span>
            </p>
          )}
        </div>

        {/* ── Log table ── */}
        <section aria-label="Audit log entries">
          <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#0d0d14]">
            {rows.length === 0 ? (
              <p className="px-4 py-6 font-mono text-xs text-[#8a8a93]">{emptyMessage}</p>
            ) : (
              <>
                {/* Header row */}
                <div className="grid grid-cols-[auto_160px_1fr] gap-4 border-b border-[rgba(255,255,255,0.08)] bg-[#08080c] px-4 py-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
                    Timestamp
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
                    Event
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]">
                    Metadata
                  </span>
                </div>

                {/* Event rows */}
                {rows.map((row, i) => {
                  const ts = row.createdAt
                    .toISOString()
                    .replace("T", " ")
                    .slice(0, 19) + " UTC";
                  const meta = JSON.stringify(row.metadata);

                  return (
                    <div
                      key={i}
                      className="group relative grid grid-cols-[auto_160px_1fr] items-start gap-4 border-b border-[rgba(255,255,255,0.06)] px-4 py-3 last:border-b-0"
                    >
                      {/* Left-accent on hover */}
                      <div
                        className="pointer-events-none absolute inset-y-0 left-0 w-[2px] origin-center scale-y-0 bg-[#00e5ff] transition-transform duration-150 group-hover:scale-y-100"
                        aria-hidden="true"
                      />

                      {/* Timestamp */}
                      <span className="font-mono text-[11px] tabular-nums text-[#8a8a93]">
                        {ts}
                      </span>

                      {/* Event type — cyan + uppercase mono */}
                      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#00e5ff]">
                        {row.eventType}
                      </span>

                      {/* Metadata — truncated, full value in title for hover-reveal */}
                      <span
                        className="max-w-xs truncate font-mono text-[11px] text-[#8a8a93]"
                        title={meta}
                      >
                        {meta}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
