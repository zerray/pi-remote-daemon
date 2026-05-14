# Count public transcript messages

## Title

Count public transcript messages

## Status

Accepted

## Context

The iOS app displays the `messageCount` field returned by project-session and session-state APIs as a user-facing conversation message count. The current daemon value can come from the TUI registration payload, where it is based on Pi session entries. Pi session entries include internal/tool/system records that are not one-to-one with the public transcript messages shown in the app conversation page.

This causes the session list count to be noticeably larger than the message count users infer from the conversation page. The iOS app does not use `messageCount` for pagination, cursors, synchronization, or raw Pi-entry accounting.

## Decision

Change the daemon-owned public meaning of `messageCount` to the count of public `TranscriptMessage` values derived from the session's Pi JSONL `sessionFile`, using the same normalization path as HTTP transcript reads.

For active TUI sessions, the daemon treats `messageCount` in TUI registration as an initial hint only. Public session summaries and session-state responses use the daemon-computed public transcript count when the session file is readable. The count excludes Pi entries that do not normalize to public transcript messages.

## Consequences

The session list count matches the app's conversation-page message model instead of raw Pi session-entry counts.

Changing `messageCount` semantics is acceptable because the app only uses it for display. Clients that need raw Pi entry counts should use a separate future field rather than overloading `messageCount`.

Computing the count may require reading the session file when building session summaries. Active remote-control session counts are expected to be small enough for this to be acceptable; if needed, the daemon can cache the computed count while preserving the public semantics.
