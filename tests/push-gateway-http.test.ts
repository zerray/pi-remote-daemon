import { describe, expect, it, vi } from "vitest";
import { startPushGatewayServer, type PushGatewayService } from "../src/push-gateway/http.js";

async function withGateway<T>(service: PushGatewayService, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = await startPushGatewayServer({ bindAddress: "127.0.0.1:0", service });
  try {
    return await fn(`http://${server.address}`);
  } finally {
    await server.close();
  }
}

describe("central Push Gateway HTTP contract", () => {
  it("manages routes and accepts only fixed Agent Settlement notifications", async () => {
    const service: PushGatewayService = {
      createRoute: vi.fn(async () => ({ routeId: "route_1", routeToken: "route_secret_1", managementToken: "manage_secret_1" })),
      updateRoute: vi.fn(async () => "updated"),
      revokeRoute: vi.fn(async () => "revoked"),
      notifySettlement: vi.fn(async () => "accepted"),
    };

    await withGateway(service, async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/v1/routes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apnsDeviceToken: "01abff", daemonDeviceId: "dev_opaque", environment: "development" }),
      });
      expect(createResponse.status).toBe(201);
      await expect(createResponse.json()).resolves.toEqual({ routeId: "route_1", routeToken: "route_secret_1", managementToken: "manage_secret_1" });

      const updateResponse = await fetch(`${baseUrl}/v1/routes/route_1/device`, {
        method: "PUT",
        headers: { authorization: "Bearer manage_secret_1", "content-type": "application/json" },
        body: JSON.stringify({ apnsDeviceToken: "02bc00", environment: "production" }),
      });
      expect(updateResponse.status).toBe(200);

      const settlementResponse = await fetch(`${baseUrl}/v1/routes/route_1/agent-settled`, {
        method: "POST",
        headers: { authorization: "Bearer route_secret_1", "content-type": "application/json" },
        body: JSON.stringify({ settlementId: "settle_1", projectId: "proj_opaque", sessionId: "sess_opaque", title: "leak", body: "leak" }),
      });
      expect(settlementResponse.status).toBe(202);
      expect(service.notifySettlement).toHaveBeenCalledWith("route_1", "route_secret_1", {
        settlementId: "settle_1",
        projectId: "proj_opaque",
        sessionId: "sess_opaque",
      });

      const revokeResponse = await fetch(`${baseUrl}/v1/routes/route_1`, {
        method: "DELETE",
        headers: { authorization: "Bearer manage_secret_1" },
      });
      expect(revokeResponse.status).toBe(200);
    });
  });

  it("rate limits unauthenticated route creation by remote address", async () => {
    const service: PushGatewayService = {
      createRoute: vi.fn(async () => ({ routeId: "route_1", routeToken: "route_token", managementToken: "management_token" })),
      updateRoute: vi.fn(), revokeRoute: vi.fn(), notifySettlement: vi.fn(),
    };
    const server = await startPushGatewayServer({ bindAddress: "127.0.0.1:0", service, maxRouteCreationsPerHour: 1 });
    try {
      const baseUrl = `http://${server.address}`;
      const request = () => fetch(`${baseUrl}/v1/routes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apnsDeviceToken: "01abff", daemonDeviceId: "dev_opaque", environment: "development" }),
      });
      expect((await request()).status).toBe(201);
      expect((await request()).status).toBe(429);
      expect(service.createRoute).toHaveBeenCalledOnce();
    } finally {
      await server.close();
    }
  });

  it("rejects invalid APNs tokens and missing route bearer capabilities", async () => {
    const service: PushGatewayService = {
      createRoute: vi.fn(), updateRoute: vi.fn(), revokeRoute: vi.fn(), notifySettlement: vi.fn(),
    };
    await withGateway(service, async (baseUrl) => {
      const invalidCreate = await fetch(`${baseUrl}/v1/routes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apnsDeviceToken: "not-hex", daemonDeviceId: "dev_1", environment: "development" }),
      });
      expect(invalidCreate.status).toBe(400);

      const unauthorized = await fetch(`${baseUrl}/v1/routes/route_1/agent-settled`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settlementId: "settle_1", projectId: "proj_1", sessionId: "sess_1" }),
      });
      expect(unauthorized.status).toBe(401);
      expect(service.notifySettlement).not.toHaveBeenCalled();
    });
  });
});
