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

create table device_push_routes (
  device_id text primary key references devices(id),
  route_id text not null unique,
  route_token text not null,
  enabled integer not null,
  updated_at text not null
);
```

`device_push_routes.route_token` is a gateway bearer capability, not an APNs device token. It is durable because the daemon must notify while iOS is suspended, and it relies on the same owner-only directory and database permissions as daemon device credentials.

Pairing codes and device token hashes are durable. Active session registry entries are rebuilt by currently running Pi TUI extensions after the user enables `/remote-control`. Completed transcript history is read from Pi session JSONL files, not stored in daemon SQLite or active registry memory.

## Config file

```ts
type DaemonConfig = {
  bindAddress: string;
  advertisedBaseUrl?: string;
  pushGatewayBaseUrl?: string;
};
```

`config.json` is human-editable daemon configuration. It does not contain allowed project roots for the MVP because project visibility is derived from active remote-control TUI sessions. `pushGatewayBaseUrl` is the trusted central Push Gateway endpoint; iOS cannot override it when registering a Push Route. `bindAddress` is the remote-facing listener. When it is a specific non-loopback address, the daemon also listens on `127.0.0.1` on the same port for local TUI control. `advertisedBaseUrl` is the URL encoded into pairing QR codes and used by iOS for future daemon calls; it must not be a loopback or wildcard address when pairing a separate device.

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

The raw link is encoded as a `pi-remote://pair?...` URL and rendered as a QR code by `/remote-control-pair`. The same link is also printed as a UTF-8 hex string for desktop copy/paste pairing. The raw link is not printed as a separate TUI text line, and hex encoding is presentation obfuscation only.

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

## Push Route

```ts
type DevicePushRoute = {
  deviceId: string;
  routeId: string;
  routeToken: string;
  enabled: boolean;
  updatedAt: string;
};
```

A Push Route is a gateway-issued capability associated with the paired device resolved from daemon bearer authentication. `routeId` is non-secret and is returned in APNs custom payloads so iOS can resolve the paired daemon. `routeToken` authorizes only the gateway's fixed generic Agent Settlement notification for this route. APNs device tokens and APNs provider keys are never daemon data.

## Active project

```ts
type ActiveProject = {
  id: string;
  name: string;
  path: string;
};
```

An active project exists while at least one registered TUI session for that project has remote control enabled.

## Active session summary

```ts
type ActiveSessionSummary = {
  id: string;
  piSessionId: string;
  projectId: string;
  name: string | null;
  path: string;
  updatedAt: string;
  messageCount: number;
  isActive: boolean;
};
```

`ActiveSessionSummary` is the public session identity shape returned to iOS in lists, session snapshots, and replacement handoff events.

## Active TUI session

```ts
type ActiveTuiSession = {
  id: string;
  piSessionId: string;
  projectId: string;
  sessionFile: string;
  name?: string;
  nameSource?: "tui" | "generated";
  pid: number;
  messageCount: number;
  isStreaming: boolean;
  runtimeStatus?: RuntimeStatus;
  modelCatalog?: ModelCatalogSnapshot;
  treeSnapshot?: TreeSnapshot;
  treeStateStale?: boolean;
  registeredAt: string;
  lastSeenAt: string;
  lastSettlementId?: string;
};
```

An active TUI session is owned by one Pi extension control channel. It is removed when `/remote-control` disables it, the TUI session shuts down, or the control channel closes. If the daemon removes it because heartbeats stopped but the same TUI process still has local remote-control state active, the TUI extension can recreate the active session by re-registering on the next heartbeat miss. Its `sessionFile` points to the Pi JSONL transcript used for HTTP transcript reads. Its `runtimeStatus` is the latest structured runtime-status snapshot reported by the owning TUI extension. Its `modelCatalog` is the latest reduced authenticated model list used for explicit remote selection. Its `treeSnapshot` is the latest TUI-reported public tree state used for remote tree UI and branch-aware transcript reads. `lastSettlementId` prevents duplicate push requests for the same settled run and is not durable beyond the active-session lifetime.

`name` is the effective public display name for API responses. `nameSource` is `"tui"` when Pi session metadata supplied a nonblank name and `"generated"` when the daemon generated an ephemeral name for an otherwise unnamed session. Generated names live only in active-session process state and are discarded with that state. A later nonblank TUI name replaces the generated name.

Public `messageCount` values are daemon-computed counts of top-level `user` and `assistant` transcript messages. Assistant messages whose `stopReason` is `"toolUse"` are included because they represent visible tool-call activity in the app. Thinking and tool-use blocks count as part of their containing assistant message, not as separate messages; top-level `toolResult`, `system`, tool execution, lifecycle, branch summary, compaction, and other non-message records are excluded. When a valid tree snapshot is available, counts and transcript pages are computed from the active branch path; before the first tree snapshot or when cached tree state is stale, they fall back to linear JSONL order.

## Runtime status

```ts
type RuntimeStatus = {
  model: null | {
    provider: string;
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
  };
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
  context: null | {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
  updatedAt: string;
};
```

