output "firebase_client_config" {
  description = "Public client config (ADR-0010)."
  value       = module.platform.firebase_client_config
}

output "ai_proxy_url" {
  value = module.platform.ai_proxy_url
}

output "hosting_url" {
  value = module.platform.hosting_url
}

output "github_actions_variables" {
  description = "Set these as GitHub repository variables. Identifiers, not credentials."
  value       = module.platform.github_actions_variables
}

output "kill_switch_engaged" {
  value = module.platform.kill_switch_engaged
}
