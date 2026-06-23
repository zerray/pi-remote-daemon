# Preserve remote control across remote session replacement

## Title

Preserve remote control across remote session replacement

## Status

Accepted

## Context

Remote control normally requires explicit activation from the live Pi TUI session, and entering or resuming a TUI session does not automatically restore remote visibility. Remote Fork and Remote Clone are different because they are requested by an already paired iOS client against an already active remote-control session and replace that live TUI session with a new Pi session file.

## Decision

Remote-initiated Fork and Clone preserve remote-control continuity into the replacement TUI session as a scoped exception to manual reactivation. The extension registers the replacement session before reporting the replacement result, emits a `remote_session_replaced` handoff for the old session, and then unregisters/closes the old active session.

Remote Fork and Remote Clone remain explicit allowlisted remote actions. They are asynchronous commands, rejected while the session is busy, and guarded by the tree state version so iOS cannot replace a session based on stale tree state. Remote Fork targets a user entry and returns the selected prompt text to the iOS composer only; it does not prefill the replacement TUI editor or auto-send the prompt. Remote Clone duplicates the current active branch and returns no draft text.

## Consequences

An iOS user can fork or clone without losing the remote-control connection they intentionally started from the TUI. Local TUI session entry, resume, fork, or clone still do not automatically enable remote control. The daemon and extension must support replacement handoff, new-session registration before old-session closure, and distinct public session identity for the replacement session.
