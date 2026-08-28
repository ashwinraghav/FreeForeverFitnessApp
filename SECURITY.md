# Security

## Reporting

Report vulnerabilities privately through GitHub's "Report a vulnerability" advisory flow.
Please do not open a public issue for anything exploitable.

## The threat model, stated plainly

This repository is public, so an attacker can read every security rule, every Terraform file
and every line of client code. Nothing here relies on obscurity.

**Public by design, and safe:**
- The Firebase web `apiKey` and client config — a project identifier, not a credential.
- `firestore.rules` — readable by anyone, which is exactly why the rules test suite is
  CI-blocking. See [ADR-0015](docs/decisions/0015-public-rules-need-tests.md).
- All Terraform. Identity is federated (WIF), so there is no key material to expose.

**Secret, and never in this repository:**
- Service-account JSON and Admin SDK credentials — these bypass all Security Rules.
- AI provider API keys — server-side only, in GCP Secret Manager, reached through a proxy
  that enforces per-user quotas and requires App Check.
- App Check debug tokens, Terraform state.

**No long-lived cloud credentials exist.** CI authenticates to GCP through Workload Identity
Federation, so there is no service-account key to leak, rotate, or find in a git history.
See [ADR-0011](docs/decisions/0011-wif-not-service-account-keys.md).

## User data

Training and nutrition logs are private to their owner by default deny. A coach can see a
client's data only through an explicit, revocable grant. Progress photos are device-local
unless the user opts into sync. Export is unconditional — users can always leave with everything.
