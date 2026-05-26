import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { createActiveSessionRegistry } from "../src/active-session-registry.js";

const runtimeStatus = {
  model: { provider: "anthropic", id: "claude-sonnet-4-5", contextWindow: 200000 },
  thinkingLevel: "medium" as const,
  usage: { input: 12, output: 3, cacheRead: 50, cacheWrite: 10, cost: { input: 0.036, output: 0.045, cacheRead: 0.015, cacheWrite: 0.0375, total: 0.1335 } },
  context: { tokens: 65000, contextWindow: 200000, percent: 32.5 },
  updatedAt: "2026-05-09T09:47:00.000Z",
};

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

  it("prunes active TUI sessions when the owning TUI process exits", () => {
    const registry = createActiveSessionRegistry({ isProcessRunning: (pid) => pid !== 1234, staleSessionTimeoutMs: 60_000 });
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

    expect(registry.pruneInactiveSessions()).toEqual(["sess_1"]);
    expect(registry.listProjects()).toEqual([]);
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

  it("uses visible conversation message counts for active session summaries", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-control-registry-count-"));
    const sessionFile = join(root, "session.jsonl");
    const registry = createActiveSessionRegistry();
    try {
      await writeFile(sessionFile, [
        JSON.stringify({ type: "message", id: "msg_1", timestamp: "2026-05-09T00:00:00.000Z", message: { role: "user", content: "hello" } }),
        JSON.stringify({ type: "message", id: "msg_2", timestamp: "2026-05-09T00:00:01.000Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "checking" }, { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } }, { type: "text", text: "done" }] } }),
        JSON.stringify({ type: "message", id: "msg_3", timestamp: "2026-05-09T00:00:02.000Z", message: { role: "toolResult", toolCallId: "call_1", toolName: "bash", content: [{ type: "text", text: "file.txt" }] } }),
        JSON.stringify({ type: "message", id: "msg_4", timestamp: "2026-05-09T00:00:03.000Z", message: { role: "system", content: "system" } }),
      ].join("\n"));
      registry.registerSession({
        id: "sess_1",
        piSessionId: "pi_1",
        project: { id: "proj_1", name: "Example", path: "/repo/example" },
        sessionFile,
        pid: 1234,
        messageCount: 999,
        isStreaming: false,
        updatedAt: "2026-05-09T00:00:00.000Z",
      });

      expect(registry.listProjectSessions("proj_1")[0]?.messageCount).toBe(2);
      expect(registry.getSessionState("sess_1")?.session.messageCount).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns snapshots for active sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-control-registry-"));
    const sessionFile = join(root, "session.jsonl");
    const registry = createActiveSessionRegistry();
    try {
      await writeFile(sessionFile, [
        JSON.stringify({ type: "message", id: "msg_1", timestamp: "2026-05-09T00:00:00.000Z", message: { role: "user", content: "hello" } }),
        JSON.stringify({ type: "message", id: "msg_2", timestamp: "2026-05-09T00:00:01.000Z", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } }),
      ].join("\n"));
      registry.registerSession({
        id: "sess_1",
        piSessionId: "pi_1",
        project: { id: "proj_1", name: "Example", path: "/repo/example" },
        sessionFile,
        pid: 1234,
        messageCount: 0,
        isStreaming: true,
        updatedAt: "2026-05-09T00:00:00.000Z",
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
      runtimeStatus: null,
      });
      expect(registry.getSessionState("missing")).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("generates ephemeral names for unnamed active sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-control-generated-name-"));
    const sessionFile = join(root, "session.jsonl");
    const generator = vi.fn(async () => "Debug login failure");
    const registry = createActiveSessionRegistry({ nameGenerator: generator });
    try {
      await writeFile(sessionFile, [
        JSON.stringify({ type: "message", id: "msg_1", timestamp: "2026-05-09T00:00:00.000Z", message: { role: "user", content: "The login button fails on iOS" } }),
        JSON.stringify({ type: "message", id: "msg_2", timestamp: "2026-05-09T00:00:01.000Z", message: { role: "assistant", content: [{ type: "text", text: "I'll inspect the auth flow." }] } }),
      ].join("\n"));

      registry.registerSession({
        id: "sess_1",
        piSessionId: "pi_1",
        project: { id: "proj_1", name: "Example", path: "/repo/example" },
        sessionFile,
        pid: 1234,
        messageCount: 0,
        isStreaming: false,
        updatedAt: "2026-05-09T00:00:00.000Z",
      });

      await vi.waitFor(() => expect(registry.listProjectSessions("proj_1")[0]?.name).toBe("Debug login failure"));
      expect(generator).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: "sess_1",
        sessionFile,
        messages: [
          expect.objectContaining({ id: "msg_1", text: "The login button fails on iOS" }),
          expect.objectContaining({ id: "msg_2", text: "I'll inspect the auth flow." }),
        ],
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats blank TUI names as unnamed for generated names", async () => {
    const generator = vi.fn(async () => "Generated blank-name title");
    const registry = createActiveSessionRegistry({ nameGenerator: generator });
    registry.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      name: "   ",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    await vi.waitFor(() => expect(registry.listProjectSessions("proj_1")[0]?.name).toBe("Generated blank-name title"));
  });

  it("updates active session names from TUI session metadata", () => {
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

    expect(registry.updateSessionName("sess_1", "Refactor auth module")).toBe(true);
    expect(registry.listProjectSessions("proj_1")[0]?.name).toBe("Refactor auth module");
    expect(registry.getSessionState("sess_1")?.session.name).toBe("Refactor auth module");
    expect(registry.updateSessionName("missing", "Other")).toBe(false);
  });

  it("stores and updates runtime status snapshots for active sessions", () => {
    const registry = createActiveSessionRegistry();
    registry.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      runtimeStatus,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    expect(registry.getSessionState("sess_1")?.runtimeStatus).toEqual(runtimeStatus);
    expect(registry.updateRuntimeStatus("sess_1", runtimeStatus)).toBe(false);

    const nextStatus = { ...runtimeStatus, thinkingLevel: "high" as const, updatedAt: "2026-05-09T09:48:00.000Z" };
    expect(registry.updateRuntimeStatus("sess_1", nextStatus)).toBe(true);
    expect(registry.getSessionState("sess_1")?.runtimeStatus).toEqual(nextStatus);
    expect(registry.updateRuntimeStatus("missing", nextStatus)).toBe(false);
  });
});
