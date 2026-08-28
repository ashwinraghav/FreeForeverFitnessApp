output "project_id" {
  value       = var.project_id
  description = "Project this environment lives in."
}

output "firebase_client_config" {
  description = "Public Firebase web config (ADR-0010). Feed into apps/web's committed config."
  value       = module.firebase.client_config
}

output "hosting_site_id" {
  value       = module.firebase.hosting_site_id
  description = "Firebase Hosting site."
}

output "hosting_url" {
  value       = module.firebase.hosting_default_url
  description = "Default Hosting URL."
}

output "ai_proxy_url" {
  value       = module.ai_proxy.service_url
  description = "AI proxy endpoint."
}

output "ai_provider_secret_id" {
  value       = module.ai_proxy.ai_provider_secret_id
  description = "Secret container name. Add the value with `gcloud secrets versions add`, never with Terraform."
}

output "kill_switch_engaged" {
  value       = module.ai_proxy.kill_switch_engaged
  description = "Whether hosted AI is currently switched off."
}

output "budget_pubsub_topic" {
  value       = module.budget.pubsub_topic_id
  description = "Topic receiving budget notifications."
}

output "github_actions_variables" {
  description = "Values to set as GitHub repository variables. Identifiers, not credentials."
  value       = module.ci.github_variables
}
