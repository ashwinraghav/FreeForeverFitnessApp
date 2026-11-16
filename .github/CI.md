# CI and deployment

| Workflow | Runs on | Blocking | Notes |
|---|---|---|---|
| `ci.yml` | every push and PR | yes | Secret scan, typecheck/lint/test, Firestore rules, design token guards. |
| `terraform.yml` | changes under `infra/` | yes | `fmt -check`, `validate`, security guardrails, plan-on-PR. |
| `lighthouse.yml` | every push and PR | yes | PWA and accessibility ≥ 95 (ADR-0013). Audits the app *and* the landing page, with separate assertions for each — the landing page is deliberately not a PWA. Does **not** gate the deploy: it is a separate workflow, so an accessibility regression can still ship. |

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

## Deploying

`ci.yml` has a `deploy` job that needs all five checks and publishes to Firebase Hosting.
It runs only on a push to `main`, inside the `production` GitHub Environment — which is
also what makes the OIDC subject match, and where required reviewers would go.

Before that job existed, every deploy was a laptop running `firebase deploy`, and a green
tick told you nothing about what was live. It is worth being precise about what it does and
does not prove: it proves the five `ci.yml` checks passed on the deployed commit. Lighthouse
is a separate workflow and does not gate it.

## A note on the identity, since it took four attempts

The deployer holds exactly two roles — `firebasehosting.admin` and
`serviceusage.serviceUsageConsumer`. It briefly held three more from a shared module's
fixed list, which administered nothing on a project with no Firestore and no Cloud Run but
were still real grants on an assumable identity.

Two things cost three failed deploys, both recorded here because the error messages point
away from them:

- **`sts.googleapis.com` was not enabled.** Without it there is no path from a workflow to
  a Google credential at all, however correct the pool and bindings are.
- **The subject is not what the documentation implies.** This account emits
  `repo:OWNER@OWNER_ID/NAME@REPO_ID:...`, not `repo:OWNER/NAME:...`, and `use_default` is
  `true` — that *is* the default now. Read it rather than assuming:

  ```bash
  gh api repos/OWNER/NAME/actions/oidc/customization/sub --jq .sub_claim_prefix
  ```

Both failed with `iam.serviceAccounts.getAccessToken denied` while every visible part of
the configuration checked out, and `firebase-tools` replaced the underlying error with
"have you run `firebase login`?" — a message about the one cause that was not the problem.
