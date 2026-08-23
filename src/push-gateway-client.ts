import type { AgentSettlement, DevicePushRoute } from "./types.js";

export type PushGatewayNotifierOptions = {
  gatewayBaseUrl?: string;
  listEnabledPushRoutes: () => Promise<DevicePushRoute[]>;
  fetch?: typeof globalThis.fetch;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export function createPushSettlementNotifier(
  options: PushGatewayNotifierOptions,
): (settlement: AgentSettlement) => Promise<void> {
  let gatewayBaseUrl: string | undefined;
  try {
    const configuredUrl = options.gatewayBaseUrl ? new URL(options.gatewayBaseUrl) : undefined;
    gatewayBaseUrl = configuredUrl?.protocol === "https:" ? configuredUrl.toString().replace(/\/+$/u, "") : undefined;
  } catch {
    gatewayBaseUrl = undefined;
  }
  const send = options.fetch ?? globalThis.fetch;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
  return async (settlement) => {
    if (!gatewayBaseUrl) return;
    const routes = await options.listEnabledPushRoutes();
    await Promise.allSettled(routes.map(async (route) => {
      const request = {
        method: "POST",
        headers: { authorization: `Bearer ${route.routeToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          settlementId: settlement.settlementId,
          sessionId: settlement.sessionId,
          projectId: settlement.projectId,
        }),
      };
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const response = await send(`${gatewayBaseUrl}/v1/routes/${encodeURIComponent(route.routeId)}/agent-settled`, request);
          if (response.ok || (response.status < 500 && response.status !== 429)) return;
        } catch {
          // Retry transport failures with the same route and settlement idempotency key.
        }
        if (attempt < maxAttempts && retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }));
  };
}
