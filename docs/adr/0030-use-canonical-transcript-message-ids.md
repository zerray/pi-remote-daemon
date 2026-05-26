# Use canonical transcript message IDs

## Title

Use canonical transcript message IDs

## Status

Accepted

## Context

HTTP session snapshots read persisted transcript messages from Pi session JSONL files and therefore use each session entry's `id` as the public `TranscriptMessage.id`.

Live WebSocket transcript events originate from Pi TUI events. Some TUI message lifecycle events can carry temporary event/message IDs before the corresponding Pi session entry is visible through the session manager. When iOS reconnects after backgrounding or lock-screen sleep, it receives a fresh `session_state` snapshot. If the earlier live event used a temporary ID and the snapshot uses the persisted entry ID, the same logical message appears under two IDs and client-side ID de-duplication cannot remove the duplicate.

The daemon already attempts best-effort enrichment from TUI events to session-entry IDs, but that immediate stateless match is not reliable when persistence lags streaming, timestamps differ, or streaming content is incomplete.

## Decision

Public transcript message IDs must be canonical across live WebSocket events and HTTP snapshots. The canonical ID for a Pi transcript message is the Pi session JSONL message entry ID.

The Pi extension canonicalizes message lifecycle events before posting them to the daemon. For `message_start`, `message_update`, and `message_end` events, the extension resolves the TUI event to a unique Pi session message entry and replaces the event `id`, nested `message.id`, and timestamp with the session-entry values before forwarding.

If the extension cannot yet resolve a unique session entry for a message lifecycle event, it must not forward a transcript event with a temporary ID. It may keep a bounded in-memory pending queue keyed by the TUI temporary message ID and retry resolution on later message lifecycle events. Once resolved, it flushes pending events in order using the canonical session-entry ID. If resolution never becomes unique before the bounded queue expires or is evicted, the extension drops those pending live transcript events and relies on the next HTTP snapshot/session-state read to expose the persisted message.

The daemon's event normalizer continues to treat incoming TUI event IDs as already canonical. Clients may keep defensive de-duplication, but correctness must not depend on fuzzy client-side matching.

## Consequences

Reconnect snapshots and live streams use the same message IDs for persisted messages, preventing duplicate display after iOS reconnects.

Some real-time transcript updates can be delayed until the Pi session entry is visible. In ambiguous or unresolved cases, a live streaming update may be omitted and later recovered by snapshot reads. This is preferable to exposing unstable public IDs.

The extension owns a small amount of per-active-session pending transcript state and must clear it when remote control is disabled, the session resets, or the TUI session shuts down.
