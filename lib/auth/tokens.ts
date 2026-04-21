import { randomBytes } from "node:crypto";
import { encodeBase32LowerCaseNoPadding } from "@oslojs/encoding";
import { sha256Hex } from "@/lib/utils/hash";

export type GeneratedToken = { raw: string; hash: string };

const MIN_ENTROPY_BYTES = 16;

/**
 * Generates a cryptographically random token and its SHA-256 hash.
 *
 * Email `raw` to the user (magic-link URL, session cookie). Store `hash` in the
 * DB — `raw` is never persisted, so a DB compromise cannot yield valid tokens.
 *
 * Minimum 16 bytes (128 bits) enforced; default 32 bytes (256 bits). Session
 * tokens override to 64 bytes — see `verifyMagicLink` in `lib/auth/verify.ts`.
 */
export function generateToken(bytes = 32): GeneratedToken {
  if (bytes < MIN_ENTROPY_BYTES) {
    throw new Error(`generateToken: bytes must be >= ${MIN_ENTROPY_BYTES} (got ${bytes})`);
  }
  const buf = randomBytes(bytes);
  const raw = encodeBase32LowerCaseNoPadding(buf);
  return { raw, hash: sha256Hex(raw) };
}
