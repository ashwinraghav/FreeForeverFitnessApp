# ADR-0008: PWA first, Capacitor shell at Phase 2

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

Native distribution costs money, adds a review queue to the critical path, and — given the AGPL choice in ADR-0003 — carries an unresolved App Store licence conflict. But HealthKit and Health Connect are native-only, and they matter.

## Decision

Ship an installable PWA. Add a thin Capacitor shell at Phase 2, wrapping the same codebase, purely for HealthKit, Health Connect and home-screen widgets.

## Consequences

Phase 0 and 1 have zero distribution cost, instant updates and no review latency. One codebase throughout — no rewrite. The AGPL/App Store question is deferred, not answered, and must be resolved before any store submission.

## Alternatives considered

React Native or Expo from the start — better native integration, but a separate codebase and a much slower path to something shippable. Rejected.
