# Publish on version tags

## Title

Publish on version tags

## Status

Accepted

## Context

The package should be published to npm reliably after a release is marked in git. Manual publishing can skip tests or publish a version that does not match the release tag.

## Decision

Use GitHub Actions for CI and npm publishing. Pushes and pull requests run install, test, lint, and build checks. Pushing a tag that matches `v*` additionally runs the same checks, verifies that the tag name without the leading `v` equals `package.json` `version`, and publishes to npm using the repository `NPM_TOKEN` secret.

## Consequences

Releases are created by updating `package.json`, committing the change, tagging the commit as `v<package-version>`, and pushing the tag.

Publishing requires an npm automation token stored as the GitHub Actions secret `NPM_TOKEN`.
