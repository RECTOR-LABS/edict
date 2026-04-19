import { describe, it, expect } from "vitest";
import { sha256Hex } from "@/lib/utils/hash";

describe("sha256Hex", () => {
  it("produces lowercase hex digest for a known input", () => {
    expect(sha256Hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("is deterministic across calls", () => {
    expect(sha256Hex("edict")).toBe(sha256Hex("edict"));
  });
});
