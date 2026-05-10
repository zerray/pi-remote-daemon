# Read transcripts from session files

## Title

Read transcripts from session files

## Status

Accepted

## Context

The daemon currently keeps active-session process state and can derive transcript messages from the TUI registration payload. That makes HTTP session snapshots depend on daemon memory that can become stale after new TUI messages arrive.

Pi session JSONL files are already the persisted source of truth for transcript history. Maintaining a second full transcript projection in the daemon duplicates Pi's state and requires event-specific update logic for message starts, deltas, ends, and tool output.

## Decision

The daemon will read transcript history from the active session's `sessionFile` when serving HTTP session snapshots and transcript pages.

The active session registry will store control metadata, ownership, heartbeat state, command queues, compact live state, and the `sessionFile` path. It will not be the source of truth for completed transcript history.

`GET /v1/sessions/{sessionId}` and `GET /v1/sessions/{sessionId}/messages` will derive their bounded message windows from the Pi session JSONL file at request time. The WebSocket stream remains the live incremental channel for in-progress events; HTTP transcript reads represent persisted transcript state from the session file.

## Consequences

HTTP snapshots and older pages reflect the latest transcript data that Pi has persisted to disk, even after daemon restarts or after messages arrive following remote-control activation.

The daemon avoids maintaining a duplicate full transcript state machine in memory.

In-progress streaming deltas that Pi has not yet persisted may only be visible through WebSocket live events until the session file is updated.

Long transcript reads must remain bounded by the API's `messageLimit` and page `limit` contracts.
