# Use loopback TUI control

## Status

Accepted

## Context

The daemon may bind to a Tailscale-reachable address so iOS can access it. The Pi TUI extension runs on the same host as the daemon and should not need a paired device token to register or control its own explicitly enabled session. If the extension derives its control URL from a Tailscale bind address, package-internal TUI calls can be treated like remote traffic and fail with `401`.

## Decision

The daemon listens on the configured bind address and, when that address is not loopback or wildcard, also listens on `127.0.0.1` on the same port. The Pi TUI extension uses `127.0.0.1:<configured-port>` for package-internal control calls unless `PI_REMOTE_CONTROL_LOCAL_URL` overrides it.

Package-internal `/v1/tui/*` endpoints accept unauthenticated requests from loopback clients. Non-loopback callers must still provide a valid bearer token. iOS-facing endpoints continue to require paired-device bearer authentication.

## Consequences

TUI activation works without distributing device tokens to the local extension, even when iOS reaches the daemon through Tailscale. Remote peers cannot use the TUI control endpoints without authentication. The configured port must be available on both the selected remote-facing interface and loopback when binding to a specific non-loopback address.
