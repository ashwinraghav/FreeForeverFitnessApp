variable "project_id" {
  type        = string
  description = "GCP project."
}

variable "environment" {
  type        = string
  description = "dev | prod."
}

variable "region" {
  type        = string
  description = "Region for Artifact Registry and Cloud Run."
  default     = "europe-west1"
}

variable "service_name" {
  type        = string
  description = "Cloud Run service name."
  default     = "ai-proxy"
}

variable "container_image" {
  description = <<-EOT
    Image to deploy. Defaults to Google's hello container so the service can
    exist before apps/functions do. CI replaces the image on every deploy and
    Terraform ignores changes to it (see lifecycle block) — otherwise every
    `terraform apply` would roll production back to whatever this variable
    happened to say.
  EOT
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "max_instance_count" {
  description = <<-EOT
    HARD ceiling on concurrent container instances. This is the single most
    important number in this file: Cloud Run bills per instance-second, and an
    unbounded max_instance_count is how a retry storm becomes a four-figure
    invoice. ADR-0001 rule 2 requires the cap to ship with the feature, so it
    is required infrastructure, not a tuning knob.

    Exceeding it returns 429 to the client, which the app must degrade on
    (ADR-0016: AI is a garnish, never load-bearing).
  EOT
  type        = number
  default     = 2

  validation {
    condition     = var.max_instance_count >= 1 && var.max_instance_count <= 10
    error_message = "max_instance_count must be 1..10. A larger ceiling needs an ADR explaining how ADR-0001 rule 2 still holds."
  }
}

variable "min_instance_count" {
  description = "Warm instances. Must be 0: a warm instance bills 24/7 for a feature that is explicitly optional."
  type        = number
  default     = 0

  validation {
    condition     = var.min_instance_count == 0
    error_message = "min_instance_count must be 0. A minimum instance is a standing monthly charge for a garnish."
  }
}

variable "container_concurrency" {
  description = "Requests per instance. High concurrency is what keeps max_instance_count low for an IO-bound proxy."
  type        = number
  default     = 80
}

variable "request_timeout_seconds" {
  description = "Request timeout. Long timeouts multiply the cost of a hung upstream by the number of stuck instances."
  type        = number
  default     = 30
}

variable "cpu_limit" {
  type        = string
  description = "CPU limit per instance."
  default     = "1"
}

variable "memory_limit" {
  type        = string
  description = "Memory limit per instance."
  default     = "512Mi"
}

variable "ai_provider_secret_id" {
  description = "Secret Manager secret ID for the AI provider API key. The CONTAINER is declared here; the value never is."
  type        = string
  default     = "ai-provider-api-key"
}

variable "global_monthly_spend_cap_micros" {
  description = <<-EOT
    Global spend ceiling handed to the proxy, in micro-USD. ADR-0016: when it
    is reached the service degrades to deterministic mode rather than failing
    or overspending. The proxy enforces it; Terraform is where the number lives
    so it is reviewable in a pull request.
  EOT
  type        = number
  default     = 20000000 # $20/month
}

variable "per_user_daily_call_quota" {
  description = "Per-uid daily AI call ceiling, enforced by the proxy against a Firestore counter (ADR-0016)."
  type        = number
  default     = 20
}

variable "kill_switch" {
  description = <<-EOT
    Set true and apply to stop hosted AI spend.

    It does three things at once: tells the proxy AI is off, drops its access to
    the provider key so it could not spend even if the flag were ignored, and
    holds the instance ceiling at 1. See infra/README.md -> Kill switch, which
    covers the wider ladder up to unlinking billing.
  EOT
  type        = bool
  default     = false
}

variable "app_check_required" {
  description = "Tells the proxy to reject requests without a valid App Check token. Off in dev so the emulator works."
  type        = bool
  default     = true
}

variable "image_retention_days" {
  description = "Artifact Registry cleanup horizon. Container images are billed storage; old revisions are not free."
  type        = number
  default     = 30
}

