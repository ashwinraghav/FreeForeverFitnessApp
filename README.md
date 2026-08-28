# TheFreeForeverFitnessApp

A fitness app that is free forever, and structurally incapable of becoming otherwise.

Not free-tier. Not freemium. Not free-until-we-raise. The features that cost money per user
are either engineered down to near zero, hard-capped, or deliberately not built.

**Status:** Phase 0, pre-alpha. Nothing works yet.

---

## Why this exists

The fitness app industry charges **$24–480/year** for a bundle whose software half costs roughly
**$0.03–0.12 per user per month** to actually operate. Barcode scanning is a free browser API
reading a public-domain government database — and it sits behind an $80/year paywall. Volume
charts are a SQL query. Progressive overload is arithmetic.

Three things in this category are genuinely expensive: paid humans, hosted video, and unmetered
AI. None of them are what most people open the app for. So: build everything else and give it
away without limits, meter the AI so hard it can never surprise us, and broker the human layer
through coaches instead of paying for it.

- [The business plan](docs/strategy/business-plan.md) — the full market analysis and cost model
- [The design system and execution plan](docs/strategy/execution-plan.md)
- [Decision log](docs/decisions/) — every consequential choice, with its reasoning

## The constitution

Eight rules that make "free forever" a build constraint rather than a marketing claim.
They are how we say no to a good idea that would quietly break the promise. See [ADR-0001](docs/decisions/0001-free-forever-constitution.md).

1. Every feature has a zero-cost path.
2. No unbounded per-user cost — quotas ship in the same PR as the feature.
3. No video hosting, ever.
4. No paid human in the loop.
5. Own the data, or don't ship the feature.
6. No ads, no data sale, no upsell, no dark patterns.
7. Export is unconditional and complete.
8. Give the improvements back.

## Built in the open

Public from the first commit — code, strategy, decisions, running costs, and the AI agent
transcripts that produced it all.

- **Costs are published.** The monthly cloud bill lands in `docs/strategy/costs/`. The claim
  should be auditable by anyone who doubts it.
- **Security rules are public**, therefore tested. `firestore.rules` is readable by any attacker,
  so its test suite blocks CI.
- **No secrets in this repository.** Contributors need no cloud account at all — `pnpm dev` runs
  the whole stack on the Firebase emulator with seeded fixtures.

## Getting started

```bash
pnpm install
pnpm dev          # starts the emulator suite + the app. No GCP account needed.
```

## Licence

Split, deliberately. AGPL-3.0 for the app so a hosted fork must publish its source;
Apache-2.0 for `packages/design-system` and `packages/core` so the reusable parts get reused.
Contributions under the DCO (`git commit -s`) — no CLA, no copyright assignment, which means
nobody can ever relicense this project out from under its contributors. See [LICENSING.md](LICENSING.md).
