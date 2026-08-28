# ADR-0002: Open source and openly strategised from commit one

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

The promise in ADR-0001 is unverifiable if the project is a black box. Users are asked to trust a claim about running costs and intentions that they cannot check.

## Decision

Everything is public from the first commit: code, business strategy, decision log, monthly cloud bill, and the redacted AI agent transcripts that produced the work.

## Consequences

The security model must be genuinely correct rather than obscure — see ADR-0015. Cost discipline becomes publicly auditable, which is a real constraint on future decisions. It also unlocked a direct infrastructure saving we would not otherwise have: ADR-0007.

## Alternatives considered

Open-sourcing later, once the product was proven. Rejected — the discipline that makes the code publishable is exactly the discipline that keeps it cheap, and retrofitting it is harder than starting with it.
