# ─── Source-tree hashes drive image rebuild triggers ─────────────────
# Each image has a hash of the files it depends on. When sources change,
# Terraform marks the image resource for replacement → rebuild + reimport.

data "external" "src_hashes" {
  program = ["bash", "${local.script_dir}/src-hashes.sh"]
  query   = { repo_root = local.repo_root }
}

# ─── Chain images (Go) ───────────────────────────────────────────────
resource "null_resource" "image_chain" {
  for_each = toset(local.chain_images)

  triggers = {
    src_hash      = data.external.src_hashes.result["chain_${replace(each.key, "-", "_")}"]
    image_tag     = var.image_tag
    force_rebuild = var.force_image_rebuild
    skip          = tostring(var.skip_images)
  }

  provisioner "local-exec" {
    command = var.skip_images ? "echo 'skip image build for ${each.key}'" : "bash ${local.script_dir}/build-chain.sh ${each.key}"
    environment = local.shell_env
  }
}

# ─── TS builder (full monorepo build) ────────────────────────────────
resource "null_resource" "image_ts_builder" {
  triggers = {
    src_hash      = data.external.src_hashes.result["ts_builder"]
    image_tag     = var.image_tag
    force_rebuild = var.force_image_rebuild
    skip          = tostring(var.skip_images)
  }

  provisioner "local-exec" {
    command = var.skip_images ? "echo 'skip ts-builder build'" : "bash ${local.script_dir}/build-ts-builder.sh"
    environment = local.shell_env
  }
}

# ─── Service images (depend on ts-builder) ───────────────────────────
resource "null_resource" "image_service" {
  for_each = toset(concat(local.service_images, ["worker"]))

  triggers = {
    builder_id    = null_resource.image_ts_builder.id
    image_tag     = var.image_tag
    force_rebuild = var.force_image_rebuild
    skip          = tostring(var.skip_images)
  }

  depends_on = [null_resource.image_ts_builder]

  provisioner "local-exec" {
    command = var.skip_images ? "echo 'skip service build for ${each.key}'" : "bash ${local.script_dir}/build-service.sh ${each.key}"
    environment = local.shell_env
  }
}

# ─── Orchestrator image ──────────────────────────────────────────────
resource "null_resource" "image_orchestrator" {
  triggers = {
    src_hash      = data.external.src_hashes.result["orchestrator"]
    image_tag     = var.image_tag
    force_rebuild = var.force_image_rebuild
    skip          = tostring(var.skip_images)
  }

  provisioner "local-exec" {
    command = var.skip_images ? "echo 'skip orchestrator build'" : "bash ${local.script_dir}/build-orchestrator.sh"
    environment = local.shell_env
  }
}

# ─── Import all images into the k3d cluster ──────────────────────────
# k3d import is required because k3s cannot pull from the host docker daemon.
# Run sequentially in one shell to avoid concurrent writes to the k3d tools node
# (parallel imports deadlock under Docker Desktop).
resource "null_resource" "k3d_image_import" {
  triggers = {
    cluster_id   = null_resource.k3d_cluster.id
    image_refs   = join(",", sort(local.all_image_refs))
    chain_ids    = join(",", [for r in null_resource.image_chain : r.id])
    service_ids  = join(",", [for r in null_resource.image_service : r.id])
    orch_id      = null_resource.image_orchestrator.id
  }

  depends_on = [
    null_resource.k3d_cluster,
    null_resource.image_chain,
    null_resource.image_service,
    null_resource.image_orchestrator,
  ]

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      for img in ${join(" ", sort(local.all_image_refs))}; do
        echo "→ importing $img..."
        k3d image import "$img" -c ${var.cluster_name}
      done
      echo "✓ all images loaded"
    EOT
    environment = local.shell_env
  }
}
