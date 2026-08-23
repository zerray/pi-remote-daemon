import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { APNsProviderError } from "../src/push-gateway/apns.js";
import { createPushGatewayService } from "../src/push-gateway/service.js";

describe("central Push Gateway service", () => {
  it("keeps capabilities separate and sends one fixed generic payload per settlement", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-push-gateway-"));
    const sendNotification = vi.fn(async () => undefined);
    const service = createPushGatewayService({ databasePath: join(root, "gateway.sqlite"), sendNotification, now: () => new Date("2026-05-09T00:00:00.000Z") });
    try {
      const route = await service.createRoute({ apnsDeviceToken: "01abff", daemonDeviceId: "dev_opaque", environment: "development" });
      expect(route.routeId).toMatch(/^route_/);
      expect(route.routeToken).toMatch(/^prt_/);
      expect(route.managementToken).toMatch(/^pmt_/);
      expect(route.routeToken).not.toBe(route.managementToken);

      await expect(service.notifySettlement(route.routeId, route.managementToken, { settlementId: "settle_1", projectId: "proj_opaque", sessionId: "sess_opaque" })).resolves.toBe("unauthorized");
      await expect(service.notifySettlement(route.routeId, route.routeToken, { settlementId: "settle_1", projectId: "proj_opaque", sessionId: "sess_opaque" })).resolves.toBe("accepted");
      await expect(service.notifySettlement(route.routeId, route.routeToken, { settlementId: "settle_1", projectId: "proj_opaque", sessionId: "sess_opaque" })).resolves.toBe("duplicate");

      expect(sendNotification).toHaveBeenCalledOnce();
      expect(sendNotification).toHaveBeenCalledWith({
        deviceToken: "01abff",
        environment: "development",
        payload: {
          aps: { alert: { title: "Pi Relay", body: "Agent finished." }, sound: "default" },
          routeId: route.routeId,
          projectId: "proj_opaque",
          sessionId: "sess_opaque",
        },
      });

      await expect(service.updateRoute(route.routeId, route.routeToken, { apnsDeviceToken: "02bc00", environment: "production" })).resolves.toBe("unauthorized");
      await expect(service.updateRoute(route.routeId, route.managementToken, { apnsDeviceToken: "02bc00", environment: "production" })).resolves.toBe("updated");
      await expect(service.revokeRoute(route.routeId, route.managementToken)).resolves.toBe("revoked");
      await expect(service.revokeRoute(route.routeId, route.managementToken)).resolves.toBe("revoked");
      await expect(service.notifySettlement(route.routeId, route.routeToken, { settlementId: "settle_2", projectId: "proj_opaque", sessionId: "sess_opaque" })).resolves.toBe("not_found");
    } finally {
      service.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("revokes routes when APNs reports an invalid device token", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-push-gateway-invalid-token-"));
    const service = createPushGatewayService({
      databasePath: join(root, "gateway.sqlite"),
      sendNotification: async () => { throw new APNsProviderError(410, "Unregistered"); },
    });
    try {
      const route = await service.createRoute({ apnsDeviceToken: "01abff", daemonDeviceId: "dev_opaque", environment: "development" });
      await expect(service.notifySettlement(route.routeId, route.routeToken, { settlementId: "settle_1", projectId: "proj_1", sessionId: "sess_1" })).rejects.toThrow("Unregistered");
      await expect(service.notifySettlement(route.routeId, route.routeToken, { settlementId: "settle_2", projectId: "proj_1", sessionId: "sess_1" })).resolves.toBe("not_found");
    } finally {
      service.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rate limits distinct settlements per route", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-push-gateway-rate-"));
    const service = createPushGatewayService({ databasePath: join(root, "gateway.sqlite"), sendNotification: async () => undefined, now: () => new Date("2026-05-09T00:00:00.000Z"), maxNotificationsPerHour: 1 });
    try {
      const route = await service.createRoute({ apnsDeviceToken: "01abff", daemonDeviceId: "dev_opaque", environment: "development" });
      await expect(service.notifySettlement(route.routeId, route.routeToken, { settlementId: "settle_1", projectId: "proj_1", sessionId: "sess_1" })).resolves.toBe("accepted");
      await expect(service.notifySettlement(route.routeId, route.routeToken, { settlementId: "settle_2", projectId: "proj_1", sessionId: "sess_1" })).resolves.toBe("rate_limited");
    } finally {
      service.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
