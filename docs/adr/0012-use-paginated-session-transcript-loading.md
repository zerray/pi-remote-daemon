# Use paginated session transcript loading

## Title

Use paginated session transcript loading

## Status

Proposed

## Context

Pi session histories can be long. Sending the full transcript in one session snapshot or one WebSocket message can exceed iOS WebSocket message limits and can make session detail loading slow or memory-heavy.

Raising the iOS WebSocket message-size limit treats the symptom rather than the protocol problem. The daemon needs a contract that bounds initial payload size and lets Pi Relay fetch older history only when the user asks for it by scrolling.

## Decision

The daemon-to-iOS API will expose bounded transcript windows instead of unbounded session histories.

`GET /v1/sessions/{sessionId}` will return session metadata, compact tool state, streaming state, and only the most recent messages up to a requested `messageLimit`, subject to a daemon maximum.

Older messages will be loaded through `GET /v1/sessions/{sessionId}/messages?before={cursor}&limit={limit}`. Cursors are daemon values based on the oldest loaded message's `createdAt` timestamp. The encoded cursor remains opaque to the app, but it represents an exclusive timestamp upper bound for the next older page. Responses return messages in chronological order plus an optional cursor for the next older page.

The session WebSocket stream must not use an unbounded initial transcript message. Any initial session state sent over the stream follows the same bounded-message rule, and live events after subscription are incremental.

Pi Relay will initially request the latest N messages for the session detail view. When the user scrolls to the top of the loaded transcript and an older cursor is available, the app requests the next older page and prepends it to the in-memory transcript. The app de-duplicates all HTTP page and live stream merges by `ChatMessage.id`.

## Consequences

Initial session detail loads remain bounded even for long Pi histories.

The app can show recent context quickly and progressively load older history on demand.

The daemon must maintain a stable transcript paging model over Pi session history and must enforce a maximum page size.

The app must track transcript loading state, older-page cursors, and de-duplicate messages by `ChatMessage.id` when HTTP pages and live stream events overlap.
