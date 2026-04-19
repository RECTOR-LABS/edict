import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return encodeHexLowerCase(sha256(bytes));
}
