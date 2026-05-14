# Count assistant tool-use messages

## Title

Count assistant tool-use messages

## Status

Accepted

## Context

ADR 0024 narrowed `messageCount` from raw Pi session-entry count toward the app's conversation display. A real session showed `messageCount` of 79, composed of 6 user messages plus 73 assistant messages. Of those assistant messages, 67 had `stopReason: "toolUse"` and represented assistant tool-call steps; excluding them would produce 12 messages.

The iOS app also shows tool-call activity and can display tool-call details, so counting assistant tool-use messages in the session-list count is acceptable.

## Decision

Keep `messageCount` as the count of top-level public transcript messages whose role is `user` or `assistant`, including assistant messages whose `stopReason` is `"toolUse"`.

Do not count top-level `toolResult`, `system`, tool execution, lifecycle, or other non-message records. Tool-call details remain associated with assistant/tool events in the transcript UI.

This ADR supersedes ADR 0024 only for whether assistant tool-use messages are included.

## Consequences

The session-list count can be larger than a manually counted user/final-answer exchange count because assistant tool-use steps are included.

The count remains useful as an activity-oriented transcript message count and aligns with the app's ability to display tool-call details.
