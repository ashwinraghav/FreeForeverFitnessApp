# Budget guardrails.
#
# ADR-0012: "Budget alerts are provisioned BEFORE any billable resource."
# The env stacks enforce that ordering with an explicit depends_on from every
# billable module to this one. It is not a comment, it is a graph edge.
#
# Three independent layers, because each one has a blind spot:
#
#   1. Billing budget (actual + forecast)  -- authoritative, but billing data
#      lags by hours and a budget alert is a *notification*, never a cap.
#   2. Log-based metrics on the AI proxy's own structured logs -- near-real-time
#      and denominated in provider dollars, which billing cannot see at all
#      until the invoice arrives.
#   3. Resource-rate alerts (Cloud Run instances, Firestore reads) -- catch the
#      shape of a runaway before it is expensive enough to show up anywhere.
#
# None of these stop spend. The kill switch does; see infra/README.md.

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0, < 7.0"
    }
  }
}

# --------------------------------------------------------------------------
# Notification fan-out
# --------------------------------------------------------------------------

# Pub/Sub is the machine-readable path. A budget notification lands here as a
# structured message, which is what any future automated kill switch would
# subscribe to. We publish to it from day one so the topic exists and is
# already receiving traffic long before anything reads it.
resource "google_pubsub_topic" "budget" {
  project = var.project_id
  name    = "budget-alerts-${var.environment}"

  labels = {
    managed-by = "terraform"
    purpose    = "budget-notifications"
    env        = var.environment
  }

  # Budget notifications are small and only useful while fresh.
  message_retention_duration = "86400s"
}

# The billing service publishes as this well-known service agent. Without this
# binding the budget silently never delivers, which is the worst possible
# failure mode for an alert: it looks configured and is not.
resource "google_pubsub_topic_iam_member" "billing_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.budget.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:billing-budget-alerts@system.gserviceaccount.com"
}

# Email is the human path. Cloud Monitoring channels are used by the anomaly
# alert policies below; the billing budget itself also copies every Billing
# Account Administrator by default (disable_default_iam_recipients = false).
resource "google_monitoring_notification_channel" "email" {
  for_each = toset(var.alert_emails)

  project      = var.project_id
  display_name = "Cost alerts (${var.environment}) -> ${each.value}"
  type         = "email"

  labels = {
    email_address = each.value
  }
}

# --------------------------------------------------------------------------
# 1. Billing budget
# --------------------------------------------------------------------------

resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account
  display_name    = "TheFreeForeverFitnessApp ${var.environment} monthly ceiling"

  budget_filter {
    # Budgets address projects by NUMBER. Using the ID here is a silent
    # no-op: the budget is created, matches nothing, and never fires.
    projects = ["projects/${var.project_number}"]

    calendar_period = "MONTH"

    # Credits (free tier, promotional) are excluded from the spend figure, so
    # the budget measures what would actually be invoiced. That is the number
    # the free-forever claim is about.
    credit_types_treatment = "EXCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.budget_amount_usd)
    }
  }

  dynamic "threshold_rules" {
    for_each = var.threshold_percents
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }

  dynamic "threshold_rules" {
    for_each = var.forecast_threshold_percents
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "FORECASTED_SPEND"
    }
  }

  all_updates_rule {
    pubsub_topic   = google_pubsub_topic.budget.id
    schema_version = "1.0"

    # Keep the default IAM recipients (billing admins) on the email path.
    # Belt and braces: if the Pub/Sub binding above ever breaks, a human
    # still gets told.
    disable_default_iam_recipients = false
  }

  depends_on = [google_pubsub_topic_iam_member.billing_publisher]
}

# --------------------------------------------------------------------------
# 2. Log-based cost anomaly detection
# --------------------------------------------------------------------------

# The AI proxy emits one structured log line per upstream provider call:
#   { "event": "ai_call_completed", "provider_cost_micros": 1234, "uid": "..." }
# Extracting the cost field turns provider spend -- which GCP billing cannot
# see, because it is someone else's invoice -- into a first-class metric we
# can alert on within a minute.
resource "google_logging_metric" "ai_provider_spend" {
  project = var.project_id
  name    = "ai_proxy/provider_spend_micros"

  description = "Upstream AI provider spend reported by the proxy, in micro-USD. Not visible to GCP billing (ADR-0016)."

  filter = join(" AND ", [
    "resource.type=\"cloud_run_revision\"",
    "jsonPayload.event=\"ai_call_completed\"",
    "jsonPayload.provider_cost_micros>0",
  ])

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "DISTRIBUTION"
    unit         = "1"
    display_name = "AI provider spend (micro-USD)"
  }

  value_extractor = "EXTRACT(jsonPayload.provider_cost_micros)"

  bucket_options {
    exponential_buckets {
      num_finite_buckets = 32
      growth_factor      = 2
      scale              = 1
    }
  }
}

