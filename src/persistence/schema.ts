export const SCHEMA_VERSION = 1;

export function createSchemaSql(): string[] {
  return [
    "create table if not exists meta (key text primary key, value text not null)",
    "create table if not exists devices (id text primary key, name text not null, token_hash text not null unique, created_at text not null, last_seen_at text, revoked_at text)",
    "create table if not exists pairing_codes (id text primary key, code_hash text not null unique, created_at text not null, expires_at text not null, consumed_at text)",
  ];
}

export function migrateSchemaSql(fromVersion: number, toVersion = SCHEMA_VERSION): string[] {
  if (fromVersion === toVersion) return [];
  if (fromVersion !== 0 || toVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported schema migration: ${fromVersion} -> ${toVersion}`);
  }

  return [
    ...createSchemaSql(),
    `insert or replace into meta (key, value) values ('schema_version', '${SCHEMA_VERSION}')`,
  ];
}
