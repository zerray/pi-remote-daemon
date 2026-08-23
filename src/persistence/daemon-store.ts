import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { createPairingCode, hashPairingCode, canClaimPairingCode } from "../auth/pairing.js";
import { issueDeviceToken, verifyDeviceToken } from "../auth/tokens.js";
import type { PairClaimResponse, PairCodeResponse } from "../server/http.js";
import type { DevicePushRoute, PairingCode } from "../types.js";
import { migrateSchemaSql } from "./schema.js";

export type DaemonStore = {
  close(): void;
  createPairingCode(now: Date, ttlMs: number): Promise<PairCodeResponse>;
  claimPairingCode(rawCode: string, deviceName: string, now: Date): Promise<PairClaimResponse | undefined>;
  authenticateToken(rawToken: string): Promise<boolean>;
  resolveDeviceId(rawToken: string): Promise<string | undefined>;
  upsertPushRoute(route: DevicePushRoute): Promise<void>;
  removePushRoute(deviceId: string): Promise<boolean>;
  listEnabledPushRoutes(): Promise<DevicePushRoute[]>;
};

export function openDaemonStore(stateDir: string): DaemonStore {
  const database = new DatabaseSync(join(stateDir, "daemon.sqlite"));
  const hasMeta = database.prepare("select 1 from sqlite_master where type = 'table' and name = 'meta'").get();
  const storedVersion = hasMeta
    ? Number.parseInt((database.prepare("select value from meta where key = 'schema_version'").get() as { value?: string } | undefined)?.value ?? "0", 10)
    : 0;
  for (const sql of migrateSchemaSql(Number.isFinite(storedVersion) ? storedVersion : 0)) database.exec(sql);

  return {
    close() {
      database.close();
    },

    async createPairingCode(now: Date, ttlMs: number): Promise<PairCodeResponse> {
      const pair = createPairingCode(now, ttlMs);
      database
        .prepare("insert into pairing_codes (id, code_hash, created_at, expires_at, consumed_at) values (?, ?, ?, ?, null)")
        .run(pair.id, pair.codeHash, pair.createdAt, pair.expiresAt);
      return { pairCode: pair.rawCode, expiresAt: pair.expiresAt };
    },

    async claimPairingCode(rawCode: string, deviceName: string, now: Date): Promise<PairClaimResponse | undefined> {
      const row = database
        .prepare("select id, code_hash as codeHash, created_at as createdAt, expires_at as expiresAt, consumed_at as consumedAt from pairing_codes where code_hash = ? order by created_at desc limit 1")
        .get(hashPairingCode(rawCode)) as PairingCode | undefined;
      if (!row || !canClaimPairingCode(row, rawCode, now)) return undefined;

      const token = issueDeviceToken();
      const deviceId = `dev_${Date.now().toString(36)}`;
      database.prepare("update pairing_codes set consumed_at = ? where id = ?").run(now.toISOString(), row.id);
      database
        .prepare("insert into devices (id, name, token_hash, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, null, null)")
        .run(deviceId, deviceName, token.tokenHash, now.toISOString());
      return { deviceId, token: token.rawToken, daemonName: "pi-remote-control" };
    },

    async authenticateToken(rawToken: string): Promise<boolean> {
      const rows = database.prepare("select token_hash as tokenHash from devices where revoked_at is null").all() as Array<{ tokenHash: string }>;
      for (const row of rows) {
        if (await verifyDeviceToken(rawToken, row.tokenHash)) return true;
      }
      return false;
    },

    async resolveDeviceId(rawToken: string): Promise<string | undefined> {
      const rows = database.prepare("select id, token_hash as tokenHash from devices where revoked_at is null").all() as Array<{ id: string; tokenHash: string }>;
      for (const row of rows) {
        if (await verifyDeviceToken(rawToken, row.tokenHash)) return row.id;
      }
      return undefined;
    },

    async upsertPushRoute(route: DevicePushRoute): Promise<void> {
      database.prepare(`
        insert into device_push_routes (device_id, route_id, route_token, enabled, updated_at)
        values (?, ?, ?, ?, ?)
        on conflict(device_id) do update set
          route_id = excluded.route_id,
          route_token = excluded.route_token,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `).run(route.deviceId, route.routeId, route.routeToken, route.enabled ? 1 : 0, route.updatedAt);
    },

    async removePushRoute(deviceId: string): Promise<boolean> {
      const result = database.prepare("delete from device_push_routes where device_id = ?").run(deviceId);
      return Number(result.changes) > 0;
    },

    async listEnabledPushRoutes(): Promise<DevicePushRoute[]> {
      const rows = database.prepare(`
        select device_id as deviceId, route_id as routeId, route_token as routeToken, enabled, updated_at as updatedAt
        from device_push_routes
        where enabled = 1
        order by device_id
      `).all() as Array<Omit<DevicePushRoute, "enabled"> & { enabled: number }>;
      return rows.map((row) => ({ ...row, enabled: row.enabled === 1 }));
    },
  };
}
