# Production.
#
# Differences from dev, all of them deliberate:
#   - deploy_gate = "environment": a deploy requires a job declaring GitHub
#     Environment `production`, which GitHub gates with required reviewers. The
#     approval therefore happens outside the repository's own code, so a
#     malicious commit cannot approve itself.
#   - App Check ENFORCED.
#   - Firestore delete protection and point-in-time recovery on.
#   - A real budget, with real recipients.

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
  environment     = "prod"
  region          = var.region
  billing_account = var.billing_account
  state_bucket    = var.state_bucket

  budget_amount_usd = var.budget_amount_usd
  alert_emails      = var.alert_emails

  github_repository          = var.github_repository
  github_repository_id       = var.github_repository_id
  github_repository_owner_id = var.github_repository_owner_id

  deploy_gate        = "environment"
  deploy_environment = var.deploy_environment
  deploy_branch      = var.deploy_branch

  firestore_point_in_time_recovery = "POINT_IN_TIME_RECOVERY_ENABLED"

  # Every backend the client touches. Storage is on this list because
  # progress-photo bytes are governed by storage.rules (ADR-0023) and rules
  # alone are the last line, not the only one.
  app_check_enforcement = "ENFORCED"
  app_check_services = [
    "firestore.googleapis.com",
    "firebasestorage.googleapis.com",
    "identitytoolkit.googleapis.com",
  ]
  app_check_required_by_proxy = true

  # Required: ENFORCED without this is refused by a precondition, because with
  # no attestation provider the client cannot mint a token and enforcement
  # would reject the real app along with everyone else.
  recaptcha_secret_id = var.recaptcha_secret_id

  authorized_domains = concat(["localhost"], var.extra_authorized_domains)
  custom_domain      = var.custom_domain

  enable_google_signin   = var.enable_google_signin
  google_oauth_client_id = var.google_oauth_client_id
  google_oauth_secret_id = var.google_oauth_secret_id

  enable_apple_signin   = var.enable_apple_signin
  apple_services_id     = var.apple_services_id
  apple_oauth_secret_id = var.apple_oauth_secret_id

  ai_proxy_max_instances             = var.ai_proxy_max_instances
  ai_proxy_kill_switch               = var.ai_proxy_kill_switch
  ai_global_monthly_spend_cap_micros = var.ai_global_monthly_spend_cap_micros
  ai_per_user_daily_call_quota       = var.ai_per_user_daily_call_quota
}
