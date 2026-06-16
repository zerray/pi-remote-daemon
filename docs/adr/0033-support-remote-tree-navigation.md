# Support remote tree navigation as an explicit TUI-owned action

## Title

Support remote tree navigation as an explicit TUI-owned action

## Status

Accepted

## Context

The iOS app needs access to Pi's `/tree` capability without exposing generic slash-command passthrough. Pi tree navigation depends on live TUI session state such as the current leaf, branch summaries, labels, editor text behavior, and whether the agent is idle. The daemon can read session JSONL files, but file order is not enough after branching because `parentId`/`leafId` define the active branch.

## Decision

Support Remote Tree Navigation as an explicit allowlisted action owned by the live TUI extension. The iOS app renders a native tree picker from daemon-cached TUI-reported Tree Snapshots and may request asynchronous refreshes. Actual navigation is queued to the owning TUI extension, which performs `navigateTree` semantics against the live session and reports an asynchronous Navigation Result over the session WebSocket.

Tree Snapshots expose reduced public Tree Entry objects, not raw Pi session entries. The daemon tracks TUI-reported current leaf and tree state version so transcript snapshots and pages can be derived from the active branch instead of linear JSONL file order. Remote navigation is rejected while the session is busy and uses the tree state version as an optimistic stale-state guard.

## Consequences

The iOS app can offer `/tree`-equivalent navigation while preserving TUI authority and avoiding arbitrary slash-command passthrough. Tree opening can be cached-immediate with async refresh instead of blocking on the poll-based TUI command channel. The daemon must maintain cached tree state, branch-aware transcript reads, and stable remote tree action/result protocol.
