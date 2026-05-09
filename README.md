# Pi Remote Daemon

Private daemon that exposes authenticated remote access to local Pi sessions for the Pi iOS app.

## Run

```bash
npm install
npm run build
PI_REMOTE_DAEMON_DEV_TOKEN=test-token node dist/cli.js start --bind 127.0.0.1:17373
```

In another shell:

```bash
TOKEN=test-token ./scripts/http-smoke-test.sh
```

## Directory overview

- `scripts/http-smoke-test.sh` — curl/WebSocket smoke test for daemon HTTP endpoints.
- `docs/architecture.md` — daemon architecture, Pi package shape, and lifecycle boundaries.
- `docs/interfaces.md` — daemon public API and daemon-to-Pi integration contract.
- `docs/data-model.md` — daemon state, pairing, device, project, and live session structures.
- `docs/adr/` — accepted daemon decisions.
