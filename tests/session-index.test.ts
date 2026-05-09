import { describe, expect, it } from "vitest";
import { projectIdForPath } from "../src/session-index.js";

describe("session identifiers", () => {
  it("creates stable project ids from paths", () => {
    expect(projectIdForPath("/repo/example")).toBe(projectIdForPath("/repo/example"));
    expect(projectIdForPath("/repo/example")).toMatch(/^proj_[0-9a-f]{16}$/);
    expect(projectIdForPath("/repo/example")).not.toBe(projectIdForPath("/repo/other"));
  });
});
