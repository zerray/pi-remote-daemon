import { describe, expect, it, vi } from "vitest";
import { main } from "../src/push-gateway/cli.js";

describe("central Push Gateway CLI", () => {
  it("fails closed when APNs provider configuration is missing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(main({})).resolves.toBe(1);

    expect(error).toHaveBeenCalledWith(expect.stringContaining("PI_APNS_TEAM_ID"));
    error.mockRestore();
  });
});
