import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { sha256Hex } from "@/lib/utils/hash";
import { findActiveSessionByTokenHash, touchSession } from "@/lib/db/queries/sessions";
import { adminDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { runWithContext, type EdictContext } from "@/lib/auth/context";

const COOKIE = process.env.SESSION_COOKIE_NAME ?? "edict_session";

/**
 * React cache() deduplicates this per-request. Both layout and page call
 * requireClientSession/requireAdminSession on every render — cache() ensures
 * the DB lookup (findActiveSessionByTokenHash) only runs once per RSC request,
 * regardless of how many server components call it.
 *
 * Background: Next.js App Router renders layout and page components in separate
 * React fiber tasks. AsyncLocalStorage context set in the layout's
 * runWithContext() callback does not propagate to the page component because
 * React schedules page rendering outside the layout's async continuation. The
 * fix is to have each component resolve its own session and rely on React cache()
 * to collapse the redundant DB round-trips.
 */
const resolveSession = cache(async () => {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;
  const s = await findActiveSessionByTokenHash(sha256Hex(raw));
  return s;
});

export async function requireAdminSession<T>(fn: () => Promise<T>): Promise<T> {
  const s = await resolveSession();
  if (!s || s.subjectType !== "admin") redirect("/");
  await touchSession(s.id);
  const ctx: EdictContext = { kind: "admin", sessionId: s.id, adminId: s.subjectId };
  return runWithContext(ctx, fn);
}

/**
 * Resolves the caller's client session for `slug`. Sets up AsyncLocalStorage
 * context; does NOT wrap DB work in `withClientScope`. Downstream RLS-scoped
 * queries must call `withClientScope(ctx.clientId, fn)` themselves.
 */
export async function requireClientSession<T>(slug: string, fn: () => Promise<T>): Promise<T> {
  const s = await resolveSession();
  if (!s || s.subjectType !== "client_member" || !s.clientId) redirect("/");

  const client = await adminDb.query.clients.findFirst({
    where: eq(schema.clients.slug, slug),
    columns: { id: true, slug: true },
  });
  if (!client) notFound();
  if (client.id !== s.clientId) notFound(); // prevents using another tenant's cookie on another tenant's URL

  await touchSession(s.id);
  const ctx: EdictContext = {
    kind: "client",
    sessionId: s.id,
    memberId: s.subjectId,
    clientId: client.id,
    clientSlug: client.slug,
  };
  return runWithContext(ctx, fn);
}

export { COOKIE as SESSION_COOKIE_NAME };
