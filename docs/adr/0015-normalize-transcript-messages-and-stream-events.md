# Normalize transcript messages and stream events

## Title

Normalize transcript messages and stream events

## Status

Accepted

## Context

HTTP transcript snapshots are derived from Pi session JSONL files, while WebSocket streams currently forward raw Pi TUI extension events. Pi session messages contain structured content blocks such as text, thinking, and tool calls. Raw stream events contain lifecycle and delta events for the same assistant messages plus tool execution events.

Keeping different public shapes for historical transcript messages and live updates forces the iOS app to maintain separate rendering paths and causes fields such as thinking and tool calls to be lost when the daemon flattens transcript history to plain text.

## Decision

The daemon-to-iOS API will use `TranscriptMessage` as the public transcript message shape for both HTTP transcript reads and WebSocket live updates.

HTTP session snapshots and transcript pages will return persisted `TranscriptMessage` values parsed from the Pi session JSONL `sessionFile`. The parser will preserve structured content blocks including text, thinking, tool calls, images, and tool-result metadata.

The WebSocket stream will not broadcast raw Pi extension events to iOS. The daemon will normalize TUI-forwarded Pi events into daemon-owned stream events that create, patch, replace, or close `TranscriptMessage` values and update tool execution state. The stream remains incremental and bounded; it does not replay unbounded history.

The Pi extension may continue to send raw Pi events to the daemon over the package-internal TUI control interface. Raw Pi event shapes are not part of the public iOS API.

## Consequences

The iOS app renders historical transcript pages and live updates with one transcript model.

Thinking and tool-call content are preserved in HTTP snapshots, HTTP pages, and live stream updates.

The daemon owns the compatibility boundary between Pi event formats and the public iOS protocol.

The WebSocket protocol changes incompatibly for clients that consume raw Pi events.
