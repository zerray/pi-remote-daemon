export const SCHEMA_VERSION = 1;

export function createSchemaSql(): string[] {
  return [
    "create table if not exists meta (key text primary key, value text not null)",
    "create table if not exists projects (id text primary key, name text not null, path text not null unique, created_at text not null, updated_at text not null)",
    "create table if not exists devices (id text primary key, name text not null, token_hash text not null unique, created_at text not null, last_seen_at text, revoked_at text)",
    "create table if not exists pairing_codes (id text primary key, code_hash text not null unique, created_at text not null, expires_at text not null, consumed_at text)",
    "create table if not exists session_index (id text primary key, project_id text not null references projects(id), pi_session_id text not null, session_file text not null unique, name_cache text, updated_at text not null, message_count_cache integer not null default 0, last_opened_at text)",
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
