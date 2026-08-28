# ADR-0012: All infrastructure in Terraform; no console changes

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

Console-clicked resources are invisible to the public repository, which breaks the auditability ADR-0002 promises, and are unreproducible for anyone forking the project.

## Decision

Every GCP and Firebase resource is declared in `infra/`, with state in a GCS bucket. If it is not in Terraform, it does not exist. Budget alerts are provisioned **before** any billable resource.

## Consequences

Anyone can stand up their own instance. Cost control becomes infrastructure rather than vigilance. Cost: emergency console fixes must be back-ported to Terraform immediately or drift accumulates silently.

## Alternatives considered

Console-first with Terraform import later. Rejected — the import never happens.
