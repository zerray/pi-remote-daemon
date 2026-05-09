import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { openDaemonStore } from "../src/persistence/daemon-store.js";

describe("daemon store", () => {
  it("authenticates claimed device tokens", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-daemon-store-"));
    try {
      const store = openDaemonStore(root);
      const pair = await store.createPairingCode(new Date("2026-05-09T00:00:00.000Z"), 60_000);
      const claimed = await store.claimPairingCode(pair.pairCode, "iPhone", new Date("2026-05-09T00:00:30.000Z"));

      await expect(store.authenticateToken(claimed!.token)).resolves.toBe(true);
      await expect(store.authenticateToken("prd_wrong")).resolves.toBe(false);
      store.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates and persists pairing codes", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-daemon-store-"));
    try {
      const store = openDaemonStore(root);
      const pair = await store.createPairingCode(new Date("2026-05-09T00:00:00.000Z"), 60_000);
      store.close();

      const reopened = openDaemonStore(root);
      const claimed = await reopened.claimPairingCode(pair.pairCode, "iPhone", new Date("2026-05-09T00:00:30.000Z"));
      reopened.close();

      expect(pair).toMatchObject({ pairCode: expect.stringMatching(/^\d{6}$/), expiresAt: "2026-05-09T00:01:00.000Z" });
      expect(claimed).toMatchObject({ deviceId: expect.stringMatching(/^dev_/), token: expect.stringMatching(/^prd_/), daemonName: "pi-remote-daemon" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
