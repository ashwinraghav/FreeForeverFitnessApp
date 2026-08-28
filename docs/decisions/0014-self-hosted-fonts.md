# ADR-0014: Self-hosted subset variable fonts

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

A Google Fonts CDN link is a third-party request that fails offline, leaks user IPs to another party, and blocks first render.

## Decision

Fonts are self-hosted, subset to latin, WOFF2, variable where possible. Total font budget ~120KB.

## Consequences

The app renders fully offline with zero third-party requests. Cost: a font subsetting step in the build, and discipline about weights.

## Alternatives considered

Google Fonts CDN — rejected on the offline requirement, which is non-negotiable for a gym app in a basement.
