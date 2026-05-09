# Title

Use TUI-activated remote-control sessions

# Status

Accepted

# Context

The daemon previously treated Pi sessions as daemon-owned resources: it would discover projects and sessions with Pi SDK `SessionManager`, then open, prompt, stream, and abort sessions with Pi SDK runtime or Pi RPC. That model can expose saved sessions that the user did not explicitly enable for mobile control and can conflict with a live Pi TUI process that already owns the active runtime.

# Decision

For the MVP, the Pi TUI extension owns remote-controlled sessions. The daemon lists only sessions that have been activated by the user from a Pi TUI command. The daemon does not use Pi SDK or RPC to discover, open, prompt, stream, or abort sessions. It stores pairing state and device tokens, tracks currently activated TUI sessions, relays iOS prompt and abort requests to the owning TUI extension, and broadcasts TUI-forwarded events to iOS clients.

The Pi command surface changes to two explicit commands:

- `/remote-control`: toggle remote control for the current TUI session. It starts the daemon if needed; when enabling, it registers the current session with the daemon; when disabling, it unregisters it.
- `/remote-control-pair`: start the daemon if needed and create a short-lived pairing code from the TUI.

# Consequences

The remote API reflects user-selected live TUI sessions rather than all saved Pi sessions or configured project roots. The daemon no longer competes with the TUI for session file ownership or runtime control. If a TUI process exits, reloads, or disables remote control, that session disappears from the iOS app. The previous `/remote-daemon` control-shim command shape and daemon-owned Pi runtime model are superseded.
