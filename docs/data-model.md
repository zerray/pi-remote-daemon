# Data model

## Persistent storage

The daemon state directory defaults to `~/.pi/remote-control` and can be overridden with `PI_REMOTE_CONTROL_DIR`.

```text
~/.pi/remote-control/
├── config.json
├── daemon.sqlite
└── daemon.lock
```

The directory must be created with owner-only permissions. Database and token-bearing files must not be world-readable. `daemon.lock` is created atomically and contains the daemon PID for singleton enforcement, `status`, and `stop`.

## SQLite schema

`daemon.sqlite` is the daemon-owned source of truth for remote access state. Active TUI sessions are process state and Pi session JSONL files remain the source of truth for transcripts.

```sql
create table meta (
  key text primary key,
  value text not null
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
```

Pairing codes and device token hashes are durable. Active session registry entries are rebuilt by currently running Pi TUI extensions after the user enables `/remote-control`.

## Config file

```ts
type DaemonConfig = {
  bindAddress: string;
  advertisedBaseUrl?: string;
};
```

`config.json` is human-editable daemon configuration. It does not contain allowed project roots for the MVP because project visibility is derived from active remote-control TUI sessions. `bindAddress` is the remote-facing listener. When it is a specific non-loopback address, the daemon also listens on `127.0.0.1` on the same port for local TUI control. `advertisedBaseUrl` is the URL encoded into pairing QR codes and used by iOS for future daemon calls; it must not be a loopback or wildcard address when pairing a separate device.

## Daemon process state

```ts
type DaemonState = {
  pid: number;
  startedAt: string;
  version: string;
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

Pairing codes are short-lived. The daemon stores code hashes, not raw codes. Raw pair codes are created only for `/remote-control-pair` and are displayed in the Pi TUI.

## Pairing link

```ts
type PairingLink = {
  scheme: "pi-remote";
  action: "pair";
  baseUrl: string;
  code: string;
  expiresAt: string;
};
```

The raw link is encoded as a `pi-remote://pair?...` URL and rendered as a QR code by `/remote-control-pair`. The same values are displayed as text fallback.

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

## Active project

```ts
type ActiveProject = {
  id: string;
  name: string;
  path: string;
};
```

An active project exists while at least one registered TUI session for that project has remote control enabled.

## Active TUI session

```ts
type ActiveTuiSession = {
  id: string;
  piSessionId: string;
  projectId: string;
  sessionFile: string;
  name?: string;
  pid: number;
  messageCount: number;
  isStreaming: boolean;
  registeredAt: string;
  lastSeenAt: string;
};
```

An active TUI session is owned by one Pi extension control channel. It is removed when `/remote-control` disables it, the TUI session shuts down, or the control channel closes.

## Session snapshot

```ts
type SessionSnapshot = {
  session: ActiveTuiSession;
  messages: ChatMessage[];
  olderMessagesCursor?: string;
  hasOlderMessages: boolean;
  tools: ToolCallStatus[];
  pendingMessageCount: number;
};
```

The daemon returns a bounded recent-message snapshot for active sessions so newly connected iOS clients can render current state before incremental events arrive. Older transcript history is loaded through explicit transcript page requests.

## Transcript page

```ts
type TranscriptPage = {
  messages: ChatMessage[];
  olderMessagesCursor?: string;
  hasOlderMessages: boolean;
};
```

Transcript pages contain bounded message windows ordered oldest-to-newest. Cursor values are daemon-owned and opaque to clients.

## TUI control channel

```ts
type TuiControlChannel = {
  sessionId: string;
  pid: number;
  status: "active" | "closing";
  lastHeartbeatAt: string;
};
```

The control channel is the daemon's route for sending remote prompt and abort commands to the owning TUI extension. Loopback TUI control requests do not require a bearer token; non-loopback TUI control requests do.

## Tool state

`tools` is currently an empty array in session snapshots. Tool execution details are forwarded as raw Pi TUI events on the WebSocket stream.
