# Interfaces

## iOS app ↔ daemon

Remote endpoints require `Authorization: Bearer <device-token>` unless explicitly noted. Request and response bodies are JSON. Session streaming uses WebSocket JSON messages.

### Pairing

Pair-code creation is not available through the remote iOS API. Codes are created only from the Pi TUI with `/remote-control-pair`.

`/remote-control-pair` displays a QR code that encodes a pairing link and prints the expiration time. The numeric pair code and raw pairing link are not printed as separate TUI text lines. `baseUrl` comes from daemon config `advertisedBaseUrl` and must be reachable from iOS.

`POST /v1/pair/claim` is unauthenticated because the short-lived pair code is the bootstrap proof.

Request:

```json
{
  "pairCode": "123456",
  "deviceName": "Zerray iPhone"
}
```

Response:

```json
{
  "deviceId": "dev_...",
  "token": "...",
  "daemonName": "macbook-pro"
}
```

### Health

`GET /v1/health`

Response:

```json
{
  "status": "ok",
  "daemonVersion": "1.0.0"
}
```

### Projects

`GET /v1/projects`

Returns projects derived from active TUI sessions that enabled remote control.

Response:

```json
{
  "projects": [
    {
      "id": "proj_...",
      "name": "pi-ios",
      "path": "/Users/zerray/gitclone/pi-ios"
    }
  ]
}
```

### Sessions

`GET /v1/projects/{projectId}/sessions`

Returns only active remote-control TUI sessions for the project.

Response:

```json
{
  "sessions": [
    {
      "id": "sess_...",
      "piSessionId": "019e0a73-...",
      "projectId": "proj_...",
      "name": "Refactor auth module",
      "path": "/Users/zerray/.pi/agent/sessions/...jsonl",
      "updatedAt": "2026-05-09T09:47:00.000Z",
      "messageCount": 42,
      "isActive": true
    }
  ]
}
```

`messageCount` is the daemon-computed count of top-level `user` and `assistant` transcript messages derived from the session file. Assistant messages whose `stopReason` is `"toolUse"` are included, because the app can show tool-call activity and details. Assistant thinking and tool-use blocks are content within an assistant message and do not increment the count separately. Top-level `toolResult`, `system`, internal tool execution, lifecycle, and other non-message records are excluded.

`POST /v1/projects/{projectId}/sessions` returns `405 method_not_allowed`. New sessions are created in the Pi TUI, then made visible by running `/remote-control`.

`GET /v1/sessions/{sessionId}?messageLimit={limit}`

Returns the daemon's current state for an active remote-control TUI session with a bounded recent transcript window read from the session's Pi JSONL `sessionFile`. `session.messageCount` uses the transcript message count semantics described above. If `messageLimit` is absent, the daemon uses its default recent-message limit. The daemon enforces a maximum page size. Invalid non-positive limits return `400` with `invalid_limit`.

Response:

```json
{
  "session": {
    "id": "sess_...",
    "piSessionId": "019e0a73-...",
    "projectId": "proj_...",
    "name": "Refactor auth module",
    "path": "/Users/zerray/.pi/agent/sessions/...jsonl",
    "updatedAt": "2026-05-09T09:47:00.000Z",
    "messageCount": 4200,
    "isActive": true
  },
  "messages": [
    {
      "id": "msg_...",
      "role": "assistant",
      "content": [
        { "type": "thinking", "thinking": "Checking the project structure..." },
        { "type": "toolCall", "id": "call_...", "name": "bash", "arguments": { "command": "ls" } },
        { "type": "text", "text": "Recent answer text" }
      ],
      "text": "Recent answer text",
      "createdAt": "2026-05-09T09:47:00.000Z",
      "isStreaming": false
    }
  ],
  "olderMessagesCursor": "opaque-cursor-or-null",
  "hasOlderMessages": true,
  "tools": [],
  "isStreaming": false,
  "pendingMessageCount": 0,
  "runtimeStatus": {
    "model": {
      "provider": "anthropic",
      "id": "claude-sonnet-4-5",
      "name": "Claude Sonnet 4.5",
      "contextWindow": 200000,
      "maxTokens": 8192,
      "reasoning": true
    },
    "thinkingLevel": "medium",
    "usage": {
      "input": 12000,
      "output": 3000,
      "cacheRead": 50000,
      "cacheWrite": 10000,
      "cost": { "input": 0.036, "output": 0.045, "cacheRead": 0.015, "cacheWrite": 0.0375, "total": 0.1335 }
    },
    "context": { "tokens": 65000, "contextWindow": 200000, "percent": 32.5 },
    "updatedAt": "2026-05-09T09:47:00.000Z"
  }
}
```

