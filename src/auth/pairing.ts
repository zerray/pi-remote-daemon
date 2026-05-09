import { randomInt, createHash, timingSafeEqual } from "node:crypto";
import { NotImplementedError } from "../errors.js";
import type { PairingCode } from "../types.js";

export type CreatedPairingCode = PairingCode & {
  rawCode: string;
};

export function createPairingCode(now: Date, ttlMs: number): CreatedPairingCode {
  // Generate a six digit decimal code.
  // Hash the code before storing it.
  // Set createdAt and expiresAt from now and ttlMs.
  void now;
  void ttlMs;
  void randomInt;
  throw new NotImplementedError("createPairingCode");
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
