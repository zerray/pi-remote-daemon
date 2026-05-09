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
        },
      },
    );
  });
});
