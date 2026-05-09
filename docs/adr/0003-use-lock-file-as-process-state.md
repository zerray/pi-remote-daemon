# Title

Use daemon lock file as process state

# Status

Accepted

# Context

The daemon needs singleton enforcement and enough process metadata for `status` and `stop`. Earlier design mentioned both `daemon.lock` and `daemon.pid`, which duplicated process state and could become inconsistent.

# Decision

Use only `daemon.lock` for daemon process state. The daemon creates it atomically on startup, writes its PID into it, and removes it on normal shutdown. `status` and `stop` read the PID from `daemon.lock`.

# Consequences

There is a single process-state file to reason about. Duplicate starts are rejected by atomic lock creation. Stale lock handling is not yet implemented; if the daemon exits without releasing the lock, the user must remove `daemon.lock` manually before starting again.
