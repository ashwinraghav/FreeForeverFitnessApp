output "state_bucket" {
  description = "Name of the state bucket."
  value       = google_storage_bucket.tfstate.name
}

output "backend_config" {
  description = "Paste into envs/*/backend.tf, or pass with -backend-config."
  value       = <<-EOT
    terraform {
      backend "gcs" {
        bucket = "${google_storage_bucket.tfstate.name}"
        prefix = "env/<dev|prod>"
      }
    }
  EOT
}