`messages` are ordered oldest-to-newest within the returned window and represent transcript data persisted in the Pi session file at request time. Each item uses the same `TranscriptMessage` shape as live stream message events. `olderMessagesCursor` is `null` when there are no older messages. When present, the cursor is generated from the oldest returned message's `createdAt` timestamp. The cursor is encoded by the daemon and treated as opaque by clients.

`GET /v1/sessions/{sessionId}/messages?before={cursor}&limit={limit}`

Returns the next older transcript page from the session's Pi JSONL `sessionFile` before `cursor`. The `before` value must be a cursor previously returned by the daemon. It represents an exclusive timestamp upper bound, so returned messages satisfy `createdAt < cursor.createdAt`. Invalid cursors return `400` with `invalid_cursor`. Invalid non-positive limits return `400` with `invalid_limit`.

Response:

```json
{
  "messages": [
    {
      "id": "msg_older",
      "role": "user",
      "content": [{ "type": "text", "text": "Older prompt text" }],
      "text": "Older prompt text",
      "createdAt": "2026-05-09T09:30:00.000Z",
      "isStreaming": false
    }
  ],
  "olderMessagesCursor": "next-older-cursor-or-null",
  "hasOlderMessages": true
}
```

`messages` are ordered oldest-to-newest within the returned page so the app can prepend the page while preserving transcript order. The daemon must not include duplicate message IDs within a single response. Pi Relay must still de-duplicate merged pages and live stream updates by message `id` because page requests and live events can overlap.

Public transcript messages use this shape:

```ts
type TranscriptMessage = {
  id: string;
  role: "user" | "assistant" | "toolResult" | "system";
  content: Array<
    | { type: "text"; text: string; truncated?: boolean; originalBytes?: number }
    | { type: "thinking"; thinking: string; truncated?: boolean; originalBytes?: number }
    | { type: "toolCall"; id: string; name: string; arguments: unknown; argumentsTruncated?: boolean; argumentsOriginalBytes?: number }
    | { type: "image"; data: string; mimeType: string; truncated?: boolean; originalBytes?: number }
  >;
  text: string;
  textTruncated?: boolean;
  textOriginalBytes?: number;
  createdAt: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  isStreaming: boolean;
};
```

`content` preserves Pi message blocks. `text` is a simple display summary. Tool-result messages include `toolCallId`, `toolName`, and `isError` when available. Truncation metadata is present only when the daemon intentionally sends a preview.

Runtime status snapshots use this shape and may be `null` when the TUI extension has not reported one yet:

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

`POST /v1/sessions/{sessionId}/prompt`

Forwards a prompt to the TUI extension that owns the active session.

Request:

```json
{
  "text": "请解释这个项目结构",
  "streamingBehavior": null
}
```

`streamingBehavior` is `null`, `"steer"`, or `"followUp"`. `null` sends immediately when the TUI is idle; if the TUI is already busy, the extension delivers it as `"followUp"` so Pi does not reject the remote prompt for missing streaming delivery mode.

Response:

```json
{
  "accepted": true
}
```

If the session has no active TUI owner, the daemon returns `409`:

```json
{
  "error": "session_not_active"
}
```

`POST /v1/sessions/{sessionId}/abort`

Forwards abort to the TUI extension that owns the active session.

Response:

```json
{
  "aborted": true
}
```

`POST /v1/sessions/{sessionId}/compact`

Forwards a compact request to the TUI extension that owns the active session. This is the remote-control equivalent of running `/compact` in the Pi TUI. It is an explicit allowlisted action, not generic slash-command passthrough. The HTTP response only confirms that the daemon accepted the command for delivery; the asynchronous compaction outcome is reported later on the session WebSocket as `remote_compact_result`.

Response:

```json
{
  "accepted": true,
  "requestId": "req_..."
}
```

If the session has no active TUI owner, the daemon returns `409`:

```json
{
  "error": "session_not_active"
}
```

### Session stream

`GET /v1/sessions/{sessionId}/stream` upgrades to WebSocket.

Server messages are daemon-normalized transcript stream events. The stream sends a bounded initial `session_state`, turn lifecycle events, live `TranscriptMessage` lifecycle events, normalized tool execution events, `runtime_status`, `remote_compact_result`, `session_closed`, and errors. It must not send raw Pi TUI extension events or full historical transcript payloads. Full or older persisted history is loaded only through the HTTP session snapshot and transcript-page endpoints. In-progress events that are not yet persisted may be visible only on the stream.

The initial `session_state` contains at most 20 recent messages regardless of the HTTP transcript default. Before the initial `session_state` is sent, oversized string payloads inside those messages are truncated to their first 10 KiB of UTF-8 data and marked with truncation metadata. This preview truncation applies to initial WebSocket state only; HTTP transcript endpoints keep their requested transcript windows, and live incremental events are not changed by this rule.

