import Link from "next/link";
import type { Route } from "next";
import { eq } from "drizzle-orm";
import { ArrowLeft, Link2, Check } from "lucide-react";

import { adminDb, schema } from "@/lib/db";
import { getContext } from "@/lib/auth/context";
import { requireAdminSession } from "@/lib/auth/middleware";
import { AdminNav } from "@/app/(admin)/_components/admin-nav";
import { createDocAction } from "@/actions/docs";
import { Field, SelectField, TextareaField } from "../_components/doc-form-fields";

// ── Page (server component) ──────────────────────────────────────────────────

export default async function AdminDocsNewPage() {
  return requireAdminSession(async () => {
  const ctx = getContext();
  if (ctx.kind !== "admin") {
    throw new Error("unexpected: non-admin context in /admin/docs/new");
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
          href={"/admin/docs" as Route}
          className="group mb-8 inline-flex items-center gap-1.5 font-mono text-[11px] text-[#8a8a93] transition-colors duration-150 hover:text-white"
        >
          <ArrowLeft
            size={13}
            strokeWidth={2}
            className="transition-transform duration-150 group-hover:-translate-x-0.5"
          />
          /admin/docs
        </Link>

        {/* Page header */}
        <div className="mb-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8a8a93]">
            New doc
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white">Create doc</h1>
        </div>

        {/* Form */}
        <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#0d0d14] p-10">
          <form action={createDocAction} className="flex flex-col gap-6">
            {/* Slug */}
            <Field
              name="slug"
              label="Slug"
              required
              mono
              placeholder="adrena-implementation-plan"
              pattern="[a-z0-9-]+"
              hint="lowercase letters, numbers, dashes only"
              icon={<Link2 size={14} strokeWidth={1.75} />}
            />

            {/* Title */}
            <Field
              name="title"
              label="Title"
              required
              placeholder="Adrena Trading Arena — Implementation Plan"
            />

            {/* Body type */}
            <SelectField
              name="bodyType"
              label="Body type"
              defaultValue="html"
              options={[
                { value: "html", label: "html" },
                { value: "markdown", label: "markdown" },
              ]}
            />

            {/* Body */}
            <TextareaField
              name="body"
              label="Body"
              required
              rows={22}
              placeholder={"HTML: paste full <!DOCTYPE html>...\nMarkdown: paste raw markdown."}
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
                Create doc
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
  });
}
