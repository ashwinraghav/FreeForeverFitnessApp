# ADR-0016: AI behind a quota'd proxy; BYO-key runs client-side

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

AI is the only line item in the cost model that can run away. A naive daily-chat design costs ~$3.40/user/month — $34,000/month at 10,000 users. The same product engineered properly costs $0.02–0.05.

## Decision

All hosted AI goes through a Cloud Run proxy holding the provider key in Secret Manager, enforcing per-uid quotas in Firestore and requiring App Check. Cost engineering is mandatory, not optional: deterministic-first, a pre-generated answer corpus, right-sized models, prompt caching, the batch API for anything non-interactive, and amortised generation. Users who want it uncapped supply their own API key, stored device-local, calling the provider directly.

## Consequences

A global monthly spend cap degrades the service to deterministic mode rather than failing or overspending. BYO-key removes the only cost that scales, without introducing a paywall. Every AI feature must still work — more slowly, less cleverly — with AI entirely switched off.

## Alternatives considered

No AI at all (rejected: real user value in NL logging and photo estimation). Unmetered AI (rejected: ends the project).
