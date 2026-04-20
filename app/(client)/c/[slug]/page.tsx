import Link from "next/link";
import type { Route } from "next";
import { ArrowUpRight, Clock, FileQuestion } from "lucide-react";

import { getContext } from "@/lib/auth/context";
import { getClientBySlug } from "@/lib/db/queries/clients";
import { listDocsForClientWithLastViewed } from "@/lib/db/queries/docs";
import { notFound } from "next/navigation";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function bodyTypeLabel(bodyType: string): string {
  return bodyType === "html" ? "HTML" : "MD";
}

// ── Sub-components ───────────────────────────────────────────────────────────

type DocCardProps = {
  slug: string;
  title: string;
  bodyType: string;
  lastViewedAt: Date | null;
  clientSlug: string;
  index: number;
};

function DocCard({ slug, title, bodyType, lastViewedAt, clientSlug, index }: DocCardProps) {
  const isNew = lastViewedAt === null;
  const viewedLabel = lastViewedAt ? `You read this ${formatRelative(lastViewedAt)}` : null;

  return (
    <Link
      href={`/c/${clientSlug}/d/${slug}` as Route}
      className="doc-card group relative block rounded-md border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.015)] px-6 py-8 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_32px_rgba(0,0,0,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tenant-color,#00e5ff)]"
      style={{
        animationDelay: `${index * 80}ms`,
        // Tenant-color selection feedback
        ["--selection-color" as string]: "var(--tenant-color, #00e5ff)",
      }}
      aria-label={`Open edict: ${title}`}
    >
      {/* Hover glow border via ::after — see <style> block below */}

      {/* Top row: badge + "New" indicator */}
      <div className="mb-3 flex items-center gap-2">
        {/* BodyType badge */}
        <span className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#8a8a93]">
          {bodyTypeLabel(bodyType)}
        </span>

        {/* New badge — tenant-color pulsing dot */}
        {isNew && (
          <span
            className="flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--tenant-color,#00e5ff)]"
            style={{
              background: "color-mix(in srgb, var(--tenant-color, #00e5ff) 12%, transparent)",
              boxShadow: "0 0 6px color-mix(in srgb, var(--tenant-color, #00e5ff) 40%, transparent)",
            }}
          >
            <span
              className="new-pulse inline-block h-1.5 w-1.5 rounded-full bg-[var(--tenant-color,#00e5ff)]"
              aria-hidden="true"
            />
            New
          </span>
        )}
      </div>

      {/* Title */}
      <h2 className="pr-8 text-2xl font-medium leading-snug tracking-tight text-white">
        {title}
      </h2>

      {/* Last-viewed indicator */}
      {!isNew && viewedLabel && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-[#8a8a93]">
          <Clock size={13} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
          {viewedLabel}
        </p>
      )}

      {/* ArrowUpRight action — top-right corner */}
      <div
        className="absolute right-5 top-5 flex h-7 w-7 items-center justify-center rounded-full border border-[rgba(255,255,255,0.12)] text-[#8a8a93] transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:border-[var(--tenant-color,#00e5ff)] group-hover:bg-[var(--tenant-color,#00e5ff)] group-hover:text-[#06060c]"
        aria-hidden="true"
      >
        <ArrowUpRight size={14} strokeWidth={2} />
      </div>
    </Link>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function ClientDashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const ctx = getContext();
  if (ctx.kind !== "client") {
    throw new Error("client only: unexpected context kind in /c/[slug]");
  }

  const { slug } = await params;
  const tenant = await getClientBySlug(slug);
  if (!tenant) notFound();

  const docs = await listDocsForClientWithLastViewed(ctx.clientId, ctx.memberId);

  return (
    <>
      {/*
        Styles:
        - .doc-card — fade-up entrance animation
        - .doc-card::after — tenant-color hover glow border
        - .new-pulse — tenant-color pulsing dot animation
        - ::selection — tenant-color text selection
      */}
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .doc-card {
          opacity: 0;
          animation: fadeUp 0.35s ease forwards;
        }
        .doc-card::after {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(
            135deg,
            var(--tenant-color, #00e5ff),
            transparent 60%
          );
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          opacity: 0;
          transition: opacity 0.2s ease;
          pointer-events: none;
        }
        .doc-card:hover::after {
          opacity: 1;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .new-pulse {
          animation: pulse 1.8s ease-in-out infinite;
        }
        ::selection {
          background: var(--tenant-color, #00e5ff);
          color: #06060c;
        }
      `}</style>

      <main className="mx-auto max-w-4xl px-10 py-10">
        {/* Page header */}
        <div className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight text-white">Your edicts</h1>
          <p className="mt-2 text-base text-[#8a8a93]">Documents issued to {tenant.name}</p>
        </div>

        {/* Doc list or empty state */}
        {docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <FileQuestion
              size={48}
              strokeWidth={1}
              className="mb-5 text-white"
              style={{ opacity: 0.2 }}
              aria-hidden="true"
            />
            <h3 className="text-2xl font-semibold text-white">No edicts yet.</h3>
            <p className="mt-2 max-w-sm text-sm text-[#8a8a93]">
              When {tenant.name} issues documents, they appear here.
            </p>
          </div>
        ) : (
          <ol className="flex flex-col gap-3" aria-label="Your edicts">
            {docs.map((doc, i) => (
              <li key={doc.id}>
                <DocCard
                  slug={doc.slug}
                  title={doc.title}
                  bodyType={doc.bodyType}
                  lastViewedAt={doc.lastViewedAt}
                  clientSlug={slug}
                  index={i}
                />
              </li>
            ))}
          </ol>
        )}
      </main>
    </>
  );
}
