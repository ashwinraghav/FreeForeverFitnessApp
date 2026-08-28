variable "project_id" {
  description = "GCP project that will hold Terraform state. Usually the prod project."
  type        = string
}

variable "region" {
  description = "Default region."
  type        = string
  default     = "europe-west1"
}

variable "state_bucket_name" {
  description = "Globally unique GCS bucket name for Terraform state."
  type        = string
}

variable "state_bucket_location" {
  description = "Bucket location. Single-region is cheaper and sufficient for state."
  type        = string
  default     = "EU"
}

variable "state_admin_principals" {
  description = "IAM members allowed to read and write state, e.g. [\"user:maintainer@example.com\"]. CI is granted separately by the ci-wif module."
  type        = list(string)
  default     = []
}
