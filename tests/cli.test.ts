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
      writeTextFile: async (path, content) => {
        calls.push({ writeTextFile: path, content });
      },
      removeFile: async (path) => {
        calls.push({ removeFile: path });
      },
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
      { writeTextFile: "/tmp/state/daemon.pid", content: `${process.pid}\n` },
      { removeFile: "/tmp/state/daemon.pid" },
    ]);
    expect(lines).toContain("pi-remote-daemon listening on http://127.0.0.1:9999");
  });

  it("reports stopped status when no pid file exists", async () => {
    const lines: string[] = [];
    const deps: CliDependencies = {
      getStateDir: () => "/tmp/state",
      readTextFile: async () => {
        const error = new Error("missing") as Error & { code: string };
        error.code = "ENOENT";
        throw error;
      },
      writeLine: (line) => lines.push(line),
    };

    const code = await main(["status"], deps);

    expect(code).toBe(1);
    expect(lines).toEqual(["pi-remote-daemon is stopped"]);
  });

  it("reports running status from pid file", async () => {
    const lines: string[] = [];
    const code = await main(["status", "--state-dir", "/tmp/state"], {
      readTextFile: async (path) => {
        expect(path).toBe("/tmp/state/daemon.pid");
        return "1234\n";
      },
      isProcessRunning: (pid) => pid === 1234,
      writeLine: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    expect(lines).toEqual(["pi-remote-daemon is running (pid 1234)"]);
  });
});
