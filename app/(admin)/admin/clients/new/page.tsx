import Link from "next/link";
import type { Route } from "next";
import { eq } from "drizzle-orm";
import { ArrowLeft, Link2, Check } from "lucide-react";

import { adminDb, schema } from "@/lib/db";
import { getContext } from "@/lib/auth/context";
import { AdminNav } from "@/app/(admin)/_components/admin-nav";
import { createClientAction } from "@/actions/clients";

// ── Field helper ─────────────────────────────────────────────────────────────

type FieldProps = {
  name: string;
  label: string;
  required?: boolean;
  hint?: string;
  /** Input type — defaults to "text" */
  type?: string;
  placeholder?: string;
  /** Mono font on the input */
  mono?: boolean;
  /** Lucide icon rendered as a left-adornment inside the input */
  icon?: React.ReactNode;
  /** Swatch preview shown to the left of the input */
  colorSwatch?: boolean;
  /** HTML pattern attribute */
  pattern?: string;
};

function Field({
  name,
  label,
  required = false,
  hint,
  type = "text",
  placeholder,
  mono = false,
  icon,
  colorSwatch = false,
  pattern,
}: FieldProps) {
  const hasAdornment = icon !== undefined || colorSwatch;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Label row */}
      <div className="flex items-center justify-between">
        <label
          htmlFor={name}
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]"
        >
          {label}
        </label>
        {required && (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#00e5ff]">
            Required
          </span>
        )}
      </div>

      {/* Input wrapper */}
      <div className="relative flex items-center">
        {/* Left adornment: icon */}
        {icon && (
          <span className="pointer-events-none absolute left-3 flex items-center text-[#8a8a93]/50">
            {icon}
          </span>
        )}

        {/* Left adornment: color swatch preview (static neutral for Phase 1) */}
        {colorSwatch && (
          <span
            className="pointer-events-none absolute left-3 h-3.5 w-3.5 rounded-full ring-1 ring-white/10"
            style={{
              background: "linear-gradient(135deg, #14141e 0%, #0d0d14 100%)",
            }}
            aria-hidden="true"
          />
        )}

        <input
          id={name}
          name={name}
          type={type}
          required={required}
          placeholder={placeholder}
          pattern={pattern}
          className={[
            "w-full rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#030305] py-2.5 text-sm text-white",
            "placeholder:text-[#8a8a93]/50",
            "focus:border-[#00e5ff] focus:outline-none",
            "transition-colors duration-150",
            // input-glow on focus: 1px ring + 12px glow at 10% opacity
            "focus:[box-shadow:0_0_0_1px_#00e5ff,0_0_12px_rgba(0,229,255,0.10)]",
            mono ? "font-mono text-[13px]" : "font-sans",
            hasAdornment ? "pl-9 pr-4" : "px-4",
          ]
            .filter(Boolean)
            .join(" ")}
        />
      </div>

      {/* Hint text */}
      {hint && (
        <p className="font-sans text-[12px] text-[#8a8a93]">{hint}</p>
      )}
    </div>
  );
}

// ── Page (server component) ──────────────────────────────────────────────────

export default async function AdminClientsNewPage() {
  const ctx = getContext();
  if (ctx.kind !== "admin") {
    throw new Error("unexpected: non-admin context in /admin/clients/new");
  }

  // Resolve admin email for nav display.
  const [adminRow] = await adminDb
    .select({ email: schema.admins.email })
    .from(schema.admins)
    .where(eq(schema.admins.id, ctx.adminId))
    .limit(1);

  const adminEmail = adminRow?.email ?? ctx.adminId;

  return (
    <div className="min-h-screen bg-[#06060c] text-white font-sans">
      <AdminNav adminEmail={adminEmail} />

      <main className="mx-auto max-w-[800px] px-6 py-10">
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

        {/* Page header */}
        <div className="mb-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8a8a93]">
            New client
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white">
            Create client
          </h1>
        </div>

        {/* Form */}
        <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#0d0d14] p-10">
          <form action={createClientAction} className="flex flex-col gap-6">
            {/* Slug */}
            <Field
              name="slug"
              label="Slug"
              required
              mono
              placeholder="adrena"
              pattern="[a-z0-9-]+"
              hint="lowercase letters, numbers, dashes only"
              icon={<Link2 size={14} strokeWidth={1.75} />}
            />

            {/* Name */}
            <Field
              name="name"
              label="Name"
              required
              placeholder="Adrena Trading"
            />

            {/* Brand color */}
            <Field
              name="brandColor"
              label="Brand color"
              placeholder="#00e5ff"
              hint="hex color for client-branded dashboard"
              colorSwatch
            />

            {/* Logo URL */}
            <Field
              name="logoUrl"
              label="Logo URL"
              placeholder="https://cdn.example.com/logo.png"
            />

            {/* Submit */}
            <div className="pt-2">
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-md bg-[#00e5ff] px-6 py-3 font-sans text-sm font-semibold text-[#06060c] transition-opacity duration-150 hover:opacity-90"
                style={{
                  boxShadow: "0 0 20px rgba(0,229,255,0.25), 0 0 40px rgba(0,229,255,0.10)",
                }}
              >
                <Check size={15} strokeWidth={2.5} />
                Create client
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
