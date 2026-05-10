# Require manual remote-control reactivation after TUI entry

## Title

Require manual remote-control reactivation after TUI entry

## Status

Accepted

## Context

Remote control is explicitly enabled from a live Pi TUI session with `/remote-control`. If the TUI exits without cleanly unregistering, the daemon can temporarily retain an active session registration and the iOS app can continue to show that session until the daemon observes that the TUI control channel is gone.

Automatically restoring remote control when a user resumes a Pi session would make remote visibility persist across TUI process lifecycles, which weakens the explicit opt-in model.

## Decision

Entering or resuming a Pi TUI session does not automatically enable or restore remote control.

On TUI session start, the extension clears local remote-control state. The user must run `/remote-control` to activate remote visibility for that TUI process.

The daemon treats missing TUI heartbeats as an inactive control channel, removes the active session registration, and notifies iOS subscribers with `session_closed`.

## Consequences

Exiting the TUI is effectively a remote-control deactivation, even if shutdown cleanup is missed.

Stale sessions disappear from the iOS app after the heartbeat timeout.

Users must explicitly run `/remote-control` after entering or resuming a TUI session before the session is remotely visible or controllable again.
