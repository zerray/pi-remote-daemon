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
      acquireLock: async (stateDir) => {
        calls.push({ acquireLock: stateDir });
        return { path: `${stateDir}/daemon.lock`, release: async () => calls.push({ releaseLock: true }) };
      },
      startServer: async (options) => {
        calls.push({ startServer: options });
        return { address: "127.0.0.1:9999", close: async () => undefined };
      },
      openStore: () => ({
        close: () => undefined,
        authenticateToken: async () => false,
        createPairingCode: async () => ({ pairCode: "123456", expiresAt: "2026-05-09T00:01:00.000Z" }),
        claimPairingCode: async () => undefined,
      }),
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
      { acquireLock: "/tmp/state" },
      {
        startServer: expect.objectContaining({
          stateDir: "/tmp/state",
          config: { bindAddress: "127.0.0.1:0", allowedProjects: [] },
        }),
      },
      { writeTextFile: "/tmp/state/daemon.pid", content: `${process.pid}\n` },
      { removeFile: "/tmp/state/daemon.pid" },
      { releaseLock: true },
    ]);
    expect(lines).toContain("pi-remote-daemon listening on http://127.0.0.1:9999");
  });

  it("does not start when daemon lock is already held", async () => {
    const lines: string[] = [];
    const calls: unknown[] = [];
    const code = await main(["start"], {
      getStateDir: () => "/tmp/state",
      ensureStateDir: async () => undefined,
      acquireLock: async (stateDir) => {
        calls.push({ acquireLock: stateDir });
        return undefined;
      },
      loadConfig: async () => ({ bindAddress: "127.0.0.1:0", allowedProjects: [] }),
      startServer: async () => {
        throw new Error("should not start");
      },
      writeLine: (line) => lines.push(line),
    });

    expect(code).toBe(1);
    expect(calls).toEqual([{ acquireLock: "/tmp/state" }]);
    expect(lines).toEqual(["pi-remote-daemon is already running"]);
  });

  it("starts with persistent store authentication and pairing", async () => {
    let startOptions: Parameters<NonNullable<CliDependencies["startServer"]>>[0] | undefined;
    const calls: unknown[] = [];
    const code = await main(["start"], {
      getStateDir: () => "/tmp/state",
      ensureStateDir: async () => undefined,
      loadConfig: async () => ({ bindAddress: "127.0.0.1:0", allowedProjects: [] }),
      acquireLock: async (stateDir) => {
        calls.push({ acquireLock: stateDir });
        return { path: `${stateDir}/daemon.lock`, release: async () => calls.push({ releaseLock: true }) };
      },
      openStore: (stateDir) => {
        calls.push({ openStore: stateDir });
        return {
          close: () => calls.push({ closeStore: true }),
          authenticateToken: async (token) => token === "stored-token",
          createPairingCode: async () => ({ pairCode: "123456", expiresAt: "2026-05-09T00:01:00.000Z" }),
          claimPairingCode: async () => ({ deviceId: "dev_1", token: "prd_1", daemonName: "pi-remote-daemon" }),
        };
      },
      startServer: async (options) => {
        startOptions = options;
        return { address: "127.0.0.1:9999", close: async () => undefined };
      },
      writeTextFile: async () => undefined,
      removeFile: async () => undefined,
      waitForShutdown: async () => undefined,
      writeLine: () => undefined,
    });

    expect(code).toBe(0);
    expect(calls).toEqual([{ acquireLock: "/tmp/state" }, { openStore: "/tmp/state" }, { closeStore: true }, { releaseLock: true }]);
    await expect(startOptions?.authenticateToken?.("stored-token")).resolves.toBe(true);
    await expect(startOptions?.pairService?.createPairingCode?.()).resolves.toEqual({
      pairCode: "123456",
      expiresAt: "2026-05-09T00:01:00.000Z",
    });
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

  it("reports stopped when stopping without a pid file", async () => {
    const lines: string[] = [];
    const code = await main(["stop", "--state-dir", "/tmp/state"], {
      readTextFile: async () => {
        const error = new Error("missing") as Error & { code: string };
        error.code = "ENOENT";
        throw error;
      },
      writeLine: (line) => lines.push(line),
    });

    expect(code).toBe(1);
    expect(lines).toEqual(["pi-remote-daemon is not running"]);
  });

  it("stops a running daemon from its pid file", async () => {
    const lines: string[] = [];
    const calls: unknown[] = [];
    const code = await main(["stop", "--state-dir", "/tmp/state"], {
      readTextFile: async () => "1234\n",
      sendSignal: (pid, signal) => {
        calls.push({ sendSignal: pid, signal });
      },
      removeFile: async (path) => {
        calls.push({ removeFile: path });
      },
      writeLine: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    expect(calls).toEqual([
      { sendSignal: 1234, signal: "SIGTERM" },
      { removeFile: "/tmp/state/daemon.pid" },
    ]);
    expect(lines).toEqual(["pi-remote-daemon stop requested (pid 1234)"]);
  });

  it("requests and prints a pairing code", async () => {
    const lines: string[] = [];
    const requests: unknown[] = [];
    const code = await main(["pair", "--base-url", "http://127.0.0.1:9999"], {
      env: { PI_REMOTE_DAEMON_DEV_TOKEN: "test-token" },
      fetchJson: async (url, init) => {
        requests.push({ url, init });
        return { pairCode: "123456", expiresAt: "2026-05-09T00:01:00.000Z" };
      },
      writeLine: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:9999/v1/pair/code",
        init: { method: "POST", headers: { authorization: "Bearer test-token" } },
      },
    ]);
    expect(lines).toEqual(["Pair code: 123456", "Expires at: 2026-05-09T00:01:00.000Z"]);
  });
});
