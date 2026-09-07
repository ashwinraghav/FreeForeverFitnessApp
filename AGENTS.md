# AGENTS.md

Instructions for an AI coding agent working in this repository. Read this before
changing anything.

This file exists because [`CLAUDE.md`](CLAUDE.md) is the *maintainer's* brief — written
for sessions that own the whole repository, with roles like "the integrator" and a
parallel-agent fan-out protocol that will not apply to you. It is worth reading for the
hard-won traps, but it is not your contract. This is.

## Before anything else

**You may not open a pull request that nobody asked for.** Find or open an issue, get it
accepted, then write code. An unrequested PR is closed unreviewed — see
[CONTRIBUTING.md](CONTRIBUTING.md) for why, and it is not about code quality.

**Disclose that you were used.** A trailer on the commit:

```
Assisted-by: <tool name and version>
```

**Your human must be able to explain the change without you.** That is the actual bar. If
the honest answer to "why is this branch here" would be "the model wrote it", the change
is not ready. You are not an author here and cannot be accountable for anything.

## One command to check your work

```bash
pnpm install
pnpm verify      # typecheck, lint, every test suite, and the sync suite — exactly what CI runs
```

`pnpm verify` is what the CI `verify` job runs, in the same order. If it passes locally and
fails in CI, that difference is a bug worth reporting.

```bash
pnpm dev         # the app on http://localhost:5173 — no account, no backend, no emulator
```

## Five things that will make your work wrong here

These are not style preferences. Each one has cost this project a real bug, and CI cannot
catch most of them.

### 1. A green test suite here does not mean the code works

`jsdom` has no layout engine. **Every element reports zero size**, so the whole suite
passes at every viewport because it cannot see one. Four real layout bugs have shipped
past a green suite — a control pushed off the right edge, a button that grew to 624px, a
tab bar 498px wide inside a 412px phone.

If you touch anything visual you must open a real browser at **412px and at 200% text**
and look. If you cannot, say so in the PR rather than implying it was checked.

`CLAUDE.md` lists five further ways this repository's own tests have fooled it — a closed
`<dialog>` still being in the DOM, an element never being its own container-query
container, a CSS guard that only guards the package it parses. Read that section before
writing a test that asserts something is absent.

### 2. A test asserting a negative must prove the positive in the same file

"Not found", "unsupported", "renders nothing" — all pass when the harness never ran. Prove
the positive case in the same file or you cannot tell the difference. This has produced
green tests for code that could never execute, and a test asserting a reload flag that the
library ignores entirely.

### 3. Measure, do not reason, about numbers

The rule this project keeps relearning: **a mechanism that plausibly could fire is not
evidence that it did, and a number moving in the right direction is not evidence it
crossed the line.**

A contrast ratio was computed at 5.37, an `opacity: .85` was noticed, and "still above
4.5" was asserted. It was 4.23 and it failed the accessibility gate. Compute it.

### 4. No raw literals outside the design system

No hex colours, no raw `px` spacing, no raw durations outside `packages/design-system`.
Tokens only, and **verify the token exists** — four invented token names once passed review
and silently resolved to nothing. `pnpm lint` enforces the rule but cannot tell you a
token is fictional.

### 5. Do not run a formatter across the repository

There is no Prettier here and no formatting config. `pnpm format` used to exist and was
removed: Prettier was not a dependency, so it would have downloaded and reformatted
everything with its own defaults, and ESLint has no stylistic rules to catch it. Match the
code around you.

## Stay inside the boundary

[`.github/CODEOWNERS`](.github/CODEOWNERS) is the machine-readable version of ADR-0018.
Root config, `apps/web/src/app/`, `apps/web/src/shell/`, the security rules, `infra/` and
the decision records are the maintainer's. Need a change there? Say so in the issue.

Ownership is per **directory**, so it cannot see a collision in a shared **string**. Two
components once styled the same class name from different owned files and silently fought.
Grep the other packages before claiming a CSS class name.

## Constraints that reject features outright

Proposing something that breaks one of these wastes your human's time.

- **No unbounded per-user cost.** If it costs money for each person using it, the quota
  ships in the same change — or the feature is not built ([ADR-0001](docs/decisions/0001-free-forever-constitution.md)).
- **It must work with no AI at all.** The deterministic version stands alone first. AI is a
  garnish, never load-bearing ([ADR-0016](docs/decisions/0016-ai-proxy-quotas-byok.md)).
- **Reads come from the device.** A server round-trip to draw the user's own history is a
  bug, not an optimisation ([ADR-0005](docs/decisions/0005-firestore-is-a-sync-engine.md)).
- **Accessibility is not negotiable.** WCAG 2.2 AA, 48px hit targets and 56px for anything
  tapped mid-set, works at 200% text, never colour alone ([ADR-0013](docs/decisions/0013-design-direction-blueprint.md)).
- **No modals during a workout.** Losing entered sets to a dismissed dialog is the worst
  failure in this category.

## The design context, which explains most of the odd decisions

The user is holding a weight in one hand, in bad light, out of breath, interrupted every
ninety seconds, for 45–90 minutes of screen-on time. No paragraphs in the workout flow.
One number per glance. If a change makes sense at a desk and not there, it is wrong.

## Decisions

Anything arguable becomes a record in the same pull request:

```bash
pnpm adr "Title"
```

Records are **immutable once accepted**. Supersede with a new one; never edit an accepted
record to match what you did.

## Never

- Commit a secret. A pre-commit hook, GitHub push protection and a CI scan all guard this
  — do not defeat them, and do not add an ignore entry without a comment saying why the
  value is safe.
- `git push --force` to `main`, or rewrite published history, without being asked.
- `git reset --hard`, `git clean -fd`, or `git stash drop` when there is uncommitted work
  in the tree that is not yours. That destroyed eleven files of a parallel session's work
  in this repository, recoverable only because the dropped stash object had not been
  pruned yet.
- Claim you checked something you did not check. An unverified claim in this codebase is
  treated as a defect, and the most valuable issue anyone can open is one showing that a
  claim here is untrue.
