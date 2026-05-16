import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { encodePairingLinkHex, formatPairingDisplay, renderPairingQr } from "../src/qr.js";

describe("pairing QR display", () => {
  it("renders a terminal QR code for a pairing link", () => {
    const qr = renderPairingQr("pi-remote://pair?code=123456");

    expect(qr).toContain("█");
    expect(qr.split("\n").length).toBeGreaterThan(5);
  });

  it("encodes pairing links as lowercase UTF-8 hex", () => {
    const pairingLink = "pi-remote://pair?baseUrl=https%3A%2F%2Fmacbook.tailnet.ts.net%3A17373&code=123456";

    const hex = encodePairingLinkHex(pairingLink);

    expect(hex).toMatch(/^[0-9a-f]+$/);
    expect(Buffer.from(hex, "hex").toString("utf8")).toBe(pairingLink);
  });

  it("formats QR, desktop hex, and expiry without raw link text", () => {
    const pairingLink = "pi-remote://pair?code=123456";
    const display = formatPairingDisplay({
      expiresAt: "2026-05-09T00:01:00.000Z",
      pairingLink,
      qrCode: "QR-CODE",
    });

    expect(display).toEqual([
      "Scan with Pi iOS app:",
      "QR-CODE",
      "Desktop pairing hex:",
      Buffer.from(pairingLink, "utf8").toString("hex"),
      "Expires at: 2026-05-09T00:01:00.000Z",
    ]);
    expect(display.join("\n")).not.toContain("pi-remote://pair");
    expect(display.join("\n")).not.toContain("Pairing link:");
    expect(display.join("\n")).not.toContain("Pair code:");
  });
});
