# Title

Rename package to Pi Remote Control

# Status

Accepted

# Context

The package originally used the `pi-remote-daemon` name. The current design exposes `/remote-control` and `/remote-control-pair`, with the daemon acting as the relay behind a remote-control user experience.

# Decision

Rename the package, CLI binary, daemon display name, default state directory, environment variables, logs, tests, and documentation references to `pi-remote-control` / Pi Remote Control.

# Consequences

The naming matches the TUI command surface. Existing users of previous local builds may need to move state from `~/.pi/remote-daemon` to `~/.pi/remote-control` and update environment variables from `PI_REMOTE_DAEMON_*` to `PI_REMOTE_CONTROL_*`.
