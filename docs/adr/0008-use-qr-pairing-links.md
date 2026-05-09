# Title

Use QR pairing links

# Status

Accepted

# Context

Pair-code creation is restricted to the Pi TUI via `/remote-control-pair`, but a mobile device also needs the daemon endpoint to claim the code. The daemon bind address may be `127.0.0.1` or `0.0.0.0`, neither of which is a usable mobile endpoint. Manual entry of a Tailscale URL plus a short-lived code is poor setup UX.

# Decision

`/remote-control-pair` displays a QR code in the Pi TUI. The QR code encodes a `pi-remote://pair` link containing the advertised daemon base URL, pair code, and expiration time. The same information is also shown as text fallback.

The daemon config supports `advertisedBaseUrl`, which is the URL iOS should use when claiming a pair code and making future API calls.

# Consequences

The iOS app can pair by scanning one QR code. Users must configure `advertisedBaseUrl` when automatic endpoint inference would produce a loopback or wildcard address. Pair-code creation remains TUI-originated only; the QR link does not grant access beyond the short-lived claim proof.
