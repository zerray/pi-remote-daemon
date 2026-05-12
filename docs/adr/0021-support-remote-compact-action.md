# Support remote compact action

## Title

Support remote compact action

## Status

Accepted

## Context

The iOS app needs to trigger the same operation as the Pi TUI `/compact` command for an active remote-control session.

Pi's extension API exposes `ctx.compact()` for triggering compaction from the live TUI extension context. Pi does not expose all built-in interactive slash commands as a stable generic command registry suitable for remote passthrough, and many interactive commands require local TUI UI flows.

## Decision

Support `/compact` as an explicit allowlisted remote session action, not as generic remote slash-command passthrough.

The daemon exposes an authenticated iOS endpoint for compacting an active session. The daemon enqueues a `remote_compact` command for the owning TUI extension. The TUI extension handles that command by calling `ctx.compact()` for the current live session.

If the target session is not active, the daemon returns `409 session_not_active`, matching remote prompt and abort behavior.

## Consequences

The iOS app can request compaction for an active remote-control session with a small protocol addition.

The implementation avoids exposing arbitrary TUI slash commands remotely and avoids having to reproduce interactive TUI command flows in the app.

Additional remote slash-command-like operations require separate explicit protocol decisions.
