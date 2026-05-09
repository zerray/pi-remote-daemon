import { describe, expect, it } from "vitest";
import { hashDeviceToken, issueDeviceToken, verifyDeviceToken } from "../src/auth/tokens.js";

describe("device tokens", () => {
  it("issues a raw token and a persistable hash", () => {
    const issued = issueDeviceToken();

    expect(issued.rawToken).toMatch(/^prd_[A-Za-z0-9_-]{32,}$/);
    expect(issued.tokenHash).not.toContain(issued.rawToken);
  });

  it("verifies the original token", async () => {
    const hash = await hashDeviceToken("prd_test_token", "fixed-salt");

    await expect(verifyDeviceToken("prd_test_token", hash)).resolves.toBe(true);
    await expect(verifyDeviceToken("wrong", hash)).resolves.toBe(false);
  });
});
