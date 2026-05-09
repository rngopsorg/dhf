# ─── Phase 7-8 — Run orchestrator + collect results ──────────────────
resource "null_resource" "orchestrator" {
  count = var.skip_orchestrator ? 0 : 1

  triggers = {
    cluster_id    = null_resource.k3d_cluster.id
    epochs        = var.epochs
    manifest_hash = filesha256("${local.k8s_dir}/04-orchestrator.yaml")
    services_id   = null_resource.services.id
  }

  depends_on = [null_resource.services]

  provisioner "local-exec" {
    command = "bash ${local.script_dir}/run-orchestrator.sh"
    environment = merge(local.shell_env, {
      EPOCHS = tostring(var.epochs)
    })
  }
}
