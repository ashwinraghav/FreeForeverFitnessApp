# Workload Identity Federation for GitHub Actions (ADR-0011).
#
# No service-account key is created anywhere in this repository. GitHub Actions
# presents a short-lived OIDC token; GCP exchanges it for a short-lived access
# token if — and only if — the token's claims satisfy the conditions below.
#
# ---------------------------------------------------------------------------
# WHY THE attribute_condition IS THE WHOLE SECURITY BOUNDARY
# ---------------------------------------------------------------------------
# GitHub runs one OIDC issuer for every repository on the platform, public and
# private, yours and everyone else's. A pool provider that trusts
# `https://token.actions.githubusercontent.com` with no attribute_condition
# trusts *all of them*: anyone can push a workflow to their own repository and
# mint a token this pool will accept. The pool becomes a public credential.
#
# Three failure modes, in descending order of how often they are shipped:
#
#   1. No attribute_condition at all           -> the entire internet.
#   2. `assertion.repository_owner == "acme"`  -> anyone who can create a repo
#      in the org, which in most orgs is everyone, including a compromised
#      contributor account. It also fails open if the org is ever renamed and
#      the old name re-registered.
#   3. `assertion.repository == "acme/app"`    -> correct until the repository
#      is deleted or transferred and the name is claimed by someone else.
#
# So the condition below pins the two IMMUTABLE numeric claims (owner ID and
# repository ID) and the human-readable name, all three, ANDed. Numeric IDs are
# never reused by GitHub, which closes the name-recycling hole; the name is kept
# because it makes an audit log line readable by a human.
#
# The condition is the coarse gate: "is this our repository at all?"
# The per-service-account bindings further down are the fine gate: "and is it
# a context allowed to hold *this* identity?" Two independent checks, so a
# mistake in either one alone is not a compromise.

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0, < 7.0"
    }
  }
}

# Needed for the project NUMBER. Several GCP identity surfaces are addressed by
# number rather than by ID, and the two never coincide -- see the audience
# comment below and the principal:// members further down.
data "google_project" "this" {
  project_id = var.project_id
}

locals {
  # Suffixed per environment so the dev pool can never mint a prod identity.
  pool_id     = "gh-${var.environment}"
  provider_id = "gh-oidc-${var.environment}"

  # GitHub's `sub` claim, reconstructed. Binding on the full subject rather
  # than on a mapped attribute means the branch/environment is checked by
  # IAM against the raw token, not against something we derived.
  /*
   * The `sub` prefix is read from configuration, not assumed.
   *
   * Assuming `repo:OWNER/NAME` cost four failed deploys. GitHub now emits
   * `repo:OWNER@OWNER_ID/NAME@REPO_ID` on some accounts — as the *default*, with
   * `use_default: true` — and the failure is a bare
   * `iam.serviceAccounts.getAccessToken denied`, with every visible part of the binding
   * looking exactly correct. There is nothing to see; the two strings simply differ.
   */
  subject_prefix = coalesce(var.subject_prefix, "repo:${var.github_repository}")

  deploy_subject = (
    var.deploy_gate == "environment"
    ? "${local.subject_prefix}:environment:${var.deploy_environment}"
    : "${local.subject_prefix}:ref:refs/heads/${var.deploy_branch}"
  )
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = local.pool_id
  display_name              = "GitHub Actions (${var.environment})"
  description               = "Keyless CI identity for ${var.github_repository}. ADR-0011."
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = local.provider_id
  display_name                       = "GitHub OIDC"
  description                        = "Trusts GitHub's OIDC issuer, restricted to a single repository by immutable ID."

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"

    # Pin the audience to this provider's own resource name rather than
    # accepting GitHub's default `https://github.com/<owner>`. A token minted
    # for a different audience -- including one minted for some other GCP
    # project's pool -- is then rejected outright.
    #
    # THIS MUST BE THE PROJECT NUMBER, NOT THE PROJECT ID.
    #
    # google-github-actions/auth defaults the requested audience to
    # `https://iam.googleapis.com/<workload_identity_provider>`, and the value
    # the workflow passes is this resource's `.name`, which the API always
    # renders as `projects/{project_number}/...`. Building the pin from
    # var.project_id instead produces a string that can never match any token
    # GitHub sends, so every federation attempt fails on audience mismatch --
    # and it fails at the first real deploy, long after the code was reviewed.
    #
    # Self-reference is not possible here (the provider cannot read its own
    # computed `.name`), hence the data source above rather than the obvious
    # `google_iam_workload_identity_pool_provider.github.name`.
    allowed_audiences = [
      "https://iam.googleapis.com/projects/${data.google_project.this.number}/locations/global/workloadIdentityPools/${local.pool_id}/providers/${local.provider_id}",
    ]
  }

  # Only claims mapped here can be referenced by attribute_condition or by a
  # principalSet binding. Map the minimum; every extra attribute is another
  # thing a future binding can get subtly wrong.
  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository"          = "assertion.repository"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
    "attribute.event_name"          = "assertion.event_name"

    # Synthetic attribute. principalSet:// can only match a single attribute,
    # so "this repo AND a pull_request event" has to be one string to be
    # expressible as a binding at all.
    "attribute.repo_event" = "assertion.repository + \":\" + assertion.event_name"
  }

  # ---------------------------------------------------------------------
  # THE CONDITION. See the essay at the top of this file before editing.
  # Every clause is an AND. There is no wildcard, no prefix match, and no
  # startsWith() on an attacker-influenced string.
  # ---------------------------------------------------------------------
  attribute_condition = join(" && ", [
    # Immutable numeric owner ID. Survives an org rename; cannot be squatted.
    "assertion.repository_owner_id == \"${var.github_repository_owner_id}\"",

    # Immutable numeric repository ID. This is the clause that makes the whole
    # thing safe: a fork, a rename, a delete-and-recreate, and a same-named
    # repository under a different owner all carry a different ID.
    "assertion.repository_id == \"${var.github_repository_id}\"",

    # Human-readable name, checked as well as the IDs. Redundant by design:
    # it costs nothing and it makes Cloud Audit Logs legible.
    "assertion.repository == \"${var.github_repository}\"",
  ])

  depends_on = [google_iam_workload_identity_pool.github]
}

