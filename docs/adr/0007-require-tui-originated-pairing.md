# Title

Require TUI-originated pairing

# Status

Accepted

# Context

Pairing creates bearer tokens for remote devices. Earlier design allowed unauthenticated pair-code creation from loopback and authenticated pair-code creation from remote clients. The new user flow is centered on explicit actions inside the Pi TUI, where the user is already present at the host-side control surface.

# Decision

Pair-code creation is only available from the Pi TUI extension through `/remote-control-pair`. The remote HTTP API does not provide a pair-code creation endpoint. The iOS app may claim a short-lived pair code, but it cannot request a new code remotely.

# Consequences

Pairing requires local intent from an active Pi TUI session and no longer depends on daemon bind address or remote address classification. Remote peers cannot initiate pairing-code generation. ADR 0004's loopback pair-code creation rule is superseded.
