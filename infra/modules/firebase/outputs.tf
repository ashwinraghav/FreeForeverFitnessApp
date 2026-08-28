output "web_app_id" {
  description = "Firebase web app ID."
  value       = google_firebase_web_app.web.app_id
}

# ADR-0010: this is a public project identifier, not a credential, and it is
# committed to the repository on purpose. `terraform output -json client_config`
# is the supported way to regenerate it. It is NOT marked sensitive, because
# marking a public value sensitive teaches people that the marker means nothing.
output "client_config" {
  description = "Firebase web client config. Public by design (ADR-0010, SECURITY.md)."
  value = {
    apiKey            = data.google_firebase_web_app_config.web.api_key
    authDomain        = data.google_firebase_web_app_config.web.auth_domain
    projectId         = var.project_id
    appId             = google_firebase_web_app.web.app_id
    messagingSenderId = data.google_firebase_web_app_config.web.messaging_sender_id
    storageBucket     = data.google_firebase_web_app_config.web.storage_bucket
  }
}

output "firestore_database_name" {
  description = "Firestore database resource name."
  value       = google_firestore_database.default.name
}

output "hosting_site_id" {
  description = "Firebase Hosting site ID, for `firebase deploy --only hosting:<id>`."
  value       = google_firebase_hosting_site.web.site_id
}

output "hosting_default_url" {
  description = "Default Hosting URL."
  value       = google_firebase_hosting_site.web.default_url
}
