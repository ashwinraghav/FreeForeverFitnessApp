# ADR-0015: Security rules are public, so rules tests block CI

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

An attacker can read `firestore.rules` in this repository. Any rule that works by being unread is already broken.

## Decision

Every rule is covered by `@firebase/rules-unit-testing` tests, running against the emulator, as a **blocking** CI job. Both directions are asserted: the permitted access succeeds, and the forbidden access fails.

## Consequences

Turns the main risk of open-sourcing a backend into a forcing function for correctness. Cost: rules changes are slower, which is the correct trade.

## Alternatives considered

Manual review of rules changes. Rejected — rules are subtle, and a reviewer's attention is not a control.
