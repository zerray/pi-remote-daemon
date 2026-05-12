# Return remote compact results

## Title

Return remote compact results

## Status

Accepted

## Context

ADR 0021 added `/compact` as an explicit allowlisted remote action. The current request path only tells iOS that the daemon accepted the command for delivery to the owning TUI extension. It does not tell iOS whether Pi compaction eventually succeeded, what summary was produced, or why compaction failed.

Pi's extension API triggers compaction asynchronously through the live TUI context and supports completion and error callbacks.

## Decision

Return a `requestId` from `POST /v1/sessions/{sessionId}/compact` and report the asynchronous outcome on the session WebSocket as `remote_compact_result`.

The TUI extension handles `remote_compact` by calling `ctx.compact()` with completion and error callbacks. On success, it posts `{ "type": "remote_compact_result", "requestId": "...", "ok": true, "summary": "...", "firstKeptEntryId": "...", "tokensBefore": 12345 }` to the daemon. On failure, it posts `{ "type": "remote_compact_result", "requestId": "...", "ok": false, "message": "..." }`.

The daemon forwards this result to iOS WebSocket subscribers for the same session. The result is live stream state, not durable daemon state and not part of HTTP session snapshots.

## Consequences

The iOS app can correlate compact completion with the original request and show success summaries or failure messages.

Clients that need compact results must keep the session WebSocket open after the HTTP compact request is accepted.
