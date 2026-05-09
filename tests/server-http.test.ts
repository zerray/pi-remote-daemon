import WebSocket from "ws";
import { describe, expect, it } from "vitest";
import { startDaemonServer, type StartServerOptions } from "../src/server/http.js";

async function withServer<T>(
  fn: (baseUrl: string) => Promise<T>,
  overrides: Partial<StartServerOptions> = {},
): Promise<T> {
  const server = await startDaemonServer({
    stateDir: "/tmp/pi-remote-daemon-test",
    config: { bindAddress: "127.0.0.1:0", allowedProjects: [] },
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

  it("lists configured projects for authenticated devices", async () => {
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
        config: {
          bindAddress: "127.0.0.1:0",
          allowedProjects: [{ id: "proj_1", name: "Example", path: "/repo/example" }],
        },
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

  it("accepts authenticated prompts", async () => {
    const prompts: unknown[] = [];
    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/sessions/sess_1/prompt`, {
          method: "POST",
          headers: { authorization: "Bearer test-token", "content-type": "application/json" },
          body: JSON.stringify({ text: "hello", streamingBehavior: "followUp" }),
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ accepted: true });
        expect(prompts).toEqual([{ sessionId: "sess_1", text: "hello", streamingBehavior: "followUp" }]);
      },
      {
        authenticateToken: (token) => token === "test-token",
        sessionService: {
          promptSession: async (sessionId, request) => {
            prompts.push({ sessionId, ...request });
          },
        },
      },
    );
  });

  it("aborts authenticated sessions", async () => {
    const aborted: string[] = [];
    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/sessions/sess_1/abort`, {
          method: "POST",
          headers: { authorization: "Bearer test-token" },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ aborted: true });
        expect(aborted).toEqual(["sess_1"]);
      },
      {
        authenticateToken: (token) => token === "test-token",
        sessionService: {
          abortSession: async (sessionId) => {
            aborted.push(sessionId);
          },
        },
      },
    );
  });

  it("creates pairing codes on loopback when no authenticator is configured", async () => {
    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/pair/code`, { method: "POST" });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          pairCode: "123456",
          expiresAt: "2026-05-09T00:01:00.000Z",
        });
      },
      {
        pairService: {
          createPairingCode: async () => ({
            pairCode: "123456",
            expiresAt: "2026-05-09T00:01:00.000Z",
          }),
          claimPairingCode: async () => {
            throw new Error("not used");
          },
        },
      },
    );
  });

  it("creates pairing codes for authenticated local operators", async () => {
    await withServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/pair/code`, {
          method: "POST",
          headers: { authorization: "Bearer test-token" },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          pairCode: "123456",
          expiresAt: "2026-05-09T00:01:00.000Z",
        });
      },
      {
        authenticateToken: (token) => token === "test-token",
        pairService: {
          createPairingCode: async () => ({
            pairCode: "123456",
            expiresAt: "2026-05-09T00:01:00.000Z",
          }),
          claimPairingCode: async () => {
            throw new Error("not used");
          },
        },
      },
    );
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
