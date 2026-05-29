"use server";

import { createClient } from "@/lib/db/queries/clients";
import { writeAudit } from "@/lib/db/queries/audit";
import { getContext } from "@/lib/auth/context";
import { requireAdminSession } from "@/lib/auth/middleware";

/**
 * Server action: create a new client (tenant). Returns the created row so the
 * calling Route Handler can own the post-create redirect (admin writes run as
 * Route Handlers — see app/api/auth/request-link/route.ts for the why).
 *
 * Guard: admin context only. Validates slug regex and name presence before
 * touching the DB. Unique-slug violations propagate from createClient() —
 * no catch-wrap here per CLAUDE.md (no silent failures).
 */
export async function createClientAction(formData: FormData) {
  return requireAdminSession(async () => {
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

  return c;
  });
}
