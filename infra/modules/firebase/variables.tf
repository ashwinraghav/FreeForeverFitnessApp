variable "project_id" {
  description = "GCP project to turn into a Firebase project."
  type        = string
}

variable "environment" {
  description = "dev | prod."
  type        = string
}

variable "web_app_display_name" {
  description = "Name of the Firebase web app registration."
  type        = string
  default     = "TheFreeForeverFitnessApp"
}

variable "firestore_location" {
  description = <<-EOT
    Firestore location. Immutable after creation — changing it means a new
    database, not a migration. Pick the multi-region or region closest to the
    user base and accept it forever.
  EOT
  type        = string
  default     = "eur3"
}

variable "firestore_delete_protection" {
  description = "DELETE_PROTECTION_ENABLED | DELETE_PROTECTION_DISABLED."
  type        = string
  default     = "DELETE_PROTECTION_ENABLED"
}

variable "firestore_point_in_time_recovery" {
  description = <<-EOT
    POINT_IN_TIME_RECOVERY_ENABLED costs money (continuous backup storage).
    On in prod, off in dev — the free-forever claim is about the production
    bill, and dev data is fixtures.
  EOT
  type        = string
  default     = "POINT_IN_TIME_RECOVERY_DISABLED"
}

variable "autodelete_anonymous_users" {
  description = <<-EOT
    Identity Platform deletes anonymous accounts inactive for 30 days.

    ADR-0009 flags abandoned anonymous accounts as needing a cleanup policy but
    does not settle it, so this defaults to FALSE: with anonymous-first auth
    (no email, no password) the account IS the user's only key to their data,
    and a 30-day gym break must not silently orphan a training history. Turning
    it on needs an ADR and a matching Firestore document lifecycle, not a flag
    flip. Deleting the account does not delete the documents underneath it.
  EOT
  type        = bool
  default     = false
}

variable "authorized_domains" {
  description = "Domains allowed to complete an auth flow. localhost is required for emulator-free local testing against a real dev project."
  type        = list(string)
  default     = ["localhost"]
}

variable "enable_google_signin" {
  description = "Enable the Google identity provider. Requires google_oauth_secret_id to resolve."
  type        = bool
  default     = false
}

variable "enable_apple_signin" {
  description = "Enable the Apple identity provider. Requires apple_oauth_secret_id to resolve."
  type        = bool
  default     = false
}

variable "google_oauth_client_id" {
  description = "OAuth client ID for Google sign-in. Public by nature (it ships in the client)."
  type        = string
  default     = ""
}

variable "google_oauth_secret_id" {
  description = <<-EOT
    Secret Manager secret ID holding the Google OAuth client secret.
    Terraform reads the LATEST version at apply time. The value is never in
    this repository and never in a tfvars file; only the secret's name is.
  EOT
  type        = string
  default     = ""
}

variable "apple_services_id" {
  description = "Apple Services ID (the OAuth client_id for Sign in with Apple). Public."
  type        = string
  default     = ""
}

variable "apple_oauth_secret_id" {
  description = <<-EOT
    Secret Manager secret ID holding the Apple client secret JWT.

    Operational caveat worth knowing before you enable this: Apple's client
    secret is a JWT you generate from a .p8 private key and it EXPIRES after at
    most six months. Sign in with Apple then breaks with no deploy having
    happened. Rotation is a calendar item, not a Terraform concern.
  EOT
  type        = string
  default     = ""
}

variable "app_check_enforcement" {
  description = <<-EOT
    ENFORCED | UNENFORCED | OFF, applied to the Firebase services listed in
    app_check_services. Enforce in prod; leave unenforced in dev so a
    contributor pointing at the dev project is not locked out.
  EOT
  type        = string
  default     = "UNENFORCED"

  validation {
    condition     = contains(["ENFORCED", "UNENFORCED", "OFF"], var.app_check_enforcement)
    error_message = "app_check_enforcement must be ENFORCED, UNENFORCED or OFF."
  }
}

variable "app_check_services" {
  description = "Services App Check enforcement applies to."
  type        = list(string)
  default = [
    "firestore.googleapis.com",
    "identitytoolkit.googleapis.com",
  ]
}

variable "recaptcha_secret_id" {
  description = <<-EOT
    Secret Manager secret ID holding the reCAPTCHA Enterprise / v3 site
    SECRET. The site KEY is public and ships in the client bundle
    (VITE_FIREBASE_APPCHECK_SITE_KEY); the site secret is not and lives here.
    Empty string leaves App Check registered but without a web attestation
    provider, which is the correct state for dev.
  EOT
  type        = string
  default     = ""
}

variable "hosting_site_id" {
  description = "Firebase Hosting site ID. Defaults to the project ID when null."
  type        = string
  default     = null
}

variable "custom_domain" {
  description = "Optional custom domain for Hosting. Requires DNS records the maintainer must add by hand."
  type        = string
  default     = null
}


variable "signup_quota_per_hour" {
  description = <<-EOT
    Ceiling on new sign-ups per hour, anonymous included. A sign-up flood is
    both an abuse vector and a cost event (every anonymous uid is a Firestore
    document tree). Far above organic growth, far below anything that produces
    a bill.
  EOT
  type        = number
  default     = 1000
}

variable "signup_quota_start_time" {
  description = "RFC3339 instant the sign-up quota takes effect. Fixed, not computed, so applies are idempotent."
  type        = string
  default     = "2026-01-01T00:00:00Z"
}
