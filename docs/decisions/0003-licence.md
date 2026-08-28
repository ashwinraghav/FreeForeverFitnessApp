# ADR-0003: Split licence: AGPL-3.0 for the app, Apache-2.0 for reusable packages

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

A permissive licence lets a funded competitor fork the work and add the paywall we exist to avoid. A strong copyleft licence protects against that but conflicts with Apple App Store distribution terms — the problem VLC hit — and deters contribution.

## Decision

Split the repository. `apps/**`, `functions/**` and `packages/data` are AGPL-3.0-or-later. `packages/design-system` and `packages/core` are Apache-2.0 so the genuinely reusable parts get reused. Contributions under the DCO (`git commit -s`), with no CLA and no copyright assignment.

## Consequences

A hosted fork must publish its source, which protects the thesis. Because there is no CLA, the project **cannot** be relicensed or dual-licensed later without every contributor's agreement — including by its original author. That is intentional and is the strongest available guarantee that this cannot be taken proprietary. The cost: shipping to the App Store under AGPL is a genuine open problem, and the PWA-first approach (ADR-0008) sidesteps it for now rather than solving it.

## Alternatives considered

Apache-2.0 throughout — simpler, no store conflict, but fork-and-paywall is legal. AGPL throughout — maximum protection, but restricts reuse of the design system and core maths for no real benefit.
