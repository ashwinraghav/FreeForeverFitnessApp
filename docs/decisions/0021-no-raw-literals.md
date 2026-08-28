# ADR-0021: No raw colour, spacing or duration literals outside the design system

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

Six teams building UI in parallel will produce six slightly different greys unless something mechanical prevents it.

## Decision

A lint rule fails the build on any hex colour, raw `px` spacing value or duration literal outside `packages/design-system`. Tokens come from one source of truth — `tokens.json` — which emits CSS custom properties, typed TS exports and a Tailwind theme block so they cannot drift apart.

## Consequences

This is what makes the fan-out produce one coherent app rather than six. Cost: occasional friction when a genuinely novel value is needed, which is resolved by adding a token rather than an exception.

## Alternatives considered

Design review as the control. Rejected — it does not scale to parallel agents and it catches problems after the work is done.
