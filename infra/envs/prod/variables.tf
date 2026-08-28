variable "project_id" {
  description = "Production GCP project ID."
  type        = string
}

variable "region" {
  type    = string
  default = "europe-west1"
}

variable "billing_account" {
  type = string
}

variable "state_bucket" {
  type = string
}

variable "budget_amount_usd" {
  description = <<-EOT
    The number the free-forever claim is measured against. ADR-0020 publishes
    the actual bill monthly, so this ceiling is public-facing in effect: if
    it has to be raised, that is a fact about the product, not about billing.
  EOT
  type        = number
  default     = 50
}

variable "alert_emails" {
  type    = list(string)
  default = []
}

variable "github_repository" {
  type = string
}

variable "github_repository_id" {
  type = string
}

variable "github_repository_owner_id" {
  type = string
}

variable "deploy_branch" {
  type    = string
  default = "main"
}

variable "deploy_environment" {
  description = "GitHub Environment gating production deploys. Configure required reviewers on it."
  type        = string
  default     = "production"
}

variable "extra_authorized_domains" {
  type    = list(string)
  default = []
}

variable "custom_domain" {
  type    = string
  default = null
}

variable "recaptcha_secret_id" {
  description = "Secret Manager secret ID holding the reCAPTCHA site SECRET (the site KEY is public and ships in the bundle)."
  type        = string
  default     = ""
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

variable "ai_proxy_max_instances" {
  type    = number
  default = 2
}

variable "ai_global_monthly_spend_cap_micros" {
  type    = number
  default = 20000000
}

variable "ai_per_user_daily_call_quota" {
  type    = number
  default = 20
}

variable "ai_proxy_kill_switch" {
  description = "Emergency stop for hosted AI. See infra/README.md -> Kill switch."
  type        = bool
  default     = false
}
