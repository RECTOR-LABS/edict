import { describe, it, expect } from "vitest";
import { generateToken } from "@/lib/auth/tokens";
import { sha256Hex } from "@/lib/utils/hash";

describe("generateToken", () => {
  it("returns raw and hash, with hash matching sha256(raw)", () => {
    const { raw, hash } = generateToken();
    expect(raw).toMatch(/^[a-z0-9]+$/);
    expect(hash).toBe(sha256Hex(raw));
  });

  it("produces distinct tokens across calls", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.raw).not.toBe(b.raw);
  });

  it("raw has entropy >= 160 bits (32 base32 chars)", () => {
    const { raw } = generateToken();
    expect(raw.length).toBeGreaterThanOrEqual(32);
  });
});
