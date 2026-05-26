# Track active agent streaming state

## Title

Track active agent streaming state

## Status

Accepted

## Context

The daemon exposes `isStreaming` in session snapshots so iOS can show working state and enable abort controls. The active-session registry originally received this value only at TUI session registration time. During a long-running agent turn, reconnecting iOS clients could receive a fresh `session_state` whose `isStreaming` value was stale, commonly `false`, even though the TUI agent was still working.

Pi emits `agent_start` and `agent_end` extension events around the full agent lifecycle. These events are package-internal control signals and are more appropriate for session-level working state than persisted transcript messages, which are always non-streaming after they are read from the JSONL session file.

## Decision

The daemon updates active-session `isStreaming` from TUI `agent_start` and `agent_end` events. `agent_start` sets `isStreaming` to `true`; `agent_end` sets it to `false`.

When this state changes, the daemon broadcasts a bounded `session_state` update to current WebSocket subscribers. New WebSocket subscribers and HTTP session snapshot reads observe the latest active-session `isStreaming` value.

The daemon continues not to expose raw `agent_start` or `agent_end` events as public transcript stream events.

## Consequences

Reconnects during an active agent run preserve working state and abort affordances in iOS.

Persisted transcript messages can remain `isStreaming: false` without resetting session-level working state.

WebSocket clients may receive more than one `session_state` event for a subscription: the initial snapshot and later bounded state refreshes when session-level activity changes.
