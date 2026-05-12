# Re-register active TUI session on heartbeat miss

## Title

Re-register active TUI session on heartbeat miss

## Status

Accepted

## Context

The daemon tracks active TUI sessions in process memory and removes registrations when heartbeats stop. System sleep pauses the TUI heartbeat timer and the daemon sweep timer, but wall-clock time still advances. After wake, the daemon can prune the active session before the TUI extension sends another heartbeat.

The iOS app then correctly sees no active projects because the daemon registration is gone. The TUI can still show `Remote Control Active` because that status is local extension state and the polling heartbeat currently does not repair a missing daemon registration.

## Decision

Keep the daemon's simple heartbeat timeout and in-memory active-session registry behavior.

When a TUI extension still considers a session locally remote-control active, but its heartbeat command poll receives `session_not_found` from the daemon, the extension re-registers the current TUI session with the daemon.

If re-registration succeeds, the extension keeps local remote control active and continues polling. If re-registration fails, the extension clears local remote-control state, removes the status indicator, stops polling, and notifies the user that remote control disconnected.

This recovery only applies to a session that was already locally active in the current TUI process. Entering or resuming a TUI session still does not automatically enable remote control.

## Consequences

System sleep, daemon restart, or daemon in-memory state loss can be repaired by the next TUI heartbeat without requiring daemon sleep detection.

The iOS app may briefly show no active projects after wake until the TUI heartbeat runs and re-registers the session. Remote prompts sent during that gap can still fail with `session_not_active`.

The daemon remains simple and continues to remove stale sessions by heartbeat timeout and owner PID checks.
