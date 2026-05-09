import { mkdtemp, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ensureDaemonStateDir, getDaemonStateDir } from "../src/paths.js";

describe("daemon state directory", () => {
  it("uses PI_REMOTE_DAEMON_DIR when provided", () => {
    expect(getDaemonStateDir({ env: { PI_REMOTE_DAEMON_DIR: "./state" }, homeDir: "/home/test" })).toMatch(/state$/);
  });

  it("defaults to ~/.pi/remote-daemon", () => {
    expect(getDaemonStateDir({ env: {}, homeDir: "/home/test" })).toBe("/home/test/.pi/remote-daemon");
  });

  it("creates the state directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-daemon-"));
    const stateDir = join(root, "state");

    try {
      await ensureDaemonStateDir(stateDir);
      const info = await stat(stateDir);
      expect(info.isDirectory()).toBe(true);
      expect(info.mode & 0o077).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
