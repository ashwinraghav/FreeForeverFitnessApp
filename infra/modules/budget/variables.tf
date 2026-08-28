variable "project_id" {
  description = "GCP project the budget is scoped to."
  type        = string
}

variable "project_number" {
  description = "Numeric project number. Billing budget filters address projects by number, not ID."
  type        = string
}

variable "environment" {
  description = "dev | prod. Used in resource names and alert titles."
  type        = string
}

variable "billing_account" {
  description = "Billing account ID (NNNNNN-NNNNNN-NNNNNN). Not a secret, but not in this repo either."
  type        = string
}

variable "budget_amount_usd" {
  description = <<-EOT
    Monthly budget ceiling in USD. This is the denominator for every threshold
    below, so it is the single number that defines "surprising bill" for this
    project. Keep it small: ADR-0001 rule 2 means a correct month should be
    nowhere near it.
  EOT
  type        = number

  validation {
    condition     = var.budget_amount_usd > 0 && var.budget_amount_usd <= 1000
    error_message = "Budget must be > 0 and <= 1000 USD. A four-figure monthly ceiling on a free-forever app is a bug, not a configuration."
  }
}

variable "threshold_percents" {
  description = <<-EOT
    Fractions of budget_amount_usd at which a notification fires against
    ACTUAL spend. ADR-0012 mandates 50/80/100.
  EOT
  type        = list(number)
  default     = [0.5, 0.8, 1.0]
}

variable "forecast_threshold_percents" {
  description = <<-EOT
    Fractions at which a notification fires against FORECAST spend. Forecast
    alerts are the ones that arrive in time to do something: actual-100% means
    the money is already spent.
  EOT
  type        = list(number)
  default     = [0.8, 1.0]
}

variable "alert_emails" {
  description = "Addresses that receive Cloud Monitoring cost-anomaly alerts. Not secret; still supplied via tfvars rather than committed."
  type        = list(string)
  default     = []
}

variable "ai_provider_hourly_spend_ceiling_micros" {
  description = <<-EOT
    Alert if the AI proxy reports more than this much provider spend in one
    hour, in micro-dollars (1_000_000 = $1). This is the anomaly detector that
    fires *hours* before a billing budget notices, because billing data lags
    and the proxy's own logs do not.
  EOT
  type        = number
  default     = 500000 # $0.50/hour == ~$360/month if sustained
}

variable "firestore_read_ops_ceiling_per_minute" {
  description = <<-EOT
    Firestore reads per minute above which something is querying rather than
    syncing. ADR-0005 makes this a correctness alarm as much as a cost one:
    a chart rendered from a Firestore query is a bug.
  EOT
  type        = number
  default     = 5000
}

variable "cloud_run_instance_ceiling" {
  description = "Alert when the AI proxy is running more than this many container instances (runaway scale-out)."
  type        = number
  default     = 3
}
