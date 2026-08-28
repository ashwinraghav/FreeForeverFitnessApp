# Bootstrap: the one stack that cannot use the remote backend, because it
# creates the remote backend.
#
# Run once per project, from a maintainer's machine, with LOCAL state. Then
# migrate that state into the bucket it just made:
#
#   terraform init
#   terraform apply
#   # add the backend block printed by `terraform output backend_config`
#   terraform init -migrate-state
#
# Everything after this point runs from envs/dev and envs/prod against GCS.
#
# Note what is NOT here: project creation and billing linkage. Those need
# organisation-level permissions this project does not assume the maintainer
# has, and creating a project is the one action where a typo costs real money.
# They are documented as manual steps in infra/README.md.

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0, < 7.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_project_service" "bootstrap" {
  for_each = toset([
    "storage.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "serviceusage.googleapis.com",
  ])

  project                    = var.project_id
  service                    = each.value
  disable_on_destroy         = false
  disable_dependent_services = false
}

resource "google_storage_bucket" "tfstate" {
  project  = var.project_id
  name     = var.state_bucket_name
  location = var.state_bucket_location

  # Terraform state contains the AI provider key indirectly (via the identity
  # platform secret data sources) and every resource identifier. SECURITY.md
  # lists it as secret. Uniform access removes per-object ACLs as a way to
  # accidentally make it readable.
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # A corrupted or truncated state file is recoverable only from a previous
  # version. This is not optional.
  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 20
    }
    action {
      type = "Delete"
    }
  }

  lifecycle_rule {
    condition {
      age        = 90
      with_state = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  # Deleting this bucket orphans every resource in every environment.
  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.bootstrap]
}

resource "google_storage_bucket_iam_member" "admins" {
  for_each = toset(var.state_admin_principals)

  bucket = google_storage_bucket.tfstate.name
  role   = "roles/storage.objectAdmin"
  member = each.value
}
