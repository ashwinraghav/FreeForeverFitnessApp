output "pubsub_topic_id" {
  description = "Topic receiving billing budget notifications. Subscribe an automated kill switch here."
  value       = google_pubsub_topic.budget.id
}

output "notification_channel_ids" {
  description = "Cloud Monitoring email channels, reusable by other alert policies."
  value       = [for c in google_monitoring_notification_channel.email : c.id]
}

output "budget_id" {
  description = "Resource ID of the monthly billing budget."
  value       = google_billing_budget.monthly.id
}

# The ADR-0012 ordering is enforced by `depends_on = [module.budget]` on every
# billable module in modules/platform, and asserted in CI. This output exists so
# a caller that needs the ordering as a *value* -- a template, a null_resource,
# a future module -- has one, rather than reaching into the budget's internals.
output "guardrails_ready" {
  description = "Sentinel proving budget guardrails exist. ADR-0012 ordering handle."
  value       = google_billing_budget.monthly.name
}
