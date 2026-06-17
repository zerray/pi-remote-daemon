import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";
import { createActiveSessionRegistry } from "../src/active-session-registry.js";
import { openDaemonStore } from "../src/persistence/daemon-store.js";
import { bindAddressesForConfig, startDaemonServer, type StartServerOptions } from "../src/server/http.js";

const runtimeStatus = {
  model: { provider: "anthropic", id: "claude-sonnet-4-5", contextWindow: 200000 },
  thinkingLevel: "medium" as const,
  usage: { input: 12, output: 3, cacheRead: 50, cacheWrite: 10, cost: { input: 0.036, output: 0.045, cacheRead: 0.015, cacheWrite: 0.0375, total: 0.1335 } },
  context: { tokens: 65000, contextWindow: 200000, percent: 32.5 },
  updatedAt: "2026-05-09T09:47:00.000Z",
};

async function withServer<T>(
  fn: (baseUrl: string) => Promise<T>,
  overrides: Partial<StartServerOptions> = {},
): Promise<T> {
  const server = await startDaemonServer({
    stateDir: "/tmp/pi-remote-control-test",
    config: { bindAddress: "127.0.0.1:0" },
    piVersion: "pi-test",
    daemonVersion: "daemon-test",
    ...overrides,
  });

  try {
    return await fn(`http://${server.address}`);
  } finally {
    await server.close();
  }
}

