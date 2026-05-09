# Title

Clean stale lock on status

# Status

Accepted

# Context

The Pi TUI command surface intentionally keeps `/remote-control` focused on toggling the current session. It no longer exposes daemon maintenance subcommands. The daemon still uses `daemon.lock` as the single process-state file, and stale locks can remain after crashes or forced exits.

# Decision

`pi-remote-control status` removes `daemon.lock` when the lock PID is not running. The command reports the daemon as stopped after removing the stale lock. Manual daemon termination remains an operator task outside the TUI command surface.

# Consequences

Users do not need a TUI daemon maintenance command solely to recover from stale locks. A later `/remote-control` invocation can start the daemon normally after `status` has cleaned the stale lock. `status` now has a small side effect, but only when the lock file no longer represents a live process.
