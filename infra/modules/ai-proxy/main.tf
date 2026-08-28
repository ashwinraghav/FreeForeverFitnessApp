# The AI proxy (ADR-0016): the only component in the system whose cost can run
# away, so it is the component with the most guardrails per line of code.
#
#   - The provider key lives in Secret Manager and is mounted, never baked in.
#   - Instances are hard-capped; minimum instances are forbidden.
#   - Per-uid quotas and a global monthly cap are configuration, reviewable
#     in a pull request rather than buried in application constants.
#   - App Check is required, so the endpoint is reachable but not usable by
#     anything that is not the app.
#   - A one-variable kill switch cuts spend without a code change.

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0, < 7.0"
    }
  }
}

# --------------------------------------------------------------------------
# Artifact Registry
# --------------------------------------------------------------------------

resource "google_artifact_registry_repository" "containers" {
  project       = var.project_id
  location      = var.region
  repository_id = "containers-${var.environment}"
  description   = "Container images for ${var.service_name}."
  format        = "DOCKER"

  docker_config {
    immutable_tags = false
  }

  # Image storage is billed by the gigabyte-month. Without a cleanup policy an
  # image registry is a slowly growing bill that nobody ever looks at.
  cleanup_policies {
    id     = "keep-recent-releases"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  cleanup_policies {
    id     = "delete-old-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "${var.image_retention_days * 24}h"
    }
  }
}

# --------------------------------------------------------------------------
# Secret Manager — container only
# --------------------------------------------------------------------------

# The secret CONTAINER is Terraform's. The VALUE is added out of band, once,
# by a human:
#
#   printf '%s' "$KEY" | gcloud secrets versions add ai-provider-api-key \
#     --project <project> --data-file=-
#
# No google_secret_manager_secret_version resource exists in this repository
# and none should. A version resource would put the key in Terraform state,
# in every plan output, and in the CI log of any job that ran a plan.
resource "google_secret_manager_secret" "ai_provider_key" {
  project   = var.project_id
  secret_id = var.ai_provider_secret_id

  replication {
    auto {}
  }

  labels = {
    managed-by = "terraform"
    env        = var.environment
    contains   = "third-party-api-key"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# --------------------------------------------------------------------------
# Runtime identity
# --------------------------------------------------------------------------

# A dedicated SA. The default Compute Engine service account carries Editor on
# the whole project, which on a Cloud Run service that talks to the public
# internet is an unreasonable amount of authority to hold by default.
resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "${var.service_name}-${var.environment}"
  display_name = "AI proxy runtime (${var.environment})"
  description  = "Cloud Run runtime identity. Least privilege; no keys (ADR-0011)."
}

# Read the provider key — scoped to this one secret, not the project.
# Revoked outright when the kill switch is thrown, so the service cannot spend
# even if a bug ignores the AI_ENABLED flag below.
resource "google_secret_manager_secret_iam_member" "runtime_accessor" {
  count = var.kill_switch ? 0 : 1

  project   = var.project_id
  secret_id = google_secret_manager_secret.ai_provider_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

# Firestore access for the per-uid quota counters (ADR-0016). datastore.user is
# read/write on documents and grants nothing administrative.
resource "google_project_iam_member" "runtime" {
  for_each = toset([
    "roles/datastore.user",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/cloudtrace.agent",
    # Verifies Firebase ID tokens and App Check tokens on inbound requests.
    "roles/firebaseauth.viewer",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# --------------------------------------------------------------------------
# Cloud Run
# --------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "proxy" {
  project  = var.project_id
  name     = "${var.service_name}-${var.environment}"
  location = var.region

  # The browser calls this directly, so it must accept internet traffic. What
  # keeps that safe and cheap is not network policy: it is App Check plus a
  # Firebase ID token verified in-process, a per-uid quota, and the instance
  # ceiling below. Cloud Run IAM cannot express "a signed-in user of our PWA",
  # so pretending it can by locking ingress would be theatre.
  ingress = "INGRESS_TRAFFIC_ALL"

  deletion_protection = false

  template {
    service_account = google_service_account.runtime.email

    # The cost ceiling, stated as infrastructure.
    scaling {
      min_instance_count = var.min_instance_count
      max_instance_count = var.kill_switch ? 1 : var.max_instance_count
    }

    max_instance_request_concurrency = var.container_concurrency
    timeout                          = "${var.request_timeout_seconds}s"

    containers {
      image = var.container_image

      resources {
        limits = {
          cpu    = var.cpu_limit
          memory = var.memory_limit
        }
        # CPU is allocated only while a request is in flight. For a proxy that
        # spends its life waiting on an upstream, this is most of the saving.
        cpu_idle          = true
        startup_cpu_boost = true
      }

      env {
        name  = "AI_ENABLED"
        value = var.kill_switch ? "false" : "true"
      }

      env {
        name  = "APP_CHECK_REQUIRED"
        value = tostring(var.app_check_required)
      }

      env {
        name  = "PER_USER_DAILY_CALL_QUOTA"
        value = tostring(var.per_user_daily_call_quota)
      }

      env {
        name  = "GLOBAL_MONTHLY_SPEND_CAP_MICROS"
        value = tostring(var.global_monthly_spend_cap_micros)
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }

      env {
        name  = "ENVIRONMENT"
        value = var.environment
      }

      # Mounted from Secret Manager at start-up. The value is not in this
      # repository, not in Terraform state, and not in the image.
      dynamic "env" {
        for_each = var.kill_switch ? [] : [1]
        content {
          name = "AI_PROVIDER_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.ai_provider_key.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    # CI deploys images; Terraform owns shape and limits. Without this, an
    # apply from a laptop would silently roll the service back to whatever
    # var.container_image defaults to.
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_secret_manager_secret.ai_provider_key,
    google_project_iam_member.runtime,
  ]
}

# Unauthenticated at the Cloud Run layer, authenticated in the application.
# See the ingress comment above for why this is the honest configuration
# rather than the alarming one.
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  location = google_cloud_run_v2_service.proxy.location
  name     = google_cloud_run_v2_service.proxy.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
