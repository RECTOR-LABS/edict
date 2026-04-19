import "dotenv/config";
import React from "react";
import { fileURLToPath } from "node:url";
import { adminDb, schema } from "@/lib/db";
import { issueMagicLink } from "@/lib/auth/issue";
import { sendMail } from "@/lib/mail/resend";
import { MagicLinkEmail } from "@/lib/mail/templates/magic-link";

export type SeedResult = {
  adminId: string;
  email: string;
  url: string;
  delivery: "dev-print" | "sent";
};

/**
 * Bootstrap the first admin when the admins table is empty.
 *
 * SECURITY INVARIANT: The empty-table check is the sole gate. If admins
 * already exist, this function throws unconditionally — it must never be
 * callable as a self-issue path once the platform is live.
 *
 * Throws on:
 *   - Non-empty admins table (bootstrap gate violated)
 *   - DB insert failure
 *   - Mail delivery failure (sent path only)
 */
export async function runAdminSeed(email: string): Promise<SeedResult> {
  // SECURITY GATE: query only the id column — efficient and sufficient.
  const existing = await adminDb.query.admins.findMany({ columns: { id: true } });
  if (existing.length > 0) {
    throw new Error(
      "admins table is not empty; use edict:admin:invite from an authenticated session",
    );
  }

  const [admin] = await adminDb
    .insert(schema.admins)
    .values({ email, name: "Bootstrap Admin" })
    .returning();
  if (!admin) throw new Error("admin insert failed");

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
    return { adminId: admin.id, email, url, delivery: "dev-print" };
  }

  await sendMail({
    to: email,
    subject: "Edict — your first sign-in link",
    template: React.createElement(MagicLinkEmail, {
      docTitle: "Welcome to Edict",
      actorName: "Edict",
      magicLinkUrl: url,
    }),
  });

  return { adminId: admin.id, email, url, delivery: "sent" };
}

// CLI entrypoint — only executes when this file is run directly (not when imported by tests).
const invokedDirectly = fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const email = process.argv[2] ?? process.env.ADMIN_BOOTSTRAP_EMAIL;
  if (!email) {
    console.error("usage: edict:admin:seed <email>");
    process.exit(1);
  }
  runAdminSeed(email)
    .then((r) => {
      if (r.delivery === "dev-print") {
        console.warn(`[seed] magic link: ${r.url}`);
      } else {
        console.warn(`[seed] magic link emailed to ${r.email}`);
      }
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
