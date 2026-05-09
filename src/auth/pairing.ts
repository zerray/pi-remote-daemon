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
  // Hash the short pairing code with a daemon-local format.
  // Return an encoded string that can be compared later.
  void rawCode;
  void createHash;
  throw new NotImplementedError("hashPairingCode");
}

export function canClaimPairingCode(pairingCode: PairingCode, rawCode: string, now: Date): boolean {
  // Reject consumed codes.
  // Reject expired codes.
  // Hash the candidate raw code and compare with timingSafeEqual.
  void pairingCode;
  void rawCode;
  void now;
  void timingSafeEqual;
  throw new NotImplementedError("canClaimPairingCode");
}
