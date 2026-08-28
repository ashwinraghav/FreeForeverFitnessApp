# Partial backend configuration. The bucket name is not committed because it is
# environment-specific and belongs to whoever runs this fork, not to the repo.
#
#   terraform init -backend-config=backend.hcl
#
# where backend.hcl (gitignored, see infra/README.md) contains:
#   bucket = "your-tfstate-bucket"
terraform {
  backend "gcs" {
    prefix = "env/dev"
  }
}
