# Title

Use central Push Gateway routes instead of APNs credentials

# Status

Accepted

# Context

The daemon can observe Agent Settlement while the iOS app may be suspended, but sending a remote notification requires APNs provider credentials. Shipping the App Store bundle's APNs private key in this public package or copying it to every daemon would make that credential broadly extractable.

# Decision

The daemon stores only an opaque Push Route registered by an authenticated paired device. On Agent Settlement it sends a fixed completion event and idempotency key to a configured central Push Gateway. The gateway owns APNs device tokens, APNs provider credentials, payload rendering, route revocation, invalid-token cleanup, and delivery rate limits.

The daemon does not accept an arbitrary gateway URL from iOS and does not send prompt text, assistant output, paths, project names, or session names. It sends only the opaque route and identifiers required for the generic notification to open the corresponding session.

# Consequences

The daemon gains a dependency on the gateway for completion alerts but never handles APNs credentials or device tokens. Push Routes are bearer capabilities and must be stored in owner-only daemon state, associated with the authenticated paired device, and removed when disabled or revoked.
