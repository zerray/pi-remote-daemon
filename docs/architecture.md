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
- Register `/remote-control-pair` as the only pair-code creation command and render its pairing link as a QR code plus text fallback.
- Start the daemon on demand when either command needs it.
- When `/remote-control` enables a session, open a control channel to the daemon and register current session metadata.
- When `/remote-control` disables a session or the TUI session shuts down, unregister it.
- Forward Pi message, assistant streaming, tool execution, queue, and lifecycle events to the daemon while remote control is active.
- Receive daemon-forwarded prompt and abort commands and apply them to the current live TUI runtime through Pi extension APIs.

The extension owns live Pi session control. It does not expose a network listener to iOS.

## Daemon responsibilities

The daemon responsibilities are independent of Pi SDK session ownership:

- Serve the HTTP/WebSocket API documented in `docs/interfaces.md`.
- Enforce device token authentication for iOS requests and non-loopback TUI control requests.
- Persist pairing codes, paired device token hashes, and daemon metadata.
- Track currently activated TUI sessions and group them into projects for iOS display.
- Relay prompt and abort requests from iOS to the TUI extension that owns the target session.
- Serve bounded recent transcript snapshots and older transcript pages for active sessions.
- Forward live raw TUI Pi events to subscribed iOS WebSocket clients without using the stream for full historical transcript payloads.
- Broadcast session updates to subscribed iOS WebSocket clients.

The daemon does not use Pi SDK or RPC to discover, open, prompt, stream, or abort sessions in the MVP.

## Session runtime model

A live session controller is represented by a TUI extension control channel, not a daemon-created Pi runtime. The control channel is the authority for one remote-control-enabled TUI session. If the channel closes, the daemon marks the session inactive, removes it from project/session listings, and notifies iOS subscribers.

Multiple TUI processes may enable remote control at the same time. Each active session has one owning TUI control channel. The daemon rejects prompt or abort requests for sessions without an active owner.

## Persistence model

The daemon binds the configured remote-facing address and, for specific non-loopback bind addresses, an additional `127.0.0.1` listener on the same port for local TUI control. The extension uses the loopback listener by default; iOS uses the configured advertised URL.

Session detail reads are bounded: the daemon returns a recent transcript window first, then serves older transcript pages on request. WebSocket streams are for live updates and must not carry unbounded session history.

The daemon stores its own durable state in a daemon state directory, defaulting to `~/.pi/remote-control` and overridable with `PI_REMOTE_CONTROL_DIR`.

Durable daemon-owned files:

- `config.json`: daemon configuration such as bind address and advertised base URL.
- `daemon.sqlite`: SQLite database for paired devices, token hashes, pairing codes, and metadata.
- `daemon.lock`: singleton lock file containing the daemon PID.

Active TUI sessions are process state, not durable daemon state. Pi session transcripts remain in Pi's own JSONL session files under Pi's session directory. The daemon may keep in-memory snapshots for currently active sessions so newly connected iOS clients can render current state.

## Installation model

The package can be installed with Pi package installation, for example from a local path, git source, or npm source. The package manifest exposes the extension through the `pi.extensions` field and the daemon binary through the normal package binary entry.

Installing the Pi package makes Pi aware of `/remote-control` and `/remote-control-pair`; it does not by itself imply that the daemon process is running or that any TUI session is remotely visible. Pairing QR codes require an advertised base URL that is reachable from iOS, such as a Tailscale HTTPS or HTTP URL.
