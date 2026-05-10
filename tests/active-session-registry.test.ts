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

  it("prunes active TUI sessions when heartbeats stop", () => {
    let now = 1_000;
    const registry = createActiveSessionRegistry({ now: () => now, staleSessionTimeoutMs: 5_000 });
    registry.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    now = 5_000;
    expect(registry.touchSession("sess_1")).toBe(true);
    now = 9_999;
    expect(registry.pruneInactiveSessions()).toEqual([]);
    expect(registry.listProjects()).toEqual([{ id: "proj_1", name: "Example", path: "/repo/example" }]);

    now = 10_001;
    expect(registry.pruneInactiveSessions()).toEqual(["sess_1"]);
    expect(registry.listProjects()).toEqual([]);
    expect(registry.touchSession("sess_1")).toBe(false);
  });

  it("returns active registered sessions for TUI resume sync", () => {
    let now = 1_000;
    const registry = createActiveSessionRegistry({ now: () => now, staleSessionTimeoutMs: 5_000 });
    registry.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    expect(registry.getRegisteredSession("sess_1")).toMatchObject({ id: "sess_1", projectId: "proj_1" });
    now = 6_001;
    expect(registry.getRegisteredSession("sess_1")).toBeUndefined();
  });

  it("queues remote commands for active TUI sessions", () => {
    const registry = createActiveSessionRegistry();
    registry.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    expect(registry.enqueueCommand("sess_1", { type: "remote_abort", requestId: "req_1" })).toBe(true);
    expect(registry.enqueueCommand("missing", { type: "remote_abort", requestId: "req_2" })).toBe(false);
    expect(registry.takeCommands("sess_1")).toEqual([{ type: "remote_abort", requestId: "req_1" }]);
    expect(registry.takeCommands("sess_1")).toEqual([]);
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
      entries: [
        { type: "message", id: "msg_1", timestamp: "2026-05-09T00:00:00.000Z", message: { role: "user", content: "hello" } },
        { type: "message", id: "msg_2", timestamp: "2026-05-09T00:00:01.000Z", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
      ],
    });

    expect(registry.getSessionState("sess_1")).toMatchObject({
      session: { id: "sess_1", projectId: "proj_1", isActive: true },
      messages: [
        { id: "msg_1", role: "user", text: "hello", createdAt: "2026-05-09T00:00:00.000Z", isStreaming: false },
        { id: "msg_2", role: "assistant", text: "hi", createdAt: "2026-05-09T00:00:01.000Z", isStreaming: false },
      ],
      tools: [],
      isStreaming: true,
      pendingMessageCount: 0,
    });
    expect(registry.getSessionState("missing")).toBeUndefined();
  });
});
