# Infrastructure

Every GCP and Firebase resource this project uses is declared here. If it is not
in `infra/`, it does not exist (ADR-0012). Console changes are drift, and drift
in a public repository is a broken promise about auditability (ADR-0002).

**Nothing in this directory is a secret.** Identity is federated, so there is no
key material anywhere (ADR-0011). Where a resource genuinely needs a secret
value, Terraform is given the *name* of a Secret Manager secret and reads the
value at apply time. The repository holds the name of the box, never the
contents.

---

## Contents

- [Layout](#layout)
- [Environments: directories, not workspaces](#environments-directories-not-workspaces)
- [Local development, with no GCP account](#local-development-with-no-gcp-account)
- [Bootstrapping a real deployment](#bootstrapping-a-real-deployment)
- [Workload Identity Federation](#workload-identity-federation)
- [App Check](#app-check)
- [Budget guardrails](#budget-guardrails)
- [Kill switch](#kill-switch)
- [Manual steps](#manual-steps)
- [Day-to-day](#day-to-day)

---

## Layout

```
infra/
├── modules/
│   ├── project-services/   GCP API enablement. Free. Runs first.
│   ├── budget/             Billing budget, Pub/Sub, log-based cost anomaly alerts.
│   ├── firebase/           Firebase project, web app, Firestore, Auth, App Check, Hosting.
│   ├── ai-proxy/           Cloud Run, Artifact Registry, Secret Manager, runtime SA.
│   ├── ci-wif/             Workload Identity Federation + least-privilege CI identities.
│   └── platform/           Composes all of the above into one environment.
├── envs/
│   ├── bootstrap/          Creates the GCS state bucket. Run once, with local state.
│   ├── dev/                Thin: backend + providers + module "platform".
│   └── prod/               Same, with the production settings.
└── seed/                   Emulator fixtures and the one-command local dev script.
```

The environment directories are deliberately thin. All substance lives in
`modules/platform`, so dev and prod cannot drift apart by accident — only on
purpose, through an explicitly different argument.

### Apply order is a property of the graph

ADR-0012 requires budget guardrails **before any billable resource**. That is
not a convention someone has to remember:

```
project-services  (free)
      │
      ▼
    budget        (free)
      │
      ▼
firebase, ai-proxy, ci-wif   (billable)
```

Every billable module in `modules/platform/main.tf` carries an explicit
`depends_on` against `module.budget`. Terraform cannot create a Cloud Run
service before the budget that watches it exists.

---

## Environments: directories, not workspaces

Both are legitimate. This project uses **separate directories with separate GCP
projects**, for three reasons:

1. **Workspaces make the blast radius invisible.** With workspaces, "am I about
   to change dev or production?" is answered by a piece of CLI state you cannot
   see in the diff, in the PR, or in the file you are editing. The failure mode
   is silent and lands on production.
2. **A dev credential must not reach prod.** Separate projects mean separate WIF
   pools, separate service accounts, separate IAM. This is the property actually
   worth paying for; workspaces share one provider configuration and give you
   none of it.
3. **The duplication is one thin file.** `envs/dev/main.tf` and
   `envs/prod/main.tf` are a provider block and a module call. Everything real
   is shared.

State is separated by prefix in one bucket: `env/dev` and `env/prod`.

---

## Local development, with no GCP account

**None of the above is required to contribute.** This is the point of ADR-0010,
and it is the decision that makes public contribution viable at all.

```bash
node infra/seed/dev.mjs
```

Starts the Firebase Emulator Suite, waits for it to serve, loads fixture data,
and stays running. No project, no billing account, no keys, no `gcloud`. Zero
npm dependencies — it runs before `pnpm install` has ever succeeded.

The emulator project ID is `demo-freeforever`. The `demo-` prefix is a Firebase
tooling guarantee that requests can never reach a real backend, so there is no
configuration mistake that turns local development into a cloud bill.

See [`seed/README.md`](seed/README.md) for the fixtures and what each one is for.

> **Integrator note:** wiring this to `pnpm dev` needs a line in the root
> `package.json`, which is integrator-only under ADR-0018:
> `"dev:emulators": "node infra/seed/dev.mjs"`.

---

## Bootstrapping a real deployment

Only maintainers deploying their own instance need this.

### 0. Prerequisites

- `terraform` ≥ 1.5, `gcloud`, `gh`
- Two GCP projects (dev and prod), each linked to a billing account
- `roles/owner` on both, and `roles/billing.admin` on the billing account

Project creation and billing linkage are **not** in Terraform — see
[Manual steps](#manual-steps).

### 1. State bucket

Chicken-and-egg: the backend cannot store the state of the thing that creates
the backend. So `envs/bootstrap` runs with local state and then migrates.

```bash
cd infra/envs/bootstrap
cp terraform.tfvars.example terraform.tfvars   # fill in
terraform init
terraform apply

terraform output backend_config    # paste the bucket into a backend.hcl
terraform init -migrate-state      # move local state into the bucket
```

The bucket has versioning on, public access prevention enforced, and uniform
bucket-level access. Terraform state is listed as secret in `SECURITY.md`;
treat it that way.

### 2. Environments

```bash
cd infra/envs/dev
cp terraform.tfvars.example terraform.tfvars   # fill in — no secrets go in here
echo 'bucket = "your-tfstate-bucket"' > backend.hcl

terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

Then the same in `envs/prod`.

Two things will fail on a first apply and that is expected:

- **Firestore location is immutable.** Choose `firestore_location` before the
  first apply. Changing it later means a new database, not a migration.
- **A custom domain stays pending** until the DNS records Firebase asks for
  exist. `terraform output` will not show a working domain until you add them.

### 3. Secret values, added by hand exactly once

Terraform declares the secret *container*. It never declares a version, because
a version resource would put the key in Terraform state, in every plan output,
and in the CI log of any job that ran a plan.

```bash
printf '%s' "$AI_PROVIDER_KEY" | \
  gcloud secrets versions add ai-provider-api-key --project "$PROJECT" --data-file=-
```

Same pattern for `google-oauth-client-secret`, `apple-oauth-client-secret` and
`recaptcha-site-secret` if you enable those providers.

### 4. Wire up CI

```bash
terraform output -json github_actions_variables
```

Set the four values as GitHub repository **variables** (not secrets):
`GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`,
`GCP_PLAN_SERVICE_ACCOUNT`, `GCP_PROJECT_ID`.

They are identifiers, not credentials. None of them grants anything without an
OIDC token whose claims satisfy the provider's `attribute_condition`. Keeping
them as variables rather than secrets keeps CI logs readable and keeps the
"no secrets in this repository" claim literally true.

---

## Workload Identity Federation

ADR-0011: **no service-account key is ever created.** GitHub Actions presents a
short-lived OIDC token; GCP exchanges it for a short-lived access token if, and
only if, the token's claims match.

### Why the attribute condition is the entire security boundary

GitHub runs **one** OIDC issuer for every repository on the platform — yours,
mine, and everyone else's. A pool provider that trusts
`https://token.actions.githubusercontent.com` with no `attribute_condition`
trusts all of them. Anyone can push a workflow to a repository they own, mint a
token, and impersonate your deployer. The pool becomes a public credential, and
because it is federated there is nothing to rotate.

Three conditions people actually ship, in descending order of frequency:

| Condition | What it actually permits |
|---|---|
| *(none)* | Every GitHub Actions workflow on the internet. |
| `assertion.repository_owner == "acme"` | Anyone who can create a repository in the org — in most orgs, everyone, including a compromised contributor account. Also fails open if the org is renamed and the old name re-registered. |
| `assertion.repository == "acme/app"` | Correct until the repository is deleted or transferred and someone else claims the name. |

### What this repository uses

```hcl
attribute_condition = join(" && ", [
  "assertion.repository_owner_id == \"${var.github_repository_owner_id}\"",
  "assertion.repository_id       == \"${var.github_repository_id}\"",
  "assertion.repository          == \"${var.github_repository}\"",
])
```

All three, ANDed. No wildcard, no prefix match, no `startsWith()` on an
attacker-influenced string.

- `repository_owner_id` and `repository_id` are GitHub's **immutable numeric
  IDs**. GitHub never reuses them. This is what closes the name-recycling hole:
  a fork, a rename, a delete-and-recreate, and a same-named repository under a
  different owner all carry a different ID.
- `repository` is kept as well, purely so a Cloud Audit Log line is readable by
  a human. It costs nothing.

`allowed_audiences` is also pinned to the provider's own resource name rather
than accepting GitHub's default, so a token minted for some other GCP project's
pool is rejected outright.

**That pin is built from the project *number*, not the project ID.** The two are
easy to confuse and never coincide. `google-github-actions/auth` defaults the
requested audience to `https://iam.googleapis.com/<workload_identity_provider>`,
and the value the workflow passes is the provider resource's `.name`, which the
API always renders as `projects/{project_number}/…`. A pin assembled from
`var.project_id` therefore matches no token GitHub will ever send: every
federation attempt fails on audience mismatch, and it fails at the first real
deploy rather than in review. The module resolves the number through a
`data "google_project"` — the provider cannot reference its own computed `.name`
without a cycle.

The same distinction cuts the other way elsewhere. IAM principal identifiers
(`principal://`, `principalSet://`) and billing budget filters also require the
number, while Artifact Registry paths and IAM service-account resource names
take the project ID. Neither form is safe to copy from one surface to another.

The `terraform validate` in CI cannot catch a wildcard here, so
`modules/ci-wif/variables.tf` carries a validation block that rejects anything
that is not exactly `owner/repo`, and requires the ID variables to be digits.

### Two gates, not one

The `attribute_condition` is the coarse gate: *is this our repository at all?*
The per-service-account bindings are the fine gate: *and is this a context
allowed to hold this particular identity?* A mistake in either one alone is not
a compromise.

| Identity | Bound to | Can do |
|---|---|---|
| `ci-deployer-dev` | `principal://…/subject/repo:OWNER/REPO:ref:refs/heads/main` | Deploy Hosting, rules, indexes, Cloud Run revisions. Push to one Artifact Registry repo. `actAs` one runtime SA. |
| `ci-deployer-prod` | `principal://…/subject/repo:OWNER/REPO:environment:production` | Same, in prod. |
| `ci-planner-*` | `principalSet://…/attribute.repo_event/OWNER/REPO:pull_request` | Read only. `roles/viewer` + `secretmanager.viewer`. Read state, never write it. |

Note `principal://` and not `principalSet://` for the deployers. A set binding
would widen it back out to every workflow in the repository, including one
added by an unreviewed pull request.

**Production requires a GitHub Environment,** not just a branch. The `sub` claim
for an environment-gated job is `repo:OWNER/REPO:environment:production`, and
GitHub only issues it after the environment's required reviewers approve. The
approval therefore happens outside the repository's own code, so a malicious
commit cannot approve itself. Configure required reviewers on that environment,
or the gate is decorative.

**The planner is deliberately read-only and deliberately cannot read secret
values.** `roles/secretmanager.viewer` sees that a secret exists and its
metadata; it cannot fetch a version. A PR plan runs against code nobody has
reviewed yet, so it gets the smallest identity that can still produce a useful
diff. It also has only `objectViewer` on the state bucket — which is why the CI
plan job runs `-lock=false`.

### The planner is the only set binding, so here is exactly what holds it up

The planner matches `principalSet://…/attribute.repo_event/OWNER/REPO:pull_request`
— any workflow in this repository running on a `pull_request` event. Three
things justify widening it from a single subject to a set:

1. **The identity is read-only.** `roles/viewer` + `secretmanager.viewer`, and
   `objectViewer` on state. The worst case for a token minted through this
   binding is disclosure of resource metadata that is already declared in this
   public repository.
2. **The event name is part of the matched attribute.** `pull_request_target`
   *does* run with base-repo permissions and can request `id-token: write` — but
   its `event_name` claim is `pull_request_target`, producing
   `owner/repo:pull_request_target`, which does not match this binding. That is
   why `event_name` is baked into the synthetic attribute rather than left
   implicit.
3. **GitHub does not issue an OIDC token to a `pull_request` workflow raised
   from a fork.** Fork PRs run with read-only permissions and no secrets.

> **Verified or asserted?** Point 3 is **asserted from documented GitHub
> behaviour, not empirically verified.** Verifying it needs a fork, a pull
> request and a CI run against a provisioned pool, none of which exist yet.
> Treat it as an assumption to confirm on the first real fork PR.
>
> Points 1 and 2 do not depend on point 3, which is why they are listed first.
> If point 3 turned out to be wrong tomorrow, an outside contributor would gain
> a read-only view of metadata this repository already publishes — not a
> deploy path.

A `pull_request_target` trigger anywhere in `.github/workflows` would run
untrusted PR code with base-repo permissions and would deserve a fresh look at
all three points. `.github/workflows/terraform.yml` therefore has a guardrail
that fails the build if one is ever added.

### Deliberately not granted to CI

`roles/editor`, `roles/owner`, `iam.serviceAccountAdmin`,
`resourcemanager.projectIamAdmin`, `secretmanager.secretAccessor`, and
project-wide `iam.serviceAccountUser`. CI deploys the application. It does not
need to read the AI provider key, and it must not be able to grant itself
anything.

### Footgun: pool deletion is soft

Deleting a workload identity pool or provider soft-deletes it for **30 days**,
and the ID cannot be reused during that window. A `terraform destroy` followed
by a re-`apply` fails with a confusing "already exists". Either wait, or change
the pool ID.

---

## App Check

**Enforcement is the whole thing.** Registering an App Check provider and
calling `initializeAppCheck()` in the client changes nothing on its own: until
enforcement is switched on per service, an attacker omits the App Check header
and every request still succeeds. Enforcement is a server-side act.

An unenforced App Check is arguably worse than none, because the client wiring
reads as protection to anyone reviewing the app code.

### What Terraform owns

`modules/firebase` declares `google_firebase_app_check_service_config` per
service with an explicit `enforcement_mode`, so this is Terraform's, not the
console's (ADR-0012).

| Service | ID | Enforced in prod |
|---|---|---|
| Cloud Firestore | `firestore.googleapis.com` | yes |
| Cloud Storage | `firebasestorage.googleapis.com` | yes |
| Authentication | `identitytoolkit.googleapis.com` | yes |
| Realtime Database | `firebasedatabase.googleapis.com` | n/a — not used (ADR-0005) |

Storage is on that list because progress-photo bytes are a security surface in
their own right and are governed by `storage.rules` (ADR-0023). Rules are the
last line, not the only one.

`dev` sets `UNENFORCED` and `prod` sets `ENFORCED`. Unenforced is not the same
as absent: it registers the services and collects App Check metrics, so the dev
project shows what fraction of traffic *would* be rejected before prod flips
the switch.

The service list is plumbed through `modules/platform` and named explicitly in
both `envs/dev/main.tf` and `envs/prod/main.tf`, so "which backends are actually
protected" is answerable from the environment stack rather than from a module
default someone has to go and read.

### The Cloud Run proxy is a separate mechanism

`google_firebase_app_check_service_config` covers Google-managed Firebase
backends only. The AI proxy is a custom backend, so no service config exists for
it — it verifies the App Check token itself, gated by the `APP_CHECK_REQUIRED`
environment variable set in `modules/ai-proxy`. Two mechanisms, one guarantee;
turning on the first does nothing for the second.

### ENFORCED with no provider is an outage, not a weaker posture

The web app is the only registered app (ADR-0008 is PWA-first), so reCAPTCHA is
the only way a client can obtain an App Check token. Setting
`app_check_enforcement = "ENFORCED"` while `recaptcha_secret_id` is empty means
no client can mint a token and enforcement rejects **everything, including the
real app**.

A `precondition` on the service config refuses that combination at plan time.
Verified across all four combinations of mode and secret; `ENFORCED` + empty is
the only one that blocks.

### Manual steps

Terraform cannot create the reCAPTCHA key itself — it is a Google-side artefact
outside the Firebase resource surface.

1. Create a **reCAPTCHA v3 site key** (or reCAPTCHA Enterprise key) for the
   production domain. The **site key** is public and ships in the client bundle
   as `VITE_FIREBASE_APPCHECK_SITE_KEY`. The **site secret** is not.
2. Put the secret in Secret Manager and pass its *name*:
   ```bash
   printf '%s' "$SITE_SECRET" | \
     gcloud secrets versions add recaptcha-site-secret --project "$PROJECT" --data-file=-
   ```
3. Set `recaptcha_secret_id = "recaptcha-site-secret"` in `envs/prod/terraform.tfvars`.
4. Apply. Terraform registers the provider and turns enforcement on together.

### Testing gap, stated plainly

App Check cannot be exercised locally: the emulator suite ignores it entirely
and reCAPTCHA cannot run under Node, so `initializeAppCheck()` has never
executed in a test and no CI job covers it. That gap is not closeable with the
current tooling — which is exactly why the Terraform side has to be right, and
why the guardrails job asserts that Storage is in the enforced list and that
prod is `ENFORCED` rather than trusting review to catch a regression.

---

## Budget guardrails

Provisioned before anything billable (ADR-0012). Three layers, because each has
a blind spot the others cover.

### 1. Billing budget

| Threshold | Basis | Why |
|---|---|---|
| 50% | actual | Early notice. At a $50 ceiling this is $25 — worth a look, not worth panic. |
| 80% | actual | Something is wrong and there is still a month left to fix it. |
| 100% | actual | The money is already spent. This one arrives too late to be useful, which is why the forecast rules exist. |
| 80% | forecast | The first genuinely actionable alert. |
| 100% | forecast | Current burn rate will exhaust the budget this month. |

Credits are excluded (`EXCLUDE_ALL_CREDITS`) so the figure is what would
actually be invoiced — the number the free-forever claim is about, and the
number ADR-0020 publishes.

Notifications go to a **Pub/Sub topic** (machine-readable, and where an
automated kill switch would subscribe) and to billing administrators by email.
The topic's IAM binding for `billing-budget-alerts@system.gserviceaccount.com`
is load-bearing: without it the budget silently never delivers, which is the
worst failure mode an alert can have — it looks configured and is not.

Defaults: **$5/month dev, $50/month prod.** A validation block rejects anything
above $1000, because a four-figure ceiling on this project is a bug rather than
a configuration.

### 2. Log-based cost anomaly detection

Billing data lags by hours, and it cannot see the AI provider's invoice at all —
that is someone else's bill. So the proxy emits a structured line per upstream
call and Terraform turns it into a metric:

| Metric | Fires when | Why it exists |
|---|---|---|
| `ai_proxy/provider_spend_micros` | > $0.50 of provider spend in an hour | The only near-real-time visibility into the one cost GCP cannot see. |
| `ai_proxy/quota_exceeded_count` | > 100 rejections in 5 minutes | Abuse, or a client retry loop. Either way a human should know. |

### 3. Resource-rate alerts

| Alert | Fires when | Why |
|---|---|---|
| Cloud Run scale-out | > 3 instances for 5 min | Cloud Run bills per instance-second; scale-out *is* the cost event. |
| Firestore read rate | > 5000 reads/min | ADR-0005: reads come from the local cache. A high server read rate is a design regression that also happens to be the easiest way to run up a bill on this stack. |

**None of these stop spend.** They are notifications. Stopping spend is the kill
switch.

---

## Kill switch

A ladder, cheapest and most reversible first. Steps 1–2 are one variable and an
apply. Step 4 is destructive and is a last resort.

### 1. Hosted AI off — the usual answer

```bash
cd infra/envs/prod
terraform apply -var 'ai_proxy_kill_switch=true'
```

Effective within about a minute. It does three things at once:

- sets `AI_ENABLED=false` in the Cloud Run environment,
- **revokes the runtime SA's `secretAccessor` binding on the provider key**, so
  the service could not spend even if a bug ignored the flag,
- removes the secret from the container environment and holds the instance
  ceiling at 1.

ADR-0016 means the app keeps working: every AI feature has a deterministic path,
and AI is a garnish, never load-bearing. Users see a slower, less clever app —
not a broken one.

Reverse by setting it back to `false` and applying.

### 2. Cloud Run to zero traffic

If the proxy itself is the problem — a hot loop, an abusive client the quota is
not catching:

```bash
gcloud run services update-traffic ai-proxy-prod --region europe-west1 --to-revisions=LATEST=0
# or remove public invoke entirely:
gcloud run services remove-iam-policy-binding ai-proxy-prod \
  --region europe-west1 --member=allUsers --role=roles/run.invoker
```

Back-port to Terraform immediately (ADR-0012), or the next `apply` silently
undoes it and you will not find out until the bill.

### 3. Tighten the ceilings

`ai_proxy_max_instances`, `ai_per_user_daily_call_quota` and
`ai_global_monthly_spend_cap_micros` are all Terraform variables. Lowering them
is a reviewable pull request, which is the point: the numbers that bound cost
live where cost decisions are argued about.

### 4. Unlink the billing account — genuinely last resort

```bash
gcloud beta billing projects unlink "$PROJECT_ID"
```

Everything stops. **Read this before running it:**

- Firestore data becomes inaccessible and is eventually **deleted**. There is a
  grace period, not an indefinite one.
- Hosting stops serving. The app goes down for everyone.
- Relinking does not always restore deleted resources.

This is the "the credit card is on fire" option. Steps 1–3 handle every
realistic scenario; a healthy month for this project is dollars, and step 1 cuts
the only line item that can move fast.

### Automating step 1

The budget Pub/Sub topic exists so a Cloud Function could subscribe and throw
the kill switch unattended. It is **deliberately not built**: such a function
needs `billing.projectManager` or broad IAM write, which is a large standing
privilege held to guard against a small, slow risk. Revisit if the project ever
has enough traffic that an hour of runaway spend matters more than the blast
radius of that permission. Worth an ADR at that point.

---

## Manual steps

Terraform cannot own these, and pretending otherwise would be worse than
documenting them.

| Step | Why it is manual |
|---|---|
| Create the GCP projects | Needs organisation-level permission this project does not assume you have, and a typo in project creation costs real money. |
| Link a billing account | Same, plus it is the one action that turns a free project into a billable one. It should be deliberate. |
| Add secret **values** | A `google_secret_manager_secret_version` resource would put the key in Terraform state and in every plan output. See step 3 above. |
| DNS records for a custom domain | You own the domain; Firebase tells you the records after the first apply. |
| GitHub Environment `production` + required reviewers | GitHub-side configuration. Without reviewers, the prod deploy gate is decorative. |
| GitHub repository variables | Output by Terraform, set by hand once. |
| Apple Sign In: Services ID, Team ID, Key ID, `.p8` key | Apple Developer portal. The client secret is a **JWT that expires within six months** — Sign in with Apple then breaks with no deploy having happened. Put the rotation in a calendar, not in a runbook nobody opens. |
| reCAPTCHA site key/secret | Created in the console; the key is public and ships in the client bundle, the secret goes to Secret Manager. **Required before prod can apply** — see [App Check](#app-check). |

---

## Day-to-day

```bash
terraform fmt -recursive -check   # CI enforces this
terraform validate                # in each envs/ directory
```

Both run on every pull request that touches `infra/`. The plan job runs only
when WIF variables are present, so forks — which cannot have them — get a clean
skip rather than a red X.

### A note on lock files

The root `.gitignore` excludes `.terraform.lock.hcl`. That means provider
versions are resolved fresh on every `init` within the `>= 6.0, < 7.0`
constraint, so a new provider release can change a plan without any commit
having happened. Committing the lock files is the usual practice and would make
plans reproducible. That is a change to root config, which is integrator-only
under ADR-0018 — raised rather than reached across.

### Drift

An emergency console change must be back-ported to Terraform the same day. The
alternative is drift that nobody sees until the next apply reverts a fix at the
worst possible moment (ADR-0012).
