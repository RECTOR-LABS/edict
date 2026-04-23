import Link from "next/link";
import type { Route } from "next";
import { ShieldCheck } from "lucide-react";

type AdminNavProps = {
  /** Admin email shown in the right side of the nav bar. */
  adminEmail: string;
};

/**
 * Sticky top navigation bar shared across all /admin/* pages.
 *
 * Extracted in Task 37 to avoid duplication across Tasks 36-42.
 * Pattern: server component (no client-side state), wired to the admin's
 * email resolved upstream (in each page's server component) to keep the
 * nav stateless.
 */
export function AdminNav({ adminEmail }: AdminNavProps) {
  return (
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-[rgba(255,255,255,0.08)] bg-[#06060c]/90 px-6 backdrop-blur-md">
      <Link
        href={"/admin" as Route}
        className="group flex items-center gap-2.5 outline-none focus-visible:ring-2 focus-visible:ring-[#00e5ff]/50 rounded-sm"
      >
        {/* Pulsing status dot — live-ops console indicator */}
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00e5ff] opacity-75" />
          <span
            className="relative inline-flex h-2 w-2 rounded-full bg-[#00e5ff]"
            style={{ boxShadow: "0 0 6px #00e5ff" }}
          />
        </span>
        <span className="font-mono text-sm font-bold tracking-[0.2em] text-white transition-colors duration-150 group-hover:text-[#00e5ff]">
          EDICT{" "}
          <span className="text-[#00e5ff]/50">/</span>{" "}
          ADMIN
        </span>
      </Link>

      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5 font-mono text-xs text-[#8a8a93]">
          <ShieldCheck size={13} strokeWidth={1.5} className="text-[#00e5ff]" />
          {adminEmail}
        </span>
        <form action="/auth/logout" method="POST">
          <button
            type="submit"
            className="font-mono text-xs text-[#8a8a93] transition-colors duration-150 hover:text-white"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
