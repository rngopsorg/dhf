# ─── Phase 3 — Shared infrastructure (Postgres / Redis / NATS / MinIO) ──
resource "null_resource" "shared_infra" {
  triggers = {
    cluster_id    = null_resource.k3d_cluster.id
    manifest_hash = filesha256("${local.k8s_dir}/00-shared-infra.yaml")
  }

  depends_on = [
    null_resource.namespaces,
    null_resource.k3d_image_import,  # single sequential import resource
  ]

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      kubectl apply -f ${local.k8s_dir}/00-shared-infra.yaml
      kubectl -n ecca-shared rollout status deploy/postgres --timeout=${var.wait_timeout_seconds}s
      kubectl -n ecca-shared rollout status deploy/redis    --timeout=${var.wait_timeout_seconds}s
      kubectl -n ecca-shared rollout status deploy/nats     --timeout=${var.wait_timeout_seconds}s
      kubectl -n ecca-shared rollout status deploy/minio    --timeout=${var.wait_timeout_seconds}s
    EOT
  }
}

# ─── Phase 4 — Per-region chain stacks (medulla / hippocampus / cortex) ──
resource "null_resource" "region_chains" {
  for_each = toset(var.regions)

  triggers = {
    cluster_id    = null_resource.k3d_cluster.id
    manifest_hash = filesha256("${local.k8s_dir}/01-${each.key}.yaml")
    image_import  = null_resource.k3d_image_import.id
  }

  depends_on = [
    null_resource.shared_infra,
    null_resource.k3d_image_import,
    null_resource.latency,
  ]

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      kubectl apply -f ${local.k8s_dir}/01-${each.key}.yaml
      for app in medulla-pow hippocampus-dag cortex-evm; do
        kubectl -n ${each.key} rollout status deploy/$app --timeout=${var.wait_timeout_seconds}s || \
          echo "WARN: $app in ${each.key} did not reach ready in ${var.wait_timeout_seconds}s"
      done
    EOT
  }
}

# ─── Phase 5 — Deploy contracts (one-shot job in region-compute) ─────
resource "null_resource" "contracts_deployer" {
  triggers = {
    cluster_id    = null_resource.k3d_cluster.id
    manifest_hash = filesha256("${local.k8s_dir}/02-contracts-deployer.yaml")
  }

  depends_on = [null_resource.region_chains]

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      kubectl -n region-compute delete job contracts-deployer --ignore-not-found
      kubectl -n region-compute apply -f ${local.k8s_dir}/02-contracts-deployer.yaml
      kubectl -n region-compute wait --for=condition=complete \
        job/contracts-deployer --timeout=${var.wait_timeout_seconds * 2}s
      echo "─── Contract deployment log ───"
      kubectl -n region-compute logs job/contracts-deployer | tail -40
    EOT
  }
}

# ─── Phase 6 — Per-region services (siyana-api + thalamus-router) ────
resource "null_resource" "services" {
  triggers = {
    cluster_id    = null_resource.k3d_cluster.id
    manifest_hash = filesha256("${local.k8s_dir}/03-services.yaml")
  }

  depends_on = [null_resource.contracts_deployer]

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      kubectl apply -f ${local.k8s_dir}/03-services.yaml
      for region in ${join(" ", var.regions)}; do
        for app in siyana-api thalamus-router; do
          kubectl -n "$region" rollout status deploy/$app --timeout=${var.wait_timeout_seconds}s || \
            echo "WARN: $app in $region did not reach ready"
        done
      done
    EOT
  }
}
