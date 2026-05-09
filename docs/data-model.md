# Data model

## Persistent storage

The daemon state directory defaults to `~/.pi/remote-daemon` and can be overridden with `PI_REMOTE_DAEMON_DIR`.

```text
~/.pi/remote-daemon/
├── config.json
├── daemon.sqlite
├── daemon.lock
└── daemon.pid
```

The directory must be created with owner-only permissions. Database and token-bearing files must not be world-readable.

## SQLite schema

`daemon.sqlite` is the daemon-owned source of truth for remote access state. Pi session JSONL files remain the source of truth for transcripts.

```sql
create table meta (
  key text primary key,
  value text not null
);

create table projects (
  id text primary key,
  name text not null,
  path text not null unique,
  created_at text not null,
  updated_at text not null
);

create table devices (
  id text primary key,
  name text not null,
  token_hash text not null unique,
  created_at text not null,
  last_seen_at text,
  revoked_at text
);

create table pairing_codes (
  id text primary key,
  code_hash text not null unique,
  created_at text not null,
  expires_at text not null,
  consumed_at text
);

create table session_index (
  id text primary key,
  project_id text not null references projects(id),
  pi_session_id text not null,
  session_file text not null unique,
  name_cache text,
  updated_at text not null,
  message_count_cache integer not null default 0,
  last_opened_at text
);
```

`session_index` is a cache and stable-ID map for the daemon API. It can be rebuilt by scanning Pi session files with Pi SDK `SessionManager`.

## Config file

```ts
type DaemonConfig = {
  bindAddress: string;
  allowedProjects: Array<{
    id: string;
    name: string;
    path: string;
  }>;
};
```

`config.json` is human-editable daemon configuration. Project records are mirrored into SQLite so API responses and session indexes have stable foreign keys.

## Daemon process state

```ts
type DaemonState = {
  pid: number;
  startedAt: string;
  version: string;
  piVersion: string;
  bindAddress: string;
  stateDir: string;
};
```

Stored process state is used for health checks and singleton detection. It is not session history.

## Pairing code

```ts
type PairingCode = {
  codeHash: string;
  expiresAt: string;
  createdAt: string;
  consumedAt?: string;
};
```

Pairing codes are short-lived. The daemon stores code hashes, not raw codes.

## Paired device

```ts
type PairedDevice = {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
};
```

The iOS app stores the bearer token in Keychain. The daemon stores only token hashes.

## Project registry

```ts
type ProjectRecord = {
  id: string;
  name: string;
  path: string;
};
```

Projects are daemon-approved working directories. The daemon never lets a mobile client browse arbitrary host paths outside configured projects.

## Live session controller

```ts
type LiveSessionController = {
  sessionId: string;
  projectId: string;
  piSessionId: string;
  sessionFile: string;
  status: "idle" | "streaming" | "aborting" | "disposed";
  lastUsedAt: string;
};
```

A live controller wraps the Pi SDK runtime or RPC subprocess for one open session. Controllers are daemon-owned and may be disposed when idle.

## Tool call status

```ts
type ToolCallStatus = {
  id: string;
  name: string;
  status: "pending" | "running" | "succeeded" | "failed" | "aborted";
  summary?: string;
  updatedAt: string;
};
```

Tool call status is derived from Pi tool execution events and streamed to the iOS app in compact form.
