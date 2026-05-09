# Title

Allow loopback pair code creation without token

# Status

Accepted

# Context

Pairing is the bootstrap path that creates the first device bearer token. Requiring an existing bearer token for every `POST /v1/pair/code` request creates a circular dependency for first-time setup. At the same time, allowing unauthenticated pair code creation on Tailscale-reachable or public bind addresses would let any network peer initiate device pairing.

# Decision

Allow unauthenticated `POST /v1/pair/code` only when the daemon is bound to a loopback address: `127.0.0.1`, `localhost`, or `::1`. For non-loopback bind addresses, pair code creation requires bearer authentication. `POST /v1/pair/claim` remains unauthenticated because the pair code itself is the short-lived proof.

# Consequences

First-time setup works from the host through the CLI or Pi extension without a pre-existing token. Remote pair-code creation is still protected when the daemon is reachable over Tailscale or other non-loopback interfaces. Users who bind directly to a Tailscale IP need an existing token or must temporarily create the pair code through a loopback-bound daemon session.
