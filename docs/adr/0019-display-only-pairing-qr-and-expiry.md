# Display only pairing QR and expiry

## Title

Display only pairing QR and expiry

## Status

Accepted

## Context

`/remote-control-pair` previously displayed the numeric pair code and raw pairing link as text fallback in addition to the QR code. The app pairing flow uses the QR code, and showing the raw bootstrap code and full link in the TUI adds unnecessary sensitive and noisy output.

## Decision

`/remote-control-pair` displays only the QR code and its expiration time. The pair code and pairing link remain encoded inside the QR code but are not printed as separate TUI text lines.

This supersedes the text-fallback display portion of ADR 0008.

## Consequences

The pairing output is shorter and exposes less bootstrap material in terminal text.

Users pair by scanning the QR code before the displayed expiration time.
