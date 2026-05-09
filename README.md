# Pi Remote Control

Private relay daemon for iOS remote control of explicitly enabled Pi TUI sessions.

## Run

```bash
npm install
npm run build
node dist/cli.js start --bind 127.0.0.1:17373
node dist/cli.js status
node dist/cli.js stop
```

From Pi TUI after installing the package:

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
