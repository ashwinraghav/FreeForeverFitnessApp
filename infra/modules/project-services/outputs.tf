output "enabled_services" {
  description = "The service names this module manages, for use in depends_on chains."
  value       = [for s in google_project_service.this : s.service]
}
