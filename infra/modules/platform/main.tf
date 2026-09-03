# The whole platform for one environment, composed.
#
# dev and prod are separate DIRECTORIES that both call this module, rather than
# two Terraform workspaces. Reasoning, since ADR-0012 asks for it to be written
# down (see infra/README.md for the long version):
#
#   - Workspaces share one backend and one provider configuration, so the
#     difference between "I am about to change dev" and "I am about to change
#     production" is a piece of invisible CLI state. The failure is silent and
#     the blast radius is production.
#   - Separate directories give separate state prefixes, separate tfvars,
#     separate WIF pools and separate GCP projects. A dev credential cannot
#     reach prod, which is the property actually worth having.
#   - The cost of duplication is one thin main.tf per environment, because all
#     the substance lives in this module.
#
# ORDERING (ADR-0012: "budget alerts are provisioned BEFORE any billable
# resource"). The dependency graph enforces it:
#
#   project-services  (free)
#         v
#       budget        (free)
#         v
#   firebase, ai-proxy, ci-wif   (billable)
#
# Every billable module below takes an explicit depends_on against the budget
# module. That makes the ADR a property of the graph rather than a convention
# someone has to remember on a Friday.

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

data "google_project" "this" {
  project_id = var.project_id
}

# --------------------------------------------------------------------------
# Step 1 — APIs. Free.
# --------------------------------------------------------------------------

module "services" {
  source = "../project-services"

  project_id = var.project_id

  services = [
    # Budget guardrails first, so step 2 can run at all.
    "cloudbilling.googleapis.com",
    "billingbudgets.googleapis.com",
    "pubsub.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",

    # Platform
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "storage.googleapis.com",

    # Firebase
    "firebase.googleapis.com",
    "firebaserules.googleapis.com",
    "firebasehosting.googleapis.com",
    "firestore.googleapis.com",
    "identitytoolkit.googleapis.com",
    "firebaseappcheck.googleapis.com",
    "firebaseinstallations.googleapis.com",

    # AI proxy
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudtrace.googleapis.com",
  ]
}

# --------------------------------------------------------------------------
# Step 2 — budget guardrails. Free, and mandatory before step 3.
# --------------------------------------------------------------------------

module "budget" {
  source = "../budget"

  project_id      = var.project_id
  project_number  = data.google_project.this.number
  environment     = var.environment
  billing_account = var.billing_account

  budget_amount_usd = var.budget_amount_usd
  alert_emails      = var.alert_emails

  depends_on = [module.services]
}

# --------------------------------------------------------------------------
# Step 3 — billable resources. Gated on step 2 existing.
# --------------------------------------------------------------------------

module "firebase" {
  source = "../firebase"

  project_id  = var.project_id
  environment = var.environment

  firestore_location               = var.firestore_location
  firestore_point_in_time_recovery = var.firestore_point_in_time_recovery
  firestore_delete_protection      = var.environment == "prod" ? "DELETE_PROTECTION_ENABLED" : "DELETE_PROTECTION_DISABLED"

  authorized_domains = var.authorized_domains

  enable_google_signin   = var.enable_google_signin
  google_oauth_client_id = var.google_oauth_client_id
  google_oauth_secret_id = var.google_oauth_secret_id

  enable_apple_signin   = var.enable_apple_signin
  apple_services_id     = var.apple_services_id
  apple_oauth_secret_id = var.apple_oauth_secret_id

  app_check_enforcement = var.app_check_enforcement
  app_check_services    = var.app_check_services
  recaptcha_secret_id   = var.recaptcha_secret_id

  custom_domain = var.custom_domain

  depends_on = [module.budget]
}

module "ai_proxy" {
  source = "../ai-proxy"

  project_id  = var.project_id
  environment = var.environment
  region      = var.region

  max_instance_count              = var.ai_proxy_max_instances
  kill_switch                     = var.ai_proxy_kill_switch
  global_monthly_spend_cap_micros = var.ai_global_monthly_spend_cap_micros
  per_user_daily_call_quota       = var.ai_per_user_daily_call_quota
  app_check_required              = var.app_check_required_by_proxy

  depends_on = [module.budget]
}

# --------------------------------------------------------------------------
# Step 4 — CI identity. Depends on ai_proxy for the resources it scopes to.
# --------------------------------------------------------------------------

module "ci" {
  source = "../ci-wif"

  project_id  = var.project_id
  environment = var.environment
  region      = var.region

  github_repository          = var.github_repository
  github_repository_id       = var.github_repository_id
  github_repository_owner_id = var.github_repository_owner_id

  deploy_branch      = var.deploy_branch
  deploy_gate        = var.deploy_gate
  deploy_environment = var.deploy_environment

  state_bucket = var.state_bucket

  /*
   * This module creates Firestore and the Cloud Run proxy, so it is the thing entitled
   * to ask for the roles that administer them. The module's own default is
   * Hosting-only; an environment that does not stand these up should not be handing CI
   * the ability to rewrite security rules.
   */
  deployer_roles = [
    "roles/firebasehosting.admin",             # publish the PWA
    "roles/firebaserules.admin",               # deploy firestore.rules (ADR-0015)
    "roles/datastore.indexAdmin",              # deploy firestore.indexes.json
    "roles/run.developer",                     # deploy new Cloud Run revisions
    "roles/serviceusage.serviceUsageConsumer", # read which APIs are enabled
  ]

  artifact_registry_repository_id = module.ai_proxy.artifact_registry_repository_id
  runtime_service_account_email   = module.ai_proxy.runtime_service_account_email

  depends_on = [module.budget, module.ai_proxy]
}
