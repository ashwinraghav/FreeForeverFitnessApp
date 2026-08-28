# ADR-0001: The free-forever constitution

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

"Free forever" is a promise that decays unless something structural enforces it. Every app in this category started free. The decay is never one big betrayal; it is a sequence of individually reasonable features that each add a little recurring per-user cost, until a paywall becomes the only way out.

## Decision

Eight rules govern every feature decision:

1. **Every feature has a zero-cost path.** If the metered version fails or the budget runs out, the feature degrades — it never disappears.
2. **No unbounded per-user cost.** Any metered feature ships with its hard ceiling implemented, in the same pull request. Not a TODO, not a monitoring alert.
3. **No video hosting, ever.** Static loops for demonstration, links out for anything longer.
4. **No paid human in the loop.** Including support.
5. **Own the data, or don't ship the feature.** No per-call third-party API on a path users touch daily.
6. **No ads, no data sale, no upsell, no dark patterns.**
7. **Export is unconditional and complete.**
8. **Give the improvements back.**

## Consequences

Rules 1 and 2 are the expensive ones — they mean AI features take roughly twice the work, because the deterministic version must be built and shipped first. That cost is the point. Rule 6 forecloses every conventional monetisation path, which makes ADR-0002 (open source) and the coach-side model load-bearing rather than idealistic.

## Alternatives considered

A conventional freemium model was the obvious alternative and is rejected outright: the moment a paid tier exists, every roadmap decision starts getting made in its favour, and the free tier becomes a funnel rather than a product.
