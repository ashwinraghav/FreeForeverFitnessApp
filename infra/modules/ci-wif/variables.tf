variable "project_id" {
  description = "Project hosting the identity pool and the CI service accounts."
  type        = string
}

variable "environment" {
  description = "dev | prod."
  type        = string
}

variable "github_repository" {
  description = <<-EOT
    The one repository allowed to federate, as "owner/repo".

    There is deliberately no default and deliberately no wildcard. A value like
    "owner/*" or an empty attribute_condition turns this pool into a credential
    that any GitHub Actions workflow on the internet can mint.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$", var.github_repository))
    error_message = "Must be exactly \"owner/repo\". Wildcards, globs and bare owners are rejected on purpose."
  }
}

variable "github_repository_id" {
  description = <<-EOT
    GitHub's immutable numeric repository ID.
      gh api repos/OWNER/REPO --jq .id

    Names are recyclable; IDs are not. Pinning the ID is what stops the
    "delete the repo, someone re-registers the name, they are now us" attack.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_id))
    error_message = "Must be the numeric repository ID, digits only."
  }
}

variable "github_repository_owner_id" {
  description = <<-EOT
    GitHub's immutable numeric owner (user or org) ID.
      gh api users/OWNER --jq .id
  EOT
  type        = string

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_owner_id))
    error_message = "Must be the numeric owner ID, digits only."
  }
}

variable "deploy_branch" {
  description = <<-EOT
    The protected branch whose pushes may deploy this environment. Branch
    protection on GitHub is load-bearing here: this binding trusts that only
    reviewed commits reach the branch.
  EOT
  type        = string
  default     = "main"
}

variable "deploy_gate" {
  description = <<-EOT
    How a deploy identity is proven.

      "branch"      -- a push to var.deploy_branch. Suitable for dev.
      "environment" -- a job declaring `environment: <deploy_environment>`,
                       which GitHub gates with required reviewers and wait
                       timers. Suitable for prod, because approval happens
                       outside the repository's own code.
  EOT
  type        = string
  default     = "branch"

  validation {
    condition     = contains(["branch", "environment"], var.deploy_gate)
    error_message = "deploy_gate must be \"branch\" or \"environment\"."
  }
}

variable "deploy_environment" {
  description = "GitHub Environment name when deploy_gate = \"environment\"."
  type        = string
  default     = "production"
}

variable "artifact_registry_repository_id" {
  description = "Artifact Registry repo the deployer may push to. Null disables the binding."
  type        = string
  default     = null
}

variable "runtime_service_account_email" {
  description = "Cloud Run runtime SA the deployer may act as. Null disables the binding."
  type        = string
  default     = null
}

variable "state_bucket" {
  description = "GCS bucket holding Terraform state. The planner gets read-only access to it."
  type        = string
}

variable "region" {
  description = "Region for regional resources referenced in IAM conditions."
  type        = string
  default     = "europe-west1"
}

variable "subject_prefix" {
  description = <<-EOT
    The literal prefix GitHub puts in the OIDC `sub` claim, without the trailing
    `:environment:...` or `:ref:...`.

    Null means the classic `repo:OWNER/NAME`. Supply it when the account emits the
    newer ID-embedded form, `repo:OWNER@OWNER_ID/NAME@REPO_ID`, which is now the
    default on some accounts even with `use_default: true`.

    Read the actual value rather than guessing:
      gh api repos/OWNER/NAME/actions/oidc/customization/sub --jq .sub_claim_prefix
  EOT
  type        = string
  default     = null
}

variable "deployer_roles" {
  description = <<-EOT
    Project roles the deploy identity gets.

    Defaults to the minimum a Hosting deploy needs. Anything beyond that is opt-in by
    the environment that genuinely runs it: an env with Firestore passes the rules and
    index roles, one with Cloud Run passes `run.developer`.

    The default used to be the union of all of them, which meant a project with no
    Firestore and no Cloud Run still handed CI the ability to rewrite security rules.
    Inert, but exposure nobody had asked for.
  EOT
  type        = set(string)
  default = [
    "roles/firebasehosting.admin",
    # firebase-tools checks which APIs are enabled before it deploys; without this it
    # cannot read that and refuses.
    "roles/serviceusage.serviceUsageConsumer",
  ]
}
