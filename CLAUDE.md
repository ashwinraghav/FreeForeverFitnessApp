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
| domain-model | `packages/data`, `firestore.rules` |
| workout | `apps/web/src/features/workout`, `packages/core/src/training` |
| nutrition | `apps/web/src/features/nutrition`, `packages/core/src/nutrition` |
| insights | `apps/web/src/features/insights` |
| infra | `infra/`, `.github/` |
| datasets | `packages/datasets` |

Root config (`package.json`, `tsconfig.base.json`, route manifests) is integrator-only.

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
