import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
      saveConfig: async (stateDir, config) => {
        calls.push({ saveConfig: stateDir, config });
      },
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
      removeFile: async (path) => {
        calls.push({ removeFile: path });
      },
      writeLine: (line) => lines.push(line),
      env: { PI_REMOTE_CONTROL_DEV_TOKEN: "test-token" },
    };

    const code = await main(["start", "--state-dir", "/tmp/state", "--bind", "127.0.0.1:0"], deps);

    expect(code).toBe(0);
    expect(calls).toEqual([
      { ensureStateDir: "/tmp/state" },
      { acquireLock: "/tmp/state" },
      { saveConfig: "/tmp/state", config: { bindAddress: "127.0.0.1:17373", allowedProjects: [] } },
      {
        startServer: expect.objectContaining({
          stateDir: "/tmp/state",
          config: { bindAddress: "127.0.0.1:0", allowedProjects: [] },
        }),
      },
      { releaseLock: true },
    ]);
    expect(lines).toContain("pi-remote-control listening on http://127.0.0.1:9999");
  });

  it("creates config.json on first real start", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-control-cli-"));
    try {
      const code = await main(["start", "--state-dir", root], {
        openStore: () => ({
          close: () => undefined,
          authenticateToken: async () => false,
          createPairingCode: async () => ({ pairCode: "123456", expiresAt: "2026-05-09T00:01:00.000Z" }),
          claimPairingCode: async () => undefined,
        }),
        startServer: async () => ({ address: "127.0.0.1:9999", close: async () => undefined }),
        waitForShutdown: async () => undefined,
        writeLine: () => undefined,
      });

      expect(code).toBe(0);
      await expect(readFile(join(root, "config.json"), "utf8")).resolves.toContain("127.0.0.1:17373");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes default config when config file is missing", async () => {
    const calls: unknown[] = [];
    const missing = new Error("missing") as Error & { code: string };
    missing.code = "ENOENT";

    const code = await main(["start"], {
      getStateDir: () => "/tmp/state",
      ensureStateDir: async () => undefined,
      acquireLock: async () => ({ path: "/tmp/state/daemon.lock", release: async () => calls.push({ releaseLock: true }) }),
      loadConfig: async () => {
        throw missing;
      },
      saveConfig: async (stateDir, config) => calls.push({ saveConfig: stateDir, config }),
      openStore: () => ({
        close: () => calls.push({ closeStore: true }),
        authenticateToken: async () => false,
        createPairingCode: async () => ({ pairCode: "123456", expiresAt: "2026-05-09T00:01:00.000Z" }),
        claimPairingCode: async () => undefined,
      }),
      startServer: async () => ({ address: "127.0.0.1:9999", close: async () => undefined }),
      removeFile: async () => undefined,
      waitForShutdown: async () => undefined,
      writeLine: () => undefined,
    });

    expect(code).toBe(0);
    expect(calls).toContainEqual({
      saveConfig: "/tmp/state",
      config: { bindAddress: "127.0.0.1:17373" },
    });
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
    expect(lines).toEqual(["pi-remote-control is already running"]);
  });

  it("starts with persistent store authentication and pairing", async () => {
    let startOptions: Parameters<NonNullable<CliDependencies["startServer"]>>[0] | undefined;
    const calls: unknown[] = [];
    const code = await main(["start"], {
      getStateDir: () => "/tmp/state",
      ensureStateDir: async () => undefined,
      loadConfig: async () => ({ bindAddress: "127.0.0.1:0", allowedProjects: [] }),
      saveConfig: async (stateDir, config) => calls.push({ saveConfig: stateDir, config }),
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
          claimPairingCode: async () => ({ deviceId: "dev_1", token: "prd_1", daemonName: "pi-remote-control" }),
        };
      },
      startServer: async (options) => {
        startOptions = options;
        return { address: "127.0.0.1:9999", close: async () => undefined };
      },
      removeFile: async () => undefined,
      waitForShutdown: async () => undefined,
      writeLine: () => undefined,
    });

    expect(code).toBe(0);
    expect(calls).toEqual([
      { acquireLock: "/tmp/state" },
      { saveConfig: "/tmp/state", config: { bindAddress: "127.0.0.1:0", allowedProjects: [] } },
      { openStore: "/tmp/state" },
      { closeStore: true },
      { releaseLock: true },
    ]);
    await expect(startOptions?.authenticateToken?.("stored-token")).resolves.toBe(true);
    await expect(startOptions?.pairService?.createPairingCode?.()).resolves.toEqual({
      pairCode: "123456",
      expiresAt: "2026-05-09T00:01:00.000Z",
    });
  });


  it("reports stopped status when no lock file exists", async () => {
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
    expect(lines).toEqual(["pi-remote-control is stopped"]);
  });

  it("reports running status from lock file", async () => {
    const lines: string[] = [];
    const code = await main(["status", "--state-dir", "/tmp/state"], {
      readTextFile: async (path) => {
        expect(path).toBe("/tmp/state/daemon.lock");
        return "1234\n";
      },
      isProcessRunning: (pid) => pid === 1234,
      writeLine: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    expect(lines).toEqual(["pi-remote-control is running (pid 1234)"]);
  });

  it("reports stopped when stopping without a lock file", async () => {
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
    expect(lines).toEqual(["pi-remote-control is not running"]);
  });

  it("removes stale lock when stopping a missing process", async () => {
    const lines: string[] = [];
    const calls: unknown[] = [];
    const code = await main(["stop", "--state-dir", "/tmp/state"], {
      readTextFile: async () => "1234\n",
      sendSignal: () => {
        const error = new Error("missing process") as Error & { code: string };
        error.code = "ESRCH";
        throw error;
      },
      removeFile: async (path) => calls.push({ removeFile: path }),
      writeLine: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    expect(calls).toEqual([{ removeFile: "/tmp/state/daemon.lock" }]);
    expect(lines).toEqual(["pi-remote-control stale lock removed (pid 1234)"]);
  });

  it("stops a running daemon from its lock file", async () => {
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
      { removeFile: "/tmp/state/daemon.lock" },
    ]);
    expect(lines).toEqual(["pi-remote-control stop requested (pid 1234)"]);
  });

  it("creates and prints a local TUI pairing link", async () => {
    const lines: string[] = [];
    const calls: unknown[] = [];
    const code = await main(["pair", "--state-dir", "/tmp/state"], {
      ensureStateDir: async (stateDir) => calls.push({ ensureStateDir: stateDir }),
      loadConfig: async () => ({ bindAddress: "127.0.0.1:17373", advertisedBaseUrl: "https://macbook.tailnet.ts.net:17373" }),
      openStore: (stateDir) => {
        calls.push({ openStore: stateDir });
        return {
          close: () => calls.push({ closeStore: true }),
          authenticateToken: async () => false,
          createPairingCode: async () => ({ pairCode: "123456", expiresAt: "2026-05-09T00:01:00.000Z" }),
          claimPairingCode: async () => undefined,
        };
      },
      writeLine: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    expect(calls).toEqual([{ ensureStateDir: "/tmp/state" }, { openStore: "/tmp/state" }, { closeStore: true }]);
    expect(lines).toEqual([
      "Pair code: 123456",
      "Expires at: 2026-05-09T00:01:00.000Z",
      "Pairing link: pi-remote://pair?baseUrl=https%3A%2F%2Fmacbook.tailnet.ts.net%3A17373&code=123456&expiresAt=2026-05-09T00%3A01%3A00.000Z",
    ]);
  });
});