# ===========================================================================
# Identity 1 — deployer. Write access, narrowly.
# ===========================================================================

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "ci-deployer-${var.environment}"
  display_name = "CI deployer (${var.environment})"
  description  = "Impersonated by GitHub Actions via WIF. Has no keys and must never be given one (ADR-0011)."
}

# The fine gate. `principal://.../subject/<sub>` matches exactly one GitHub
# context: one repository, one branch (or one GitHub Environment). Note this
# is `principal://` and not `principalSet://` — a set binding here would widen
# it back out to every workflow in the repository, including a workflow added
# by an unreviewed pull request.
resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principal://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/subject/${local.deploy_subject}"
}

# Least privilege, resource-scoped wherever the API allows it.
# Deliberately NOT granted: roles/editor, roles/owner, iam.serviceAccountAdmin,
# resourcemanager.projectIamAdmin, secretmanager.secretAccessor. CI deploys the
# application; it does not need to read the AI provider key, and it does not
# need to be able to grant itself anything.
resource "google_project_iam_member" "deployer" {
  # Supplied by the environment rather than fixed here — see `var.deployer_roles`. A
  # Hosting-only project has no business granting `firebaserules.admin`.
  for_each = var.deployer_roles

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# Push container images — scoped to the single repository, not the project.
resource "google_artifact_registry_repository_iam_member" "deployer_push" {
  count = var.artifact_registry_repository_id == null ? 0 : 1

  project    = var.project_id
  location   = var.region
  repository = var.artifact_registry_repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

# actAs on the runtime SA only. Project-wide iam.serviceAccountUser would let
# CI deploy a service running as any identity in the project, which is a
# privilege-escalation path straight out of this SA's narrow role list.
resource "google_service_account_iam_member" "deployer_act_as_runtime" {
  count = var.runtime_service_account_email == null ? 0 : 1

  # project_id is correct here, unlike in the audience above: the IAM service
  # account resource name is documented as
  # `projects/{PROJECT_ID_OR_NUMBER|-}/serviceAccounts/{EMAIL}` and accepts
  # either. The two surfaces differ, so neither form is safe to copy between them.
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.runtime_service_account_email}"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_storage_bucket_iam_member" "deployer_state" {
  bucket = var.state_bucket
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.deployer.email}"
}

# ===========================================================================
# Identity 2 — planner. Read-only, for `terraform plan` on pull requests.
# ===========================================================================

resource "google_service_account" "planner" {
  project      = var.project_id
  account_id   = "ci-planner-${var.environment}"
  display_name = "CI Terraform planner (${var.environment})"
  description  = "Read-only identity for plan-on-PR. Never used for apply."
}

# principalSet on the synthetic repo_event attribute: any workflow in THIS
# repository, running on a `pull_request` event.
#
# This is the one binding that is a SET rather than a single subject, so its
# justification has to carry weight. Three things hold it up, in descending
# order of how much they are relied on:
#
#   1. The identity is read-only. roles/viewer + secretmanager.viewer, and
#      objectViewer on state. Worst case for a token minted here is disclosure
#      of resource metadata that is already declared in this public repository.
#   2. The event name is part of the matched attribute. A `pull_request_target`
#      workflow -- which DOES run with base-repo permissions and can request
#      id-token -- carries event_name "pull_request_target" and produces
#      "owner/repo:pull_request_target", which does not match this binding.
#      That is why event_name is in the attribute rather than left implicit.
#   3. GitHub does not issue an OIDC token to a `pull_request` workflow raised
#      from a fork (fork PRs get read-only permissions and no secrets), so an
#      outside contributor cannot reach even the read-only identity.
#
# Point 3 is documented GitHub behaviour, asserted rather than verified here --
# see infra/README.md. Points 1 and 2 do not depend on it, which is the reason
# they are listed first. .github/workflows/terraform.yml has a guardrail job
# that fails the build if a pull_request_target trigger is ever added.
resource "google_service_account_iam_member" "planner_wif" {
  service_account_id = google_service_account.planner.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repo_event/${var.github_repository}:pull_request"
}

resource "google_project_iam_member" "planner" {
  for_each = toset([
    "roles/viewer",
    # Lets plan see that a secret EXISTS and its metadata. Not
    # secretmanager.secretAccessor: a plan has no business reading a value,
    # and a PR plan runs against code that has not been reviewed yet.
    "roles/secretmanager.viewer",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.planner.email}"
}

resource "google_storage_bucket_iam_member" "planner_state" {
  bucket = var.state_bucket
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.planner.email}"
}
