import { randomBytes } from "node:crypto";
import { encodeBase32LowerCaseNoPadding } from "@oslojs/encoding";
import { sha256Hex } from "@/lib/utils/hash";

export type GeneratedToken = { raw: string; hash: string };

export function generateToken(bytes = 32): GeneratedToken {
  const buf = randomBytes(bytes);
  const raw = encodeBase32LowerCaseNoPadding(buf);
  return { raw, hash: sha256Hex(raw) };
}
