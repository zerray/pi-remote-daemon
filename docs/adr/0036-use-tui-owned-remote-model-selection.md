# Title

Use TUI-owned remote model selection

# Status

Accepted

# Context

The iOS app needs the equivalent of Pi's interactive `/model` selector. The daemon intentionally has no Pi runtime and built-in interactive commands are not executed through remote prompt delivery. Passing arbitrary slash commands through the daemon would also violate the allowlisted control boundary.

# Decision

The live TUI extension publishes a reduced Model Catalog Snapshot and handles explicit Remote Model Selection commands. The daemon caches the catalog, exposes authenticated list, refresh, and selection endpoints, guards selection by session activity and catalog version, and forwards the selected provider/model identity to the owning extension.

The extension refreshes its live model registry, resolves only authenticated available models, calls `pi.setModel(...)`, and reports an asynchronous selection result plus updated Runtime Status. Model metadata sent through the daemon excludes credentials, headers, base URLs, and environment values.

# Consequences

Remote and local model changes operate on the same Pi runtime and use Pi's normal model persistence and thinking-level clamping. Model refresh and selection require an active TUI owner. The protocol gains cached catalog state, request IDs, stale-catalog errors, and public model-selection result events without gaining generic command execution.
