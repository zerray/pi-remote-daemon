import { describe, expect, it } from "vitest";
import { startDaemonServer } from "../src/server/http.js";

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = await startDaemonServer({
    stateDir: "/tmp/pi-remote-daemon-test",
    config: { bindAddress: "127.0.0.1:0", allowedProjects: [] },
    piVersion: "pi-test",
    daemonVersion: "daemon-test",
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
});
