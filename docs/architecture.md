# Architecture

## Purpose

`pi-remote-daemon` is a long-lived local service that exposes authenticated, Tailscale-reachable remote control for Pi sessions. It is designed to be distributed as a Pi package, but the daemon process itself is not a Pi extension runtime.

## Pi package shape

The package contains two runtime surfaces:

- Daemon binary: the long-lived HTTP/WebSocket service used by the iOS app.
- Pi extension: a thin control shim loaded by Pi that registers user-facing commands and optional status UI.

The extension must not host the daemon server in-process. Pi extensions are loaded per Pi process and are rebound during session replacement flows, so a server started directly from extension load would be tied to the wrong lifecycle and could be attempted once per Pi session/process.

## Process lifecycle

The daemon is started by one of these explicit singleton mechanisms:

1. OS service manager, preferred for regular use:
   - macOS `launchd` user agent.
   - Linux `systemd --user` service.
2. Manual CLI:
   - `pi-remote-daemon start`.
3. Pi extension command:
   - `/remote-daemon start` starts the same detached daemon binary after checking whether it is already running.

The extension may perform a cheap health check on Pi startup, but it must not auto-start the daemon by default. If an auto-start option is added later, it must still acquire the daemon singleton lock before spawning and must return immediately when an existing daemon is healthy.

## Singleton ownership

Only the daemon process owns the network listener, pairing state, device tokens, and live Pi session runtimes. Singleton enforcement uses `daemon.lock` under the daemon state directory. The lock is created atomically during startup and contains the daemon PID for `status` and `stop`.

If another Pi process loads the extension, it sees the existing daemon and only reports status.

## Pi extension responsibilities

The extension responsibilities are intentionally small:

- Register `/remote-daemon status`.
- Register `/remote-daemon start` and `/remote-daemon stop` as convenience commands.
- Register `/remote-daemon pair` to request or display a short-lived pair code from the daemon.
- Optionally show daemon connection status in the Pi UI.

The extension does not proxy iOS requests and does not keep per-session server state.

## Daemon responsibilities

The daemon responsibilities are independent of active Pi TUI sessions:

- Serve the HTTP/WebSocket API documented in `docs/interfaces.md`.
- Enforce token authentication and device pairing.
- Discover projects and sessions through Pi SDK `SessionManager`.
- Open, prompt, stream, and abort Pi sessions through Pi SDK runtime or Pi RPC.
- Normalize Pi events into app-level stream events.
- Keep Pi package and protocol compatibility isolated from the iOS client.

## Session runtime model

The daemon creates live Pi runtimes only when a remote client opens or interacts with a session. A daemon process may maintain multiple session controllers, keyed by daemon session ID, subject to a resource limit. Idle controllers can be disposed and recreated from the persisted Pi session file.

## Persistence model

The daemon stores its own durable state in a daemon state directory, defaulting to `~/.pi/remote-daemon` and overridable with `PI_REMOTE_DAEMON_DIR`.

Durable daemon-owned files:

- `config.json`: daemon configuration such as bind address and allowed project roots.
- `daemon.sqlite`: SQLite database for paired devices, token hashes, pairing codes, project records, metadata, and session index cache.
- `daemon.lock`: singleton lock file containing the daemon PID.

Pi session transcripts remain in Pi's own JSONL session files under Pi's session directory. The daemon does not duplicate full conversation history. It stores only references, cached summary fields, and app-facing stable IDs needed to serve the remote API.

## Installation model

The package can be installed with Pi package installation, for example from a local path, git source, or npm source. The package manifest exposes the extension through the `pi.extensions` field and the daemon binary through the normal package binary entry.

Installing the Pi package makes Pi aware of the extension; it does not by itself imply that the daemon process is running. The user or installer enables the daemon service separately.
