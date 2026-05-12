# Expose session status snapshots

## Title

Expose session status snapshots

## Status

Accepted

## Context

The iOS app needs to display the same kind of session status currently shown in the Pi TUI footer: model, thinking level, token/cache usage, cost, and context window usage.

The Pi extension API exposes enough structured data to compute this status from the live TUI session context, including `ctx.model`, `pi.getThinkingLevel()`, `ctx.sessionManager`, and `ctx.getContextUsage()`. The daemon cannot compute the live TUI status by itself because active sessions are owned by the TUI extension and the daemon does not use Pi SDK session runtime APIs.

## Decision

Add a package-level `session_status` snapshot for active remote-control sessions.

The TUI extension computes the snapshot from the live session context when a session is registered and whenever relevant status inputs change. The daemon stores the latest snapshot in the active-session registry, includes it in HTTP session snapshots and initial WebSocket session state, and broadcasts a `session_status` WebSocket event when the snapshot changes.

The status snapshot is structured data, not rendered TUI footer text. It includes current model metadata, thinking level, cumulative usage and cost, and context usage. Context token and percentage values may be `null` when Pi reports them as unknown.

## Consequences

The iOS app can render session status without parsing terminal UI output.

The app's displayed status is eventually consistent with the TUI and updates when the live TUI extension reports changes.

The daemon remains independent of Pi SDK session runtime APIs and only relays status produced by the owning TUI extension.
