import { randomInt, createHash, timingSafeEqual } from "node:crypto";
import { NotImplementedError } from "../errors.js";
import type { PairingCode } from "../types.js";

export type CreatedPairingCode = PairingCode & {
  rawCode: string;
};

export function createPairingCode(now: Date, ttlMs: number): CreatedPairingCode {
  const rawCode = randomInt(0, 1_000_000).toString().padStart(6, "0");
  return {
    id: `pair_${createHash("sha256").update(`${rawCode}:${now.toISOString()}`).digest("hex").slice(0, 16)}`,
    rawCode,
    codeHash: createHash("sha256").update(rawCode).digest("hex"),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
}

export function hashPairingCode(rawCode: string): string {
  return createHash("sha256").update(rawCode).digest("hex");
}

export function canClaimPairingCode(pairingCode: PairingCode, rawCode: string, now: Date): boolean {
  if (pairingCode.consumedAt) return false;
  if (Date.parse(pairingCode.expiresAt) <= now.getTime()) return false;

  const expected = Buffer.from(pairingCode.codeHash);
  const actual = Buffer.from(hashPairingCode(rawCode));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
