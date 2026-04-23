import { test as base, expect, type APIRequestContext } from "@playwright/test";
import { adminDb, schema } from "@/lib/db";
import { issueMagicLink } from "@/lib/auth/issue";
import { createClient } from "@/lib/db/queries/clients";
import { upsertMember } from "@/lib/db/queries/members";
import { createDoc } from "@/lib/db/queries/docs";
import { upsertShare } from "@/lib/db/queries/shares";

export type Seed = {
  adminId: string;
  clientA: { id: string; slug: string };
  clientB: { id: string; slug: string };
  docA1: { id: string; slug: string };
  docB1: { id: string; slug: string };
  memberA: { id: string; email: string };
  memberB: { id: string; email: string };
};

/**
 * Exchange a fresh magic-link token for a session cookie value.
 *
 * Two-step verify: GET renders a landing page; POST consumes the token and
 * returns the session cookie on a 302. The token we already have from
 * issueMagicLink() is sufficient — we skip the GET render step and POST
 * directly to consume, which is what a real browser would do after a human
 * clicks the Continue button in the landing form.
 */
export async function signIn(
  request: APIRequestContext,
  memberEmail: string,
  memberId: string,
  clientId: string,
): Promise<string> {
  const { raw } = await issueMagicLink({
    subjectType: "client_member",
    subjectId: memberId,
    email: memberEmail,
    clientId,
  });
  // maxRedirects: 0 prevents following the 302 so we can read Set-Cookie from
  // the redirect response directly. failOnStatusCode: false allows non-2xx
  // status without throwing.
  const res = await request.post(`/auth/verify`, {
    form: { token: raw },
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  const setCookie = res.headers()["set-cookie"] ?? "";
  const match = /edict_session=([^;]+)/.exec(setCookie);
  if (!match) {
    throw new Error(
      `signIn: no edict_session cookie in Set-Cookie header (status ${res.status()}). ` +
        `Verify that POST /auth/verify is reachable and the token was not already consumed.`,
    );
  }
  return match[1]!;
}

export const test = base.extend<{ seed: Seed }>({
  seed: async ({}, use) => {
    // Wipe then seed — tests assume fully fresh state on every run.
    // Delete in dependency order (children before parents) to avoid FK violations.
    // rate_limit_events is self-contained (no FK refs) but must wipe to prevent
    // prior-run buckets (e.g. /auth/verify 10/hour/email) from causing 429s.
    await adminDb.delete(schema.rateLimitEvents);
    await adminDb.delete(schema.auditLog);
    await adminDb.delete(schema.sessions);
    await adminDb.delete(schema.magicLinkTokens);
    await adminDb.delete(schema.docShares);
    await adminDb.delete(schema.clientMembers);
    await adminDb.delete(schema.docs);
    await adminDb.delete(schema.clients);
    await adminDb.delete(schema.admins);

    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "admin@edict.test", name: "Test Admin" })
      .returning();

    const a = await createClient({ slug: "a", name: "Alpha" });
    const b = await createClient({ slug: "b", name: "Bravo" });

    const ma = await upsertMember({ clientId: a.id, email: "mem@a.test", role: "viewer" });
    const mb = await upsertMember({ clientId: b.id, email: "mem@b.test", role: "viewer" });

    const d1 = await createDoc({
      slug: "doc-one",
      title: "Doc for Alpha",
      bodyType: "html",
      body: "<p>Alpha only</p>",
      createdBy: admin!.id,
    });
    const d2 = await createDoc({
      slug: "doc-two",
      title: "Doc for Bravo",
      bodyType: "html",
      body: "<p>Bravo only</p>",
      createdBy: admin!.id,
    });

    await upsertShare(d1.id, a.id);
    await upsertShare(d2.id, b.id);

    await use({
      adminId: admin!.id,
      clientA: { id: a.id, slug: "a" },
      clientB: { id: b.id, slug: "b" },
      docA1: { id: d1.id, slug: d1.slug },
      docB1: { id: d2.id, slug: d2.slug },
      memberA: { id: ma.id, email: "mem@a.test" },
      memberB: { id: mb.id, email: "mem@b.test" },
    });
  },
});

export { expect };
