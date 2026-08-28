# ADR-0011: CI authenticates to GCP via Workload Identity Federation

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

A long-lived service-account JSON key stored in CI secrets is the single most damaging thing that can leak from a project with a public repository and public CI logs.

## Decision

GitHub Actions authenticates to GCP through Workload Identity Federation. No service-account key is ever created.

## Consequences

There is no key material to leak, rotate, or find in git history. Slightly more Terraform to set up the identity pool and bindings (Team D). Any future contributor asking for a service-account key is a signal that something has gone wrong.

## Alternatives considered

A service-account key in GitHub Secrets. Standard practice, and rejected outright given the threat model.
