# Title

Use agent settlement for completion notifications

# Status

Accepted

# Context

Pi's `agent_end` event marks the end of one low-level run, but Pi may still retry, compact and retry, or process queued continuations. Sending a completion notification at `agent_end` can therefore notify before the agent has actually finished.

Pi `0.80.4` introduced `agent_settled`, which fires only when no automatic retry, compaction retry, or queued continuation remains.

# Decision

Agent completion notifications are triggered only by the owning TUI extension's `agent_settled` event. The extension reports an idempotent Agent Settlement event to the daemon after at least one agent run in the active remote-control session, unless the terminal outcome was aborted or errored. The daemon does not infer completion from transcript, tool, turn, `agent_end`, socket-close, or idle-timeout events.

The package's minimum supported Pi version for this capability is `0.80.4`.

# Consequences

A successfully settled multi-run task generates one completion signal after all automatic work settles; aborted and failed tasks do not generate a completion push. Older Pi versions cannot provide completion push and must be upgraded. Existing `agent_start` and `agent_end` handling remains responsible for live `isStreaming` state and is separate from notification semantics.
