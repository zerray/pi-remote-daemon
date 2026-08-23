# Pi Remote Control

Private relay daemon for iOS remote control of explicitly enabled Pi TUI sessions.

App Store: https://apps.apple.com/us/app/pi-relay/id6768893799

## Run

Install as a Pi package:

```bash
pi install https://github.com/zerray/pi-remote-control
```

After installation, edit `~/.pi/remote-control/config.json` so iOS can reach the daemon. Use a LAN IP or Tailscale address. Exposing the daemon on a public IP is at your own risk.

LAN example:

```json
{
  "bindAddress": "192.168.1.23:17373",
  "advertisedBaseUrl": "http://192.168.1.23:17373"
}
```

Tailscale example:

```json
{
  "bindAddress": "100.86.12.34:17373",
  "advertisedBaseUrl": "http://100.86.12.34:17373"
}
```

To enable completion notifications, set `pushGatewayBaseUrl` to the trusted central gateway URL in the same config file.

Then open a Pi TUI session and run:

```text
/remote-control-pair  # display QR code and desktop hex payload for pairing
/remote-control       # toggle this TUI session for remote control
```

## Central Push Gateway

The gateway is a separately deployed operator service; APNs credentials must never be installed on user daemons. Run `pi-relay-push-gateway` with:

```text
PI_APNS_TEAM_ID
PI_APNS_KEY_ID
PI_APNS_BUNDLE_ID
PI_APNS_PRIVATE_KEY_PATH
PI_PUSH_GATEWAY_STATE_DIR
PI_PUSH_GATEWAY_BIND              # optional; defaults to 127.0.0.1:17473
PI_PUSH_GATEWAY_MAX_PER_HOUR      # optional; defaults to 20 notifications per route
PI_PUSH_GATEWAY_MAX_ROUTE_CREATIONS_PER_HOUR # optional; defaults to 20 per source IP
```

Terminate with `SIGINT` or `SIGTERM`. The state directory contains `push-gateway.sqlite` and must be backed up and restricted to the provider account.

## Directory overview

- `src/push-gateway/` — independently deployed route service and APNs provider.
- `scripts/http-smoke-test.sh` — curl/WebSocket smoke test for daemon HTTP endpoints.
- `docs/architecture.md` — daemon architecture, Pi package shape, and lifecycle boundaries.
- `docs/interfaces.md` — daemon public API and TUI control integration contract.
- `docs/data-model.md` — daemon state, pairing, device, active session, and stream structures.
- `docs/adr/` — accepted daemon decisions.
