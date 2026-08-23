import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createAPNsProvider } from "../src/push-gateway/apns.js";

const privateKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("APNs provider", () => {
  it("sends the fixed alert with a cached ES256 provider token", async () => {
    const transport = vi.fn(async () => ({ status: 200 }));
    const now = vi.fn(() => new Date("2026-05-09T00:00:00.000Z"));
    const send = createAPNsProvider({ teamId: "TEAM123", keyId: "KEY123", bundleId: "me.zerray.pi-relay", privateKey, transport, now });
    const notification = {
      deviceToken: "01abff",
      environment: "development" as const,
      payload: {
        aps: { alert: { title: "Pi Relay", body: "Agent finished." }, sound: "default" as const },
        routeId: "route_1",
        projectId: "proj_opaque",
        sessionId: "sess_opaque",
      },
    };

    await send(notification);
    await send(notification);

    expect(transport).toHaveBeenCalledTimes(2);
    const first = transport.mock.calls[0]![0];
    const second = transport.mock.calls[1]![0];
    expect(first.authority).toBe("https://api.sandbox.push.apple.com");
    expect(first.path).toBe("/3/device/01abff");
    expect(first.headers).toMatchObject({
      "apns-topic": "me.zerray.pi-relay",
      "apns-push-type": "alert",
      "apns-priority": "10",
      authorization: expect.stringMatching(/^bearer [^.]+\.[^.]+\.[^.]+$/),
    });
    expect(first.body).toBe(JSON.stringify(notification.payload));
    expect(second.headers.authorization).toBe(first.headers.authorization);
  });

  it("surfaces APNs rejection reasons", async () => {
    const send = createAPNsProvider({
      teamId: "TEAM123", keyId: "KEY123", bundleId: "me.zerray.pi-relay", privateKey,
      transport: async () => ({ status: 410, reason: "Unregistered" }),
    });

    await expect(send({
      deviceToken: "01abff",
      environment: "production",
      payload: { aps: { alert: { title: "Pi Relay", body: "Agent finished." }, sound: "default" }, routeId: "route_1", projectId: "proj_1", sessionId: "sess_1" },
    })).rejects.toThrow("APNs 410: Unregistered");
  });
});
