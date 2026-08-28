variable "project_id" {
  description = "GCP project ID to enable services on."
  type        = string
}

variable "services" {
  description = "Fully-qualified service names, e.g. run.googleapis.com."
  type        = list(string)
}
