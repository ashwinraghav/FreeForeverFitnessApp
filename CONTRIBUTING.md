# Contributing

Read this before opening a pull request. It is stricter than most projects, and the
reasons are given rather than asserted.

## The one rule everything else follows from

> **A contribution has to be worth more to this project than the time it takes to
> review it.**

That is [LLVM's golden rule](https://llvm.org/docs/AIToolPolicy.html), and it is the only
test that matters here. It is not about how the code was written. It is about whether the
total cost — reviewing, questioning, merging, and living with it — is less than the value.

Generating a plausible patch now costs almost nothing. Reviewing one costs exactly what it
always did. Every policy below exists because of that asymmetry, and for no other reason.

## Open an issue first. Always.

**Unsolicited pull requests are closed without review.** Not out of rudeness — because a
PR nobody asked for is a bill nobody agreed to pay.

1. Open an issue describing the problem.
2. Wait for it to be accepted and assigned to you.
3. Then write the code.

The only exceptions are a typo fix, or a one-line change to something already agreed in an
issue. If in doubt, it is not an exception.

## AI-assisted contributions

**Allowed, disclosed, and you are accountable.**

This codebase was largely written by an AI agent working from [`CLAUDE.md`](CLAUDE.md), and
[ADR-0019](docs/decisions/0019-publish-redacted-agent-log.md)
commits to publishing those transcripts. A project built this way has no standing to ban
the tools. What it can insist on is that a human is answerable.

**Required:**

- **Disclose it.** Add a trailer to the commit:
  ```
  Assisted-by: <tool name and version>
  ```
- **Review every line before you ask anyone else to.** You are the author. The tool is not
  a co-author and is not a defence.
- **Be able to explain it without going back to the model.** If a reviewer asks why a
  branch exists and the honest answer is "the model put it there", the PR is not ready.
  This is the whole bar. Everything else is detail.

**Refused outright:**

- **Agent-submitted pull requests with no human in the loop.** Closed on sight, no
  discussion.
- **AI on issues labelled `good first issue`.** Those exist so a human can learn this
  codebase. A model taking them removes the only reason they are there.
- **Volume.** Several PRs at once from one contributor, none of them requested, is treated
  as noise regardless of quality.

### Why this shape, specifically

Because the failure mode is measured, not imagined:

- Excalidraw took **more than twice** as many PRs in Q4 2025 as in Q3
  ([LeadDev](https://leaddev.com/software-quality/open-source-has-a-big-ai-slop-problem)).
- curl's security queue passed **20% AI-generated reports** by mid-2025, roughly two a week
  ([The New Stack](https://thenewstack.io/ai-generated-code-crisis/)).
- A CodeRabbit study of 470 PRs found about **1.7× more issues** in AI-co-authored ones
  than in human-written ones.
- Agoda measured experienced developers **19% slower** with AI tools, attributed to
  comprehension debt — understanding less of your own codebase over time.
- tldraw closed external pull requests **entirely**, its founder calling the inflow
  "well-formed noise".

The lesson worth taking from that is not "AI bad". It is that projects which said nothing
were forced into the harshest possible policy later. Saying it clearly now is what keeps
this repository open to contributions at all.

## Before you write any code

### You do not need a Google Cloud account

```bash
pnpm install
pnpm dev            # the web app on http://localhost:5173 — nothing else required
```

The app is local-first and does not talk to a backend, so this is genuinely all you need
for almost everything.

Only if you are working on sync or security rules:

```bash
pnpm emulators      # Firebase Emulator Suite, separately
```

### Never commit secrets

This repository is public.

```bash
pnpm scan:secrets
```

**Safe:** the Firebase *client* config. The web `apiKey` is a public project identifier,
documented by Firebase as safe to expose; protection comes from Security Rules and App
Check, not from hiding it ([ADR-0010](docs/decisions/0010-commit-firebase-client-config.md)).

**Never:** service-account JSON, Admin SDK credentials, AI provider keys, App Check debug
tokens, Terraform state or `.tfvars`. A `gitleaks` pre-commit hook, GitHub push protection
and a CI scan all guard this. Do not defeat them.

## House rules, all enforced by CI

Not review comments. The build fails.

- **No raw literals.** No hex colours, `px` values or durations outside
  `packages/design-system`. Tokens only ([ADR-0021](docs/decisions/0021-no-raw-literals.md)).
- **Accessibility is not negotiable.** WCAG 2.2 AA, 48px minimum hit targets and 56px for
  anything tapped mid-set, never colour as the only signal, works at 200% text
  ([ADR-0013](docs/decisions/0013-design-direction-blueprint.md)).
- **The zero-cost path ships first.** A feature's deterministic version must stand alone
  before anything AI-assisted is layered on. AI is a garnish, never load-bearing
  ([ADR-0016](docs/decisions/0016-ai-proxy-quotas-byok.md)).
- **No unbounded per-user cost.** If a feature needs a quota to be safe, the quota ships in
  the same pull request ([ADR-0001](docs/decisions/0001-free-forever-constitution.md)).
- **Tests ship with the change**, not in a follow-up. A component brings a Storybook entry
  too.
- **Stay in your lane.** Each area has an owning directory
  ([ADR-0018](docs/decisions/0018-monorepo-file-ownership.md)).
  Need a change outside it? Say so in the issue rather than reaching across.

### Two things CI cannot check, so you must

- **jsdom has no layout engine.** Every element reports zero size, so the suite is green at
  every viewport because it cannot see one. Open a real browser at 412px and at 200% text
  before calling a screen done. This has cost four real bugs, each found only by looking.
- **A test that asserts a negative must prove the positive in the same file.** Otherwise
  you cannot tell a real negative from a harness that never ran. `CLAUDE.md` lists five
  ways this repository has already been fooled.

## Decisions

Anything worth arguing about becomes an ADR in the same pull request:

```bash
pnpm adr "Use X instead of Y"
```

ADRs are immutable once accepted. Supersede them with a new one; never edit one to match
what you did. If you disagree with an accepted ADR, write the superseding record — do not
quietly work around it.

## Commits

Sign off with the [DCO](https://developercertificate.org/):

```bash
git commit -s
```

No CLA and no copyright assignment. You keep your copyright, and the deliberate consequence
is that this project cannot be relicensed or taken proprietary without every contributor
agreeing — including by its author.

Commit messages explain **why**, not what. The diff already says what. A message that would
have saved the next person an hour is worth the ten minutes it takes to write.

## What gets a fast yes

- A bug report with the steps that reproduce it.
- A failing test, on its own, for a bug you found.
- A fix to something in [the open items](README.md#what-is-not-built-yet).
- Anything that deletes code without losing behaviour.
- Pointing out that a claim in this repository is not true. Those are the most valuable
  issues here, and there is no such thing as a rude one.
