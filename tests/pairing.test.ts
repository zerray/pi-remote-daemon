import { describe, expect, it } from "vitest";
import { canClaimPairingCode, createPairingCode, hashPairingCode } from "../src/auth/pairing.js";

describe("pairing codes", () => {
  it("creates a six digit code without storing it in plaintext", () => {
    const pairing = createPairingCode(new Date("2026-05-09T00:00:00.000Z"), 60_000);

    expect(pairing.rawCode).toMatch(/^\d{6}$/);
    expect(pairing.codeHash).not.toContain(pairing.rawCode);
    expect(pairing.expiresAt).toBe("2026-05-09T00:01:00.000Z");
  });

  it("hashes the same raw code consistently", () => {
    expect(hashPairingCode("123456")).toBe(hashPairingCode("123456"));
  });

  it("allows only matching, unconsumed, unexpired codes", () => {
    const now = new Date("2026-05-09T00:00:00.000Z");
    const pairing = createPairingCode(now, 60_000);

    expect(canClaimPairingCode(pairing, pairing.rawCode, now)).toBe(true);
    expect(canClaimPairingCode(pairing, "000000", now)).toBe(false);
    expect(canClaimPairingCode({ ...pairing, consumedAt: now.toISOString() }, pairing.rawCode, now)).toBe(false);
    expect(canClaimPairingCode(pairing, pairing.rawCode, new Date("2026-05-09T00:02:00.000Z"))).toBe(false);
  });
});