Initial state:

```json
{
  "type": "session_state",
  "state": {
    "session": { "id": "sess_...", "isActive": true },
    "messages": [
      {
        "id": "msg_...",
        "role": "toolResult",
        "content": [{ "type": "text", "text": "first 10 KiB preview...", "truncated": true, "originalBytes": 1048576 }],
        "text": "first 10 KiB preview...",
        "textTruncated": true,
        "textOriginalBytes": 1048576,
        "createdAt": "2026-05-09T09:47:00.000Z",
        "toolCallId": "call_...",
        "toolName": "bash",
        "isStreaming": false
      }
    ],
    "olderMessagesCursor": null,
    "hasOlderMessages": false,
    "tools": [],
    "isStreaming": false,
    "pendingMessageCount": 0,
    "runtimeStatus": null
  }
}
```

Turn lifecycle events:

```json
{ "type": "turn_start", "turnIndex": 0, "createdAt": "2026-05-09T09:47:00.000Z" }
{ "type": "turn_end", "turnIndex": 0 }
```

`turn_start` marks an active model/tool turn. `turn_end` marks that the turn is complete. Transcript content is still delivered through message and tool events.

Message lifecycle events. `transcript_message_start` is emitted for assistant streaming messages; non-streaming user messages are emitted once as `transcript_message_end` to avoid duplicate client display.

```json
{ "type": "transcript_message_start", "message": { "id": "msg_...", "role": "assistant", "content": [], "text": "", "createdAt": "2026-05-09T09:47:00.000Z", "isStreaming": true } }
{ "type": "transcript_message_patch", "messageId": "msg_...", "contentIndex": 0, "patch": { "type": "thinking_delta", "delta": "Checking..." } }
{ "type": "transcript_message_patch", "messageId": "msg_...", "contentIndex": 1, "patch": { "type": "toolCall", "toolCall": { "type": "toolCall", "id": "call_...", "name": "bash", "arguments": { "command": "ls" } } } }
{ "type": "transcript_message_patch", "messageId": "msg_...", "contentIndex": 2, "patch": { "type": "text_delta", "delta": "Done." } }
{ "type": "transcript_message_end", "message": { "id": "msg_...", "role": "assistant", "content": [{ "type": "text", "text": "Done." }], "text": "Done.", "createdAt": "2026-05-09T09:47:02.000Z", "isStreaming": false } }
```

Tool execution events:

```json
{ "type": "tool_execution_start", "toolCallId": "call_...", "toolName": "bash", "args": { "command": "ls" } }
{ "type": "tool_execution_update", "toolCallId": "call_...", "toolName": "bash", "partialResult": { "content": [{ "type": "text", "text": "partial output" }] } }
{ "type": "tool_execution_end", "toolCallId": "call_...", "toolName": "bash", "result": { "content": [{ "type": "text", "text": "final output" }] }, "isError": false }
```

Runtime status events:

```json
{ "type": "runtime_status", "status": { "model": { "provider": "anthropic", "id": "claude-sonnet-4-5", "contextWindow": 200000 }, "thinkingLevel": "medium", "usage": { "input": 12000, "output": 3000, "cacheRead": 50000, "cacheWrite": 10000, "cost": { "input": 0.036, "output": 0.045, "cacheRead": 0.015, "cacheWrite": 0.0375, "total": 0.1335 } }, "context": { "tokens": 65000, "contextWindow": 200000, "percent": 32.5 }, "updatedAt": "2026-05-09T09:47:00.000Z" } }
```

The daemon sends `runtime_status` when the owning TUI extension reports a changed runtime-status snapshot. Clients should treat the event as replacing the previous runtime status for that session.

Remote compact result events:

```json
{ "type": "remote_compact_result", "requestId": "req_...", "ok": true, "summary": "Conversation summary...", "firstKeptEntryId": "entry_...", "tokensBefore": 12345 }
{ "type": "remote_compact_result", "requestId": "req_...", "ok": false, "message": "Compaction failed: ..." }
```

The daemon sends `remote_compact_result` when the owning TUI extension reports completion or failure for a prior `remote_compact` command. Clients correlate the result with the `requestId` returned by `POST /v1/sessions/{sessionId}/compact`. Compact results are live stream events and are not included in HTTP session snapshots.

## Pi TUI extension ↔ daemon

The TUI control interface is package-internal and used by the Pi extension, not by iOS clients. Loopback TUI requests are accepted without a bearer token; non-loopback callers must provide a valid bearer token. The extension normally calls `127.0.0.1:<configured-port>` even when iOS uses `advertisedBaseUrl` over Tailscale.

### Pair code creation

`/remote-control-pair` asks the daemon to create one short-lived pair code and displays it in the TUI as a QR code plus expiration time.

