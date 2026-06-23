# Title

Do not auto-enable remote control after local fork

# Status

Accepted

# Context

Remote iOS fork and clone commands intentionally replace the active remote-controlled TUI session and preserve remote-control state for the replacement.

A user can also fork directly in the TUI while remote control is active. That action was not requested by iOS, and automatically carrying remote control into the fork would make a rare local action change the remote client's active session implicitly.

# Decision

When a remote-controlled session is forked locally in the TUI, remote control is disabled for the previous session and is not automatically enabled for the fork.

After the fork starts, the TUI notifies the user that remote control was disabled and that `/remote-control` must be re-run to control the fork from iOS.

# Consequences

Local TUI forks avoid speculative remote handoff behavior.

The iOS client sees the previous session close and can present it as inactive. Users must explicitly opt in before iOS controls the forked session.