describe("daemon HTTP server", () => {
  it("serves health", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/health`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        status: "ok",
        piVersion: "pi-test",
        daemonVersion: "daemon-test",
      });
    });
  });

  it("rejects unauthenticated project requests", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/projects`);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    });
  });

  it("binds an additional loopback listener when the configured bind address is not local", () => {
    expect(bindAddressesForConfig("100.86.12.34:17373")).toEqual(["100.86.12.34:17373", "127.0.0.1:17373"]);
    expect(bindAddressesForConfig("127.0.0.1:17373")).toEqual(["127.0.0.1:17373"]);
    expect(bindAddressesForConfig("0.0.0.0:17373")).toEqual(["0.0.0.0:17373"]);
  });

  it("registers and unregisters active TUI sessions from package-internal endpoints", async () => {
    const activeSessions = createActiveSessionRegistry();

    await withServer(
      async (baseUrl) => {
        const registerWithoutToken = await fetch(`${baseUrl}/v1/tui/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "sess_1",
            piSessionId: "pi_1",
            project: { id: "proj_1", name: "Example", path: "/repo/example" },
            sessionFile: "/tmp/session.jsonl",
            pid: 1234,
            messageCount: 0,
            isStreaming: false,
            updatedAt: "2026-05-09T00:00:00.000Z",
          }),
        });
        expect(registerWithoutToken.status).toBe(200);

        const registerResponse = await fetch(`${baseUrl}/v1/tui/sessions`, {
          method: "POST",
          headers: { authorization: "Bearer test-token", "content-type": "application/json" },
          body: JSON.stringify({
            id: "sess_1",
            piSessionId: "pi_1",
            project: { id: "proj_1", name: "Example", path: "/repo/example" },
            sessionFile: "/tmp/session.jsonl",
            pid: 1234,
            messageCount: 0,
            isStreaming: false,
            updatedAt: "2026-05-09T00:00:00.000Z",
          }),
        });
        expect(registerResponse.status).toBe(200);
        await expect(registerResponse.json()).resolves.toMatchObject({ session: { id: "sess_1", projectId: "proj_1" } });
        expect(activeSessions.listProjects()).toEqual([{ id: "proj_1", name: "Example", path: "/repo/example" }]);

        const unregisterResponse = await fetch(`${baseUrl}/v1/tui/sessions/sess_1`, {
          method: "DELETE",
          headers: { authorization: "Bearer test-token" },
        });
        expect(unregisterResponse.status).toBe(200);
        await expect(unregisterResponse.json()).resolves.toEqual({ unregistered: true });
        expect(activeSessions.listProjects()).toEqual([]);
      },
      { activeSessions, authenticateToken: (token) => token === "test-token" },
    );
  });

  it("does not expose TUI session resume synchronization", async () => {
    const activeSessions = createActiveSessionRegistry();
    activeSessions.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/tui/sessions/sess_1`, {
          headers: { authorization: "Bearer test-token" },
        });

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ error: "not_found" });
      },
      { activeSessions, authenticateToken: (token) => token === "test-token" },
    );
  });

  it("broadcasts session closure when TUI heartbeats expire", async () => {
    const activeSessions = createActiveSessionRegistry({ staleSessionTimeoutMs: 40 });
    activeSessions.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    await withServer(
      async (baseUrl) => {
        const wsUrl = baseUrl.replace("http://", "ws://");
        const webSocket = new WebSocket(`${wsUrl}/v1/sessions/sess_1/stream`, {
          headers: { authorization: "Bearer test-token" },
        });
        const messages: unknown[] = [];
        webSocket.on("message", (data) => messages.push(JSON.parse(String(data))));
        await new Promise<void>((resolve) => webSocket.once("open", resolve));

        await vi.waitFor(() => expect(messages).toContainEqual({ type: "session_closed" }), { timeout: 300 });
        expect(activeSessions.listProjects()).toEqual([]);
        webSocket.close();
      },
      { activeSessions, authenticateToken: (token) => token === "test-token", sessionSweepIntervalMs: 10 } as Partial<StartServerOptions>,
    );
  });

  it("sends bounded preview session state to iOS WebSocket subscribers", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-control-ws-preview-"));
    const sessionFile = join(root, "session.jsonl");
    const activeSessions = createActiveSessionRegistry();
    try {
      await writeFile(sessionFile, Array.from({ length: 25 }, (_, index) => JSON.stringify({
        type: "message",
        id: `msg_${index + 1}`,
        timestamp: `2026-05-09T00:00:${String(index + 1).padStart(2, "0")}.000Z`,
        message: { role: "assistant", content: [{ type: "text", text: index === 24 ? "z".repeat(11 * 1024) : `message ${index + 1}` }] },
      })).join("\n"));
      activeSessions.registerSession({
        id: "sess_1",
        piSessionId: "pi_1",
        project: { id: "proj_1", name: "Example", path: "/repo/example" },
        sessionFile,
        pid: 1234,
        messageCount: 25,
        isStreaming: false,
        updatedAt: "2026-05-09T00:00:25.000Z",
      });

      await withServer(
        async (baseUrl) => {
          const wsUrl = baseUrl.replace("http://", "ws://");
          const message = await new Promise<{ type: string; state: { messages: Array<{ id: string; text: string; textTruncated?: boolean; content: unknown[] }> } }>((resolve, reject) => {
            const webSocket = new WebSocket(`${wsUrl}/v1/sessions/sess_1/stream`, {
              headers: { authorization: "Bearer test-token" },
            });
            webSocket.once("message", (data) => {
              resolve(JSON.parse(String(data)));
              webSocket.close();
            });
            webSocket.once("error", reject);
          });

          expect(message.type).toBe("session_state");
          expect(message.state.messages).toHaveLength(20);
          expect(message.state.messages[0]?.id).toBe("msg_6");
          expect(message.state.messages.at(-1)).toMatchObject({ id: "msg_25", textTruncated: true });
          expect(message.state.messages.at(-1)?.text).toHaveLength(10 * 1024);
        },
        { activeSessions, authenticateToken: (token) => token === "test-token" },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stores and broadcasts runtime status events from active TUI sessions", async () => {
    const activeSessions = createActiveSessionRegistry();
    activeSessions.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    await withServer(
      async (baseUrl) => {
        const wsUrl = baseUrl.replace("http://", "ws://");
        const webSocket = new WebSocket(`${wsUrl}/v1/sessions/sess_1/stream`, {
          headers: { authorization: "Bearer test-token" },
        });
        const messages: unknown[] = [];
        webSocket.on("message", (data) => messages.push(JSON.parse(String(data))));
        await new Promise<void>((resolve) => webSocket.once("open", resolve));
        await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ type: "session_state", state: expect.objectContaining({ runtimeStatus: null }) })));

        const response = await fetch(`${baseUrl}/v1/tui/sessions/sess_1/events`, {
          method: "POST",
          headers: { authorization: "Bearer test-token", "content-type": "application/json" },
          body: JSON.stringify({ type: "runtime_status", status: runtimeStatus }),
        });
        expect(response.status).toBe(200);
        await vi.waitFor(() => expect(messages).toContainEqual({ type: "runtime_status", status: runtimeStatus }));

        const snapshotResponse = await fetch(`${baseUrl}/v1/sessions/sess_1`, {
          headers: { authorization: "Bearer test-token" },
        });
        expect(snapshotResponse.status).toBe(200);
        await expect(snapshotResponse.json()).resolves.toMatchObject({ runtimeStatus });
        webSocket.close();
      },
      { activeSessions, authenticateToken: (token) => token === "test-token" },
    );
  });

  it("updates and broadcasts active-session streaming state from agent lifecycle events", async () => {
    const activeSessions = createActiveSessionRegistry();
    activeSessions.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    await withServer(
      async (baseUrl) => {
        const wsUrl = baseUrl.replace("http://", "ws://");
        const webSocket = new WebSocket(`${wsUrl}/v1/sessions/sess_1/stream`, {
          headers: { authorization: "Bearer test-token" },
        });
        const messages: unknown[] = [];
        webSocket.on("message", (data) => messages.push(JSON.parse(String(data))));
        await new Promise<void>((resolve) => webSocket.once("open", resolve));
        await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ type: "session_state", state: expect.objectContaining({ isStreaming: false }) })));

        const startResponse = await fetch(`${baseUrl}/v1/tui/sessions/sess_1/events`, {
          method: "POST",
          headers: { authorization: "Bearer test-token", "content-type": "application/json" },
          body: JSON.stringify({ type: "agent_start" }),
        });
        expect(startResponse.status).toBe(200);
        await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ type: "session_state", state: expect.objectContaining({ isStreaming: true }) })));

        const snapshotResponse = await fetch(`${baseUrl}/v1/sessions/sess_1`, {
          headers: { authorization: "Bearer test-token" },
        });
        expect(snapshotResponse.status).toBe(200);
        await expect(snapshotResponse.json()).resolves.toMatchObject({ isStreaming: true });

        const endResponse = await fetch(`${baseUrl}/v1/tui/sessions/sess_1/events`, {
          method: "POST",
          headers: { authorization: "Bearer test-token", "content-type": "application/json" },
          body: JSON.stringify({ type: "agent_end" }),
        });
        expect(endResponse.status).toBe(200);
        await vi.waitFor(() => {
          const sessionStates = messages.filter((message) => typeof message === "object" && message !== null && (message as { type?: unknown }).type === "session_state");
          expect(sessionStates.at(-1)).toMatchObject({ type: "session_state", state: { isStreaming: false } });
        });
        webSocket.close();
      },
      { activeSessions, authenticateToken: (token) => token === "test-token" },
    );
  });

  it("stores TUI session-name events for session API responses", async () => {
    const activeSessions = createActiveSessionRegistry();
    activeSessions.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/tui/sessions/sess_1/events`, {
          method: "POST",
          headers: { authorization: "Bearer test-token", "content-type": "application/json" },
          body: JSON.stringify({ type: "session_name", name: "Manual TUI Name" }),
        });
        expect(response.status).toBe(200);

        const sessionsResponse = await fetch(`${baseUrl}/v1/projects/proj_1/sessions`, {
          headers: { authorization: "Bearer test-token" },
        });
        expect(sessionsResponse.status).toBe(200);
        await expect(sessionsResponse.json()).resolves.toMatchObject({ sessions: [{ id: "sess_1", name: "Manual TUI Name" }] });
      },
      { activeSessions, authenticateToken: (token) => token === "test-token" },
    );
  });

  it("stores and broadcasts remote Tree Snapshots from active TUI sessions", async () => {
    const activeSessions = createActiveSessionRegistry();
    activeSessions.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });
    const snapshot = {
      sessionId: "sess_1",
      leafId: "entry_1",
      snapshotVersion: "treev_2",
      branchVersion: "branchv_2",
      entries: [
        {
          id: "entry_1",
          parentId: null,
          type: "message" as const,
          role: "user" as const,
          title: "user",
          preview: "fresh tree",
          timestamp: "2026-05-09T00:00:00.000Z",
          isCurrentLeaf: true,
          isOnActiveBranch: true,
          isForkable: true,
          navigationBehavior: "edit_prompt" as const,
        },
      ],
      defaultFilter: "default" as const,
      filters: ["default", "no-tools", "user-only", "labeled-only", "all"] as const,
      generatedAt: "2026-05-09T00:00:01.000Z",
    };

    await withServer(
      async (baseUrl) => {
        const wsUrl = baseUrl.replace("http://", "ws://");
        const webSocket = new WebSocket(`${wsUrl}/v1/sessions/sess_1/stream`, {
          headers: { authorization: "Bearer test-token" },
        });
        const messages: unknown[] = [];
        webSocket.on("message", (data) => messages.push(JSON.parse(String(data))));
        await new Promise<void>((resolve) => webSocket.once("open", resolve));
        await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ type: "session_state", state: expect.any(Object) })));

        const event = { type: "remote_tree_snapshot", requestId: "req_tree_1", snapshot };
        const eventResponse = await fetch(`${baseUrl}/v1/tui/sessions/sess_1/events`, {
          method: "POST",
          headers: { authorization: "Bearer test-token", "content-type": "application/json" },
          body: JSON.stringify(event),
        });
        expect(eventResponse.status).toBe(200);
        await vi.waitFor(() => expect(messages).toContainEqual(event));

        const treeResponse = await fetch(`${baseUrl}/v1/sessions/sess_1/tree`, {
          headers: { authorization: "Bearer test-token" },
        });
        expect(treeResponse.status).toBe(200);
        await expect(treeResponse.json()).resolves.toEqual({ snapshot });
        webSocket.close();
      },
      { activeSessions, authenticateToken: (token) => token === "test-token" },
    );
  });

  it("broadcasts remote compact results to iOS WebSocket subscribers", async () => {
    const activeSessions = createActiveSessionRegistry();
    activeSessions.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    await withServer(
      async (baseUrl) => {
        const wsUrl = baseUrl.replace("http://", "ws://");
        const webSocket = new WebSocket(`${wsUrl}/v1/sessions/sess_1/stream`, {
          headers: { authorization: "Bearer test-token" },
        });
        const messages: unknown[] = [];
        webSocket.on("message", (data) => messages.push(JSON.parse(String(data))));
        await new Promise<void>((resolve) => webSocket.once("open", resolve));
        await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ type: "session_state", state: expect.any(Object) })));

        const event = { type: "remote_compact_result", requestId: "req_1", ok: true, summary: "Summary", firstKeptEntryId: "entry_1", tokensBefore: 12345 };
        const response = await fetch(`${baseUrl}/v1/tui/sessions/sess_1/events`, {
          method: "POST",
          headers: { authorization: "Bearer test-token", "content-type": "application/json" },
          body: JSON.stringify(event),
        });

        expect(response.status).toBe(200);
        await vi.waitFor(() => expect(messages).toContainEqual(event));
        webSocket.close();
      },
      { activeSessions, authenticateToken: (token) => token === "test-token" },
    );
  });

  it("broadcasts normalized TUI session events to iOS WebSocket subscribers", async () => {
    const activeSessions = createActiveSessionRegistry();
    activeSessions.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    await withServer(
      async (baseUrl) => {
        const wsUrl = baseUrl.replace("http://", "ws://");
        const webSocket = new WebSocket(`${wsUrl}/v1/sessions/sess_1/stream`, {
          headers: { authorization: "Bearer test-token" },
        });
        const messages: unknown[] = [];
        webSocket.on("message", (data) => messages.push(JSON.parse(String(data))));
        await new Promise<void>((resolve) => webSocket.once("open", resolve));

        await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ type: "session_state", state: expect.any(Object) })));
        const event = { type: "message_update", message: { id: "msg_1", role: "assistant" }, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hello" } };
        const response = await fetch(`${baseUrl}/v1/tui/sessions/sess_1/events`, {
          method: "POST",
          headers: { authorization: "Bearer test-token", "content-type": "application/json" },
          body: JSON.stringify(event),
        });
        expect(response.status).toBe(200);
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        expect(messages).toContainEqual({ type: "transcript_message_patch", messageId: "msg_1", contentIndex: 0, patch: { type: "text_delta", delta: "hello" } });
        expect(messages).not.toContainEqual(event);
        webSocket.close();
      },
      { activeSessions, authenticateToken: (token) => token === "test-token" },
    );
  });

  it("lists active TUI projects for authenticated devices", async () => {
    const activeSessions = createActiveSessionRegistry();
    activeSessions.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/projects`, {
          headers: { authorization: "Bearer test-token" },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          projects: [{ id: "proj_1", name: "Example", path: "/repo/example" }],
        });
      },
      {
        activeSessions,
        authenticateToken: (token) => token === "test-token",
      },
    );
  });

  it("lists project sessions for authenticated devices", async () => {
    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/projects/proj_1/sessions`, {
          headers: { authorization: "Bearer test-token" },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          sessions: [
            {
              id: "sess_1",
              piSessionId: "pi_1",
              projectId: "proj_1",
              name: "Work",
              path: "/sessions/work.jsonl",
              updatedAt: "2026-05-09T00:00:00.000Z",
              messageCount: 2,
            },
          ],
        });
      },
      {
        authenticateToken: (token) => token === "test-token",
        sessionService: {
          listProjectSessions: async (projectId) => [
            {
              id: "sess_1",
              piSessionId: "pi_1",
              projectId,
              name: "Work",
              path: "/sessions/work.jsonl",
              updatedAt: "2026-05-09T00:00:00.000Z",
              messageCount: 2,
            },
          ],
          createProjectSession: async () => {
            throw new Error("not used");
          },
        },
      },
    );
  });

  it("does not create project sessions from the daemon", async () => {
    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/projects/proj_1/sessions`, {
          method: "POST",
          headers: { authorization: "Bearer test-token" },
        });

        expect(response.status).toBe(405);
        await expect(response.json()).resolves.toEqual({ error: "method_not_allowed" });
      },
      { authenticateToken: (token) => token === "test-token" },
    );
  });

  it("returns 404 for inactive sessions", async () => {
    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/sessions/missing`, {
          headers: { authorization: "Bearer test-token" },
        });

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ error: "session_not_found" });
      },
      { activeSessions: createActiveSessionRegistry(), authenticateToken: (token) => token === "test-token" },
    );
  });

  it("returns cached Tree Snapshots for active sessions", async () => {
    const activeSessions = createActiveSessionRegistry();
    const snapshot = {
      sessionId: "sess_1",
      leafId: "entry_assistant_1",
      snapshotVersion: "treev_1",
      branchVersion: "branchv_1",
      entries: [
        {
          id: "entry_user_1",
          parentId: null,
          type: "message" as const,
          role: "user" as const,
          title: "user",
          preview: "Inspect the auth flow",
          timestamp: "2026-05-09T00:00:00.000Z",
          isCurrentLeaf: false,
          isOnActiveBranch: true,
          isForkable: true,
          navigationBehavior: "edit_prompt" as const,
        },
        {
          id: "entry_assistant_1",
          parentId: "entry_user_1",
          type: "message" as const,
          role: "assistant" as const,
          title: "assistant",
          preview: "I'll inspect it.",
          timestamp: "2026-05-09T00:00:01.000Z",
          isCurrentLeaf: true,
          isOnActiveBranch: true,
          isForkable: false,
          navigationBehavior: "navigate" as const,
        },
      ],
      defaultFilter: "default" as const,
      filters: ["default", "no-tools", "user-only", "labeled-only", "all"] as const,
      generatedAt: "2026-05-09T00:00:02.000Z",
    };
    activeSessions.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
      treeSnapshot: snapshot,
    });

    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/sessions/sess_1/tree`, {
          headers: { authorization: "Bearer test-token" },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ snapshot });
      },
      { activeSessions, authenticateToken: (token) => token === "test-token" },
    );
  });

  it("queues Tree Refresh for active TUI sessions", async () => {
    const activeSessions = createActiveSessionRegistry();
    activeSessions.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/sessions/sess_1/tree/refresh`, {
          method: "POST",
          headers: { authorization: "Bearer test-token" },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ accepted: true, requestId: expect.stringMatching(/^req_/) });
        expect(activeSessions.takeCommands("sess_1")).toEqual([
          { type: "remote_tree_refresh", requestId: expect.stringMatching(/^req_/) },
        ]);
      },
      { activeSessions, authenticateToken: (token) => token === "test-token" },
    );
  });

  it("rejects Tree Refresh for inactive TUI sessions", async () => {
    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/sessions/missing/tree/refresh`, {
          method: "POST",
          headers: { authorization: "Bearer test-token" },
        });

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({ error: "session_not_active" });
      },
      { activeSessions: createActiveSessionRegistry(), authenticateToken: (token) => token === "test-token" },
    );
  });

  it("returns stale cached Tree Snapshots but reports unavailable tree state when no snapshot exists", async () => {
    const activeSessions = createActiveSessionRegistry();
    const staleSnapshot = {
      sessionId: "sess_stale",
      leafId: "entry_1",
      snapshotVersion: "treev_stale",
      branchVersion: "branchv_stale",
      entries: [],
      defaultFilter: "default" as const,
      filters: ["default", "no-tools", "user-only", "labeled-only", "all"] as const,
      generatedAt: "2026-05-09T00:00:00.000Z",
    };
    activeSessions.registerSession({
      id: "sess_stale",
      piSessionId: "pi_stale",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/stale.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
      treeSnapshot: staleSnapshot,
      treeStateStale: true,
    });
    activeSessions.registerSession({
      id: "sess_no_tree",
      piSessionId: "pi_no_tree",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/no-tree.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    await withServer(
      async (baseUrl) => {
        const staleResponse = await fetch(`${baseUrl}/v1/sessions/sess_stale/tree`, {
          headers: { authorization: "Bearer test-token" },
        });
        const noSnapshotResponse = await fetch(`${baseUrl}/v1/sessions/sess_no_tree/tree`, {
          headers: { authorization: "Bearer test-token" },
        });
        const missingResponse = await fetch(`${baseUrl}/v1/sessions/missing/tree`, {
          headers: { authorization: "Bearer test-token" },
        });

        expect(staleResponse.status).toBe(200);
        await expect(staleResponse.json()).resolves.toEqual({ snapshot: { ...staleSnapshot, stale: true } });
        expect(noSnapshotResponse.status).toBe(409);
        await expect(noSnapshotResponse.json()).resolves.toEqual({ error: "tree_state_unavailable" });
        expect(missingResponse.status).toBe(409);
        await expect(missingResponse.json()).resolves.toEqual({ error: "session_not_active" });
      },
      { activeSessions, authenticateToken: (token) => token === "test-token" },
    );
  });

  it("returns an authenticated session snapshot", async () => {
    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/sessions/sess_1`, {
          headers: { authorization: "Bearer test-token" },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          session: { id: "sess_1" },
          messages: [],
          olderMessagesCursor: null,
          hasOlderMessages: false,
          tools: [],
          isStreaming: false,
          pendingMessageCount: 0,
        });
      },
      {
        authenticateToken: (token) => token === "test-token",
        sessionService: {
          listProjectSessions: async () => [],
          createProjectSession: async () => {
            throw new Error("not used");
          },
          getSessionState: async (sessionId) => ({
            session: { id: sessionId },
            messages: [],
            olderMessagesCursor: null,
            hasOlderMessages: false,
            tools: [],
            isStreaming: false,
            pendingMessageCount: 0,
          }),
        },
      },
    );
  });

  it("reads session snapshots from the latest session file contents", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-control-session-file-http-"));
    const sessionFile = join(root, "session.jsonl");
    const activeSessions = createActiveSessionRegistry();
    activeSessions.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile,
      pid: 1234,
      messageCount: 1,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:01.000Z",
      entries: [
        { type: "message", id: "stale_msg", timestamp: "2026-05-09T00:00:00.000Z", message: { role: "user", content: "stale" } },
      ],
    });
    await writeFile(sessionFile, [
      JSON.stringify({ type: "message", id: "msg_1", timestamp: "2026-05-09T00:00:01.000Z", message: { role: "user", content: "one" } }),
      JSON.stringify({ type: "message", id: "msg_2", timestamp: "2026-05-09T00:00:02.000Z", message: { role: "assistant", content: "two" } }),
    ].join("\n"));

    try {
      await withServer(
        async (baseUrl) => {
          await writeFile(sessionFile, [
            JSON.stringify({ type: "message", id: "msg_1", timestamp: "2026-05-09T00:00:01.000Z", message: { role: "user", content: "one" } }),
            JSON.stringify({ type: "message", id: "msg_2", timestamp: "2026-05-09T00:00:02.000Z", message: { role: "assistant", content: "two" } }),
            JSON.stringify({ type: "message", id: "msg_3", timestamp: "2026-05-09T00:00:03.000Z", message: { role: "user", content: "three" } }),
          ].join("\n"));

          const response = await fetch(`${baseUrl}/v1/sessions/sess_1?messageLimit=2`, {
            headers: { authorization: "Bearer test-token" },
          });
          const body = (await response.json()) as { session: { messageCount: number; updatedAt: string }; messages: Array<{ id: string; text: string }>; hasOlderMessages: boolean };

          expect(response.status).toBe(200);
          expect(body.messages).toEqual([
            expect.objectContaining({ id: "msg_2", text: "two" }),
            expect.objectContaining({ id: "msg_3", text: "three" }),
          ]);
          expect(body.hasOlderMessages).toBe(true);
          expect(body.session.messageCount).toBe(3);
          expect(body.session.updatedAt).toBe("2026-05-09T00:00:03.000Z");
        },
        { activeSessions, authenticateToken: (token) => token === "test-token" },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns bounded session snapshots with older message cursors", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-control-bounded-http-"));
    const sessionFile = join(root, "session.jsonl");
    const activeSessions = createActiveSessionRegistry();
    try {
      await writeFile(sessionFile, [
        JSON.stringify({ type: "message", id: "msg_1", timestamp: "2026-05-09T00:00:01.000Z", message: { role: "user", content: "one" } }),
        JSON.stringify({ type: "message", id: "msg_2", timestamp: "2026-05-09T00:00:02.000Z", message: { role: "assistant", content: "two" } }),
        JSON.stringify({ type: "message", id: "msg_3", timestamp: "2026-05-09T00:00:03.000Z", message: { role: "user", content: "three" } }),
      ].join("\n"));
      activeSessions.registerSession({
        id: "sess_1",
        piSessionId: "pi_1",
        project: { id: "proj_1", name: "Example", path: "/repo/example" },
        sessionFile,
        pid: 1234,
        messageCount: 3,
        isStreaming: false,
        updatedAt: "2026-05-09T00:00:03.000Z",
      });

      await withServer(
        async (baseUrl) => {
          const response = await fetch(`${baseUrl}/v1/sessions/sess_1?messageLimit=2`, {
            headers: { authorization: "Bearer test-token" },
          });
          const body = (await response.json()) as { messages: Array<{ id: string }>; olderMessagesCursor: string | null; hasOlderMessages: boolean };

          expect(response.status).toBe(200);
          expect(body.messages.map((message) => message.id)).toEqual(["msg_2", "msg_3"]);
          expect(body.hasOlderMessages).toBe(true);
          expect(typeof body.olderMessagesCursor).toBe("string");
        },
        { activeSessions, authenticateToken: (token) => token === "test-token" },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns older transcript pages before a cursor", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-control-page-http-"));
    const sessionFile = join(root, "session.jsonl");
    const activeSessions = createActiveSessionRegistry();
    try {
      await writeFile(sessionFile, [
        JSON.stringify({ type: "message", id: "msg_1", timestamp: "2026-05-09T00:00:01.000Z", message: { role: "user", content: "one" } }),
        JSON.stringify({ type: "message", id: "msg_2", timestamp: "2026-05-09T00:00:02.000Z", message: { role: "assistant", content: "two" } }),
        JSON.stringify({ type: "message", id: "msg_3", timestamp: "2026-05-09T00:00:03.000Z", message: { role: "user", content: "three" } }),
        JSON.stringify({ type: "message", id: "msg_4", timestamp: "2026-05-09T00:00:04.000Z", message: { role: "assistant", content: "four" } }),
      ].join("\n"));
      activeSessions.registerSession({
        id: "sess_1",
        piSessionId: "pi_1",
        project: { id: "proj_1", name: "Example", path: "/repo/example" },
        sessionFile,
        pid: 1234,
        messageCount: 4,
        isStreaming: false,
        updatedAt: "2026-05-09T00:00:04.000Z",
      });

      await withServer(
        async (baseUrl) => {
          const snapshotResponse = await fetch(`${baseUrl}/v1/sessions/sess_1?messageLimit=2`, {
            headers: { authorization: "Bearer test-token" },
          });
          const snapshot = (await snapshotResponse.json()) as { olderMessagesCursor: string };

          const pageResponse = await fetch(`${baseUrl}/v1/sessions/sess_1/messages?before=${encodeURIComponent(snapshot.olderMessagesCursor)}&limit=2`, {
            headers: { authorization: "Bearer test-token" },
          });
          const page = (await pageResponse.json()) as { messages: Array<{ id: string }>; olderMessagesCursor: string | null; hasOlderMessages: boolean };

          expect(pageResponse.status).toBe(200);
          expect(page.messages.map((message) => message.id)).toEqual(["msg_1", "msg_2"]);
          expect(page.hasOlderMessages).toBe(false);
          expect(page.olderMessagesCursor).toBeNull();
        },
        { activeSessions, authenticateToken: (token) => token === "test-token" },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid transcript page parameters", async () => {
    const activeSessions = createActiveSessionRegistry();
    activeSessions.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    await withServer(
      async (baseUrl) => {
        const badLimit = await fetch(`${baseUrl}/v1/sessions/sess_1?messageLimit=0`, {
          headers: { authorization: "Bearer test-token" },
        });
        const badCursor = await fetch(`${baseUrl}/v1/sessions/sess_1/messages?before=not-a-cursor&limit=1`, {
          headers: { authorization: "Bearer test-token" },
        });

        expect(badLimit.status).toBe(400);
        await expect(badLimit.json()).resolves.toEqual({ error: "invalid_limit" });
        expect(badCursor.status).toBe(400);
        await expect(badCursor.json()).resolves.toEqual({ error: "invalid_cursor" });
      },
      { activeSessions, authenticateToken: (token) => token === "test-token" },
    );
  });

  it("lets TUI extensions take queued remote commands", async () => {
    const activeSessions = createActiveSessionRegistry();
    activeSessions.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });
    activeSessions.enqueueCommand("sess_1", { type: "remote_abort", requestId: "req_1" });

    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/tui/sessions/sess_1/commands`, {
          headers: { authorization: "Bearer test-token" },
        });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ commands: [{ type: "remote_abort", requestId: "req_1" }] });

        const emptyResponse = await fetch(`${baseUrl}/v1/tui/sessions/sess_1/commands`, {
          headers: { authorization: "Bearer test-token" },
        });
        await expect(emptyResponse.json()).resolves.toEqual({ commands: [] });
      },
      { activeSessions, authenticateToken: (token) => token === "test-token" },
    );
  });

  it("queues prompts for active TUI sessions", async () => {
    const activeSessions = createActiveSessionRegistry();
    activeSessions.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/sessions/sess_1/prompt`, {
          method: "POST",
          headers: { authorization: "Bearer test-token", "content-type": "application/json" },
          body: JSON.stringify({ text: "hello", streamingBehavior: "followUp" }),
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ accepted: true });
        expect(activeSessions.takeCommands("sess_1")).toEqual([
          { type: "remote_prompt", requestId: expect.stringMatching(/^req_/), text: "hello", streamingBehavior: "followUp" },
        ]);
      },
      { activeSessions, authenticateToken: (token) => token === "test-token" },
    );
  });

  it("rejects prompts for inactive TUI sessions", async () => {
    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/sessions/missing/prompt`, {
          method: "POST",
          headers: { authorization: "Bearer test-token", "content-type": "application/json" },
          body: JSON.stringify({ text: "hello" }),
        });

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({ error: "session_not_active" });
      },
      { activeSessions: createActiveSessionRegistry(), authenticateToken: (token) => token === "test-token" },
    );
  });

  it("queues compact for active TUI sessions", async () => {
    const activeSessions = createActiveSessionRegistry();
    activeSessions.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: false,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/sessions/sess_1/compact`, {
          method: "POST",
          headers: { authorization: "Bearer test-token" },
        });

        expect(response.status).toBe(200);
        const body = (await response.json()) as { accepted: boolean; requestId: string };
        expect(body).toEqual({ accepted: true, requestId: expect.stringMatching(/^req_/) });
        expect(activeSessions.takeCommands("sess_1")).toEqual([{ type: "remote_compact", requestId: body.requestId }]);
      },
      { activeSessions, authenticateToken: (token) => token === "test-token" },
    );
  });

  it("rejects compact for inactive TUI sessions", async () => {
    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/sessions/missing/compact`, {
          method: "POST",
          headers: { authorization: "Bearer test-token" },
        });

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({ error: "session_not_active" });
      },
      { activeSessions: createActiveSessionRegistry(), authenticateToken: (token) => token === "test-token" },
    );
  });

  it("queues abort for active TUI sessions", async () => {
    const activeSessions = createActiveSessionRegistry();
    activeSessions.registerSession({
      id: "sess_1",
      piSessionId: "pi_1",
      project: { id: "proj_1", name: "Example", path: "/repo/example" },
      sessionFile: "/tmp/session.jsonl",
      pid: 1234,
      messageCount: 0,
      isStreaming: true,
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/sessions/sess_1/abort`, {
          method: "POST",
          headers: { authorization: "Bearer test-token" },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ aborted: true });
        expect(activeSessions.takeCommands("sess_1")).toEqual([{ type: "remote_abort", requestId: expect.stringMatching(/^req_/) }]);
      },
      { activeSessions, authenticateToken: (token) => token === "test-token" },
    );
  });

  it("does not expose remote pairing code creation", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/pair/code`, { method: "POST" });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "not_found" });
    });
  });

  it("returns 400 for invalid pairing claims", async () => {
    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/pair/claim`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pairCode: "000000", deviceName: "iPhone" }),
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "invalid_pairing_code" });
      },
      {
        pairService: {
          claimPairingCode: async () => {
            throw new Error("Invalid or expired pairing code");
          },
        },
      },
    );
  });

  it("issues usable bearer tokens through the pair flow", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-control-pair-http-"));
    const store = openDaemonStore(root);
    try {
      await withServer(
        async (baseUrl) => {
          const codeBody = await store.createPairingCode(new Date("2026-05-09T00:00:00.000Z"), 60_000);

          const claimResponse = await fetch(`${baseUrl}/v1/pair/claim`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ pairCode: codeBody.pairCode, deviceName: "iPhone" }),
          });
          const claimBody = (await claimResponse.json()) as { token: string };

          const projectsResponse = await fetch(`${baseUrl}/v1/projects`, {
            headers: { authorization: `Bearer ${claimBody.token}` },
          });

          expect(claimResponse.status).toBe(200);
          expect(projectsResponse.status).toBe(200);
        },
        {
          authenticateToken: (token) => store.authenticateToken(token),
          pairService: {
            claimPairingCode: async (request) => {
              const claimed = await store.claimPairingCode(request.pairCode, request.deviceName, new Date("2026-05-09T00:00:30.000Z"));
              if (!claimed) throw new Error("invalid pair code");
              return claimed;
            },
          },
        },
      );
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("claims pairing codes without bearer auth", async () => {
    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/pair/claim`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pairCode: "123456", deviceName: "iPhone" }),
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          deviceId: "dev_1",
          token: "prd_token",
          daemonName: "test-daemon",
        });
      },
      {
        pairService: {
          claimPairingCode: async (request) => {
            expect(request).toEqual({ pairCode: "123456", deviceName: "iPhone" });
            return { deviceId: "dev_1", token: "prd_token", daemonName: "test-daemon" };
          },
        },
      },
    );
  });

  it("streams session events over authenticated WebSocket", async () => {
    await withServer(
      async (baseUrl) => {
        const wsUrl = baseUrl.replace(/^http:/, "ws:");
        const message = await new Promise<unknown>((resolve, reject) => {
          const socket = new WebSocket(`${wsUrl}/v1/sessions/sess_1/stream`, {
            headers: { authorization: "Bearer test-token" },
          });
          socket.once("message", (data) => {
            resolve(JSON.parse(String(data)));
            socket.close();
          });
          socket.once("error", reject);
        });

        expect(message).toEqual({ type: "agent_done" });
      },
      {
        authenticateToken: (token) => token === "test-token",
        sessionService: {
          streamSession: async (sessionId, send) => {
            expect(sessionId).toBe("sess_1");
            send({ type: "agent_done" });
          },
        },
      },
    );
  });
});
