# Firebase: project, web app, Firestore, Auth providers, App Check, Hosting.
#
# Most of this lives in the google-beta provider because the Firebase surface
# is still beta in Terraform. That is a stability caveat, not an experiment:
# these are the only resources that exist for the job (ADR-0012 forbids doing
# it in the console).
#
# NOTHING SECRET IS DECLARED HERE. Where a provider genuinely requires a secret
# value (OAuth client secrets, the reCAPTCHA site secret) it is read from
# Secret Manager at apply time by ID. The repository holds the name of the box,
# never the contents.

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

resource "google_firebase_project" "this" {
  provider = google-beta
  project  = var.project_id
}

# --------------------------------------------------------------------------
# Web app
# --------------------------------------------------------------------------

resource "google_firebase_web_app" "web" {
  provider     = google-beta
  project      = var.project_id
  display_name = "${var.web_app_display_name} (${var.environment})"

  # Deleting a web app deletes its config, which is committed to the repo and
  # baked into every installed PWA. Abandon rather than delete.
  deletion_policy = "ABANDON"

  depends_on = [google_firebase_project.this]
}

# The client config: apiKey, authDomain, appId and friends. Per ADR-0010 and
# SECURITY.md this is a public project identifier, not a credential, and it is
# committed deliberately. Exposed as an output so `terraform output` is the
# source of truth when regenerating the committed config, rather than someone
# copying it out of the console.
data "google_firebase_web_app_config" "web" {
  provider   = google-beta
  project    = var.project_id
  web_app_id = google_firebase_web_app.web.app_id
}

# --------------------------------------------------------------------------
# Firestore
# --------------------------------------------------------------------------

resource "google_firestore_database" "default" {
  project = var.project_id
  name    = "(default)"

  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  concurrency_mode            = "OPTIMISTIC"
  app_engine_integration_mode = "DISABLED"

  delete_protection_state           = var.firestore_delete_protection
  point_in_time_recovery_enablement = var.firestore_point_in_time_recovery

  # Firestore is a sync engine, not a query engine (ADR-0005). Rules and
  # indexes are deployed by the Firebase CLI from firestore.rules and
  # firestore.indexes.json, which keeps them reviewable as code and testable
  # in the emulator; declaring them here as well would give two sources of
  # truth for the one thing that most needs exactly one.

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_firebase_project.this]
}

# --------------------------------------------------------------------------
# Auth (Identity Platform)
# --------------------------------------------------------------------------

resource "google_identity_platform_config" "auth" {
  provider = google-beta
  project  = var.project_id

  autodelete_anonymous_users = var.autodelete_anonymous_users
  authorized_domains         = var.authorized_domains

  sign_in {
    # ADR-0009: a uid on first open, no signup wall. This is the single line
    # that makes "log a set in under ten seconds from a cold install" possible.
    anonymous {
      enabled = true
    }

    # Email with password_required = false is Firebase's email-LINK
    # (passwordless) sign-in. Passwords are deliberately not offered: the
    # anonymous account upgrades in place to a link, Apple or Google, and a
    # password is one more thing to forget, reset and breach.
    email {
      enabled           = true
      password_required = false
    }
  }

  quota {
    sign_up_quota_config {
      # A signup flood is both an abuse vector and a cost event. 1000/hour is
      # far above organic growth for this project and far below anything that
      # produces a bill.
      quota          = var.signup_quota_per_hour
      quota_duration = "3600s"

      # The API requires all three fields together. A fixed timestamp in the
      # past means "in force since then" and keeps the value stable across
      # applies -- timestamp() here would re-apply the quota on every run.
      start_time = var.signup_quota_start_time
    }
  }

  depends_on = [google_firebase_project.this]
}

# Google sign-in. The client ID is public (it ships in the bundle); the client
# secret is fetched from Secret Manager by name at apply time.
data "google_secret_manager_secret_version" "google_oauth" {
  count   = var.enable_google_signin ? 1 : 0
  project = var.project_id
  secret  = var.google_oauth_secret_id
  version = "latest"
}

resource "google_identity_platform_default_supported_idp_config" "google" {
  provider = google-beta
  count    = var.enable_google_signin ? 1 : 0

  project       = var.project_id
  enabled       = true
  idp_id        = "google.com"
  client_id     = var.google_oauth_client_id
  client_secret = data.google_secret_manager_secret_version.google_oauth[0].secret_data

  depends_on = [google_identity_platform_config.auth]
}

data "google_secret_manager_secret_version" "apple_oauth" {
  count   = var.enable_apple_signin ? 1 : 0
  project = var.project_id
  secret  = var.apple_oauth_secret_id
  version = "latest"
}

