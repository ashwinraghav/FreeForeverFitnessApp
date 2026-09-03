output "workload_identity_provider" {
  description = "Full resource name for google-github-actions/auth."
  value       = module.ci.workload_identity_provider
}

output "deployer_service_account" {
  description = "Service account the deploy job impersonates."
  value       = module.ci.deployer_service_account_email
}
