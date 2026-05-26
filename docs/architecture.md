# Architecture

## Purpose

`pi-remote-control` is a long-lived local relay service that exposes authenticated, Tailscale-reachable remote control for Pi TUI sessions that the user explicitly enables. It is distributed as a Pi package, but the daemon process itself is not a Pi extension runtime.

## Pi package shape

The package contains two runtime surfaces:

- Daemon binary: the long-lived HTTP/WebSocket service used by the iOS app and the Pi TUI extension.
- Pi extension: the TUI-facing control surface that registers remote-control commands, owns the active Pi session integration, and forwards session events to the daemon.

The extension must not host the daemon server in-process. Pi extensions are loaded per Pi process and are rebound during session replacement flows, so a server started directly from extension load would be tied to the wrong lifecycle and could be attempted once per Pi session/process.

## Process lifecycle

The daemon is started by one of these explicit singleton mechanisms:

1. Manual CLI:
   - `pi-remote-control start`.
2. Pi extension commands:
   - `/remote-control` starts the daemon if needed before enabling the current TUI session.
   - `/remote-control-pair` starts the daemon if needed before creating a pair code.

OS service installation is intentionally deferred for the MVP.

The extension may perform a cheap health check when a command runs, but it must not auto-start the daemon during extension load. Daemon startup goes through singleton lock acquisition and returns immediately when an existing daemon is healthy.

## Singleton ownership

Only the daemon process owns the network listener, pairing state, device tokens, active TUI session registry, and iOS WebSocket fanout. Singleton enforcement uses `daemon.lock` under the daemon state directory. The lock is created atomically during startup and contains the daemon PID for `status` and `stop`.

If another Pi process loads the extension, it sees the existing daemon and may register its own TUI session only after the user runs `/remote-control` in that process.

## Pi extension responsibilities

The extension responsibilities are session-aware:

- Register `/remote-control` as a no-argument toggle for the current TUI session.
- Register `/remote-control-pair` as the only pair-code creation command and render its pairing link as a QR code, desktop pairing hex payload, and expiration time.
- Start the daemon on demand when either command needs it.
- When `/remote-control` enables a session, open a control channel to the daemon, register current session metadata, and keep the registration fresh with heartbeats.
- When a locally active session heartbeat finds that the daemon no longer has the registration, re-register the current TUI session; if re-registration fails, clear local active state and notify the user.
- When `/remote-control` disables a session or the TUI session shuts down, unregister it; if shutdown cleanup is missed, the daemon expires the registration after the TUI PID exits or heartbeats stop.
- Forward Pi turn, message, assistant streaming, tool execution, queue, status, and lifecycle events to the daemon while remote control is active. These TUI-to-daemon events are package-internal inputs for daemon normalization. Agent lifecycle events update daemon session-level `isStreaming` state. Message lifecycle events are forwarded only after their public IDs have been canonicalized to Pi session-entry IDs, with unresolved events buffered by temporary message ID or exact `message.role + message.timestamp`.
- Compute structured runtime-status snapshots from the live TUI context and send them to the daemon when status inputs change.
- Forward TUI session-name changes so explicit user names can override daemon-generated display names.
- Receive daemon-forwarded prompt, abort, and compact commands and apply them to the current live TUI runtime through Pi extension APIs.
- Report asynchronous compact success or failure results back to the daemon for iOS WebSocket subscribers.

The extension owns live Pi session control. It does not expose a network listener to iOS.

## Daemon responsibilities

The daemon responsibilities are independent of Pi SDK session ownership:

- Serve the HTTP/WebSocket API documented in `docs/interfaces.md`.
- Enforce device token authentication for iOS requests and non-loopback TUI control requests.
- Persist pairing codes, paired device token hashes, and daemon metadata.
- Track currently activated TUI sessions and group them into projects for iOS display.
- Relay prompt, abort, and compact requests from iOS to the TUI extension that owns the target session.
- Forward TUI-reported compact results to subscribed iOS clients.
- Store the latest TUI-reported runtime-status snapshot for each active session and include it in session state sent to iOS.
- Generate short ephemeral display names for unnamed active sessions with an LLM and expose them through session APIs until a TUI-provided name overrides them.
- Serve bounded recent transcript snapshots and older transcript pages for active sessions by reading Pi session JSONL files and normalizing entries into public `TranscriptMessage` values.
- Normalize live TUI Pi events into public transcript stream events for subscribed iOS WebSocket clients without using the stream for full historical transcript payloads, and broadcast bounded `session_state` refreshes when session-level working state changes.
- Broadcast session updates to subscribed iOS WebSocket clients.

The daemon does not use Pi SDK or RPC to discover, open, prompt, stream, or abort sessions in the MVP.

## Session runtime model

A live session controller is represented by a TUI extension control channel, not a daemon-created Pi runtime. The control channel is the authority for one remote-control-enabled TUI session. It also provides runtime-status snapshots for model, usage, cost, and context information. If the channel closes, the owning TUI PID exits, or heartbeats stop, the daemon marks the session inactive, removes it from project/session listings, and notifies iOS subscribers. If the same TUI process still has local remote control active and later observes the missing registration through heartbeat polling, it re-registers the session.

Multiple TUI processes may enable remote control at the same time. Each active session has one owning TUI control channel. The daemon rejects prompt or abort requests for sessions without an active owner.

## Persistence model

The daemon binds the configured remote-facing address and, for specific non-loopback bind addresses, an additional `127.0.0.1` listener on the same port for local TUI control. The extension uses the loopback listener by default; iOS uses the configured advertised URL.

Session detail reads are bounded and derive transcript history from the active session's Pi JSONL session file: the daemon returns a recent transcript window first, then serves older transcript pages on request. Bounded transcript windows preserve tool-use referential integrity by prepending older assistant tool-call parent messages when needed for included `toolResult` messages; pagination cursors still refer to the primary chronological page boundary. Session detail reads and initial WebSocket state also include the latest TUI-reported `RuntimeStatus` snapshot when available. HTTP transcript reads and WebSocket live updates expose the same public `TranscriptMessage` shape and the same canonical message IDs for persisted messages. WebSocket streams are for normalized live updates, status updates, and asynchronous remote-action results; they must not carry unbounded session history or transcript events with temporary TUI message IDs. The initial WebSocket `session_state` is further bounded to a small recent primary window with oversized transcript payloads truncated to previews.

The daemon stores its own durable state in a daemon state directory, defaulting to `~/.pi/remote-control` and overridable with `PI_REMOTE_CONTROL_DIR`.

Durable daemon-owned files:

- `config.json`: daemon configuration such as bind address and advertised base URL.
- `daemon.sqlite`: SQLite database for paired devices, token hashes, pairing codes, and metadata.
- `daemon.lock`: singleton lock file containing the daemon PID.

Active TUI sessions are process state, not durable daemon state. This process state may include a daemon-generated display name for an unnamed active session; that generated name is not persisted and is not written to Pi session metadata. Pi session transcripts remain in Pi's own JSONL session files under Pi's session directory. The daemon reads those files for HTTP transcript snapshots and pages instead of maintaining a duplicate completed-transcript snapshot in memory.

## Installation model

The package can be installed with Pi package installation, for example from a local path, git source, or npm source. The package manifest exposes the extension through the `pi.extensions` field and the daemon binary through the normal package binary entry.

Installing the Pi package makes Pi aware of `/remote-control` and `/remote-control-pair`; it does not by itself imply that the daemon process is running or that any TUI session is remotely visible. Pairing QR codes require an advertised base URL that is reachable from iOS, such as a Tailscale HTTPS or HTTP URL.