`RuntimeStatus` is computed by the live TUI extension from Pi extension context. It is process state in the daemon, not durable storage. `context.tokens` and `context.percent` may be `null` when Pi reports current context usage as unknown.

## Model Catalog Snapshot

```ts
type RemoteModelSummary = {
  provider: string;
  modelId: string;
  name?: string;
  reasoning: boolean;
  contextWindow?: number;
  maxTokens?: number;
  isScoped: boolean;
};

type ModelCatalogSnapshot = {
  currentModel: RemoteModelSummary | null;
  models: RemoteModelSummary[];
  catalogVersion: string;
  generatedAt: string;
};
```

A Model Catalog Snapshot is TUI-reported process state. It contains only models currently available under Pi's configured authentication. `isScoped` preserves the TUI session's resolved model scope, while the full `models` array permits the all-model view. `catalogVersion` is an opaque content version used to reject stale selections. Model summaries exclude API keys, headers, base URLs, provider environment, auth-source details, and routing configuration.

```ts
type RemoteModelSelectResultEvent =
  | { type: "remote_model_select_result"; requestId: string; ok: true; model: RemoteModelSummary; catalogVersion: string }
  | { type: "remote_model_select_result"; requestId: string; ok: false; error: "session_busy" | "model_catalog_changed" | "model_not_found" | "model_unavailable" | "selection_failed" };
```

Runtime Status remains authoritative for the active model. A successful selection result is an action outcome, not a replacement for Runtime Status.

## Agent Settlement

```ts
type AgentSettlement = {
  settlementId: string;
  sessionId: string;
  projectId: string;
};
```

An Agent Settlement is derived only from Pi `agent_settled` after at least one agent run and after automatic retry, compaction retry, and queued continuation work has stopped. Terminal aborted and error outcomes are not completed work. `settlementId` is an idempotency key for extension-to-daemon and daemon-to-gateway delivery. Settlement is not transcript content and is separate from `agent_start`/`agent_end` working state.

## Tree snapshot

```ts
type TreeSnapshot = {
  sessionId: string;
  leafId: string | null;
  snapshotVersion: string;
  branchVersion: string;
  entries: TreeEntry[];
  defaultFilter: "default";
  filters: Array<"default" | "no-tools" | "user-only" | "labeled-only" | "all">;
  generatedAt: string;
  stale?: boolean;
};

type TreeEntry = {
  id: string;
  parentId: string | null;
  type: "message" | "custom_message" | "branch_summary" | "compaction" | "model_change" | "thinking_level_change" | "label" | "session_info" | "custom" | "other";
  role?: "user" | "assistant" | "toolResult" | "system" | "custom";
  customType?: string;
  toolName?: string;
  title: string;
  preview: string;
  previewTruncated?: boolean;
  timestamp: string;
  label?: string;
  isCurrentLeaf: boolean;
  isOnActiveBranch: boolean;
  isForkable: boolean;
  navigationBehavior: "edit_prompt" | "navigate";
};
```

`TreeSnapshot` is process state reported by the owning TUI extension. It is a full reduced tree represented as a flat `entries` array with parent links, not raw Pi session entries. `snapshotVersion` changes when full tree content changes, including labels, branch summaries, compactions, and session metadata that affects the tree display. `branchVersion` changes when the active branch position changes, including leaf changes after ordinary chat messages. Both version values are opaque strings; clients compare them for equality and must not infer ordering. `leafId` and `branchVersion` are the authority for active-branch transcript reads. A stale snapshot may be shown to iOS for display, but tree navigation, fork, and clone actions based on it are rejected until refresh.

`TreeEntry.preview` is capped to about 500 characters and marked with `previewTruncated` when clipped. Tool-result entries carry `toolName` when known so clients can label compact tool-result rows. `isOnActiveBranch` marks the root-to-`leafId` path. `isForkable` is true only for user-message entries. `navigationBehavior` is `"edit_prompt"` for user and custom-message entries that return prompt text on navigation, and `"navigate"` for entries that become the new leaf directly. Labels are projected onto their target entries; label entries may also appear as entries for clients showing all entries.

## Session snapshot

```ts
type SessionSnapshot = {
  session: ActiveSessionSummary;
  messages: TranscriptMessage[];
  olderMessagesCursor?: string;
  hasOlderMessages: boolean;
  tools: ToolCallStatus[];
  isStreaming: boolean;
  pendingMessageCount: number;
  runtimeStatus: RuntimeStatus | null;
};
```

The daemon returns a bounded recent-message snapshot for active sessions so newly connected iOS clients can render persisted state before incremental events arrive. Snapshot messages are derived from the session's Pi JSONL `sessionFile` at request time and normalized into `TranscriptMessage` values. When a valid `TreeSnapshot.leafId` is available, only message entries on the active branch path are included; before tree state is available, or when it is stale, the daemon falls back to linear JSONL order and requests a tree refresh. If the bounded primary window includes a `toolResult`, older assistant messages that declare matching `toolCall` IDs are prepended as dependency context when available. The snapshot includes the latest TUI-reported `RuntimeStatus` when available and the latest session-level `isStreaming` value derived from TUI agent lifecycle events. Older transcript history is loaded through explicit transcript page requests.

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

