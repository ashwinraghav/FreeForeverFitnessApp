# ADR-0007: Serve exercise media from the public repo via jsDelivr

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

Firebase Hosting includes 10GB/month of transfer and then charges **$0.15/GB**. Exercise demo media is the largest static payload in the app and is identical for every user — precisely the traffic pattern that turns egress pricing into an unbounded cost.

## Decision

Exercise demo loops live in the public GitHub repository and are served through jsDelivr's free CDN. Versioned by git tag and cached immutably.

## Consequences

The media bill is $0 at any scale. **This saving exists only because the project is open source** — a direct, quantified return on ADR-0002. It creates a dependency on a third-party free CDN, mitigated by the assets being plain files in a git repo that can be re-pointed at any other host in one config change.

## Alternatives considered

Firebase Hosting (rejected: egress). Cloud Storage + Cloud CDN (rejected: still ~$0.12/GB). Cloudflare R2 with zero egress — genuinely viable and remains the fallback if jsDelivr becomes unsuitable.
