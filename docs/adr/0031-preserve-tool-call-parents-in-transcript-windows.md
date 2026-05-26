# Preserve tool-call parents in transcript windows

## Title

Preserve tool-call parents in transcript windows

## Status

Accepted

## Context

Pi persists assistant tool calls as `assistant` transcript messages containing `toolCall` content blocks. Tool results are later persisted as separate `toolResult` messages whose `toolCallId` points back to one of those assistant content blocks.

Bounded session snapshots and initial WebSocket `session_state` payloads select only the most recent transcript messages. A boundary can fall between an assistant tool-call message and its later tool results. When that happens, the snapshot contains `toolResult` messages but not the assistant message that declares their `toolCall` IDs. The iOS app cannot match those tool results to their originating tool uses, and reconnecting or refreshing the session cannot repair the mismatch because the persisted snapshot is itself missing the parent call.

## Decision

Transcript windows and transcript pages must preserve tool-use referential integrity. If a bounded page includes a `toolResult`, the page must also include the nearest persisted assistant message that contains a `toolCall` block with the same ID when that assistant message exists in the transcript.

The requested page limit applies to the primary chronological page slice. Additional assistant tool-call parent messages may be prepended as dependency context, so a response can contain more than the requested limit. Pagination cursors continue to refer to the primary page boundary rather than to prepended dependency context.

The daemon does not synthesize missing tool calls. If the transcript file does not contain an assistant `toolCall` block for a `toolResult.toolCallId`, the result remains unmatched.

## Consequences

Reconnect snapshots and refresh reads contain enough information for iOS to match included tool results to their originating tool calls.

Initial WebSocket `session_state` remains bounded by a small primary slice but may include a few older assistant messages as dependency context.

Older-page reads may duplicate a prepended parent assistant message that was also returned as dependency context in a newer page. Clients should continue de-duplicating transcript messages by canonical `id`.
