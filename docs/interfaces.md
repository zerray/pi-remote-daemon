# Interfaces

## iOS app ↔ daemon

Remote endpoints require `Authorization: Bearer <device-token>` unless explicitly noted. Request and response bodies are JSON. Session streaming uses WebSocket JSON messages.

### Pairing

Pair-code creation is not available through the remote iOS API. Codes are created only from the Pi TUI with `/remote-control-pair`.

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

`POST /v1/projects/{projectId}/sessions` is not part of the MVP. New sessions are created in the Pi TUI, then made visible by running `/remote-control`.

`GET /v1/sessions/{sessionId}`

Returns the daemon's current snapshot for an active remote-control TUI session.

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

Server messages:

```json
{ "type": "session_state", "session": { "id": "sess_..." }, "isStreaming": false }
{ "type": "message_upsert", "message": { "id": "msg_...", "role": "user", "text": "..." } }
{ "type": "assistant_delta", "messageId": "msg_...", "text": "Hello" }
{ "type": "tool_status", "toolCallId": "call_...", "name": "bash", "status": "running", "summary": "ls -la" }
{ "type": "tool_status", "toolCallId": "call_...", "name": "bash", "status": "succeeded" }
{ "type": "queue_update", "pendingMessageCount": 1 }
{ "type": "agent_done" }
{ "type": "session_closed" }
{ "type": "error", "message": "..." }
```

## Pi TUI extension ↔ daemon

The TUI control interface is package-internal and used by the Pi extension, not by iOS clients. It may be HTTP or WebSocket internally, but the logical messages are:

### Pair code creation

`/remote-control-pair` asks the daemon to create one short-lived pair code and displays it in the TUI.

Response payload:

```json
{
  "pairCode": "123456",
  "expiresAt": "2026-05-09T09:52:00.000Z"
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

While active, the extension forwards normalized Pi events:

```json
{ "type": "session_state", "session": { "id": "sess_..." }, "isStreaming": false }
{ "type": "message_upsert", "message": { "id": "msg_...", "role": "assistant", "text": "..." } }
{ "type": "assistant_delta", "messageId": "msg_...", "text": "..." }
{ "type": "tool_status", "toolCallId": "call_...", "name": "bash", "status": "running" }
{ "type": "queue_update", "pendingMessageCount": 0 }
{ "type": "agent_done" }
{ "type": "unregister_session" }
```

### Daemon-to-TUI commands

The daemon forwards iOS requests to the owning TUI extension:

```json
{ "type": "remote_prompt", "requestId": "req_...", "text": "...", "streamingBehavior": null }
{ "type": "remote_abort", "requestId": "req_..." }
```

The extension acknowledges each command:

```json
{ "type": "command_ack", "requestId": "req_...", "accepted": true }
{ "type": "command_ack", "requestId": "req_...", "accepted": false, "error": "not_idle" }
```

## Pi integration boundary

The daemon keeps Pi-specific event normalization inside the package. Pi SDK/RPC is not used by the daemon to operate sessions in the MVP; those calls are made by the live TUI process through the extension API.

| Action | Owner |
| --- | --- |
| Create pair code | TUI command `/remote-control-pair` asks daemon locally. |
| Enable remote visibility | TUI command `/remote-control`. |
| List remote sessions | Daemon active TUI session registry. |
| Prompt | iOS → daemon → owning TUI extension → Pi extension API. |
| Abort | iOS → daemon → owning TUI extension → Pi extension API. |
| Stream assistant text | Pi event → TUI extension → daemon → iOS WebSocket. |
| Stream tool status | Pi event → TUI extension → daemon → iOS WebSocket. |
