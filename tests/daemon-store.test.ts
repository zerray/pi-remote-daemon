import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { openDaemonStore } from "../src/persistence/daemon-store.js";

describe("daemon store", () => {
  it("rejects duplicate pairing claims", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-control-store-"));
    try {
      const store = openDaemonStore(root);
      const pair = await store.createPairingCode(new Date("2026-05-09T00:00:00.000Z"), 60_000);

      await expect(store.claimPairingCode(pair.pairCode, "iPhone", new Date("2026-05-09T00:00:30.000Z"))).resolves.toBeDefined();
      await expect(store.claimPairingCode(pair.pairCode, "iPad", new Date("2026-05-09T00:00:40.000Z"))).resolves.toBeUndefined();
      store.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("authenticates claimed device tokens", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-control-store-"));
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

  it("persists one opaque Push Route per authenticated paired device", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-control-store-"));
    try {
      const store = openDaemonStore(root);
      const pair = await store.createPairingCode(new Date("2026-05-09T00:00:00.000Z"), 60_000);
      const claimed = await store.claimPairingCode(pair.pairCode, "iPhone", new Date("2026-05-09T00:00:30.000Z"));
      const deviceId = await store.resolveDeviceId(claimed!.token);
      expect(deviceId).toBe(claimed!.deviceId);

      await store.upsertPushRoute({ deviceId: deviceId!, routeId: "route_1", routeToken: "route_secret_1", enabled: true, updatedAt: "2026-05-09T00:00:31.000Z" });
      await store.upsertPushRoute({ deviceId: deviceId!, routeId: "route_2", routeToken: "route_secret_2", enabled: true, updatedAt: "2026-05-09T00:00:32.000Z" });
      expect(await store.listEnabledPushRoutes()).toEqual([{
        deviceId,
        routeId: "route_2",
        routeToken: "route_secret_2",
        enabled: true,
        updatedAt: "2026-05-09T00:00:32.000Z",
      }]);
      store.close();

      const reopened = openDaemonStore(root);
      expect(await reopened.listEnabledPushRoutes()).toHaveLength(1);
      expect(await reopened.removePushRoute(deviceId!)).toBe(true);
      expect(await reopened.removePushRoute(deviceId!)).toBe(false);
      expect(await reopened.listEnabledPushRoutes()).toEqual([]);
      reopened.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates and persists pairing codes", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-remote-control-store-"));
    try {
      const store = openDaemonStore(root);
      const pair = await store.createPairingCode(new Date("2026-05-09T00:00:00.000Z"), 60_000);
      store.close();

      const reopened = openDaemonStore(root);
      const claimed = await reopened.claimPairingCode(pair.pairCode, "iPhone", new Date("2026-05-09T00:00:30.000Z"));
      reopened.close();

      expect(pair).toMatchObject({ pairCode: expect.stringMatching(/^\d{6}$/), expiresAt: "2026-05-09T00:01:00.000Z" });
      expect(claimed).toMatchObject({ deviceId: expect.stringMatching(/^dev_/), token: expect.stringMatching(/^prd_/), daemonName: "pi-remote-control" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
