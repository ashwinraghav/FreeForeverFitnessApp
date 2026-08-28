# ADR-0004: Firebase, GCP and Terraform as the platform

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

The maintainer is most fluent in Firebase, GCP and Terraform. A platform the sole maintainer knows well beats a theoretically cheaper one they will operate badly — especially for a project whose survival depends on low ongoing effort.

## Decision

Firebase Auth, Firestore, Hosting and Cloud Run on GCP, with all infrastructure declared in Terraform.

## Consequences

Two Firebase-specific cost traps had to be designed around explicitly rather than discovered in a bill: per-document read pricing (ADR-0005) and $0.15/GB Hosting egress (ADR-0007). Firestore's offline persistence is a genuine asset for a local-first app and removes a lot of sync code we would otherwise write.

## Alternatives considered

Cloudflare Workers + D1 + R2 has better cost characteristics — notably zero egress. Rejected on operator familiarity, with the specific traps mitigated instead.
