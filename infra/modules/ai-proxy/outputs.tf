output "service_url" {
  description = "Cloud Run URL of the AI proxy."
  value       = google_cloud_run_v2_service.proxy.uri
}

output "service_name" {
  description = "Cloud Run service name, for `gcloud run services update`."
  value       = google_cloud_run_v2_service.proxy.name
}

output "runtime_service_account_email" {
  description = "Runtime identity, so CI can be granted actAs on exactly this SA and no other."
  value       = google_service_account.runtime.email
}

output "artifact_registry_repository_id" {
  description = "Artifact Registry repo ID, for scoping the CI push binding."
  value       = google_artifact_registry_repository.containers.repository_id
}

output "artifact_registry_url" {
  description = "Docker push/pull host path."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.repository_id}"
}

output "ai_provider_secret_id" {
  description = "Name of the secret container. The value is added out of band and is never in this repository."
  value       = google_secret_manager_secret.ai_provider_key.secret_id
}

output "kill_switch_engaged" {
  description = "True when hosted AI is off and the provider key binding has been revoked."
  value       = var.kill_switch
}
