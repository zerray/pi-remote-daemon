# Title

Package the Pi extension as a control shim

# Status

Accepted

# Context

The daemon should be installable as part of a Pi package so users can manage it from Pi. Pi extensions are loaded for Pi processes and are rebound across session replacement flows. A long-lived HTTP/WebSocket daemon should not be tied to that per-process or per-session lifecycle.

# Decision

Distribute `pi-remote-daemon` as a Pi package containing both a daemon binary and a Pi extension. The extension is a thin control shim that registers commands for status, start, stop, and pairing. The daemon server runs as a separate singleton process started by an OS service, manual CLI, or explicit extension command.

# Consequences

Installing the Pi package makes the control extension available but does not automatically start one daemon per Pi session. Multiple Pi sessions can load the extension safely because daemon startup goes through singleton health checks and lock acquisition. The daemon remains available even when no Pi TUI session is open.
