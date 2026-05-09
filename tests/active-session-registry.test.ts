import { describe, expect, it } from "vitest";
import { createActiveSessionRegistry } from "../src/active-session-registry.js";

describe("active TUI session registry", () => {
  it("groups active sessions by project and removes inactive sessions", () => {
    const registry = createActiveSessionRegistry();
    registry.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      name: "Fix bug",
      pid: 1234,
      messageCount: 2,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    expect(registry.listProjects()).toEqual([{ id: "proj_1", name: "Example", path: "/repo/example" }]);
    expect(registry.listProjectSessions("proj_1")).toEqual([
      {
        id: "sess_1",
        piSessionId: "pi_1",
        projectId: "proj_1",
        name: "Fix bug",
        path: "/tmp/session.jsonl",
        updatedAt: "2026-05-09T00:00:00.000Z",
        messageCount: 2,
        isActive: true,
      },
    ]);

    expect(registry.unregisterSession("sess_1")).toBe(true);
    expect(registry.listProjects()).toEqual([]);
    expect(registry.listProjectSessions("proj_1")).toEqual([]);
  });

  it("returns snapshots for active sessions", () => {
    const registry = createActiveSessionRegistry();
    registry.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: true,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    expect(registry.getSessionState("sess_1")).toMatchObject({
      session: { id: "sess_1", projectId: "proj_1", isActive: true },
      messages: [],
      tools: [],
      isStreaming: true,
      pendingMessageCount: 0,
    });
    expect(registry.getSessionState("missing")).toBeUndefined();
  });
});
