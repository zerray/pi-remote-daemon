# Project guidance

## Repository and runtime shape

- This directory is an independent Git repository distributed as the `pi-remote-control` Pi package.
- The package has two runtime surfaces: `src/extension/index.ts` runs inside each Pi TUI process; `src/cli.ts` starts the singleton daemon process.
- Never host the daemon listener in the extension process or auto-start it during extension load. `/remote-control` and `/remote-control-pair` start it on demand.

## Ownership and trust boundaries

- The owning TUI extension is the sole authority for live Pi actions such as prompt, abort, compact, tree navigation, fork, clone, and model selection.
- The daemon owns pairing, device-token authentication, active-session process state, bounded transcript reads, command relay, and iOS WebSocket fanout.
- Public iOS events are daemon-normalized. Raw Pi extension events and temporary TUI message IDs must not cross the public interface.
- Loopback TUI control may bypass bearer authentication; non-loopback TUI calls and every iOS call require a paired device token.
- Do not add generic slash-command passthrough. Each remote capability must be explicitly allowlisted and validated.

## State boundaries

- SQLite stores daemon-owned pairing/device state. Active TUI sessions, Runtime Status, Model Catalog Snapshots, tree state, and pending commands are process state.
- Pi session JSONL files remain the transcript source of truth; do not duplicate completed transcripts in SQLite.
- Model catalogs come from the live TUI model registry and contain only public model metadata—never API keys, provider headers, base URLs, or environment values.
- Agent completion means Pi `agent_settled`, not `agent_end`; the accepted design therefore requires Pi `>=0.80.4`. The current lockfile still resolves `0.74.0` and must be upgraded before settlement notifications are implemented.
- Completion push uses an opaque Push Route to the configured central Push Gateway. APNs device tokens and provider keys must never be stored by this daemon. Notification payloads must use generic text and opaque routing/session identifiers only.

## Control-channel behavior

- Registration is explicit per TUI session. Local resume/new/fork/clone does not auto-enable remote control.
- Remote iOS fork/clone is the only replacement flow that preserves remote control into the replacement session.
- Heartbeat polling both takes queued commands and re-registers a locally active session after daemon state loss.
- Remote actions that change model or tree/session position must reject known-busy sessions and report asynchronous results by request ID.

## Verification

```sh
npm test
npm run lint
npm run build
```
