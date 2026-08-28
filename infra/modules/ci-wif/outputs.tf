output "workload_identity_provider" {
  description = "Full provider resource name. Goes in the GitHub workflow as `workload_identity_provider`. Not a secret — it is useless without the attribute_condition matching."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "pool_name" {
  description = "Full pool resource name."
  value       = google_iam_workload_identity_pool.github.name
}

output "deployer_service_account_email" {
  description = "SA impersonated by deploy jobs."
  value       = google_service_account.deployer.email
}

output "planner_service_account_email" {
  description = "Read-only SA impersonated by plan-on-PR jobs."
  value       = google_service_account.planner.email
}

output "github_variables" {
  description = <<-EOT
    Copy these into GitHub repository *variables* (Settings -> Secrets and
    variables -> Actions -> Variables). They are identifiers, not credentials:
    none of them grants anything without a token whose claims satisfy the
    provider's attribute_condition. Storing them as variables rather than
    secrets keeps CI logs readable and makes the "no secrets" claim honest.
  EOT
  value = {
    GCP_WORKLOAD_IDENTITY_PROVIDER = google_iam_workload_identity_pool_provider.github.name
    GCP_DEPLOY_SERVICE_ACCOUNT     = google_service_account.deployer.email
    GCP_PLAN_SERVICE_ACCOUNT       = google_service_account.planner.email
    GCP_PROJECT_ID                 = var.project_id
  }
}
