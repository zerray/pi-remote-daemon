# Rename session status to runtime status

## Title

Rename session status to runtime status

## Status

Accepted

## Context

ADR 0020 introduced a `session_status` snapshot and WebSocket event for live model, usage, cost, and context information. The name is too similar to the existing initial WebSocket `session_state` event and can cause protocol confusion.

## Decision

Rename the snapshot concept to `RuntimeStatus`.

Public session state uses the field `runtimeStatus`. The WebSocket update event is `runtime_status`. Package-internal TUI status reports use `{ "type": "runtime_status", "status": RuntimeStatus }`.

This ADR supersedes only the naming chosen in ADR 0020. The underlying decision to expose live status snapshots is unchanged.

## Consequences

The protocol distinguishes initial full session state (`session_state`) from incremental runtime status updates (`runtime_status`).

Clients can treat `runtimeStatus` as live metadata about the owning TUI runtime rather than as another session-state payload.
