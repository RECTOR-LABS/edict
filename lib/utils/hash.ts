import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";

/**
 * Lowercase hex SHA-256 of the UTF-8 bytes of `input`.
 * Used for token/session hash-at-rest — NOT for password hashing
 * (no salt, not memory-hard; use argon2/scrypt for passwords).
 */
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return encodeHexLowerCase(sha256(bytes));
}
