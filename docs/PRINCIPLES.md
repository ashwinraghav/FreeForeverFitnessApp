# Principles

The canonical statement. Everywhere else — the README, the landing page,
[`CLAUDE.md`](../CLAUDE.md), [`AGENTS.md`](../AGENTS.md),
[`CONTRIBUTING.md`](../CONTRIBUTING.md) — summarises this and links here rather than
restating it.

That indirection has a reason. These rules were written in six places, and the copies had
already drifted: one said "eight rules", another "five constraints", a third "five rules",
and a reader hitting two of them reasonably concluded one was out of date. They were not
the same list counted differently. They are two different lists, and nothing said so.

## There are two layers

**The constitution** governs what the *product* may ever do. It is a business decision,
and it is what makes "free forever" structural rather than a promise somebody can revoke.

**The working constraints** govern how *code* gets written. They are engineering rules,
mostly enforced by CI, and they exist to keep the constitution true in practice.

A feature can satisfy every working constraint and still be refused by the constitution.
That is the point of having both.

---

## Layer 1 — the constitution

Eight rules. Source: [ADR-0001](decisions/0001-free-forever-constitution.md).

1. **Every feature has a zero-cost path.** If the metered version fails or is disabled,
   the feature still works.
2. **No unbounded per-user cost.** Any metered feature ships with its hard cap in the
   same change — never "later".
3. **No video hosting, ever.** Static loops for demonstration, links out for the rest.
4. **No paid human in the loop.** Including support.
5. **Own the data, or do not ship the feature.** No per-call third-party dependency in
   the critical path.
6. **No ads, no data sale, no upsell, no dark patterns.**
7. **Export is unconditional and complete.**
8. **Give the improvements back.**

These are refusals as much as commitments. Features have been rejected under rules 3, 4
and 6, and [ADR-0017](decisions/0017-no-public-social-feed.md) is rule 6 applied to a
social feed.

## Layer 2 — the working constraints

Five rules, day to day. Source: [`CLAUDE.md`](../CLAUDE.md), which is the brief the AI
agent that wrote most of this codebase works from.

1. **Free forever is a build constraint.** No feature may add unbounded per-user cost.
   Quotas ship in the same PR as the feature they bound. ([ADR-0001](decisions/0001-free-forever-constitution.md))
2. **The zero-cost path ships first.** A feature's deterministic version must work
   standalone before an AI-assisted version is layered on. AI is a garnish, never
   load-bearing. ([ADR-0016](decisions/0016-ai-proxy-quotas-byok.md))
3. **Firestore is a sync engine, never a query engine.** Reads come from the local cache;
   analytics read locally materialised aggregates. A query that renders a chart is a bug,
   not an optimisation. ([ADR-0005](decisions/0005-firestore-is-a-sync-engine.md))
4. **No raw literals.** No hex colours, raw `px` spacing or durations outside
   `packages/design-system`. Tokens only, CI-enforced. ([ADR-0021](decisions/0021-no-raw-literals.md))
5. **This repository is public.** No secrets, ever. ([ADR-0010](decisions/0010-commit-firebase-client-config.md), [SECURITY.md](../SECURITY.md))

### And one that is not negotiable

**Accessibility.** WCAG 2.2 AA. 48px minimum hit targets, 56px for anything tapped
mid-set. Never colour as the only signal. Works at 200% text. Full keyboard operation
with a visible focus ring. CI-enforced, not a review comment.
([ADR-0013](decisions/0013-design-direction-blueprint.md))

## Where each one is actually enforced

A principle nobody checks is a preference. This is the honest accounting.

| Principle | Enforced by | Real? |
|---|---|---|
| No raw literals | `pnpm lint`, a custom ESLint rule | Yes, blocks the build |
| Hit targets and contrast | `hit-targets.test.ts` against the stylesheet | Yes, blocks the build |
| Accessibility score ≥ 95 | `lighthouse.yml`, a required status check | Yes — blocks the merge, and `main` is the only thing that deploys |
| Security rules tested | `ci.yml` rules job | Yes, blocks the build |
| No secrets | pre-commit hook, push protection, CI scan | Yes, three layers |
| Quotas ship with the feature | Review only | **Judgement, not machinery** |
| No unbounded per-user cost | Review, and ADR-0020's published bill | **The bill is not published yet** |
| Decisions written down | Review only | Judgement |

Two of those rows are uncomfortable and are left in deliberately. The cost claim rests on
a bill that [ADR-0020](decisions/0020-publish-monthly-costs.md) promises and
`docs/strategy/costs/` does not yet contain, and the accessibility gate does not actually
gate. Both are listed in the README's open items.

## The design context

Not a rule, but it decides more arguments than the rules do.

The user is holding a weight in one hand, in bad light, out of breath, interrupted every
ninety seconds, for 45–90 minutes of screen-on time. No paragraphs in the workout flow.
No modals during a workout — losing entered sets to a dismissed dialog is the worst
failure in this category. One number per glance.

A change that makes sense at a desk and not there is wrong, however good the code.

## Changing any of this

Write a superseding [ADR](decisions/). Records are immutable once accepted; a principle
that turned out wrong is replaced in the open with the failed reasoning left readable, not
edited into looking correct.
