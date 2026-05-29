"use server";

import { createDoc, updateDoc } from "@/lib/db/queries/docs";
import { writeAudit } from "@/lib/db/queries/audit";
import { getContext } from "@/lib/auth/context";
import { requireAdminSession } from "@/lib/auth/middleware";

export async function createDocAction(formData: FormData) {
  return requireAdminSession(async () => {
  const ctx = getContext();
  if (ctx.kind !== "admin") throw new Error("admin only");

  const slug = String(formData.get("slug") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const bodyType = (String(formData.get("bodyType") ?? "html") as "html" | "markdown");
  const body = String(formData.get("body") ?? "");

  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("invalid slug");
  if (!title) throw new Error("title required");
  if (!body) throw new Error("body required");

  const d = await createDoc({ slug, title, bodyType, body, createdBy: ctx.adminId });
  await writeAudit({
    eventType: "admin_action",
    actorType: "admin",
    actorId: ctx.adminId,
    docId: d.id,
    metadata: { target_type: "doc", target_id: d.id, action: "create", title },
  });
  return d;
  });
}

export async function updateDocAction(formData: FormData) {
  return requireAdminSession(async () => {
  const ctx = getContext();
  if (ctx.kind !== "admin") throw new Error("admin only");
  const id = String(formData.get("id"));
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "");
  const bodyType = (String(formData.get("bodyType") ?? "html") as "html" | "markdown");
  const d = await updateDoc(id, { title, body, bodyType });
  if (!d) throw new Error("doc not found");
  await writeAudit({
    eventType: "admin_action",
    actorType: "admin",
    actorId: ctx.adminId,
    docId: d.id,
    metadata: { target_type: "doc", target_id: d.id, action: "update" },
  });
  return d;
  });
}
