# Use npm trusted publishing

## Title

Use npm trusted publishing

## Status

Accepted

## Context

ADR 0027 added npm publishing on `v*` tags using a GitHub Actions secret named `NPM_TOKEN`. npm supports Trusted Publishing for GitHub Actions through OIDC, which avoids storing long-lived npm automation tokens in repository secrets.

## Decision

Publish releases with npm Trusted Publishing instead of `NPM_TOKEN`.

The publish job keeps `id-token: write` permission and runs `npm publish --provenance --access public` without `NODE_AUTH_TOKEN`. The npm package must be configured to trust this GitHub repository and workflow in npm's package publishing settings.

This supersedes the token-authentication part of ADR 0027. The `v*` tag trigger, verification steps, and tag/package-version match check remain unchanged.

## Consequences

The repository no longer needs an `NPM_TOKEN` secret for publishing.

Publishing succeeds only after the npm package has a Trusted Publisher entry for this GitHub Actions workflow.
