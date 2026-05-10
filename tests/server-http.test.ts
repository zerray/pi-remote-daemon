import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";
import { createActiveSessionRegistry } from "../src/active-session-registry.js";
import { openDaemonStore } from "../src/persistence/daemon-store.js";
import { bindAddressesForConfig, startDaemonServer, type StartServerOptions } from "../src/server/http.js";

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

  it("broadcasts TUI session events to iOS WebSocket subscribers", async () => {
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

        const event = { type: "message_update", message: { id: "msg_1", role: "assistant" }, assistantMessageEvent: { type: "text_delta", text: "hello" } };
        const response = await fetch(`${baseUrl}/v1/tui/sessions/sess_1/events`, {
          method: "POST",
          headers: { authorization: "Bearer test-token", "content-type": "application/json" },
          body: JSON.stringify(event),
        });
        expect(response.status).toBe(200);
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        expect(messages).toContainEqual(event);
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
