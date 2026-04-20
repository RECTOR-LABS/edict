"use server";

import { revokeMember, upsertMember } from "@/lib/db/queries/members";
import { writeAudit } from "@/lib/db/queries/audit";
import { getContext } from "@/lib/auth/context";
import { revalidatePath } from "next/cache";

export async function addMemberAction(formData: FormData) {
  const ctx = getContext();
  if (ctx.kind !== "admin") throw new Error("admin only");
  const clientId = String(formData.get("clientId") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || null;
  const role = (String(formData.get("role") ?? "viewer") as "viewer" | "admin_of_client");
  const m = await upsertMember({ clientId, email, name, role });
  await writeAudit({
    eventType: "admin_action",
    actorType: "admin",
    actorId: ctx.adminId,
    clientId,
    metadata: { target_type: "client_member", target_id: m.id, action: "upsert" },
  });
  revalidatePath(`/admin/clients/${clientId}`);
}

export async function revokeMemberAction(formData: FormData) {
  const ctx = getContext();
  if (ctx.kind !== "admin") throw new Error("admin only");
  const memberId = String(formData.get("memberId"));
  const clientId = String(formData.get("clientId"));
  await revokeMember(memberId);
  await writeAudit({
    eventType: "admin_action",
    actorType: "admin",
    actorId: ctx.adminId,
    clientId,
    metadata: { target_type: "client_member", target_id: memberId, action: "revoke" },
  });
  revalidatePath(`/admin/clients/${clientId}`);
}