# A burst of quota rejections means either an abusive client or a bug that is
# about to become a bill. Either way it wants a human, not a dashboard.
resource "google_logging_metric" "ai_quota_exceeded" {
  project = var.project_id
  name    = "ai_proxy/quota_exceeded_count"

  description = "Per-uid AI quota rejections from the proxy (ADR-0016). A spike is abuse or a loop."

  filter = join(" AND ", [
    "resource.type=\"cloud_run_revision\"",
    "jsonPayload.event=\"ai_quota_exceeded\"",
  ])

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "AI quota rejections"
  }
}

resource "google_monitoring_alert_policy" "ai_provider_spend" {
  count = length(var.alert_emails) > 0 ? 1 : 0

  project      = var.project_id
  display_name = "AI provider spend anomaly (${var.environment})"
  combiner     = "OR"

  documentation {
    content   = "AI proxy reported more than ${var.ai_provider_hourly_spend_ceiling_micros} micro-USD of upstream spend in an hour. Runbook: infra/README.md -> Kill switch."
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "Hourly provider spend above ceiling"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/${google_logging_metric.ai_provider_spend.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.ai_provider_hourly_spend_ceiling_micros
      duration        = "0s"

      aggregations {
        alignment_period     = "3600s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [for c in google_monitoring_notification_channel.email : c.id]

  alert_strategy {
    auto_close = "86400s"
  }
}

resource "google_monitoring_alert_policy" "ai_quota_exceeded" {
  count = length(var.alert_emails) > 0 ? 1 : 0

  project      = var.project_id
  display_name = "AI quota rejection burst (${var.environment})"
  combiner     = "OR"

  documentation {
    content   = "Sustained per-uid quota rejections. Likely abuse or a client retry loop. Runbook: infra/README.md."
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "Quota rejections above 100/5min"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/${google_logging_metric.ai_quota_exceeded.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 100
      duration        = "300s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [for c in google_monitoring_notification_channel.email : c.id]

  alert_strategy {
    auto_close = "86400s"
  }
}

# --------------------------------------------------------------------------
# 3. Resource-rate alerts
# --------------------------------------------------------------------------

# Cloud Run bills per instance-second. Scale-out is the failure mode: a slow
# upstream plus retries turns into instances, and instances turn into money.
resource "google_monitoring_alert_policy" "cloud_run_scale_out" {
  count = length(var.alert_emails) > 0 ? 1 : 0

  project      = var.project_id
  display_name = "Cloud Run runaway scale-out (${var.environment})"
  combiner     = "OR"

  documentation {
    content   = "The AI proxy is running more than ${var.cloud_run_instance_ceiling} instances. The hard cap is set on the service itself; this fires as it is approached."
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "Active instances above ceiling"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND metric.type = \"run.googleapis.com/container/instance_count\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.cloud_run_instance_ceiling
      duration        = "300s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_MAX"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [for c in google_monitoring_notification_channel.email : c.id]

  alert_strategy {
    auto_close = "86400s"
  }
}

# Firestore is priced per document read. ADR-0005 says reads come from the
# local cache and analytics read materialised aggregates -- so a high server
# read rate is a design regression that happens to also be the single easiest
# way to run up a bill on this stack.
resource "google_monitoring_alert_policy" "firestore_read_rate" {
  count = length(var.alert_emails) > 0 ? 1 : 0

  project      = var.project_id
  display_name = "Firestore read rate anomaly (${var.environment})"
  combiner     = "OR"

  documentation {
    content   = "Server-side Firestore reads above ${var.firestore_read_ops_ceiling_per_minute}/min. Per ADR-0005 this is a bug (a query rendering a chart), not growth."
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "Document reads above ceiling"

    condition_threshold {
      filter          = "resource.type = \"firestore.googleapis.com/Database\" AND metric.type = \"firestore.googleapis.com/document/read_count\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.firestore_read_ops_ceiling_per_minute
      duration        = "300s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [for c in google_monitoring_notification_channel.email : c.id]

  alert_strategy {
    auto_close = "86400s"
  }
}
