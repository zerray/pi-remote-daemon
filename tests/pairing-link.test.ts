import { describe, expect, it } from "vitest";
import { buildPairingLink } from "../src/pairing-link.js";

describe("pairing links", () => {
  it("encodes advertised daemon URL, pair code, and expiry", () => {
    expect(
      buildPairingLink({
        advertisedBaseUrl: "https://macbook.tailnet.ts.net:17373",
        pairCode: "123456",
        expiresAt: "2026-05-09T09:52:00.000Z",
      }),
    ).toBe(
      "pi-remote://pair?baseUrl=https%3A%2F%2Fmacbook.tailnet.ts.net%3A17373&code=123456&expiresAt=2026-05-09T09%3A52%3A00.000Z",
    );
  });

  it("requires an advertised daemon URL", () => {
    expect(() =>
      buildPairingLink({
        advertisedBaseUrl: undefined,
        pairCode: "123456",
        expiresAt: "2026-05-09T09:52:00.000Z",
      }),
    ).toThrow("advertisedBaseUrl is required for QR pairing");
  });
});
