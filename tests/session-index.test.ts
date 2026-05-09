import { describe, expect, it } from "vitest";
import { daemonSessionIdForFile, projectIdForPath, toSessionIndexRecord } from "../src/session-index.js";

describe("session index", () => {
  it("derives stable prefixed ids", () => {
    expect(projectIdForPath("/repo/example")).toMatch(/^proj_[a-f0-9]{16}$/);
    expect(daemonSessionIdForFile("/sessions/example.jsonl")).toMatch(/^sess_[a-f0-9]{16}$/);
    expect(projectIdForPath("/repo/example")).toBe(projectIdForPath("/repo/example"));
  });

  it("maps Pi session summaries into daemon records", () => {
    expect(
      toSessionIndexRecord(
        { id: "proj_abc", name: "example", path: "/repo/example" },
        {
          piSessionId: "pi-session-1",
          sessionFile: "/sessions/example.jsonl",
          name: "Work session",
          updatedAt: "2026-05-09T00:00:00.000Z",
          messageCount: 12,
        },
      ),
    ).toMatchObject({
      projectId: "proj_abc",
      piSessionId: "pi-session-1",
      sessionFile: "/sessions/example.jsonl",
      nameCache: "Work session",
      messageCountCache: 12,
    });
  });
});
