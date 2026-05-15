# Display hex pairing payload

## Title

Display hex pairing payload

## Status

Accepted

## Context

ADR 0019 limited `/remote-control-pair` output to a QR code plus expiration time so the TUI would not print the numeric pair code or raw pairing link as plain text. That works for mobile clients that can scan the QR code, but desktop clients need a copy/paste pairing fallback.

The desktop fallback does not need to be a security boundary. It only needs to avoid showing the raw `pi-remote://pair?...` URL directly in terminal text.

## Decision

`/remote-control-pair` will continue to render the QR code and expiration time. It will also print a desktop pairing payload encoded as a UTF-8 hex string of the same pairing link embedded in the QR code.

The command still must not print the numeric pair code or raw pairing URL as separate text lines. Hex encoding is presentation obfuscation only; pairing security remains the short-lived pair code and expiration enforced by the daemon.

## Consequences

Mobile clients can keep scanning the QR code.

Desktop clients can copy the hex payload, decode it locally, and pair without camera access.

Terminal output contains more text than ADR 0019 allowed, but it still avoids directly displaying the raw pairing URL.
