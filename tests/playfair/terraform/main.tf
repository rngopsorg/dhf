locals {
  # Resolve repo + script paths relative to this terraform module
  module_root = path.module
  playfair_dir = abspath("${path.module}/..")
  repo_root    = abspath("${path.module}/../../..")
  script_dir   = "${path.module}/scripts"
  results_dir  = "${abspath(path.module)}/../results"
  k8s_dir      = abspath("${path.module}/../k8s")

  # Docker image list (must match images.tf)
  service_images = [
    "siyana-api",
    "thalamus-router",
    "dhf-compositor",
    "needlecast-router-svc",
    "quellist-treasury-svc",
    "bandwidth-faucet",
    "sleeve-runtime",
  ]

  chain_images = [
    "medulla-pow",
    "hippocampus-dag",
    "cortex-evm",
  ]

  # All image refs (name:tag) that must be loaded into k3d
  all_image_refs = concat(
    [for img in local.chain_images : "ecca-${img}:${var.image_tag}"],
    [for img in local.service_images : "ecca-${img}:${var.image_tag}"],
    [
      "ecca-worker:${var.image_tag}",
      "ecca-playfair-orchestrator:${var.image_tag}",
      "ecca-ts-builder:${var.image_tag}",
    ],
  )

  # Common env passed to every shell exec
  shell_env = {
    CLUSTER_NAME = var.cluster_name
    REPO_ROOT    = local.repo_root
    PLAYFAIR_DIR = local.playfair_dir
    K8S_DIR      = local.k8s_dir
    RESULTS_DIR  = local.results_dir
    IMAGE_TAG    = var.image_tag
  }
}
