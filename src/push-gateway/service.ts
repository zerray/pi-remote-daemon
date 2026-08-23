import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { hashDeviceToken, verifyDeviceToken } from "../auth/tokens.js";
import { APNsProviderError } from "./apns.js";
import type { PushGatewayService } from "./http.js";

export type APNsNotification = {
  deviceToken: string;
  environment: "development" | "production";
  payload: {
    aps: { alert: { title: string; body: string }; sound: "default" };
    routeId: string;
    projectId: string;
    sessionId: string;
  };
};

export type PushGatewayRuntime = PushGatewayService & { close(): void };

type RouteRow = {
  routeId: string;
  routeTokenHash: string;
  managementTokenHash: string;
  apnsDeviceToken: string;
  environment: "development" | "production";
  revokedAt: string | null;
};

export function createPushGatewayService(options: {
  databasePath: string;
  sendNotification: (notification: APNsNotification) => Promise<void>;
  now?: () => Date;
  maxNotificationsPerHour?: number;
}): PushGatewayRuntime {
  const database = new DatabaseSync(options.databasePath);
  const now = options.now ?? (() => new Date());
  const maxNotificationsPerHour = Number.isFinite(options.maxNotificationsPerHour) && (options.maxNotificationsPerHour ?? 0) > 0
    ? options.maxNotificationsPerHour!
    : 20;
  database.exec("pragma journal_mode = wal");
  database.exec(`
    create table if not exists push_routes (
      route_id text primary key,
      route_token_hash text not null,
      management_token_hash text not null,
      apns_device_token text not null,
      apns_environment text not null,
      daemon_device_id text not null,
      created_at text not null,
      updated_at text not null,
      revoked_at text
    );
    create table if not exists push_settlements (
      route_id text not null references push_routes(route_id),
      settlement_id text not null,
      created_at text not null,
      delivered_at text,
      primary key (route_id, settlement_id)
    );
  `);

  return {
    close() {
      database.close();
    },

    async createRoute(request) {
      const routeId = `route_${randomBytes(18).toString("base64url")}`;
      const routeToken = `prt_${randomBytes(32).toString("base64url")}`;
      const managementToken = `pmt_${randomBytes(32).toString("base64url")}`;
      const [routeTokenHash, managementTokenHash] = await Promise.all([
        hashDeviceToken(routeToken),
        hashDeviceToken(managementToken),
      ]);
      const timestamp = now().toISOString();
      database.prepare(`
        insert into push_routes (
          route_id, route_token_hash, management_token_hash, apns_device_token,
          apns_environment, daemon_device_id, created_at, updated_at, revoked_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, null)
      `).run(routeId, routeTokenHash, managementTokenHash, request.apnsDeviceToken, request.environment, request.daemonDeviceId, timestamp, timestamp);
      return { routeId, routeToken, managementToken };
    },

    async updateRoute(routeId, managementToken, request) {
      const route = readRoute(database, routeId);
      if (!route || route.revokedAt) return "not_found";
      if (!await verifyDeviceToken(managementToken, route.managementTokenHash)) return "unauthorized";
      database.prepare("update push_routes set apns_device_token = ?, apns_environment = ?, updated_at = ? where route_id = ?")
        .run(request.apnsDeviceToken, request.environment, now().toISOString(), routeId);
      return "updated";
    },

    async revokeRoute(routeId, managementToken) {
      const route = readRoute(database, routeId);
      if (!route) return "not_found";
      if (!await verifyDeviceToken(managementToken, route.managementTokenHash)) return "unauthorized";
      if (route.revokedAt) return "revoked";
      database.prepare("update push_routes set revoked_at = ?, updated_at = ? where route_id = ?")
        .run(now().toISOString(), now().toISOString(), routeId);
      return "revoked";
    },

    async notifySettlement(routeId, routeToken, settlement) {
      const route = readRoute(database, routeId);
      if (!route || route.revokedAt) return "not_found";
      if (!await verifyDeviceToken(routeToken, route.routeTokenHash)) return "unauthorized";
      const duplicate = database.prepare("select 1 from push_settlements where route_id = ? and settlement_id = ?")
        .get(routeId, settlement.settlementId);
      if (duplicate) return "duplicate";

      const cutoff = new Date(now().getTime() - 60 * 60_000).toISOString();
      const rate = database.prepare("select count(*) as count from push_settlements where route_id = ? and created_at >= ?")
        .get(routeId, cutoff) as { count: number };
      if (Number(rate.count) >= maxNotificationsPerHour) return "rate_limited";

      const createdAt = now().toISOString();
      database.prepare("insert into push_settlements (route_id, settlement_id, created_at, delivered_at) values (?, ?, ?, null)")
        .run(routeId, settlement.settlementId, createdAt);
      try {
        await options.sendNotification({
          deviceToken: route.apnsDeviceToken,
          environment: route.environment,
          payload: {
            aps: { alert: { title: "Pi Relay", body: "Agent finished." }, sound: "default" },
            routeId,
            projectId: settlement.projectId,
            sessionId: settlement.sessionId,
          },
        });
        database.prepare("update push_settlements set delivered_at = ? where route_id = ? and settlement_id = ?")
          .run(now().toISOString(), routeId, settlement.settlementId);
        return "accepted";
      } catch (error) {
        database.prepare("delete from push_settlements where route_id = ? and settlement_id = ?")
          .run(routeId, settlement.settlementId);
        if (error instanceof APNsProviderError
          && (error.status === 410 || (error.status === 400 && (error.reason === "BadDeviceToken" || error.reason === "DeviceTokenNotForTopic")))) {
          database.prepare("update push_routes set revoked_at = ?, updated_at = ? where route_id = ?")
            .run(now().toISOString(), now().toISOString(), routeId);
        }
        throw error;
      }
    },
  };
}

function readRoute(database: DatabaseSync, routeId: string): RouteRow | undefined {
  return database.prepare(`
    select route_id as routeId, route_token_hash as routeTokenHash,
      management_token_hash as managementTokenHash, apns_device_token as apnsDeviceToken,
      apns_environment as environment, revoked_at as revokedAt
    from push_routes where route_id = ?
  `).get(routeId) as RouteRow | undefined;
}
