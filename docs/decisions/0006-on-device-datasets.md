# ADR-0006: On-device static datasets over backend search

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

Food search is the highest-frequency read in a nutrition app. Every architecture that answers it from a backend converts a core interaction into a recurring per-user cost.

## Decision

Ship a versioned, compressed index of the most-used foods (target ~4MB gzipped, covering the large majority of searches) with the app. Search runs entirely on-device. A Cloud Run endpoint serves only the long tail. The exercise catalogue ships the same way.

## Consequences

Search is instant and works offline — better UX than the paid competitors, not merely cheaper. Cost: an index build pipeline (Team E), and a download-size budget that must be defended over time.

## Alternatives considered

A backend search API for everything. Rejected on rule 5 and cost. Bundling the full USDA + Open Food Facts corpus (tens of MB). Rejected on download size.
