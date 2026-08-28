variable "project_id" {
  description = "GCP project ID for this environment."
  type        = string
}

variable "environment" {
  description = "dev | prod."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}

variable "region" {
  description = "Region for Cloud Run and Artifact Registry."
  type        = string
  default     = "europe-west1"
}

variable "billing_account" {
  description = "Billing account ID the budget is created under."
  type        = string
}

variable "state_bucket" {
  description = "GCS bucket holding Terraform state (created by envs/bootstrap)."
  type        = string
}

# --- Budget -------------------------------------------------------------
variable "budget_amount_usd" {
  description = "Monthly ceiling in USD."
  type        = number
}

variable "alert_emails" {
  description = "Recipients for cost-anomaly alerts."
  type        = list(string)
  default     = []
}

# --- GitHub / WIF -------------------------------------------------------
variable "github_repository" {
  description = "owner/repo. No wildcards (ADR-0011)."
  type        = string
}

variable "github_repository_id" {
  description = "Immutable numeric repository ID."
  type        = string
}

variable "github_repository_owner_id" {
  description = "Immutable numeric owner ID."
  type        = string
}

variable "deploy_branch" {
  description = "Protected branch permitted to deploy."
  type        = string
  default     = "main"
}

variable "deploy_gate" {
  description = "branch | environment."
  type        = string
  default     = "branch"
}

variable "deploy_environment" {
  description = "GitHub Environment name when deploy_gate = environment."
  type        = string
  default     = "production"
}

# --- Firebase -----------------------------------------------------------
variable "firestore_location" {
  type    = string
  default = "eur3"
}

variable "firestore_point_in_time_recovery" {
  type    = string
  default = "POINT_IN_TIME_RECOVERY_DISABLED"
}

variable "app_check_enforcement" {
  type    = string
  default = "UNENFORCED"
}

variable "app_check_services" {
  description = <<-EOT
    Firebase backends App Check enforcement covers. Plumbed through rather than
    left to the module default so that "which backends are actually protected"
    is answerable from the environment stack, where someone reviewing a deploy
    will look for it.
  EOT
  type        = list(string)
  default = [
    "firestore.googleapis.com",
    "firebasestorage.googleapis.com",
    "identitytoolkit.googleapis.com",
  ]
}

variable "recaptcha_secret_id" {
  type    = string
  default = ""
}

variable "authorized_domains" {
  type    = list(string)
  default = ["localhost"]
}

variable "custom_domain" {
  type    = string
  default = null
}

variable "enable_google_signin" {
  type    = bool
  default = false
}

variable "google_oauth_client_id" {
  type    = string
  default = ""
}

variable "google_oauth_secret_id" {
  type    = string
  default = ""
}

variable "enable_apple_signin" {
  type    = bool
  default = false
}

variable "apple_services_id" {
  type    = string
  default = ""
}

variable "apple_oauth_secret_id" {
  type    = string
  default = ""
}

# --- AI proxy -----------------------------------------------------------
variable "ai_proxy_max_instances" {
  type    = number
  default = 2
}

variable "ai_proxy_kill_switch" {
  description = "Flip to true and apply to cut hosted AI spend. See infra/README.md."
  type        = bool
  default     = false
}

variable "ai_global_monthly_spend_cap_micros" {
  type    = number
  default = 20000000
}

variable "ai_per_user_daily_call_quota" {
  type    = number
  default = 20
}

variable "app_check_required_by_proxy" {
  type    = bool
  default = true
}
