import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { APNsProviderError } from "./apns.js";

export type PushGatewayRouteRegistration = {
  routeId: string;
  routeToken: string;
  managementToken: string;
};

export type PushGatewayService = {
  createRoute(request: { apnsDeviceToken: string; daemonDeviceId: string; environment: "development" | "production" }): Promise<PushGatewayRouteRegistration>;
  updateRoute(routeId: string, managementToken: string, request: { apnsDeviceToken: string; environment: "development" | "production" }): Promise<"updated" | "unauthorized" | "not_found">;
  revokeRoute(routeId: string, managementToken: string): Promise<"revoked" | "unauthorized" | "not_found">;
  notifySettlement(routeId: string, routeToken: string, settlement: { settlementId: string; projectId: string; sessionId: string }): Promise<"accepted" | "duplicate" | "unauthorized" | "not_found" | "rate_limited">;
};

export type PushGatewayServer = {
  address: string;
  close(): Promise<void>;
};

export type PushGatewayErrorEvent = {
  event: "push_gateway_request_failed";
  errorType: "apns_provider_error" | "internal_error";
  apnsStatus?: number;
  apnsReason?: string;
  errorName?: string;
  errorCode?: string;
};

export function describePushGatewayError(error: unknown): PushGatewayErrorEvent {
  if (error instanceof APNsProviderError) {
    const event: PushGatewayErrorEvent = {
      event: "push_gateway_request_failed",
      errorType: "apns_provider_error",
      apnsStatus: error.status,
    };
    const reason = boundedDiagnostic(error.reason);
    if (reason) event.apnsReason = reason;
    return event;
  }

  const event: PushGatewayErrorEvent = {
    event: "push_gateway_request_failed",
    errorType: "internal_error",
  };
  if (error && typeof error === "object") {
    const errorName = boundedDiagnostic("name" in error ? error.name : undefined);
    const errorCode = boundedDiagnostic("code" in error ? error.code : undefined);
    if (errorName) event.errorName = errorName;
    if (errorCode) event.errorCode = errorCode;
  }
  return event;
}

