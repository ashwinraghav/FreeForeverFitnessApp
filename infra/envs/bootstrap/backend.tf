/**
 * Bootstrap keeps its state in the bucket it creates.
 *
 * The chicken and egg is real but only once: the first apply runs with local state,
 * then the state moves here. Leaving it local would mean the bucket that holds every
 * other environment's state was itself managed from one laptop — and if that file were
 * lost, the bucket becomes an unmanaged resource Terraform would try to recreate.
 */
terraform {
  backend "gcs" {
    prefix = "env/bootstrap"
  }
}
