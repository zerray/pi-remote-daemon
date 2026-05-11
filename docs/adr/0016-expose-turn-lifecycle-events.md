# Expose turn lifecycle events

## Title

Expose turn lifecycle events

## Status

Accepted

## Context

The normalized transcript stream exposes message lifecycle events, tool execution events, and session closure. Clients can infer some progress from `transcript_message_end`, but a Pi turn can include assistant output, tool calls, tool results, and follow-up assistant output. The app needs an explicit daemon-owned signal for turn boundaries instead of relying on raw Pi events or session snapshots.

Pi emits `turn_start` and `turn_end` extension events for each turn. These events are package-internal inputs today and are not part of the public iOS stream protocol.

## Decision

The daemon-to-iOS WebSocket protocol will include normalized `turn_start` and `turn_end` stream events.

The Pi extension will forward Pi `turn_start` and `turn_end` events to the daemon while remote control is active. The daemon will normalize them and broadcast only the public lifecycle fields needed by the app. Raw Pi turn event payloads are not exposed to iOS.

`turn_start` marks that a model/tool turn is active. `turn_end` marks that the turn is complete. Transcript content remains represented by `TranscriptMessage` and tool execution events.

## Consequences

The iOS app can update per-turn loading state without waiting for a new session snapshot.

The stream protocol remains incremental and normalized.

Turn lifecycle events do not replace `transcript_message_end`; clients should still use message events to update transcript content.
