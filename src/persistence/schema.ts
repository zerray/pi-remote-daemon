export const SCHEMA_VERSION = 2;

export function createSchemaSql(): string[] {
  return [
    "create table if not exists meta (key text primary key, value text not null)",
    "create table if not exists devices (id text primary key, name text not null, token_hash text not null unique, created_at text not null, last_seen_at text, revoked_at text)",
    "create table if not exists pairing_codes (id text primary key, code_hash text not null unique, created_at text not null, expires_at text not null, consumed_at text)",
    "create table if not exists device_push_routes (device_id text primary key references devices(id), route_id text not null unique, route_token text not null, enabled integer not null, updated_at text not null)",
  ];
}

export function migrateSchemaSql(fromVersion: number, toVersion = SCHEMA_VERSION): string[] {
  if (fromVersion === toVersion) return [];
  if (toVersion !== SCHEMA_VERSION) throw new Error(`Unsupported schema migration: ${fromVersion} -> ${toVersion}`);
  if (fromVersion === 1) {
    return [
      "create table if not exists device_push_routes (device_id text primary key references devices(id), route_id text not null unique, route_token text not null, enabled integer not null, updated_at text not null)",
      `insert or replace into meta (key, value) values ('schema_version', '${SCHEMA_VERSION}')`,
    ];
  }
  if (fromVersion !== 0) throw new Error(`Unsupported schema migration: ${fromVersion} -> ${toVersion}`);
  return [
    ...createSchemaSql(),
    `insert or replace into meta (key, value) values ('schema_version', '${SCHEMA_VERSION}')`,
  ];
}
