import { describe, expect, it } from "vitest";
import { main, type CliDependencies } from "../src/cli.js";

describe("daemon CLI", () => {
  it("starts the HTTP server with state dir and bind overrides", async () => {
    const lines: string[] = [];
    const calls: unknown[] = [];
    const deps: CliDependencies = {
      getStateDir: () => "/tmp/default-state",
      ensureStateDir: async (stateDir) => {
        calls.push({ ensureStateDir: stateDir });
      },
      loadConfig: async () => ({ bindAddress: "127.0.0.1:17373", allowedProjects: [] }),
      startServer: async (options) => {
        calls.push({ startServer: options });
        return { address: "127.0.0.1:9999", close: async () => undefined };
      },
      waitForShutdown: async () => undefined,
      writeLine: (line) => lines.push(line),
      env: { PI_REMOTE_DAEMON_DEV_TOKEN: "test-token" },
    };

    const code = await main(["start", "--state-dir", "/tmp/state", "--bind", "127.0.0.1:0"], deps);

    expect(code).toBe(0);
    expect(calls).toEqual([
      { ensureStateDir: "/tmp/state" },
      {
        startServer: expect.objectContaining({
          stateDir: "/tmp/state",
          config: { bindAddress: "127.0.0.1:0", allowedProjects: [] },
        }),
      },
    ]);
    expect(lines).toContain("pi-remote-daemon listening on http://127.0.0.1:9999");
  });
});
