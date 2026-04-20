/**
 * Unit tests for requireAdminSession (lib/auth/middleware) exercised through
 * the AdminLayout wrapper.
 *
 * Coverage decision: option (b) — add dedicated tests. No existing test file
 * calls requireAdminSession directly. auth-verify-route.test.ts covers session
 * creation (the verify route) but never the session-gate path that the admin
 * layout depends on. Both branches (success: admin session → fn executes,
 * failure: no/invalid session → redirect) are tested here.
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
    // next/navigation redirect throws in the real RSC runtime. Mirror that so
    // callers can .rejects.toThrow() or catch it.
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/utils/hash", () => ({
  sha256Hex: vi.fn((v: string) => `hash(${v})`),
}));

// Prevent lib/db/index.ts from evaluating (it calls required("DATABASE_URL")
// at module load time). middleware.ts imports adminDb/schema directly.
vi.mock("@/lib/db", () => ({
  adminDb: {},
  schema: {},
}));

vi.mock("@/lib/db/queries/sessions", () => ({
  findActiveSessionByTokenHash: vi.fn(),
  touchSession: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports (after vi.mock hoisting) ─────────────────────────────────────────

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  findActiveSessionByTokenHash,
  touchSession,
} from "@/lib/db/queries/sessions";
import { requireAdminSession } from "@/lib/auth/middleware";

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionRow = InferSelectModel<typeof sessions>;

// ── Mocked references ─────────────────────────────────────────────────────────

const mockCookies = vi.mocked(cookies);
const mockFindSession = vi.mocked(findActiveSessionByTokenHash);
const mockTouchSession = vi.mocked(touchSession);
const mockRedirect = vi.mocked(redirect);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Minimal ReadonlyRequestCookies stub. Uses unknown-to-type cast to avoid
 * having to satisfy the full cookies() interface (size, forEach, etc.) for
 * tests that only exercise the .get() path inside middleware.ts.
 */
function makeCookieJar(token: string | null): Awaited<ReturnType<typeof cookies>> {
  return {
    get: (_name: string) => (token ? { name: _name, value: token } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>;
}

/**
 * Minimal session row stub. Only the fields read by requireAdminSession
 * (id, subjectType, subjectId, clientId) need to be set; the rest are
 * satisfied by the cast.
 */
function makeAdminSession(overrides: {
  id?: string;
  subjectType?: SessionRow["subjectType"];
} = {}): SessionRow {
  return {
    id: overrides.id ?? "session-uuid-1",
    subjectType: overrides.subjectType ?? "admin",
    subjectId: "admin-uuid-1",
    clientId: null,
    sessionTokenHash: "hash(raw-token)",
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    lastSeenAt: new Date(),
    createdAt: new Date(),
    ip: null,
    userAgent: null,
  } as SessionRow;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("requireAdminSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no cookie present.
    mockCookies.mockResolvedValue(makeCookieJar(null));
    // Default: touch is a no-op.
    mockTouchSession.mockResolvedValue(undefined);
  });

  // ── Failure: no cookie ───────────────────────────────────────────────────────
  it("redirects to / when no session cookie is present", async () => {
    mockCookies.mockResolvedValue(makeCookieJar(null));
    mockFindSession.mockResolvedValue(null);

    await expect(requireAdminSession(async () => "ok")).rejects.toThrow("REDIRECT:/");

    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockTouchSession).not.toHaveBeenCalled();
  });

  // ── Failure: cookie present but no matching session row ───────────────────────
  it("redirects to / when session token not found in DB", async () => {
    mockCookies.mockResolvedValue(makeCookieJar("raw-token"));
    mockFindSession.mockResolvedValue(null);

    await expect(requireAdminSession(async () => "ok")).rejects.toThrow("REDIRECT:/");

    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockTouchSession).not.toHaveBeenCalled();
  });

  // ── Failure: cookie + session found but subjectType is client_member ──────────
  it("redirects to / when session subjectType is client_member (not admin)", async () => {
    mockCookies.mockResolvedValue(makeCookieJar("raw-token"));
    mockFindSession.mockResolvedValue(makeAdminSession({ subjectType: "client_member" }));

    await expect(requireAdminSession(async () => "ok")).rejects.toThrow("REDIRECT:/");

    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockTouchSession).not.toHaveBeenCalled();
  });

  // ── Success: valid admin session → callback executes, result returned ─────────
  it("runs callback and returns its result when admin session is valid", async () => {
    mockCookies.mockResolvedValue(makeCookieJar("raw-token"));
    mockFindSession.mockResolvedValue(makeAdminSession());

    const result = await requireAdminSession(async () => "protected-content");

    expect(result).toBe("protected-content");
    expect(mockTouchSession).toHaveBeenCalledWith("session-uuid-1");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  // ── Success: touchSession is called with the correct session ID ───────────────
  it("touches the session with the correct session ID on success", async () => {
    const sessionId = "distinct-session-id";
    mockCookies.mockResolvedValue(makeCookieJar("raw-token"));
    mockFindSession.mockResolvedValue(makeAdminSession({ id: sessionId }));

    await requireAdminSession(async () => undefined);

    expect(mockTouchSession).toHaveBeenCalledOnce();
    expect(mockTouchSession).toHaveBeenCalledWith(sessionId);
  });
});

// ── AdminLayout wrapper smoke test ────────────────────────────────────────────

describe("AdminLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTouchSession.mockResolvedValue(undefined);
  });

  it("renders children when admin session is valid", async () => {
    // Dynamic import after mocks are registered.
    const { default: AdminLayout } = await import("@/app/(admin)/layout");

    mockCookies.mockResolvedValue(makeCookieJar("raw-token"));
    mockFindSession.mockResolvedValue(makeAdminSession());

    const children = <div id="child">admin content</div>;
    const result = await AdminLayout({ children });

    // Layout delegates to requireAdminSession which wraps children in a
    // fragment. Verify it returns a truthy React element and redirect was not called.
    expect(result).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("redirects when called without a valid admin session", async () => {
    const { default: AdminLayout } = await import("@/app/(admin)/layout");

    mockCookies.mockResolvedValue(makeCookieJar(null));
    mockFindSession.mockResolvedValue(null);

    const children = <div id="child">should not render</div>;
    await expect(AdminLayout({ children })).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });
});
