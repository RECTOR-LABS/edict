import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, Share2, Check, Eye } from "lucide-react";

import { adminDb, schema } from "@/lib/db";
import { getContext } from "@/lib/auth/context";
import { requireAdminSession } from "@/lib/auth/middleware";
import { getDocById } from "@/lib/db/queries/docs";
import { AdminNav } from "@/app/(admin)/_components/admin-nav";
import { updateDocAction } from "@/actions/docs";
import { Field, SelectField, TextareaField } from "../_components/doc-form-fields";

// ── Page (server component) ──────────────────────────────────────────────────

export default async function AdminDocEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return requireAdminSession(async () => {
  const ctx = getContext();
  if (ctx.kind !== "admin") {
    throw new Error("unexpected: non-admin context in /admin/docs/[id]");
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

  return (
    <div className="min-h-screen bg-[#06060c] text-white font-sans">
      <AdminNav adminEmail={adminEmail} />

      <main className="mx-auto max-w-3xl px-6 py-10">
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
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8a8a93]">
              Edit doc
            </p>
            <h1 className="mt-1.5 flex flex-wrap items-baseline gap-2 text-2xl font-semibold tracking-tight text-white">
              {doc.title}
              <span className="font-mono text-[15px] font-normal text-[#00e5ff]">
                /{doc.slug}
              </span>
            </h1>
          </div>

          <div className="mt-1 flex shrink-0 items-center gap-4">
            <Link
              href={`/admin/docs/${doc.id}/preview` as Route}
              target="_blank"
              rel="noopener"
              className="group inline-flex items-center gap-1.5 font-mono text-[11px] text-[#00e5ff] transition-opacity duration-150 hover:opacity-75"
            >
              <Eye size={13} strokeWidth={1.75} />
              Preview
            </Link>

            {/* Share link (Task 41 route) */}
            <Link
              href={`/admin/docs/${doc.id}/share` as Route}
              className="group inline-flex items-center gap-1.5 font-mono text-[11px] text-[#00e5ff] transition-opacity duration-150 hover:opacity-75"
            >
              <Share2 size={13} strokeWidth={1.75} />
              Share
            </Link>
          </div>
        </div>

        {/* Form */}
        <div className="rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#0d0d14] p-10">
          <form action={updateDocAction} className="flex flex-col gap-6">
            {/* Hidden doc ID — required by updateDocAction */}
            <input type="hidden" name="id" value={doc.id} />

            {/* Title */}
            <Field
              name="title"
              label="Title"
              required
              defaultValue={doc.title}
              placeholder="Adrena Trading Arena — Implementation Plan"
            />

            {/* Body type */}
            <SelectField
              name="bodyType"
              label="Body type"
              defaultValue={doc.bodyType}
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
              defaultValue={doc.body}
              hint={`${doc.bodyType === "html" ? "HTML" : "Markdown"} — ${doc.body.length.toLocaleString()} chars`}
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
                Save
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
  });
}
