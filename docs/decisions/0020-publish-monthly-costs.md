# ADR-0020: Publish the monthly cloud bill in-repo

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

The free-forever claim is an assertion about running costs. Assertions about costs should be checkable.

## Decision

A monthly GCP billing export is committed to `docs/strategy/costs/`.

## Consequences

The central claim becomes auditable by anyone who doubts it, and cost regressions become publicly visible — a strong incentive to keep rule 2 of ADR-0001. Cost: the billing export must be scrubbed of account identifiers.

## Alternatives considered

Publishing nothing, or publishing a summary we write ourselves. Both are weaker evidence for a claim that is easy to make and hard to trust.
