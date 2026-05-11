# Bound initial WebSocket session state

## Title

Bound initial WebSocket session state

## Status

Accepted

## Context

The WebSocket stream sends an initial `session_state` event when an iOS client subscribes to a session. That state currently follows the transcript page default and can contain many `TranscriptMessage` values. After transcript normalization, a single message can include large structured payloads such as `write.arguments.content`, `edit.arguments.edits[].oldText`, `edit.arguments.edits[].newText`, or large tool-result text.

Large initial WebSocket messages can exceed iOS WebSocket message limits and fail with `NSPOSIXErrorDomain Code=40 "Message too long"`. The immediate observed failure is the initial `session_state`, not live incremental events.

## Decision

The daemon will bound only the initial WebSocket `session_state` payload for now.

When a WebSocket subscriber connects, the daemon will request at most 20 recent transcript messages for the initial `session_state`. HTTP session snapshots and explicit transcript-page endpoints keep their existing requested-limit behavior.

Before sending the initial WebSocket `session_state`, the daemon will truncate oversized string payloads inside transcript messages to their first 10 KiB of UTF-8 data. Truncated fields will be marked so clients can display that the value is a preview. The daemon will not add a generic WebSocket bounded sender in this decision, and live incremental stream events are not changed by this decision.

## Consequences

Initial WebSocket subscription is less likely to exceed iOS message-size limits while still giving the app recent context.

Clients that need older or fuller transcript data should load it through HTTP session snapshot and transcript-page endpoints.

Large live events may still need a later protocol decision if they exceed client limits.
