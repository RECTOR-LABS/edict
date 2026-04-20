"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";

import { createClient } from "@/lib/db/queries/clients";
import { writeAudit } from "@/lib/db/queries/audit";
import { getContext } from "@/lib/auth/context";

/**
 * Server action: create a new client (tenant).
 *
 * Guard: admin context only. Validates slug regex and name presence before
 * touching the DB. Unique-slug violations propagate from createClient() —
 * no catch-wrap here per CLAUDE.md (no silent failures).
 *
 * IMPORTANT: redirect() throws a NEXT_REDIRECT internally. Do NOT wrap this
 * function in try/catch — callers must let the throw propagate.
 */
export async function createClientAction(formData: FormData) {
  const ctx = getContext();
  if (ctx.kind !== "admin") throw new Error("admin only");

  const slug = String(formData.get("slug") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const brandColor = String(formData.get("brandColor") ?? "").trim() || undefined;
  const logoUrl = String(formData.get("logoUrl") ?? "").trim() || undefined;

  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("invalid slug");
  if (!name) throw new Error("name required");

  const c = await createClient({
    slug,
    name,
    ...(brandColor !== undefined && { brandColor }),
    ...(logoUrl !== undefined && { logoUrl }),
  });

  await writeAudit({
    eventType: "admin_action",
    actorType: "admin",
    actorId: ctx.adminId,
    clientId: c.id,
    metadata: {
      target_type: "client",
      target_id: c.id,
      action: "create",
      after: c,
    },
  });

  // redirect() throws NEXT_REDIRECT — must not be inside try/catch.
  redirect(`/admin/clients/${c.id}` as Route);
}
