# Interfaces

## iOS app ↔ daemon

Remote endpoints require `Authorization: Bearer <device-token>` unless explicitly noted. Request and response bodies are JSON. Session streaming uses WebSocket JSON messages.

### Pairing

Pair-code creation is not available through the remote iOS API. Codes are created only from the Pi TUI with `/remote-control-pair`.

`/remote-control-pair` displays a QR code for a pairing link:

```text
pi-remote://pair?baseUrl=https%3A%2F%2Fmacbook.tailnet.ts.net%3A17373&code=123456&expiresAt=2026-05-09T09%3A52%3A00.000Z
```

The TUI also displays the base URL and numeric pair code as text fallback. `baseUrl` comes from daemon config `advertisedBaseUrl` and must be reachable from iOS.

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
  "daemonVersion": "0.1.0"
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

`POST /v1/projects/{projectId}/sessions` returns `405 method_not_allowed`. New sessions are created in the Pi TUI, then made visible by running `/remote-control`.

`GET /v1/sessions/{sessionId}?messageLimit={limit}`

Returns the daemon's current state for an active remote-control TUI session with a bounded recent transcript window. If `messageLimit` is absent, the daemon uses its default recent-message limit. The daemon enforces a maximum page size. Invalid non-positive limits return `400` with `invalid_limit`.

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
      "text": "Recent answer text",
      "createdAt": "2026-05-09T09:47:00.000Z",
      "toolCallId": null,
      "isStreaming": false
    }
  ],
  "olderMessagesCursor": "opaque-cursor-or-null",
  "hasOlderMessages": true,
  "tools": [],
  "isStreaming": false,
  "pendingMessageCount": 0
}
```

`messages` are ordered oldest-to-newest within the returned window. `olderMessagesCursor` is `null` when there are no older messages.

`GET /v1/sessions/{sessionId}/messages?before={cursor}&limit={limit}`

Returns the next older transcript page before `cursor`. The `before` value must be a cursor previously returned by the daemon. Invalid cursors return `400` with `invalid_cursor`. Invalid non-positive limits return `400` with `invalid_limit`.

Response:

```json
{
  "messages": [
    {
      "id": "msg_older",
      "role": "user",
      "text": "Older prompt text",
      "createdAt": "2026-05-09T09:30:00.000Z",
      "toolCallId": null,
      "isStreaming": false
    }
  ],
  "olderMessagesCursor": "next-older-cursor-or-null",
  "hasOlderMessages": true
}
```

`messages` are ordered oldest-to-newest within the returned page so the app can prepend the page while preserving transcript order.

`POST /v1/sessions/{sessionId}/prompt`

Forwards a prompt to the TUI extension that owns the active session.

Request:

```json
{
  "text": "请解释这个项目结构",
  "streamingBehavior": null
}
```

`streamingBehavior` is `null`, `"steer"`, or `"followUp"`.

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

### Session stream

`GET /v1/sessions/{sessionId}/stream` upgrades to WebSocket.

Server messages include bounded initial `session_state`, raw Pi TUI extension events while the session is active, `session_closed`, and errors. The stream must not send full historical transcript payloads. Full or older history is loaded only through the HTTP session snapshot and transcript-page endpoints.

## Pi TUI extension ↔ daemon

The TUI control interface is package-internal and used by the Pi extension, not by iOS clients. Loopback TUI requests are accepted without a bearer token; non-loopback callers must provide a valid bearer token. The extension normally calls `127.0.0.1:<configured-port>` even when iOS uses `advertisedBaseUrl` over Tailscale.

### Pair code creation

`/remote-control-pair` asks the daemon to create one short-lived pair code and displays it in the TUI as a QR code plus text fallback.

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

When `/remote-control` enables a session, the extension registers the current TUI session:

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
    "isStreaming": false
  }
}
```

### TUI-to-daemon events

While active, the extension forwards raw Pi extension events. The daemon broadcasts them to iOS WebSocket subscribers without normalization in the current MVP:

```json
{ "type": "message_start", "message": { "id": "msg_...", "role": "user" } }
{ "type": "message_update", "message": { "id": "msg_..." }, "assistantMessageEvent": { "type": "text_delta", "text": "..." } }
{ "type": "message_end", "message": { "id": "msg_...", "role": "assistant" } }
{ "type": "tool_execution_start", "toolCallId": "call_...", "toolName": "bash", "args": {} }
{ "type": "tool_execution_update", "toolCallId": "call_...", "toolName": "bash", "partialResult": {} }
{ "type": "tool_execution_end", "toolCallId": "call_...", "toolName": "bash", "isError": false }
{ "type": "agent_start" }
{ "type": "agent_end", "messages": [] }
```

### Daemon-to-TUI commands

The daemon forwards iOS requests to the owning TUI extension:

```json
{ "type": "remote_prompt", "requestId": "req_...", "text": "...", "streamingBehavior": null }
{ "type": "remote_abort", "requestId": "req_..." }
```

Command acknowledgements are not part of the current MVP protocol.

## Pi integration boundary

The daemon keeps Pi-specific transport details inside the package. Pi SDK/RPC is not used by the daemon to operate sessions in the MVP; those calls are made by the live TUI process through the extension API.

| Action | Owner |
| --- | --- |
| Create pair code | TUI command `/remote-control-pair` asks daemon locally. |
| Enable remote visibility | TUI command `/remote-control`. |
| List remote sessions | Daemon active TUI session registry. |
| Prompt | iOS → daemon → owning TUI extension → Pi extension API. |
| Abort | iOS → daemon → owning TUI extension → Pi extension API. |
| Stream events | Raw Pi event → TUI extension → daemon → iOS WebSocket. |