export async function startPushGatewayServer(options: {
  bindAddress: string;
  service: PushGatewayService;
  maxRouteCreationsPerHour?: number;
  reportError?: (event: PushGatewayErrorEvent) => void;
}): Promise<PushGatewayServer> {
  const routeCreations = new Map<string, number[]>();
  const maxRouteCreationsPerHour = Number.isFinite(options.maxRouteCreationsPerHour) && (options.maxRouteCreationsPerHour ?? 0) > 0
    ? options.maxRouteCreationsPerHour!
    : 20;
  const allowRouteCreation = (remoteAddress: string): boolean => {
    const cutoff = Date.now() - 60 * 60_000;
    const recent = (routeCreations.get(remoteAddress) ?? []).filter((timestamp) => timestamp >= cutoff);
    if (recent.length >= maxRouteCreationsPerHour) {
      routeCreations.set(remoteAddress, recent);
      return false;
    }
    recent.push(Date.now());
    routeCreations.set(remoteAddress, recent);
    return true;
  };
  const reportError = options.reportError ?? ((event: PushGatewayErrorEvent) => console.error(JSON.stringify(event)));
  const server = createServer((request, response) => {
    void handleRequest(request, response, options.service, allowRouteCreation).catch((error: unknown) => {
      try {
        reportError(describePushGatewayError(error));
      } catch {
        // Diagnostics must not prevent the generic HTTP failure response.
      }
      writeJson(response, 500, { error: "internal_error" });
    });
  });
  const index = options.bindAddress.lastIndexOf(":");
  if (index < 0) throw new Error(`Invalid bind address: ${options.bindAddress}`);
  const host = options.bindAddress.slice(0, index);
  const port = Number.parseInt(options.bindAddress.slice(index + 1), 10);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    address: `${address.address}:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  service: PushGatewayService,
  allowRouteCreation: (remoteAddress: string) => boolean,
): Promise<void> {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (request.method === "GET" && pathname === "/v1/health") {
    writeJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "POST" && pathname === "/v1/routes") {
    if (!allowRouteCreation(request.socket.remoteAddress ?? "unknown")) {
      writeJson(response, 429, { error: "rate_limited" });
      return;
    }
    const body = await readJson(request);
    const apnsDeviceToken = readString(body.apnsDeviceToken);
    const daemonDeviceId = readString(body.daemonDeviceId);
    const environment = readEnvironment(body.environment);
    if (!isHexToken(apnsDeviceToken) || !isOpaqueId(daemonDeviceId) || !environment) {
      writeJson(response, 400, { error: "invalid_route_request" });
      return;
    }
    const registration = await service.createRoute({ apnsDeviceToken, daemonDeviceId, environment });
    writeJson(response, 201, registration);
    return;
  }

  const updateMatch = pathname.match(/^\/v1\/routes\/([^/]+)\/device$/u);
  if (request.method === "PUT" && updateMatch) {
    const token = bearerToken(request);
    if (!token) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }
    const body = await readJson(request);
    const apnsDeviceToken = readString(body.apnsDeviceToken);
    const environment = readEnvironment(body.environment);
    if (!isHexToken(apnsDeviceToken) || !environment) {
      writeJson(response, 400, { error: "invalid_route_request" });
      return;
    }
    const outcome = await service.updateRoute(decodeURIComponent(updateMatch[1] ?? ""), token, { apnsDeviceToken, environment });
    writeOutcome(response, outcome, { updated: true });
    return;
  }

  const settlementMatch = pathname.match(/^\/v1\/routes\/([^/]+)\/agent-settled$/u);
  if (request.method === "POST" && settlementMatch) {
    const token = bearerToken(request);
    if (!token) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }
    const body = await readJson(request);
    const settlementId = readString(body.settlementId);
    const projectId = readString(body.projectId);
    const sessionId = readString(body.sessionId);
    if (!isOpaqueId(settlementId) || !isOpaqueId(projectId) || !isOpaqueId(sessionId)) {
      writeJson(response, 400, { error: "invalid_agent_settlement" });
      return;
    }
    const outcome = await service.notifySettlement(decodeURIComponent(settlementMatch[1] ?? ""), token, { settlementId, projectId, sessionId });
    if (outcome === "accepted") writeJson(response, 202, { accepted: true });
    else if (outcome === "duplicate") writeJson(response, 200, { accepted: true, duplicate: true });
    else if (outcome === "rate_limited") writeJson(response, 429, { error: "rate_limited" });
    else writeOutcome(response, outcome, {});
    return;
  }

  const routeMatch = pathname.match(/^\/v1\/routes\/([^/]+)$/u);
  if (request.method === "DELETE" && routeMatch) {
    const token = bearerToken(request);
    if (!token) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }
    const outcome = await service.revokeRoute(decodeURIComponent(routeMatch[1] ?? ""), token);
    writeOutcome(response, outcome, { revoked: true });
    return;
  }

  writeJson(response, 404, { error: "not_found" });
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of request) {
    raw += String(chunk);
    if (raw.length > 16_384) throw new Error("request_too_large");
  }
  if (!raw) return {};
  const value = JSON.parse(raw) as unknown;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function bearerToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readEnvironment(value: unknown): "development" | "production" | undefined {
  return value === "development" || value === "production" ? value : undefined;
}

function isHexToken(value: string): boolean {
  return value.length >= 2 && value.length <= 512 && value.length % 2 === 0 && /^[0-9a-f]+$/iu.test(value);
}

function isOpaqueId(value: string): boolean {
  return value.length > 0 && value.length <= 256;
}

function boundedDiagnostic(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(value) ? value : undefined;
}

function writeOutcome(response: ServerResponse, outcome: string, successBody: unknown): void {
  if (outcome === "updated" || outcome === "revoked") writeJson(response, 200, successBody);
  else if (outcome === "unauthorized") writeJson(response, 401, { error: "unauthorized" });
  else writeJson(response, 404, { error: "not_found" });
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
