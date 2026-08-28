variable "project_id" {
  description = "Dev GCP project ID. Never committed — see terraform.tfvars.example."
  type        = string
}

variable "region" {
  type    = string
  default = "europe-west1"
}

variable "billing_account" {
  description = "Billing account ID (NNNNNN-NNNNNN-NNNNNN)."
  type        = string
}

variable "state_bucket" {
  description = "GCS bucket holding Terraform state, from envs/bootstrap."
  type        = string
}

variable "budget_amount_usd" {
  type    = number
  default = 5
}

variable "alert_emails" {
  type    = list(string)
  default = []
}

variable "github_repository" {
  description = "owner/repo. Exactly one repository; no wildcards (ADR-0011)."
  type        = string
}

variable "github_repository_id" {
  description = "gh api repos/OWNER/REPO --jq .id"
  type        = string
}

variable "github_repository_owner_id" {
  description = "gh api users/OWNER --jq .id"
  type        = string
}

variable "deploy_branch" {
  type    = string
  default = "main"
}

variable "extra_authorized_domains" {
  type    = list(string)
  default = []
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
  description = "Secret Manager secret ID. The NAME of the secret, never its value."
  type        = string
  default     = ""
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
  description = "Secret Manager secret ID. The NAME of the secret, never its value."
  type        = string
  default     = ""
}

variable "ai_proxy_kill_switch" {
  type    = bool
  default = false
}