Response payload:

```json
{
  "pairCode": "123456",
  "expiresAt": "2026-05-09T09:52:00.000Z",
  "advertisedBaseUrl": "https://macbook.tailnet.ts.net:17373",
  "pairingLink": "pi-remote://pair?baseUrl=https%3A%2F%2Fmacbook.tailnet.ts.net%3A17373&code=123456&expiresAt=2026-05-09T09%3A52%3A00.000Z"
}
```

### Session registration

When `/remote-control` enables a session, the extension registers the current TUI session. The registration `messageCount` is an initial hint from the TUI; public HTTP responses use daemon-computed transcript message counts from `sessionFile` when available:

```json
{
  "type": "register_session",
  "session": {
    "id": "sess_...",
    "piSessionId": "019e0a73-...",
    "sessionFile": "/Users/zerray/.pi/agent/sessions/...jsonl",
    "name": "Refactor auth module",
    "project": {
      "id": "proj_...",
      "name": "pi-ios",
      "path": "/Users/zerray/gitclone/pi-ios"
    },
    "pid": 12345,
    "messageCount": 42,
    "isStreaming": false,
    "runtimeStatus": {
      "model": { "provider": "anthropic", "id": "claude-sonnet-4-5", "contextWindow": 200000 },
      "thinkingLevel": "medium",
      "usage": { "input": 12000, "output": 3000, "cacheRead": 50000, "cacheWrite": 10000, "cost": { "input": 0.036, "output": 0.045, "cacheRead": 0.015, "cacheWrite": 0.0375, "total": 0.1335 } },
      "context": { "tokens": 65000, "contextWindow": 200000, "percent": 32.5 },
      "updatedAt": "2026-05-09T09:47:00.000Z"
    }
  }
}
```

`GET /v1/tui/sessions/{sessionId}/commands` also acts as the TUI heartbeat while remote control is active. The daemon removes active-session registrations when the owning TUI PID exits or when heartbeats stop, then broadcasts `session_closed` to iOS subscribers. If this heartbeat returns `404 { "error": "session_not_found" }` while the TUI extension still has local remote-control state active, the extension re-registers the current session by posting the same registration payload to `/v1/tui/sessions`. If re-registration fails, the extension clears local active state and notifies the user. Entering or resuming a TUI session does not automatically enable remote control; the user must run `/remote-control` each time.

### TUI-to-daemon events

While active, the extension forwards Pi extension events and runtime-status snapshots to the daemon over the package-internal control interface. Raw Pi event payloads are internal inputs only. The daemon normalizes them before sending any WebSocket messages to iOS.

Accepted internal event kinds include turn lifecycle, message lifecycle, assistant message updates, tool execution lifecycle, agent lifecycle, queue, status, and session lifecycle events emitted or computed by the Pi extension. Runtime-status snapshots are posted as `{ "type": "runtime_status", "status": RuntimeStatus }`; the daemon stores the snapshot and broadcasts the public `runtime_status` WebSocket event when it changes. Remote compact results are posted as `{ "type": "remote_compact_result", "requestId": "req_...", "ok": true, "summary": "...", "firstKeptEntryId": "entry_...", "tokensBefore": 12345 }` or `{ "type": "remote_compact_result", "requestId": "req_...", "ok": false, "message": "..." }`; the daemon broadcasts the public `remote_compact_result` WebSocket event without storing it durably.

### Daemon-to-TUI commands

The daemon forwards iOS requests to the owning TUI extension:

```json
{ "type": "remote_prompt", "requestId": "req_...", "text": "...", "streamingBehavior": null }
{ "type": "remote_abort", "requestId": "req_..." }
{ "type": "remote_compact", "requestId": "req_..." }
```

Prompt and abort command acknowledgements are not part of the current MVP protocol. Compact completion is reported asynchronously through `remote_compact_result`.

## Pi integration boundary

The daemon keeps Pi-specific transport details inside the package. Pi SDK/RPC is not used by the daemon to operate sessions in the MVP; those calls are made by the live TUI process through the extension API.

| Action | Owner |
| --- | --- |
| Create pair code | TUI command `/remote-control-pair` asks daemon locally. |
| Enable remote visibility | TUI command `/remote-control`. |
| List remote sessions | Daemon active TUI session registry. |
| Prompt | iOS → daemon → owning TUI extension → Pi extension API. |
| Abort | iOS → daemon → owning TUI extension → Pi extension API. |
| Compact | iOS → daemon → owning TUI extension → Pi extension API `ctx.compact()` → TUI-reported `remote_compact_result` → iOS WebSocket. |
| Stream events | Raw Pi event/status snapshot or remote-action result → TUI extension → daemon normalization/storage/forwarding → iOS WebSocket normalized transcript, status, or result event. |
