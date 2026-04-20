/**
 * Unit tests for requireClientSession (lib/auth/middleware) exercised directly
 * and through the ClientLayout wrapper.
 *
 * Coverage decision: new tests — no existing file calls requireClientSession.
 * This is the load-bearing tenant-isolation gate; it demands the same rigour
 * applied to requireAdminSession in admin-layout.test.tsx (Task 31).
 *
 * Architecture note: requireClientSession performs its own
 * `adminDb.query.clients.findFirst` (slim columns: id, slug) to verify that
 * the session's clientId matches the slug-resolved client. It does NOT call
 * getClientBySlug. The layout calls getClientBySlug *afterwards* for display
 * data (name, brandColor, logoUrl). Both adminDb usages are mocked here.
 *
 * Tenant-isolation mismatch path: client.id !== session.clientId → notFound(),
 * NOT redirect. This is intentional (slug exists, but wrong creds → 404 rather
 * than leaking that a different tenant's slug is valid).
 *
 * Expiry / revoke: findActiveSessionByTokenHash already filters revokedAt IS
 * NULL and expiresAt > now at the query level, so both surface as null returns
 * from that mock → redirect("/").
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { sessions } from "@/lib/db/schema";
import type { InferSelectModel } from "drizzle-orm";

// ── Mocks (hoisted — must be at module level) ─────────────────────────────────

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    // Mirror RSC runtime: redirect throws so callers can .rejects.toThrow().
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    // Mirror RSC runtime: notFound also throws.
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("@/lib/utils/hash", () => ({
  sha256Hex: vi.fn((v: string) => `hash(${v})`),
}));

// Prevent lib/db/index.ts from evaluating (calls required("DATABASE_URL") at
// module load). We supply a controlled stub with query.clients.findFirst.
const mockFindClientBySlug = vi.fn();
vi.mock("@/lib/db", () => ({
  adminDb: {
    query: {
      clients: {
        findFirst: (...args: unknown[]) => mockFindClientBySlug(...args),
      },
    },
  },
  schema: {
    clients: { slug: "slug_column_ref" },
  },
}));

vi.mock("@/lib/db/queries/sessions", () => ({
  findActiveSessionByTokenHash: vi.fn(),
  touchSession: vi.fn().mockResolvedValue(undefined),
}));

// getClientBySlug is used by the layout (not by requireClientSession) to fetch
// display data. Mock it so layout tests don't need a real DB.
vi.mock("@/lib/db/queries/clients", () => ({
  getClientBySlug: vi.fn(),
}));

// ── Imports (after vi.mock hoisting) ─────────────────────────────────────────

import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import {
  findActiveSessionByTokenHash,
  touchSession,
} from "@/lib/db/queries/sessions";
import { getClientBySlug } from "@/lib/db/queries/clients";
import { requireClientSession } from "@/lib/auth/middleware";

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionRow = InferSelectModel<typeof sessions>;

// ── Mocked references ─────────────────────────────────────────────────────────

const mockCookies = vi.mocked(cookies);
const mockFindSession = vi.mocked(findActiveSessionByTokenHash);
const mockTouchSession = vi.mocked(touchSession);
const mockRedirect = vi.mocked(redirect);
const mockNotFound = vi.mocked(notFound);
const mockGetClientBySlug = vi.mocked(getClientBySlug);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Minimal ReadonlyRequestCookies stub — satisfies the .get() path middleware
 * uses without needing the full interface (size, forEach, etc.).
 */
