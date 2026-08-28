# Development environment.
#
# Distinct GCP project, distinct state prefix, distinct WIF pool. A credential
# minted here cannot touch production. See modules/platform/main.tf for why
# these are directories rather than workspaces.
#
# Note for contributors: you do not need this. `pnpm dev` runs the whole stack
# on the Firebase emulator with no cloud account at all (ADR-0010). This project
# exists for integration testing by maintainers.

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0, < 7.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = ">= 6.0, < 7.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

module "platform" {
  source = "../../modules/platform"

  project_id      = var.project_id
  environment     = "dev"
  region          = var.region
  billing_account = var.billing_account
  state_bucket    = var.state_bucket

  # A dev environment that can produce a meaningful bill is a dev environment
  # nobody dares use. Five dollars is enough to notice and cheap to be wrong about.
  budget_amount_usd = var.budget_amount_usd
  alert_emails      = var.alert_emails

  github_repository          = var.github_repository
  github_repository_id       = var.github_repository_id
  github_repository_owner_id = var.github_repository_owner_id

  # Dev deploys on every push to the protected branch. No approval gate:
  # the whole point of dev is that it is cheap to break.
  deploy_gate   = "branch"
  deploy_branch = var.deploy_branch

  # Point-in-time recovery is billed storage, and dev data is fixtures.
  firestore_point_in_time_recovery = "POINT_IN_TIME_RECOVERY_DISABLED"

  # Unenforced so a maintainer can point a local build at the dev project
  # without registering a debug token. Prod enforces.
  app_check_enforcement       = "UNENFORCED"
  app_check_required_by_proxy = false

  authorized_domains = concat(["localhost"], var.extra_authorized_domains)

  enable_google_signin   = var.enable_google_signin
  google_oauth_client_id = var.google_oauth_client_id
  google_oauth_secret_id = var.google_oauth_secret_id

  enable_apple_signin   = var.enable_apple_signin
  apple_services_id     = var.apple_services_id
  apple_oauth_secret_id = var.apple_oauth_secret_id

  ai_proxy_max_instances             = 1
  ai_proxy_kill_switch               = var.ai_proxy_kill_switch
  ai_global_monthly_spend_cap_micros = 2000000 # $2/month
  ai_per_user_daily_call_quota       = 50      # generous; it is one developer
}