resource "google_identity_platform_default_supported_idp_config" "apple" {
  provider = google-beta
  count    = var.enable_apple_signin ? 1 : 0

  project   = var.project_id
  enabled   = true
  idp_id    = "apple.com"
  client_id = var.apple_services_id

  # See variables.tf: this is a JWT with a hard expiry, not a static secret.
  client_secret = data.google_secret_manager_secret_version.apple_oauth[0].secret_data

  depends_on = [google_identity_platform_config.auth]
}

# --------------------------------------------------------------------------
# App Check
# --------------------------------------------------------------------------
#
# App Check is half of the security model that ADR-0010 relies on: the client
# config is public, so "is this request from our app?" cannot be answered by
# possession of an API key. Firestore Security Rules answer "may this user do
# this?"; App Check answers "is this our app at all?". Both are needed, and
# neither is a substitute for the other.

# THIS is what makes App Check real. Registering an App Check provider and
# calling initializeAppCheck() on the client changes nothing on its own: until
# enforcement is turned on per service, an attacker omits the App Check header
# and every request still succeeds. Enforcement is a server-side act, and this
# resource is the only place this project performs it (ADR-0012 forbids doing
# it in the console).
#
# An unenforced App Check is arguably worse than none, because the client-side
# wiring reads as protection to anyone reviewing the app code.
#
# Covers Google-managed Firebase backends only. The AI proxy is a custom
# Cloud Run backend, so no service config exists for it -- it verifies the
# App Check token itself, gated by the APP_CHECK_REQUIRED env var set in
# modules/ai-proxy. Two different mechanisms for the same guarantee.
resource "google_firebase_app_check_service_config" "enforced" {
  provider = google-beta
  for_each = toset(var.app_check_services)

  project          = var.project_id
  service_id       = each.value
  enforcement_mode = var.app_check_enforcement

  lifecycle {
    # ENFORCED with no attestation provider registered is not a weaker
    # security posture -- it is a total outage. The web app is the only
    # registered app (ADR-0008 is PWA-first), so reCAPTCHA is the only way a
    # client can obtain a token; without it enforcement rejects everything,
    # including the real app. Caught at plan time rather than on the first
    # production request.
    precondition {
      condition     = var.app_check_enforcement != "ENFORCED" || var.recaptcha_secret_id != ""
      error_message = "app_check_enforcement is ENFORCED but recaptcha_secret_id is empty. With no attestation provider the client cannot mint an App Check token, so every request from the real app would be rejected. Create the reCAPTCHA site key/secret first (see infra/README.md -> App Check)."
    }
  }

  depends_on = [google_firebase_project.this]
}

resource "google_firebase_app_check_recaptcha_v3_config" "web" {
  provider = google-beta
  count    = var.recaptcha_secret_id == "" ? 0 : 1

  project     = var.project_id
  app_id      = google_firebase_web_app.web.app_id
  site_secret = data.google_secret_manager_secret_version.recaptcha[0].secret_data

  # An App Check token good for a day means a stolen token is useful for a day.
  # An hour is the shortest value the service accepts without the refresh churn
  # becoming its own cost line.
  token_ttl = "3600s"
}

data "google_secret_manager_secret_version" "recaptcha" {
  count   = var.recaptcha_secret_id == "" ? 0 : 1
  project = var.project_id
  secret  = var.recaptcha_secret_id
  version = "latest"
}

# --------------------------------------------------------------------------
# Hosting
# --------------------------------------------------------------------------
#
# Hosting egress is $0.15/GB and was called out in ADR-0004 as one of two cost
# traps designed around rather than discovered. The mitigations live outside
# Terraform: exercise media is served from jsDelivr (ADR-0007), fonts are
# self-hosted and subset (ADR-0014), and firebase.json sets immutable
# year-long cache headers on hashed assets. What Terraform owns is the site.

resource "google_firebase_hosting_site" "web" {
  provider = google-beta
  project  = var.project_id
  site_id  = coalesce(var.hosting_site_id, var.project_id)
  app_id   = google_firebase_web_app.web.app_id

  depends_on = [google_firebase_project.this]
}

resource "google_firebase_hosting_custom_domain" "web" {
  provider = google-beta
  count    = var.custom_domain == null ? 0 : 1

  project       = var.project_id
  site_id       = google_firebase_hosting_site.web.site_id
  custom_domain = var.custom_domain

  # Apply will sit in a pending state until the DNS records Firebase asks for
  # exist. That is a manual step for whoever controls the domain; see
  # infra/README.md -> Manual steps.
  wait_dns_verification = false
}
