"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import React from "react";

import { adminDb, schema } from "@/lib/db";
import { upsertMember } from "@/lib/db/queries/members";
import { upsertShare, revokeShare } from "@/lib/db/queries/shares";
import { issueMagicLink } from "@/lib/auth/issue";
import { writeAudit } from "@/lib/db/queries/audit";
import { sendMail } from "@/lib/mail/resend";
import { MagicLinkEmail } from "@/lib/mail/templates/magic-link";
import { getContext } from "@/lib/auth/context";

export async function shareDocAction(formData: FormData) {
  const ctx = getContext();
  if (ctx.kind !== "admin") throw new Error("admin only");

  const docId = String(formData.get("docId"));
  const clientId = String(formData.get("clientId"));
  const emailsRaw = String(formData.get("emails") ?? "");
  const emails = emailsRaw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (!docId || !clientId) throw new Error("missing docId/clientId");
  if (emails.length === 0) throw new Error("provide at least one recipient email");

  await upsertShare(docId, clientId);

  const doc = await adminDb.query.docs.findFirst({
    where: eq(schema.docs.id, docId),
    columns: { id: true, title: true },
  });
  if (!doc) throw new Error("doc not found");

  const actor = await adminDb.query.admins.findFirst({
    where: eq(schema.admins.id, ctx.adminId),
    columns: { name: true, email: true },
  });

  for (const email of emails) {
    const m = await upsertMember({ clientId, email, role: "viewer" });
    const { raw } = await issueMagicLink({
      subjectType: "client_member",
      subjectId: m.id,
      email,
      clientId,
      actorId: ctx.adminId,
      docId,
    });
    const url = `${process.env.APP_URL ?? "http://localhost:3000"}/auth/verify?token=${raw}`;
    await sendMail({
      to: email,
      subject: `Edict — ${doc.title}`,
      template: React.createElement(MagicLinkEmail, {
        docTitle: doc.title,
        actorName: actor?.name ?? actor?.email ?? "Your Edict",
        magicLinkUrl: url,
      }),
    });
  }

  await writeAudit({
    eventType: "doc_shared",
    actorType: "admin",
    actorId: ctx.adminId,
    clientId,
    docId,
    metadata: { doc_id: docId, client_id: clientId, new_members: emails },
  });

  revalidatePath(`/admin/docs/${docId}/share`);
}

export async function unshareAction(formData: FormData) {
  const ctx = getContext();
  if (ctx.kind !== "admin") throw new Error("admin only");

  const docId = String(formData.get("docId"));
  const clientId = String(formData.get("clientId"));

  await revokeShare(docId, clientId);

  await writeAudit({
    eventType: "doc_unshared",
    actorType: "admin",
    actorId: ctx.adminId,
    clientId,
    docId,
    metadata: { doc_id: docId, client_id: clientId },
  });

  revalidatePath(`/admin/docs/${docId}/share`);
}
