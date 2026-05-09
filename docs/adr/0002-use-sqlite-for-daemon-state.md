# Title

Use SQLite for daemon-owned state

# Status

Accepted

# Context

The daemon needs durable state for paired devices, token hashes, short-lived pairing codes, allowed projects, daemon metadata, and stable app-facing session IDs. Full Pi transcripts are already persisted by Pi as JSONL session files and should not be duplicated by the daemon.

# Decision

Store daemon-owned durable state in a SQLite database named `daemon.sqlite` under the daemon state directory. Store human-editable daemon configuration in `config.json` in the same directory. Keep Pi session transcripts in Pi's own session files and store only daemon IDs, references, and cached summary fields for sessions.

# Consequences

The daemon gets transactional updates, simple backup behavior, and easy local inspection without running an external database. The daemon must manage schema migrations and filesystem permissions. If the SQLite session index is lost, it can be rebuilt from Pi session files, but device pairing state must be restored from backup or paired again.
