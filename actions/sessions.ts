"use server";

import { adminDb, schema } from "@/lib/db";
import { issueMagicLink } from "@/lib/auth/issue";
import { sendMail } from "@/lib/mail/resend";
import { MagicLinkEmail } from "@/lib/mail/templates/magic-link";
import { and, eq, isNull } from "drizzle-orm";
import React from "react";
import { writeAudit } from "@/lib/db/queries/audit";
import { rateLimitAllow } from "@/lib/db/queries/rate-limit";

export async function requestMagicLinkAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return;

  // Rate-limit: 10 send attempts per email per hour. Silent success on throttle
  // keeps the enumeration-defense posture — attacker cannot distinguish
  // "throttled" from "unknown email" or "sent successfully."
  const allowed = await rateLimitAllow(`verify:email:${email}`, 10, 60 * 60 * 1000);
  if (!allowed) return;

  // 1) Admins (no tenant scope)
  const admin = await adminDb.query.admins.findFirst({
    where: (a, { eq }) => eq(a.email, email),
  });
  if (admin) {
    const { raw } = await issueMagicLink({
      subjectType: "admin",
      subjectId: admin.id,
      email,
      clientId: null,
    });
    await dispatch(email, raw, "Admin access to Edict");
    return;
  }

  // 2) Client members (any tenant they belong to — issue one link per client)
  const members = await adminDb
    .select()
    .from(schema.clientMembers)
    .where(and(eq(schema.clientMembers.email, email), isNull(schema.clientMembers.revokedAt)));

  for (const m of members) {
    const { raw } = await issueMagicLink({
      subjectType: "client_member",
      subjectId: m.id,
      email,
      clientId: m.clientId,
    });
    await dispatch(email, raw, "Your Edict sign-in link");
  }

  // Silent success regardless (enumeration defense)
  await writeAudit({
    eventType: "magic_link_requested",
    actorType: "system",
    metadata: { email_hash_prefix: email.slice(0, 2) + "***" },
  });
}

async function dispatch(email: string, rawToken: string, subject: string) {
  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/auth/verify?token=${rawToken}`;
  await sendMail({
    to: email,
    subject,
    template: React.createElement(MagicLinkEmail, {
      docTitle: "Your Edict",
      actorName: "Edict",
      magicLinkUrl: url,
    }),
  });
}
