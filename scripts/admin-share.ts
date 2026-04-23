import "dotenv/config";
import React from "react";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { adminDb, schema } from "@/lib/db";
import { upsertMember } from "@/lib/db/queries/members";
import { upsertShare } from "@/lib/db/queries/shares";
import { issueMagicLink } from "@/lib/auth/issue";
import { writeAudit } from "@/lib/db/queries/audit";
import { sendMail } from "@/lib/mail/resend";
import { MagicLinkEmail } from "@/lib/mail/templates/magic-link";

export async function runAdminShare(input: {
  adminId: string;
  clientId: string;
  docId: string;
  emails: string[];
}) {
  const doc = await adminDb.query.docs.findFirst({
    where: eq(schema.docs.id, input.docId),
    columns: { id: true, title: true, slug: true },
  });
  if (!doc) throw new Error(`doc not found: ${input.docId}`);

  const client = await adminDb.query.clients.findFirst({
    where: eq(schema.clients.id, input.clientId),
    columns: { id: true, slug: true, name: true },
  });
  if (!client) throw new Error(`client not found: ${input.clientId}`);

  const admin = await adminDb.query.admins.findFirst({
    where: eq(schema.admins.id, input.adminId),
    columns: { id: true, name: true, email: true },
  });
  if (!admin) throw new Error(`admin not found: ${input.adminId}`);

  await upsertShare(input.docId, input.clientId);

  // Resend free tier is 2 req/s. Pace sendMail at 600ms between calls to stay
  // under that limit with headroom. The first iteration has no delay — only
  // subsequent ones wait.
  const SEND_INTERVAL_MS = 600;

  const sent: { email: string; memberId: string }[] = [];
  let iter = 0;
  for (const email of input.emails) {
    if (iter > 0) await new Promise((r) => setTimeout(r, SEND_INTERVAL_MS));
    iter += 1;

    const m = await upsertMember({ clientId: input.clientId, email, role: "viewer" });
    const { raw } = await issueMagicLink({
      subjectType: "client_member",
      subjectId: m.id,
      email,
      clientId: input.clientId,
      actorId: input.adminId,
      docId: input.docId,
    });
    const url = `${process.env.APP_URL ?? "http://localhost:3000"}/auth/verify?token=${raw}`;
    await sendMail({
      to: email,
      subject: `Edict — ${doc.title}`,
      template: React.createElement(MagicLinkEmail, {
        docTitle: doc.title,
        actorName: admin.name ?? admin.email ?? "Your Edict",
        magicLinkUrl: url,
      }),
    });
    sent.push({ email, memberId: m.id });
  }

  await writeAudit({
    eventType: "doc_shared",
    actorType: "admin",
    actorId: input.adminId,
    clientId: input.clientId,
    docId: input.docId,
    metadata: { doc_id: input.docId, client_id: input.clientId, new_members: input.emails },
  });

  return { doc, client, sent };
}

const invokedDirectly = fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const [adminId, clientId, docId, ...emails] = process.argv.slice(2);
  if (!adminId || !clientId || !docId || emails.length === 0) {
    console.error("usage: edict:admin:share <adminId> <clientId> <docId> <email1> [email2 ...]");
    process.exit(1);
  }
  runAdminShare({ adminId, clientId, docId, emails })
    .then((r) => {
      console.warn(`[share] ${r.doc.title} → ${r.client.name}: ${r.sent.length} recipient(s)`);
      for (const s of r.sent) console.warn(`  - ${s.email} (member ${s.memberId})`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
