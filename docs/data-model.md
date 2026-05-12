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

Pairing codes and device token hashes are durable. Active session registry entries are rebuilt by currently running Pi TUI extensions after the user enables `/remote-control`. Completed transcript history is read from Pi session JSONL files, not stored in daemon SQLite or active registry memory.

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

Pairing codes are short-lived. The daemon stores code hashes, not raw codes. Raw pair codes are created only for `/remote-control-pair` and are encoded into the Pi TUI QR code.

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

The raw link is encoded as a `pi-remote://pair?...` URL and rendered as a QR code by `/remote-control-pair`. The raw link is not printed as a separate TUI text line.

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

An active TUI session is owned by one Pi extension control channel. It is removed when `/remote-control` disables it, the TUI session shuts down, or the control channel closes. If the daemon removes it because heartbeats stopped but the same TUI process still has local remote-control state active, the TUI extension can recreate the active session by re-registering on the next heartbeat miss. Its `sessionFile` points to the Pi JSONL transcript used for HTTP transcript reads.

## Session snapshot

```ts
type SessionSnapshot = {
  session: ActiveTuiSession;
  messages: TranscriptMessage[];
  olderMessagesCursor?: string;
  hasOlderMessages: boolean;
  tools: ToolCallStatus[];
  isStreaming: boolean;
  pendingMessageCount: number;
};
```

The daemon returns a bounded recent-message snapshot for active sessions so newly connected iOS clients can render persisted state before incremental events arrive. Snapshot messages are derived from the session's Pi JSONL `sessionFile` at request time and normalized into `TranscriptMessage` values. Older transcript history is loaded through explicit transcript page requests.

## Transcript message

```ts
type TranscriptMessage = {
  id: string;
  role: "user" | "assistant" | "toolResult" | "system";
  content: TranscriptContentBlock[];
  text: string;
  textTruncated?: boolean;
  textOriginalBytes?: number;
  createdAt: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  isStreaming: boolean;
};

type TranscriptContentBlock =
  | { type: "text"; text: string; truncated?: boolean; originalBytes?: number }
  | { type: "thinking"; thinking: string; truncated?: boolean; originalBytes?: number }
  | { type: "toolCall"; id: string; name: string; arguments: unknown; argumentsTruncated?: boolean; argumentsOriginalBytes?: number }
  | { type: "image"; data: string; mimeType: string; truncated?: boolean; originalBytes?: number };
```

`TranscriptMessage` is the public transcript shape used by both HTTP transcript reads and WebSocket live updates. `content` preserves structured Pi message blocks. `text` is a display summary derived from text-like blocks and kept for clients that need a simple preview. Tool-result messages carry `toolCallId`, `toolName`, and `isError` when present. Truncation metadata is used when the daemon intentionally sends a preview instead of the full string payload.

## Transcript page

```ts
type TranscriptPage = {
  messages: TranscriptMessage[];
  olderMessagesCursor?: string;
  hasOlderMessages: boolean;
};
```

Transcript pages contain bounded message windows ordered oldest-to-newest by `createdAt` and are derived from the session's Pi JSONL `sessionFile` at request time. Cursor values are generated from the oldest loaded message's `createdAt` timestamp, are daemon-encoded, and are opaque to clients. Clients merge pages and live updates by de-duplicating `TranscriptMessage.id`.

## Transcript stream event

```ts
type TranscriptStreamEvent =
  | { type: "session_state"; state: SessionSnapshot }
  | { type: "turn_start"; turnIndex: number; createdAt?: string }
  | { type: "turn_end"; turnIndex: number }
  | { type: "transcript_message_start"; message: TranscriptMessage }
  | { type: "transcript_message_patch"; messageId: string; contentIndex?: number; patch: TranscriptMessagePatch }
  | { type: "transcript_message_end"; message: TranscriptMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; partialResult: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result?: unknown; isError: boolean }
  | { type: "session_closed" }
  | { type: "error"; error: string };

type TranscriptMessagePatch =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "toolCall"; toolCall: { type: "toolCall"; id: string; name: string; arguments: unknown } }
  | { type: "replace"; message: TranscriptMessage };
```

Stream events are daemon-normalized and public to iOS. They are derived from package-internal TUI Pi events but do not expose raw Pi event payloads. `turn_start` and `turn_end` are lifecycle signals; transcript content remains represented by `TranscriptMessage` events. The initial `session_state` stream event is limited to at most 20 recent messages; oversized string payloads in those messages are truncated to their first 10 KiB and marked with truncation metadata.

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

`tools` is a compact snapshot of active or recent tool execution state associated by `toolCallId`. Tool-call declarations are preserved inside assistant `TranscriptMessage.content`; tool execution progress and completion are delivered on the WebSocket stream as normalized tool events.
