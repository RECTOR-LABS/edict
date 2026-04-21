import "dotenv/config";
import React from "react";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { adminDb, schema } from "@/lib/db";
import { issueMagicLink } from "@/lib/auth/issue";
import { sendMail } from "@/lib/mail/resend";
import { MagicLinkEmail } from "@/lib/mail/templates/magic-link";

export type InviteResult = {
  adminId: string;
  email: string;
  url: string;
  /** true if this invocation inserted a new admin row; false if admin already existed. */
  created: boolean;
  delivery: "dev-print" | "sent";
};

/**
 * Find or create an admin by email, issue them a fresh magic link, and
 * either dev-print or send it via Resend.
 *
 * Unlike admin-seed, this function does NOT check whether the admins table
 * is empty — it always proceeds. Authorization is implicit: the caller has
 * shell access to a machine with DATABASE_ADMIN_URL in its environment.
 * Phase 2 will gate this behind an authenticated admin session in the UI.
 *
 * CONCURRENCY: The find-or-insert runs inside a transaction guarded by a
 * Postgres advisory xact lock on `hashtext('edict_admin_bootstrap')`. This
 * serializes concurrent invite/seed invocations across the fleet, closing
 * the TOCTOU race where two same-email readers could both see null and
 * both attempt insert (today `admins.email` UNIQUE catches it loudly; the
 * lock turns it into a silent, ordered reuse). Token + audit writes happen
 * OUTSIDE the tx — they don't race meaningfully (distinct rows, independent
 * writes) and keeping `issueMagicLink` untouched limits blast radius to
 * this script.
 *
 * Throws on:
 *   - Empty or whitespace-only email
 *   - DB insert failure
 *   - Mail delivery failure (sent path only)
 */
export async function runAdminInvite(email: string): Promise<InviteResult> {
  if (!email || !email.trim()) throw new Error("admin email is required");

  const { admin, created } = await adminDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('edict_admin_bootstrap'))`);

    const existing = await tx.query.admins.findFirst({
      where: (a, { eq }) => eq(a.email, email),
    });

    if (existing) {
      return { admin: existing, created: false };
    }

    const [row] = await tx.insert(schema.admins).values({ email }).returning();
    if (!row) throw new Error("admin insert failed");
    return { admin: row, created: true };
  });

  const { raw } = await issueMagicLink({
    subjectType: "admin",
    subjectId: admin.id,
    email,
    clientId: null,
  });

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const url = `${appUrl}/auth/verify?token=${raw}`;

  const devPrint = process.env.DEV_PRINT_MAGIC_LINKS === "true";

  if (devPrint) {
    return { adminId: admin.id, email, url, created, delivery: "dev-print" };
  }

  await sendMail({
    to: email,
    subject: "Edict — admin invite",
    template: React.createElement(MagicLinkEmail, {
      docTitle: "Admin access to Edict",
      actorName: "Edict",
      magicLinkUrl: url,
    }),
  });

  return { adminId: admin.id, email, url, created, delivery: "sent" };
}

// CLI entrypoint — only executes when this file is run directly (not when imported by tests).
const invokedDirectly = fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const email = process.argv[2];
  if (!email) {
    console.error("usage: edict:admin:invite <email>");
    process.exit(1);
  }
  runAdminInvite(email)
    .then((r) => {
      if (r.delivery === "dev-print") {
        console.warn(`[invite] magic link: ${r.url}`);
      } else {
        console.warn(`[invite] emailed ${r.email}`);
      }
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
