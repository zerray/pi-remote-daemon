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

  it("accepts each Agent Settlement once for an active session", () => {
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

    expect(registry.acceptAgentSettlement("sess_1", "settle_1")).toEqual({
      settlementId: "settle_1",
      sessionId: "sess_1",
      projectId: "proj_1",
    });
    expect(registry.acceptAgentSettlement("sess_1", "settle_1")).toBeUndefined();
    expect(registry.acceptAgentSettlement("missing", "settle_2")).toBeUndefined();
    expect(registry.acceptAgentSettlement("sess_1", "settle_2")).toEqual({
      settlementId: "settle_2",
      sessionId: "sess_1",
      projectId: "proj_1",
    });
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

  it("stores the owning TUI model catalog only for an active session", () => {
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
    const catalog = {
      currentModel: { provider: "anthropic", modelId: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", reasoning: true, contextWindow: 200000, maxTokens: 8192, isScoped: true },
      models: [
        { provider: "anthropic", modelId: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", reasoning: true, contextWindow: 200000, maxTokens: 8192, isScoped: true },
        { provider: "openai", modelId: "gpt-5", name: "GPT-5", reasoning: true, contextWindow: 400000, maxTokens: 128000, isScoped: false },
      ],
      catalogVersion: "modelsv_known",
      generatedAt: "2026-05-09T09:47:00.000Z",
    };

    expect(registry.getModelCatalog("sess_1")).toEqual({ ok: false, error: "model_catalog_unavailable" });
    expect(registry.updateModelCatalog("missing", catalog)).toBe(false);
    expect(registry.updateModelCatalog("sess_1", catalog)).toBe(true);
    expect(registry.updateModelCatalog("sess_1", catalog)).toBe(false);
    expect(registry.getModelCatalog("sess_1")).toEqual({ ok: true, catalog });
    expect(registry.getModelCatalog("missing")).toEqual({ ok: false, error: "session_not_active" });
  });

  it("uses refreshed tree snapshots to recover from stale active-branch leaves", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-control-registry-stale-leaf-"));
    const sessionFile = join(root, "session.jsonl");
    const registry = createActiveSessionRegistry();
    try {
      await writeFile(sessionFile, [
        JSON.stringify({ type: "message", id: "user_1", parentId: null, timestamp: "2026-05-09T00:00:00.000Z", message: { role: "user", content: "run checks" } }),
        JSON.stringify({ type: "message", id: "tool_result", parentId: "user_1", timestamp: "2026-05-09T00:00:01.000Z", message: { role: "toolResult", toolCallId: "call_1", toolName: "bash", content: "ok" } }),
        JSON.stringify({ type: "message", id: "assistant_final", parentId: "tool_result", timestamp: "2026-05-09T00:00:02.000Z", message: { role: "assistant", content: "finished" } }),
      ].join("\n"));
      registry.registerSession({
        id: "sess_1",
        piSessionId: "pi_1",
        project: { id: "proj_1", name: "Example", path: "/repo/example" },
        sessionFile,
        pid: 1234,
        messageCount: 3,
        isStreaming: false,
        updatedAt: "2026-05-09T00:00:00.000Z",
      });

      expect(registry.updateTreeState("sess_1", { leafId: "tool_result", branchVersion: "branchv_stale" })).toBe(true);
      expect(registry.getSessionState("sess_1")?.messages.map((message) => message.id)).toEqual(["user_1", "tool_result"]);

      expect(registry.updateTreeSnapshot("sess_1", {
        sessionId: "sess_1",
        leafId: "assistant_final",
        snapshotVersion: "treev_2",
        branchVersion: "branchv_fresh",
        entries: [
          { id: "user_1", parentId: null, type: "message", role: "user", title: "user", preview: "run checks", timestamp: "2026-05-09T00:00:00.000Z", isCurrentLeaf: false, isOnActiveBranch: true, isForkable: true, navigationBehavior: "edit_prompt" },
          { id: "tool_result", parentId: "user_1", type: "message", role: "toolResult", title: "toolResult", preview: "ok", timestamp: "2026-05-09T00:00:01.000Z", isCurrentLeaf: false, isOnActiveBranch: true, isForkable: false, navigationBehavior: "navigate" },
          { id: "assistant_final", parentId: "tool_result", type: "message", role: "assistant", title: "assistant", preview: "finished", timestamp: "2026-05-09T00:00:02.000Z", isCurrentLeaf: true, isOnActiveBranch: true, isForkable: false, navigationBehavior: "navigate" },
        ],
        defaultFilter: "default",
        filters: ["default", "no-tools", "user-only", "labeled-only", "all"],
        generatedAt: "2026-05-09T00:00:02.000Z",
      })).toBe(true);

      expect(registry.getSessionState("sess_1")?.messages.map((message) => message.id)).toEqual(["user_1", "tool_result", "assistant_final"]);
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
