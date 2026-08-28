# ADR-0009: Anonymous-first auth — no signup wall

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

Every competitor demands an account before delivering any value. It is the largest avoidable drop-off in the category, and there is no technical reason for it.

## Decision

Firebase anonymous auth issues a uid on first open. The user logs a workout immediately, with no email, no password, no wall. The anonymous account upgrades in place to email-link, Apple or Google later, without data loss.

## Consequences

The acceptance test for Phase 0 becomes: **a set logged in under ten seconds from a cold install**. Cost: account-linking and the orphaned-anonymous-account lifecycle are real edge cases Team C owns, and abandoned anonymous accounts need a cleanup policy.

## Alternatives considered

Local-only storage with no auth at all until the user wants sync. Simpler, but makes the later migration to a real account harder, not easier.
