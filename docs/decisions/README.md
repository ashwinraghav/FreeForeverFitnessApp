# Decision log

Every consequential decision, numbered and immutable. Supersede with a new ADR rather than editing an accepted one.

New decision: `pnpm adr "Short title"`.

| ADR | Decision | Status |
|---|---|---|
| [0001](./0001-free-forever-constitution.md) | The free-forever constitution | Accepted |
| [0002](./0002-open-source-and-public-strategy.md) | Open source and openly strategised from commit one | Accepted |
| [0003](./0003-licence.md) | Split licence: AGPL-3.0 for the app, Apache-2.0 for reusable packages | Accepted |
| [0004](./0004-firebase-gcp-terraform.md) | Firebase, GCP and Terraform as the platform | Accepted |
| [0005](./0005-firestore-is-a-sync-engine.md) | Firestore is a sync engine, never a query engine | Accepted |
| [0006](./0006-on-device-datasets.md) | On-device static datasets over backend search | Accepted |
| [0007](./0007-exercise-media-via-jsdelivr.md) | Serve exercise media from the public repo via jsDelivr | Accepted |
| [0008](./0008-pwa-first-capacitor-later.md) | PWA first, Capacitor shell at Phase 2 | Accepted |
| [0009](./0009-anonymous-first-auth.md) | Anonymous-first auth — no signup wall | Accepted |
| [0010](./0010-commit-firebase-client-config.md) | Commit the Firebase client config; emulator-first development | Accepted |
| [0011](./0011-wif-not-service-account-keys.md) | CI authenticates to GCP via Workload Identity Federation | Accepted |
| [0012](./0012-terraform-all-infrastructure.md) | All infrastructure in Terraform; no console changes | Accepted |
| [0013](./0013-design-direction-blueprint.md) | Design direction: blueprint, dark-first | Accepted |
| [0014](./0014-self-hosted-fonts.md) | Self-hosted subset variable fonts | Accepted |
| [0015](./0015-public-rules-need-tests.md) | Security rules are public, so rules tests block CI | Accepted |
| [0016](./0016-ai-proxy-quotas-byok.md) | AI behind a quota'd proxy; BYO-key runs client-side | Accepted |
| [0017](./0017-no-public-social-feed.md) | No public social feed; invite-only groups only | Accepted |
| [0018](./0018-monorepo-file-ownership.md) | Monorepo file ownership as the parallel-agent boundary | Accepted |
| [0019](./0019-publish-redacted-agent-log.md) | Publish agent transcripts through a redaction pass | Accepted |
| [0020](./0020-publish-monthly-costs.md) | Publish the monthly cloud bill in-repo | Accepted |
| [0021](./0021-no-raw-literals.md) | No raw colour, spacing or duration literals outside the design system | Accepted |
| [0022](./0022-product-name.md) | Product name: TheFreeForeverFitnessApp | Accepted |
| [0023](./0023-storage-rules-are-security-surface.md) | Cloud Storage rules are part of the security surface | Accepted |
| [0024](./0024-coach-photo-access-deferred.md) | Coach access to progress-photo bytes is deferred to Phase 4 | Accepted |

## Reading order for newcomers

[0001](./0001-free-forever-constitution.md) is the spine — everything else follows from it. [0005](./0005-firestore-is-a-sync-engine.md), [0007](./0007-exercise-media-via-jsdelivr.md) and [0016](./0016-ai-proxy-quotas-byok.md) are where the cost model is actually enforced. [0010](./0010-commit-firebase-client-config.md) and [0015](./0015-public-rules-need-tests.md) explain why a public repository with a committed API key is safe.
