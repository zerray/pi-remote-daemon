# Generate ephemeral session names

## Title

Generate ephemeral session names

## Status

Accepted

## Context

Remote-control session APIs currently expose the Pi TUI session name when the user has set one with Pi session metadata. Sessions without a TUI name return `null`, which makes iOS project/session lists harder to scan.

The daemon already receives active-session metadata and can read a bounded transcript window from the Pi session JSONL file. The daemon must not write inferred display names back into Pi session files because that would make a remote-control convenience feature look like an explicit user choice in the TUI.

## Decision

When the daemon registers or refreshes an active TUI session whose TUI-provided `name` is blank or absent, it starts daemon-side LLM name generation for that active session.

The generated name is stored only in the daemon's in-memory active-session registry and is used as the public `session.name` value in HTTP session-list and session-snapshot responses. It is not persisted to daemon SQLite and is not written to the Pi session JSONL file.

Name generation uses a bounded, sanitized transcript excerpt from the session file and produces a short display title. If generation is unavailable, fails, or the transcript has insufficient content, the public name remains `null` until a TUI name or generated name is available.

A nonblank TUI-provided name is authoritative. If registration, re-registration, or a TUI session-name update reports a nonblank name, the daemon replaces any generated name with that TUI name and marks the active-session name as TUI-owned.

## Consequences

Unnamed sessions can become easier to identify in remote clients without requiring the user to name every Pi TUI session manually.

Generated names are ephemeral process state. They can disappear after daemon restart, active-session expiry, or re-registration before regeneration completes.

The daemon needs an LLM-backed name-generation boundary that is safe to test with a fake generator and that does not block heartbeat or command polling indefinitely.

Manual TUI names remain the source of truth and override daemon-generated names whenever they are reported.