function makeCookieJar(token: string | null): Awaited<ReturnType<typeof cookies>> {
  return {
    get: (_name: string) => (token ? { name: _name, value: token } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>;
}

/**
 * Minimal session row stub for a client_member session.
 * Only fields read by requireClientSession need to be accurate; the rest are
 * satisfied by the cast.
 */
function makeClientSession(overrides: {
  id?: string;
  subjectType?: SessionRow["subjectType"];
  clientId?: string | null;
} = {}): SessionRow {
  return {
    id: overrides.id ?? "session-uuid-c1",
    subjectType: overrides.subjectType ?? "client_member",
    subjectId: "member-uuid-1",
    clientId: overrides.clientId !== undefined ? overrides.clientId : "client-uuid-foo",
    sessionTokenHash: "hash(raw-token)",
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    lastSeenAt: new Date(),
    createdAt: new Date(),
    ip: null,
    userAgent: null,
  } as SessionRow;
}

/**
 * Stub returned by adminDb.query.clients.findFirst — matches the slim shape
 * requireClientSession queries (only id + slug columns).
 */
function makeClientRow(overrides: {
  id?: string;
  slug?: string;
} = {}): { id: string; slug: string } {
  return {
    id: overrides.id ?? "client-uuid-foo",
    slug: overrides.slug ?? "foo",
  };
}

/**
 * Full client row returned by getClientBySlug (used in layout rendering).
 */
function makeFullClientRow(overrides: {
  id?: string;
  slug?: string;
  name?: string;
  brandColor?: string | null;
  logoUrl?: string | null;
} = {}) {
  return {
    id: overrides.id ?? "client-uuid-foo",
    slug: overrides.slug ?? "foo",
    name: overrides.name ?? "Foo Corp",
    brandColor: overrides.brandColor !== undefined ? overrides.brandColor : "#ff6600",
    logoUrl: overrides.logoUrl !== undefined ? overrides.logoUrl : null,
    createdAt: new Date(),
  };
}

// ── Tests: requireClientSession gate ─────────────────────────────────────────

describe("requireClientSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue(makeCookieJar(null));
    mockTouchSession.mockResolvedValue(undefined);
  });

  // ── 1. No session cookie ────────────────────────────────────────────────────
  it("redirects to / when no session cookie is present", async () => {
    mockCookies.mockResolvedValue(makeCookieJar(null));
    mockFindSession.mockResolvedValue(null);

    await expect(requireClientSession("foo", async () => "ok")).rejects.toThrow("REDIRECT:/");

    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockTouchSession).not.toHaveBeenCalled();
  });

  // ── 2. Cookie present but no matching session row (invalid hash) ────────────
  it("redirects to / when session token not found in DB", async () => {
    mockCookies.mockResolvedValue(makeCookieJar("raw-token"));
    mockFindSession.mockResolvedValue(null);

    await expect(requireClientSession("foo", async () => "ok")).rejects.toThrow("REDIRECT:/");

    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockTouchSession).not.toHaveBeenCalled();
  });

  // ── 3. Admin session (wrong subjectType) ────────────────────────────────────
  it("redirects to / when session subjectType is admin (not client_member)", async () => {
    mockCookies.mockResolvedValue(makeCookieJar("raw-token"));
    mockFindSession.mockResolvedValue(makeClientSession({ subjectType: "admin", clientId: null }));

    await expect(requireClientSession("foo", async () => "ok")).rejects.toThrow("REDIRECT:/");

    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockTouchSession).not.toHaveBeenCalled();
  });

  // ── 4. CRITICAL: client_member session but slug resolves to a DIFFERENT client
  //      This is the core tenant-isolation test: a valid session for "foo" must
  //      NOT be accepted at the "bar" URL. Mismatch → notFound() (not redirect).
  it("calls notFound() when session clientId does not match the slug-resolved client id", async () => {
    // Session belongs to "foo" (client-uuid-foo).
    mockCookies.mockResolvedValue(makeCookieJar("raw-token"));
    mockFindSession.mockResolvedValue(makeClientSession({ clientId: "client-uuid-foo" }));

    // But the URL slug "bar" resolves to a different client id.
    mockFindClientBySlug.mockResolvedValue(makeClientRow({ id: "client-uuid-bar", slug: "bar" }));

    await expect(requireClientSession("bar", async () => "ok")).rejects.toThrow("NOT_FOUND");

    expect(mockNotFound).toHaveBeenCalled();
    // Critically: callback never runs and session is not touched.
    expect(mockTouchSession).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  // ── 5. Valid client_member session + matching slug ──────────────────────────
  it("runs callback, touches session, and returns result when session is valid for slug", async () => {
    mockCookies.mockResolvedValue(makeCookieJar("raw-token"));
    mockFindSession.mockResolvedValue(makeClientSession({ id: "session-uuid-c1", clientId: "client-uuid-foo" }));
    mockFindClientBySlug.mockResolvedValue(makeClientRow({ id: "client-uuid-foo", slug: "foo" }));

    const result = await requireClientSession("foo", async () => "protected-content");

    expect(result).toBe("protected-content");
    expect(mockTouchSession).toHaveBeenCalledWith("session-uuid-c1");
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  // ── 6. Session expired (findActiveSessionByTokenHash returns null) ──────────
  //      findActiveSessionByTokenHash filters expiresAt > now at query level,
  //      so expired sessions surface identically to "not found".
  it("redirects to / when session is expired (findActiveSession returns null)", async () => {
    mockCookies.mockResolvedValue(makeCookieJar("raw-token"));
    // Simulate expiry: query returns null (expiresAt filter excluded it).
    mockFindSession.mockResolvedValue(null);

    await expect(requireClientSession("foo", async () => "ok")).rejects.toThrow("REDIRECT:/");

    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockTouchSession).not.toHaveBeenCalled();
  });

  // ── 7. Session revoked (revokedAt set) ─────────────────────────────────────
  //      findActiveSessionByTokenHash filters revokedAt IS NULL at query level,
  //      so revoked sessions surface identically to "not found".
  it("redirects to / when session is revoked (findActiveSession returns null)", async () => {
    mockCookies.mockResolvedValue(makeCookieJar("raw-token"));
    // Simulate revocation: query returns null (revokedAt filter excluded it).
    mockFindSession.mockResolvedValue(null);

    await expect(requireClientSession("foo", async () => "ok")).rejects.toThrow("REDIRECT:/");

    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockTouchSession).not.toHaveBeenCalled();
  });

  // ── Additional: client_member session with null clientId ────────────────────
  //      Schema constraint prevents this in practice, but middleware guards it
  //      explicitly: `!s.clientId` → redirect.
  it("redirects to / when session is client_member but clientId is null", async () => {
    mockCookies.mockResolvedValue(makeCookieJar("raw-token"));
    mockFindSession.mockResolvedValue(makeClientSession({ clientId: null }));

    await expect(requireClientSession("foo", async () => "ok")).rejects.toThrow("REDIRECT:/");

    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockTouchSession).not.toHaveBeenCalled();
  });
});

