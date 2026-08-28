# Contributing

## You do not need a Google Cloud account

That is the point. `pnpm dev` starts the Firebase Emulator Suite with seeded fixture data —
Auth, Firestore and Functions all run locally. No billing account, no project, no keys.

```bash
pnpm install
pnpm dev
```

## Never commit secrets

The repository is public. Before your first commit:

```bash
pnpm scan:secrets
```

**Safe to commit:** the Firebase *client* config. The web `apiKey` is a public project
identifier, not a credential — Firebase documents it as safe to expose. Protection comes from
Security Rules and App Check, not from hiding it.

**Never commit:** service-account JSON, Admin SDK credentials, AI provider API keys, App Check
debug tokens, Terraform state or `.tfvars`. Three layers guard this — a `gitleaks` pre-commit
hook, GitHub push protection, and a CI scan that fails the build. Do not defeat them.

## House rules

These are enforced by CI, not by review comments.

- **No raw literals.** No hex colours, `px` values or durations outside `packages/design-system`.
  Use tokens. This is what keeps parallel work coherent.
- **Stay in your lane.** Each area has an owning team and a directory. Need a change outside it?
  Raise it rather than reaching across.
- **Tests and a Storybook entry ship with the component**, not in a follow-up PR.
- **The zero-cost path ships first.** A feature's deterministic version must work standalone
  before an AI-assisted version is added on top. AI is a garnish, never load-bearing.
- **Accessibility is not negotiable.** WCAG 2.2 AA, 48px minimum hit targets (56px for anything
  tapped mid-set), never colour as the only signal, works at 200% text size.

## Decisions

Anything worth arguing about becomes an ADR in the same pull request:

```bash
pnpm adr "Use X instead of Y"
```

ADRs are immutable once accepted — supersede them with a new one rather than editing.

## Sign your commits

This project uses the [Developer Certificate of Origin](https://developercertificate.org/).

```bash
git commit -s
```

No CLA. You keep your copyright. The deliberate consequence is that this project can never be
relicensed or taken proprietary without every contributor agreeing — including by its author.
