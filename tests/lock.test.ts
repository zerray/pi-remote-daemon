import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { acquireDaemonLock } from "../src/lock.js";

describe("daemon lock", () => {
  it("creates and releases daemon.lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-daemon-lock-"));
    try {
      const lock = await acquireDaemonLock(root, 1234);

      expect(lock?.path).toBe(join(root, "daemon.lock"));
      await expect(readFile(join(root, "daemon.lock"), "utf8")).resolves.toBe("1234\n");

      await lock!.release();
      await expect(readFile(join(root, "daemon.lock"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns undefined when daemon.lock already exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-daemon-lock-"));
    try {
      const first = await acquireDaemonLock(root, 1234);
      const second = await acquireDaemonLock(root, 5678);

      expect(second).toBeUndefined();
      await expect(readFile(join(root, "daemon.lock"), "utf8")).resolves.toBe("1234\n");
      await first!.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
