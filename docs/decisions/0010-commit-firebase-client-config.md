# ADR-0010: Commit the Firebase client config; emulator-first development

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

In a public repository, the Firebase web config looks like a leaked credential. It is not — the `apiKey` is a project identifier that Firebase documents as safe to expose. Meanwhile, requiring every contributor to create their own Firebase project is a serious barrier to the public building in ADR-0002.

## Decision

Commit the client config. Protection comes from Firestore Security Rules and App Check, not from hiding an identifier. Local development runs against the Firebase Emulator Suite with seeded fixtures: `pnpm dev` needs no cloud account, no project and no keys.

## Consequences

A contributor is productive in one command. The `gitleaks` config carries an explicit, documented allowlist for the web apiKey pattern while still blocking service-account keys — the distinction is the whole point and is spelled out in SECURITY.md so nobody 'fixes' it later.

## Alternatives considered

Requiring contributors to supply their own Firebase project — Firebase's own general suggestion for OSS. Rejected: it makes casual contribution nearly impossible, which defeats building in public.