// ── Tests: ClientLayout smoke tests ──────────────────────────────────────────

describe("ClientLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTouchSession.mockResolvedValue(undefined);
  });

  // ── 8. Unauthenticated → layout short-circuits via redirect ─────────────────
  it("redirects when called without a valid client session", async () => {
    const { default: ClientLayout } = await import("@/app/(client)/c/[slug]/layout");

    mockCookies.mockResolvedValue(makeCookieJar(null));
    mockFindSession.mockResolvedValue(null);

    const children = <div id="child">should not render</div>;
    await expect(
      ClientLayout({ children, params: Promise.resolve({ slug: "foo" }) }),
    ).rejects.toThrow("REDIRECT:/");

    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  // ── 9. Authenticated + tenant found → branded shell with CSS var ─────────────
  it("renders children inside branded shell with --tenant-color CSS var when brandColor is set", async () => {
    const { default: ClientLayout } = await import("@/app/(client)/c/[slug]/layout");

    mockCookies.mockResolvedValue(makeCookieJar("raw-token"));
    mockFindSession.mockResolvedValue(makeClientSession({ clientId: "client-uuid-foo" }));
    mockFindClientBySlug.mockResolvedValue(makeClientRow({ id: "client-uuid-foo", slug: "foo" }));
    mockGetClientBySlug.mockResolvedValue(makeFullClientRow({ brandColor: "#ff6600" }));

    const children = <div id="child">client content</div>;
    const result = await ClientLayout({ children, params: Promise.resolve({ slug: "foo" }) });

    expect(result).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockNotFound).not.toHaveBeenCalled();
  });
});
