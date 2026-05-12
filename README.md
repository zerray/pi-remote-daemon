# Pi Remote Control

Private relay daemon for iOS remote control of explicitly enabled Pi TUI sessions.

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

Then open a Pi TUI session and run:

```text
/remote-control-pair  # display QR code for iOS pairing
/remote-control       # toggle this TUI session for remote control
```

## Directory overview

- `scripts/http-smoke-test.sh` — curl/WebSocket smoke test for daemon HTTP endpoints.
- `docs/architecture.md` — daemon architecture, Pi package shape, and lifecycle boundaries.
- `docs/interfaces.md` — daemon public API and TUI control integration contract.
- `docs/data-model.md` — daemon state, pairing, device, active session, and stream structures.
- `docs/adr/` — accepted daemon decisions.
