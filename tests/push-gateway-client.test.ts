import { describe, expect, it, vi } from "vitest";
import { createPushSettlementNotifier } from "../src/push-gateway-client.js";

describe("central Push Gateway notifier", () => {
  it("fans out a generic Agent Settlement through enabled opaque routes", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 202 }))
      .mockResolvedValueOnce(new Response("gateway down", { status: 503 }));
    const notify = createPushSettlementNotifier({
      gatewayBaseUrl: "https://push.pi-relay.example/base/",
      listEnabledPushRoutes: async () => [
        { deviceId: "dev_1", routeId: "route_1", routeToken: "secret_1", enabled: true, updatedAt: "2026-05-09T00:00:00.000Z" },
        { deviceId: "dev_2", routeId: "route_2", routeToken: "secret_2", enabled: true, updatedAt: "2026-05-09T00:00:00.000Z" },
      ],
      fetch,
      maxAttempts: 1,
    });

    await expect(notify({ settlementId: "settle_1", sessionId: "sess_opaque", projectId: "proj_opaque" })).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls).toEqual([
      ["https://push.pi-relay.example/base/v1/routes/route_1/agent-settled", {
        method: "POST",
        headers: { authorization: "Bearer secret_1", "content-type": "application/json" },
        body: JSON.stringify({ settlementId: "settle_1", sessionId: "sess_opaque", projectId: "proj_opaque" }),
      }],
      ["https://push.pi-relay.example/base/v1/routes/route_2/agent-settled", {
        method: "POST",
        headers: { authorization: "Bearer secret_2", "content-type": "application/json" },
        body: JSON.stringify({ settlementId: "settle_1", sessionId: "sess_opaque", projectId: "proj_opaque" }),
      }],
    ]);
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("assistant");
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("path");
  });

  it("retries transient gateway failures with the same idempotency key", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("gateway down", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 202 }));
    const notify = createPushSettlementNotifier({
      gatewayBaseUrl: "https://push.pi-relay.example",
      listEnabledPushRoutes: async () => [
        { deviceId: "dev_1", routeId: "route_1", routeToken: "secret_1", enabled: true, updatedAt: "2026-05-09T00:00:00.000Z" },
      ],
      fetch,
      retryDelayMs: 0,
    });

    await notify({ settlementId: "settle_same", sessionId: "sess_opaque", projectId: "proj_opaque" });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(fetch.mock.calls[1]?.[1]?.body);
  });
});
