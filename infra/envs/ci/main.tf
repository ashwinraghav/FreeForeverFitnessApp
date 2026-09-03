/**
 * CI's deploy identity, and nothing else.
 *
 * ## Why this env exists rather than applying `prod`
 *
 * `envs/prod` stands up the whole platform: Firestore with point-in-time recovery, App
 * Check enforcement, Google and Apple sign-in, and the Phase 3 AI proxy. The app uses
 * none of it — it is local-first, has never talked to Firestore, and the proxy is not
 * built. Applying prod to obtain a deploy identity would create billable infrastructure
 * for features that do not exist, which is the thing ADR-0001 exists to prevent, and it
 * would demand Secret Manager secrets (recaptcha, OAuth) that have not been created.
 *
 * So this env instantiates `ci-wif` alone. It is the minimum that lets CI deploy without
 * a stored credential, and it stays true to ADR-0011: Workload Identity Federation, no
 * service-account keys anywhere.
 *
 * ## When prod is eventually applied
 *
 * `modules/platform` instantiates `ci-wif` too, as `module.ci`. Applying prod alongside
 * this env would try to create the same pool and service accounts twice and fail on the
 * name collision. Whoever brings prod up should `terraform state mv` these resources
 * into it and delete this directory — the collision is the reminder, and it fails loudly
 * rather than quietly diverging.
 */

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0, < 7.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

module "ci" {
  source = "../../modules/ci-wif"

  project_id  = var.project_id
  environment = "prod"
  region      = var.region

  github_repository          = var.github_repository
  github_repository_id       = var.github_repository_id
  github_repository_owner_id = var.github_repository_owner_id

  /*
   * Gated on a GitHub Environment, not a branch.
   *
   * Both produce a `principal://` binding naming exactly one subject, so neither is a
   * wildcard. The environment gate is the stronger of the two because it is a separate
   * switch from merge rights: required reviewers can be added to `production` later
   * without touching this, and a push to `main` alone cannot mint a token.
   */
  deploy_gate        = "environment"
  deploy_environment = var.deploy_environment

  # The state bucket bootstrap created. The deployer needs it so a future `terraform
  # apply` from CI can read and write state; it is not needed to deploy Hosting.
  state_bucket = var.state_bucket
}
