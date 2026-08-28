# Enables the GCP APIs the platform needs.
#
# This module is deliberately first in the dependency chain: enabling an API
# costs nothing, but almost every other resource fails to create without it.
# ADR-0012 requires budget guardrails before anything *billable*; APIs are not
# billable, so the order is services -> budget -> everything else.

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0, < 7.0"
    }
  }
}

resource "google_project_service" "this" {
  for_each = toset(var.services)

  project = var.project_id
  service = each.value

  # Leaving APIs enabled on destroy is intentional. Disabling an API can
  # cascade into deleting data (Firestore in particular) and is not something
  # a `terraform destroy` of an unrelated resource should be able to trigger.
  disable_on_destroy         = false
  disable_dependent_services = false
}
