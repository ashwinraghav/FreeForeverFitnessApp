# CI

| Workflow | Runs on | Blocking | Notes |
|---|---|---|---|
| `ci.yml` | every push and PR | yes | Secret scan, typecheck/lint/test, Firestore rules, design token guards. |
| `terraform.yml` | changes under `infra/` | yes | `fmt -check`, `validate`, security guardrails, plan-on-PR. |
| `lighthouse.yml` | every push and PR | yes once `apps/web` exists | PWA and accessibility ≥ 95 (ADR-0013). Skips loudly until there is an app to audit. |

## Nothing here needs a secret

`terraform.yml`'s plan job authenticates through Workload Identity Federation
(ADR-0011). There is no service-account key in this repository, in GitHub
Secrets, or anywhere else. The four values it reads are GitHub repository
**variables**, not secrets, because they are identifiers: none of them grants
anything without an OIDC token whose claims satisfy the pool provider's
`attribute_condition`.

| Variable | From |
|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `terraform output github_actions_variables` |
| `GCP_PLAN_SERVICE_ACCOUNT` | same |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | same |
| `GCP_PROJECT_ID`, `GCP_BILLING_ACCOUNT`, `GCP_TFSTATE_BUCKET` | set by hand |

## Forks are first-class

This repository is public and expects outside contributions (ADR-0002), so no
job may go red for a reason a contributor cannot fix.

- `fmt`/`validate` run with `-backend=false` and need no credentials.
- The plan job is gated on the PR coming from this repository *and* on the WIF
  variables being present. On a fork it does not run; before the infrastructure
  is bootstrapped it emits a notice and skips.
- Lighthouse skips with an explanation written into the job summary while
  `apps/web` does not exist. A green tick that silently checked nothing is worse
  than no check, so the skip says so out loud.

## The guardrails job

`terraform validate` checks syntax and schema. It cannot tell you that a
`attribute_condition` is a wildcard, that a secret value has been committed into
Terraform, or that a billable resource has floated above the budget that is
supposed to bound it. Those are ADR violations that look like valid HCL, so they
get grep-level assertions of their own:

- no `google_service_account_key` resource anywhere (ADR-0011)
- no `google_secret_manager_secret_version` resource — containers only
- the WIF condition pins `repository_owner_id`, `repository_id` and `repository`
- the deploy identity uses `principal://`, never `principalSet://`
- every billable module carries `depends_on = [module.budget]` (ADR-0012)

See [`infra/README.md`](../infra/README.md) for why each one matters.
