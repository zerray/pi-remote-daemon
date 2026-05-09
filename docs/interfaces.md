# Interfaces

## iOS app ↔ daemon

All endpoints require `Authorization: Bearer <device-token>` except pairing endpoints. Request and response bodies are JSON. Streaming uses WebSocket JSON messages.

### Pairing

`POST /v1/pair/claim`

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
  "piVersion": "0.74.0",
  "daemonVersion": "0.1.0"
}
```

### Projects

`GET /v1/projects`

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
      "messageCount": 42
    }
  ]
}
```

`POST /v1/projects/{projectId}/sessions`

Creates a new Pi session for a project.

Response:

```json
{
  "session": {
    "id": "sess_...",
    "piSessionId": "019e0a73-...",
    "projectId": "proj_...",
    "name": null,
    "path": "/Users/zerray/.pi/agent/sessions/...jsonl",
    "updatedAt": "2026-05-09T09:47:00.000Z",
    "messageCount": 0
  }
}
```

`GET /v1/sessions/{sessionId}`

Returns current session state and transcript snapshot.

`POST /v1/sessions/{sessionId}/prompt`

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

`POST /v1/sessions/{sessionId}/abort`

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
{ "type": "assistant_delta", "messageId": "msg_...", "text": "Hello" }
{ "type": "tool_status", "toolCallId": "call_...", "name": "bash", "status": "running", "summary": "ls -la" }
{ "type": "tool_status", "toolCallId": "call_...", "name": "bash", "status": "succeeded" }
{ "type": "agent_done" }
{ "type": "error", "message": "..." }
```

## Daemon ↔ Pi

The daemon keeps Pi-specific protocols internal.

| Daemon action | Pi RPC / SDK call |
| --- | --- |
| List sessions | SDK `SessionManager.list(cwd)` / `SessionManager.listAll(...)`. |
| Open session | RPC `switch_session` or SDK `runtime.switchSession(path)`. |
| New session | RPC `new_session` or SDK `runtime.newSession()`. |
| Fetch state | RPC `get_state`, `get_messages`, `get_session_stats`. |
| Prompt | RPC `prompt` with optional `streamingBehavior`. |
| Abort | RPC `abort` or SDK `session.abort()`. |
| Stream assistant text | `message_update.assistantMessageEvent.type == "text_delta"`. |
| Stream tool status | `tool_execution_start/update/end`; correlate by `toolCallId`. |
| Set display name | RPC `set_session_name`. |

Pi RPC framing is strict LF-delimited JSONL. The daemon must split only on `\n`, strip optional trailing `\r`, and keep request `id` fields for response correlation.
