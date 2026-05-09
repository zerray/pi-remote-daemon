import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { createPairingCode, hashPairingCode, canClaimPairingCode } from "../auth/pairing.js";
import { issueDeviceToken, verifyDeviceToken } from "../auth/tokens.js";
import type { PairClaimResponse, PairCodeResponse } from "../server/http.js";
import type { PairingCode } from "../types.js";
import { migrateSchemaSql } from "./schema.js";

export type DaemonStore = {
  close(): void;
  createPairingCode(now: Date, ttlMs: number): Promise<PairCodeResponse>;
  claimPairingCode(rawCode: string, deviceName: string, now: Date): Promise<PairClaimResponse | undefined>;
  authenticateToken(rawToken: string): Promise<boolean>;
};

export function openDaemonStore(stateDir: string): DaemonStore {
  const database = new DatabaseSync(join(stateDir, "daemon.sqlite"));
  for (const sql of migrateSchemaSql(0)) database.exec(sql);

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
      return { deviceId, token: token.rawToken, daemonName: "pi-remote-daemon" };
    },

    async authenticateToken(rawToken: string): Promise<boolean> {
      const rows = database.prepare("select token_hash as tokenHash from devices where revoked_at is null").all() as Array<{ tokenHash: string }>;
      for (const row of rows) {
        if (await verifyDeviceToken(rawToken, row.tokenHash)) return true;
      }
      return false;
    },
  };
}
