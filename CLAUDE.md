# Working in this repository

Read [`docs/decisions/README.md`](docs/decisions/README.md) before making any architectural choice.
The ADRs are binding, not advisory. If you disagree with one, write a superseding ADR — do not
quietly work around it.

## The five constraints that govern everything

1. **Free forever is a build constraint.** No feature may add unbounded per-user cost.
   Quotas ship in the same PR as the feature they bound. (ADR-0001)
2. **The zero-cost path ships first.** A feature's deterministic version must work standalone
   before an AI-assisted version is layered on. AI is a garnish, never load-bearing. (ADR-0016)
3. **Firestore is a sync engine, never a query engine.** Reads come from the local cache;
   analytics read locally materialised aggregates. A Firestore query that renders a chart is a
   bug, not an optimisation opportunity. (ADR-0005)
4. **No raw literals.** No hex colours, raw `px` spacing or durations outside
   `packages/design-system`. Tokens only — CI enforces it. (ADR-0021)
5. **This repository is public.** No secrets, ever. The Firebase *client* config is safe and
   committed deliberately; service-account keys, provider API keys and Terraform state are not.
   (ADR-0010, SECURITY.md)

## File ownership

Teams write only inside directories they own (ADR-0018). Need a change elsewhere? Report it to
the integrator rather than reaching across.

| Area | Owns |
|---|---|
| design-system | `packages/design-system` |
| domain-model | `packages/data` (except `src/sync`), `firestore.rules`, `storage.rules` |
| sync | `packages/data/src/sync`, Firebase client init, **App Check enforcement** |
| workout | `apps/web/src/features/workout`, `packages/core/src/training` |
| nutrition | `apps/web/src/features/nutrition`, `packages/core/src/nutrition` |
| insights | `apps/web/src/features/insights` |
| infra | `infra/`, `.github/` |
| datasets | `packages/datasets` |
| integrator | root config, `apps/web/src/app`, `apps/web/src/shell`, **CSP**, **service worker** |

Root config (`package.json`, `tsconfig.base.json`, `apps/web/src/app/routes.ts`) is
integrator-only. Feature teams never edit the route manifest — four teams appending to one
array is exactly the collision this model exists to prevent.

## Before any fan-out: audit this map (ADR-0023)

Strict ownership converts collision risk into **coverage** risk. It prevents two agents
touching one file; it does nothing about a file nobody was assigned, and nobody reports a
gap in their own brief. That is how the Cloud Storage ruleset came to be missing while
every Firestore rule was carefully tested.

So before each fan-out the integrator enumerates every security-relevant artefact and
confirms each has a named owner. Currently: `firestore.rules`, `storage.rules`, Content
Security Policy, the service worker, App Check enforcement, auth and account-linking, and
(from Phase 3) the AI proxy and its quotas. **An artefact with no owner is a defect in this
map, not an oversight by a team.**

## Two jsdom traps that make tests pass for the wrong reason

Both found the hard way. A test that passes because it never exercised anything is
worse than a failing one, so check for these before trusting a green DOM suite.

**1. `import.meta.url` is rewritten under the jsdom project.** Vite prefixes it with
`/@fs` **and drops the trailing slash from `URL.pathname`**, while the node project keeps
it — so a naive join produces `.../buildmanifest.json` and silently misses every file. A
stubbed `fetch` then 404s, and assertions about "not found" behaviour pass against an
index that never loaded. Use the shared fixture-path helper rather than building paths by
hand, and **make your fetch stub throw on a missing fixture rather than returning a
404** — then a broken path fails loudly instead of quietly confirming what you expected.

**2. jsdom defines `DecompressionStream` but its `Blob` has no `.stream()`.** Feature
detection therefore says gunzip is available and the call throws. Serve
pre-decompressed bytes in tests; the datasets reader supports that path explicitly.

The general rule: when a DOM test asserts a negative — not found, unsupported,
degraded — prove the positive case works in the same file. Otherwise you cannot tell a
real negative from a harness that never ran.

## Accessibility is not negotiable

WCAG 2.2 AA. 48px minimum hit targets, 56px for anything tapped mid-set. Never colour as the
only signal. Works at 200% text size. Full keyboard operation with a visible focus ring.
These are CI-enforced, not review comments. (ADR-0013)

## The design context

The user is holding a weight in one hand, in bad light, out of breath, interrupted every 90
seconds, for 45–90 minutes of screen-on time. No paragraphs in the workout flow. No modals
during a workout — losing entered sets to a dismissed dialog is the worst failure mode in this
category. One number per glance.

## Conventions

- TypeScript strict. No `any`, no non-null assertions without a comment justifying them.
- Tests and a Storybook entry ship with a component, not in a follow-up.
- Commits are signed off: `git commit -s` (DCO, ADR-0003).
- Anything worth arguing about becomes an ADR in the same PR: `pnpm adr "Title"`.
