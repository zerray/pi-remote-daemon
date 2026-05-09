import { describe, expect, it } from "vitest";
import { formatPairingDisplay, renderPairingQr } from "../src/qr.js";

describe("pairing QR display", () => {
  it("renders a terminal QR code for a pairing link", () => {
    const qr = renderPairingQr("pi-remote://pair?code=123456");

    expect(qr).toContain("█");
    expect(qr.split("\n").length).toBeGreaterThan(5);
  });

  it("formats QR, fallback code, expiry, and link", () => {
    const display = formatPairingDisplay({
      pairCode: "123456",
      expiresAt: "2026-05-09T00:01:00.000Z",
      pairingLink: "pi-remote://pair?code=123456",
      qrCode: "QR-CODE",
    });

    expect(display).toEqual([
      "Scan with Pi iOS app:",
      "QR-CODE",
      "Pair code: 123456",
      "Expires at: 2026-05-09T00:01:00.000Z",
      "Pairing link: pi-remote://pair?code=123456",
    ]);
  });
});
