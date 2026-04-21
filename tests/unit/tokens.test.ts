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

  it("default encodes 32 random bytes (256 bits) into 52 base32 chars", () => {
    const { raw } = generateToken();
    expect(raw.length).toBe(52);
  });

  it("rejects byte lengths below the 16-byte (128-bit) floor", () => {
    expect(() => generateToken(8)).toThrow(/must be >= 16/);
    expect(() => generateToken(0)).toThrow(/must be >= 16/);
  });
});