Transcript pages contain bounded primary message windows ordered oldest-to-newest by `createdAt` and are derived from the session's Pi JSONL `sessionFile` at request time. When a valid tree snapshot is available, pages are filtered to message entries on the active branch path and exclude abandoned branches. Branch summary and compaction entries are represented in `TreeEntry`, not as `TranscriptMessage` values. If the primary window includes `toolResult` messages, older assistant messages with matching `toolCall` IDs may be prepended as dependency context, so `messages.length` can exceed the requested page limit. Cursor values are generated from the primary page boundary, not from prepended dependency context, are daemon-encoded, and are opaque to clients. Clients merge pages and live updates by de-duplicating `TranscriptMessage.id`.

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
  | { type: "runtime_status"; status: RuntimeStatus }
  | { type: "remote_model_catalog"; requestId?: string; catalog: ModelCatalogSnapshot }
  | RemoteModelSelectResultEvent
  | { type: "remote_tree_snapshot"; requestId?: string; snapshot: TreeSnapshot }
  | RemoteCompactResultEvent
  | RemoteTreeNavigationResultEvent
  | RemoteForkResultEvent
  | RemoteCloneResultEvent
  | RemoteSessionReplacedEvent
  | { type: "session_closed" }
  | { type: "error"; error: string };

type TranscriptMessagePatch =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "toolCall"; toolCall: { type: "toolCall"; id: string; name: string; arguments: unknown } }
  | { type: "replace"; message: TranscriptMessage };

type RemoteCompactResultEvent =
  | { type: "remote_compact_result"; requestId: string; ok: true; summary: string; firstKeptEntryId: string; tokensBefore: number }
  | { type: "remote_compact_result"; requestId: string; ok: false; message: string };

type RemoteTreeNavigationResultEvent =
  | { type: "remote_tree_navigation_result"; requestId: string; ok: true; leafId: string | null; snapshotVersion: string; branchVersion: string; editorText?: string }
  | { type: "remote_tree_navigation_result"; requestId: string; ok: false; error: "session_busy" | "tree_state_changed" | "target_not_found" | "summarization_failed" | "cancelled" | "aborted"; message?: string };

type RemoteForkResultEvent =
  | { type: "remote_fork_result"; requestId: string; ok: true; newSession: ActiveSessionSummary; editorText: string }
  | { type: "remote_fork_result"; requestId: string; ok: false; error: "session_busy" | "tree_state_changed" | "target_not_found" | "target_not_forkable" | "cancelled"; message?: string };

type RemoteCloneResultEvent =
  | { type: "remote_clone_result"; requestId: string; ok: true; newSession: ActiveSessionSummary }
  | { type: "remote_clone_result"; requestId: string; ok: false; error: "session_busy" | "tree_state_changed" | "cancelled"; message?: string };

type RemoteSessionReplacedEvent = {
  type: "remote_session_replaced";
  requestId: string;
  oldSessionId: string;
  newSession: ActiveSessionSummary;
};
```

Stream events are daemon-normalized and public to iOS. They are derived from package-internal TUI Pi events, TUI-computed runtime-status snapshots, TUI-reported model and tree state, and remote-action results but do not expose raw Pi event payloads. `session_state` is sent initially and may be sent again when session-level `isStreaming` or active branch changes. `turn_start` and `turn_end` are lifecycle signals; transcript content remains represented by `TranscriptMessage` events. `runtime_status` replaces the previous runtime-status snapshot for the session. `remote_model_catalog` replaces the previous cached Model Catalog Snapshot, and model-selection results report asynchronous action outcomes. `remote_tree_snapshot` replaces the previous cached tree snapshot for the session. Package-internal `tree_state` updates are not public stream events. Remote action result events report asynchronous command outcomes and are correlated by `requestId`; they are not stored in daemon durable state. `remote_session_replaced` tells iOS to subscribe to the replacement session before the old session closes. The initial `session_state` stream event is limited to a primary window of at most 20 recent messages plus any older assistant tool-call parents required by included tool results; oversized string payloads in those messages are truncated to their first 10 KiB and marked with truncation metadata.

## TUI control channel

```ts
type TuiControlChannel = {
  sessionId: string;
  pid: number;
  status: "active" | "closing";
  lastHeartbeatAt: string;
  latestRuntimeStatus?: RuntimeStatus;
  latestModelCatalog?: ModelCatalogSnapshot;
};
```

The control channel is the daemon's route for sending remote prompt, abort, compact, model-refresh, model-selection, tree-refresh, tree-navigation, fork, and clone commands to the owning TUI extension and for receiving remote-action results and Agent Settlements. Loopback TUI control requests do not require a bearer token; non-loopback TUI control requests do.

## Tool state

`tools` is a compact snapshot of active or recent tool execution state associated by `toolCallId`. Tool-call declarations are preserved inside assistant `TranscriptMessage.content`; tool execution progress and completion are delivered on the WebSocket stream as normalized tool events.
