import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { describe, expect, it } from "vitest";
import { createActiveSessionRegistry } from "../src/active-session-registry.js";
import { openDaemonStore } from "../src/persistence/daemon-store.js";
import { startDaemonServer, type StartServerOptions } from "../src/server/http.js";

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

  it("registers and unregisters active TUI sessions from package-internal endpoints", async () => {
    const activeSessions = createActiveSessionRegistry();

    await withServer(
      async (baseUrl) => {
        const registerResponse = await fetch(`${baseUrl}/v1/tui/sessions`, {
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
        expect(registerResponse.status).toBe(200);
        await expect(registerResponse.json()).resolves.toMatchObject({ session: { id: "sess_1", projectId: "proj_1" } });
        expect(activeSessions.listProjects()).toEqual([{ id: "proj_1", name: "Example", path: "/repo/example" }]);

        const unregisterResponse = await fetch(`${baseUrl}/v1/tui/sessions/sess_1`, { method: "DELETE" });
        expect(unregisterResponse.status).toBe(200);
        await expect(unregisterResponse.json()).resolves.toEqual({ unregistered: true });
        expect(activeSessions.listProjects()).toEqual([]);
      },
      { activeSessions },
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

        const event = { type: "assistant_delta", messageId: "msg_1", text: "hello" };
        const response = await fetch(`${baseUrl}/v1/tui/sessions/sess_1/events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
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

  it("creates a project session for authenticated devices", async () => {
    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/projects/proj_1/sessions`, {
          method: "POST",
          headers: { authorization: "Bearer test-token" },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          session: {
            id: "sess_new",
            piSessionId: "pi_new",
            projectId: "proj_1",
            name: null,
            path: "/sessions/new.jsonl",
            updatedAt: "2026-05-09T00:00:00.000Z",
            messageCount: 0,
          },
        });
      },
      {
        authenticateToken: (token) => token === "test-token",
        sessionService: {
          listProjectSessions: async () => [],
          createProjectSession: async (projectId) => ({
            id: "sess_new",
            piSessionId: "pi_new",
            projectId,
            name: null,
            path: "/sessions/new.jsonl",
            updatedAt: "2026-05-09T00:00:00.000Z",
            messageCount: 0,
          }),
          getSessionState: async () => {
            throw new Error("not used");
          },
        },
      },
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
            tools: [],
            isStreaming: false,
            pendingMessageCount: 0,
          }),
        },
      },
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
        const response = await fetch(`${baseUrl}/v1/tui/sessions/sess_1/commands`);
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ commands: [{ type: "remote_abort", requestId: "req_1" }] });

        const emptyResponse = await fetch(`${baseUrl}/v1/tui/sessions/sess_1/commands`);
        await expect(emptyResponse.json()).resolves.toEqual({ commands: [] });
      },
      { activeSessions },
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
