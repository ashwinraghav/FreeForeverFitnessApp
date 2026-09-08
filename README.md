# TheFreeForeverFitnessApp

**A workout and food log that is free forever — and built so that it cannot become
anything else.**

Not free-tier. Not freemium. Not free-until-we-raise. The features that cost money for
each person using them are engineered down to near zero, hard-capped, or deliberately
not built. That is a constraint on the code, checked in the build, not a promise in a
blog post.

**[Open the app →](https://freeforeverfitness.app)** · no account, no install, works offline

[![CI](https://github.com/ashwinraghav/FreeForeverFitnessApp/actions/workflows/ci.yml/badge.svg)](https://github.com/ashwinraghav/FreeForeverFitnessApp/actions/workflows/ci.yml)
[![Licence: AGPL-3.0](https://img.shields.io/badge/licence-AGPL--3.0-blue.svg)](LICENSE)

---

## What this repository is

A pnpm monorepo holding the whole project — the app, the domain logic, the datasets it
ships, the infrastructure that serves it, and the reasoning behind every consequential
choice. Public from the first commit, including the parts most projects keep private:
the strategy, the running costs, and the AI agent transcripts that produced the code.

There are three things worth knowing before you read any of it:

1. **It is local-first.** Your log lives in your browser's own storage. There is no
   account and no server holding a copy, which is why the app works offline and why
   nobody — including its author — can look up your data.
2. **It was largely written by an AI agent** working from [`CLAUDE.md`](CLAUDE.md), under
   human direction and review. That shapes how contributions are handled rather than
   being a novelty claim.
3. **Claims here are meant to be checkable.** Where this README asserts something, it
   tries to say how you would verify it. An untrue claim is treated as a defect, and
   [the most valuable issue you can open](https://github.com/ashwinraghav/FreeForeverFitnessApp/issues/new?template=claim_is_wrong.yml)
   is one showing that a claim is wrong.

### Where things live

| Path | What it is | Licence |
|---|---|---|
| [`apps/web`](apps/web) | The PWA — React 19, Vite, offline-first. Everything a user touches. | AGPL-3.0 |
| [`packages/core`](packages/core) | Pure training and nutrition maths. No I/O, no framework. | Apache-2.0 |
| [`packages/design-system`](packages/design-system) | Tokens, primitives, the accessibility floor. | Apache-2.0 |
| [`packages/data`](packages/data) | Schemas, ids, units, the sync engine and security-rule contracts. | AGPL-3.0 |
| [`packages/datasets`](packages/datasets) | The food-index and exercise-catalogue build pipelines. | AGPL-3.0 |
| [`infra`](infra) | Terraform. Every cloud resource, no console changes. | AGPL-3.0 |
| [`docs/decisions`](docs/decisions) | 34 architecture decision records. Start here to understand *why*. | — |
| [`docs/strategy`](docs/strategy) | Business plan, cost model, execution plan. | — |
| [`.github/CI.md`](.github/CI.md) | What CI checks, what gates a deploy, and how it authenticates. | — |
| [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md) | The rules the project holds itself to, and where each is enforced. | — |

The two reusable packages are Apache-2.0 on purpose, so the parts worth reusing can be.
The app is AGPL-3.0 so a hosted fork has to publish its source. See
[LICENSING.md](LICENSING.md).

## The principles

Everything here follows from a short list, kept in one place:
**[docs/PRINCIPLES.md](docs/PRINCIPLES.md)** — the eight product rules, the five working
constraints, and an honest table of where each is actually enforced versus where it rests
on judgement. The summary below is a summary; that document is the source.

### The constitution — eight rules ([ADR-0001](docs/decisions/0001-free-forever-constitution.md))

1. Every feature has a zero-cost path.
2. No unbounded per-user cost — quotas ship in the same PR as the feature.
3. No video hosting, ever.
4. No paid human in the loop.
5. Own the data, or do not ship the feature.
6. No ads, no data sale, no upsell, no dark patterns.
7. Export is unconditional and complete.
8. Give the improvements back.

### How that shows up in the code

- **It has to work with no AI at all.** Every feature's deterministic version stands alone
  first; AI is a garnish, never load-bearing ([ADR-0016](docs/decisions/0016-ai-proxy-quotas-byok.md)).
- **Reads come from the device, never a query.** A server round-trip to draw your own
  history is treated as a bug ([ADR-0005](docs/decisions/0005-firestore-is-a-sync-engine.md)).
- **Accessibility is not negotiable.** WCAG 2.2 AA, 48px hit targets and 56px for anything
  tapped mid-set, works at 200% text, never colour as the only signal
  ([ADR-0013](docs/decisions/0013-design-direction-blueprint.md)).
- **No raw literals.** No hex colours, `px` or durations outside the design system. CI
  enforces it ([ADR-0021](docs/decisions/0021-no-raw-literals.md)).
- **Anything arguable becomes a decision record**, in the same pull request, and records
  are immutable once accepted — superseded, never edited.

### The design context, which explains the rest

The user is holding a weight in one hand, in bad light, out of breath, interrupted every
ninety seconds, for 45–90 minutes of screen-on time. No paragraphs in the workout flow.
One number per glance. A change that makes sense at a desk and not there is wrong.

---

## What it does today

Working and deployed: workout logging with progressive-overload suggestions, a
913-exercise catalogue, food logging against ~96,000 foods with barcode scanning, bodyweight
and progress photos, and charts for volume, records and adherence. It installs from the
browser and runs with the aeroplane mode on.

**Status:** usable, early, and honest about it. See
[what is not built yet](#what-is-not-built-yet).

## Seven things you can verify yourself

Not promises. Each one is checkable in your own browser in under a minute.

| | How to check it |
|---|---|
| **Nothing you log leaves your device** | DevTools → Network, then log a set. Every request is a `GET` for the app's own files. There is no `POST`. |
| **No account, ever** | There is no login screen to find. The app contains no authentication code. |
| **Zero cookies** | `document.cookie` is an empty string. That is also why there is no consent banner. |
| **No trackers, no third parties** | Every request goes to one domain. No analytics, no error reporter, no ad SDK, no font CDN. |
| **Works offline** | Open it once, turn off Wi-Fi, search for an exercise. |
| **Your data exports in one tap** | More → App → Download my data. Plain JSON, found by scanning storage at runtime rather than a hand-maintained list. |
| **Open source, licensed to stay open** | AGPL-3.0 means a hosted fork must publish its source. |

## Why this exists

The fitness app industry charges **$24–480/year** for a bundle whose software half costs
roughly **$0.03–0.12 per user per month** to operate. Barcode scanning is a free browser API
reading a public-domain government database — and it sits behind an $80/year paywall. Volume
charts are a SQL query. Progressive overload is arithmetic.

Three things in this category are genuinely expensive: paid humans, hosted video and
unmetered AI. None of them are what most people open the app for. So: build everything else
and give it away without limits, meter the AI so hard it can never surprise anyone, and
broker the human layer through coaches rather than paying for it.

- [The business plan](docs/strategy/business-plan.md) — market analysis and cost model
- [The execution plan](docs/strategy/execution-plan.md)
- [All 34 decision records](docs/decisions/) — every consequential choice, with its reasoning

## Built in the open, including the awkward parts

- **Security rules are public, therefore tested.** `firestore.rules` is readable by any
  attacker, so its test suite blocks CI ([ADR-0015](docs/decisions/0015-public-rules-need-tests.md)).
- **No secrets in this repository.** Contributors need no cloud account at all.
- **2,406 automated tests** — and a written list of the ways this repository's own tests
  have fooled it, in [`CLAUDE.md`](CLAUDE.md), because a green suite that never ran is
  worse than a red one.
- **The decision records include the wrong turns.** Superseded in public rather than
  deleted, with the reasoning that failed left readable.

## Getting started

```bash
pnpm install
pnpm dev            # the app on http://localhost:5173
```

That is genuinely all of it. The app is local-first and talks to no backend, so there is no
account, no key and no service to run.

Only if you are working on sync or security rules:

```bash
pnpm emulators      # Firebase Emulator Suite, separately
```

Useful commands:

```bash
pnpm verify         # typecheck + lint + every suite — exactly what CI runs
pnpm test           # every suite
pnpm lint           # includes the no-raw-literals rule
pnpm adr "Title"    # start a decision record
pnpm scan:secrets   # gitleaks, same scan CI runs
```

## Contributing

**Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.** It is stricter than most projects
and explains why. Using an AI agent? Point it at [AGENTS.md](AGENTS.md).

The short version:

- **Open an issue before writing code.** Unsolicited pull requests are closed unreviewed.
- **AI assistance is allowed, must be disclosed** with an `Assisted-by:` trailer, and you
  must be able to explain the code without going back to the model.
- **Agent-submitted PRs with no human in the loop are closed on sight.**
- One rule above all: a contribution has to be worth more than the time it takes to review.

The most valuable issue you can open is one pointing out that a claim in this repository is
not true.

## What is not built yet

A README that implies everything is finished is a README that cannot be trusted about
anything else.

- **No accounts and no sync.** Your log lives on one device — take a backup.
- **No importers** from MyFitnessPal, Strong or Hevy.
- **Food coverage outside the US is thin.** Custom foods and recipes fill the gap.
- **No tape-measurement logging**, though the chart for it exists.
- **No native app.** It installs from the browser and behaves like one.
- **Two of our own promises are unkept:** [ADR-0020](docs/decisions/0020-publish-monthly-costs.md)
  commits to publishing the monthly cloud bill and
  [ADR-0019](docs/decisions/0019-publish-redacted-agent-log.md) to publishing the build
  transcripts. Both directories exist and both are still empty.
- **Lighthouse does not gate deploys yet**, so an accessibility regression could in
  principle ship.

## Licence

Split, deliberately.

- **AGPL-3.0** for the app, so a hosted fork must publish its source.
- **Apache-2.0** for `packages/design-system` and `packages/core`, so the genuinely reusable
  parts get reused.

Contributions under the [DCO](https://developercertificate.org/) (`git commit -s`) — no CLA,
no copyright assignment. The deliberate consequence is that nobody can relicense this project
out from under its contributors, including its author. See [LICENSING.md](LICENSING.md).
