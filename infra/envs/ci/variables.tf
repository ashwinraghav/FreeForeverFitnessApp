variable "project_id" {
  description = "The GCP project that owns Hosting and the deploy identity."
  type        = string
}

variable "region" {
  description = "Default region for regional resources."
  type        = string
  default     = "europe-west1"
}

variable "github_repository" {
  description = "owner/name, used to build the WIF subject."
  type        = string
}

variable "github_repository_id" {
  description = "Numeric repository id. Pinned so a repo renamed or recreated at the same path cannot inherit the binding."
  type        = string
}

variable "github_repository_owner_id" {
  description = "Numeric owner id, pinned for the same reason."
  type        = string
}

variable "deploy_environment" {
  description = "GitHub Environment whose jobs may assume the deployer."
  type        = string
  default     = "production"
}

variable "state_bucket" {
  description = "Terraform state bucket created by envs/bootstrap."
  type        = string
}
