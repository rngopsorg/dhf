# ─── tc netem latency injection ──────────────────────────────────────
# Extracts tc + libs from an Alpine container and injects them into each
# k3d node, then configures netem rules per-region.

resource "null_resource" "latency" {
  count = var.skip_latency ? 0 : 1

  triggers = {
    cluster_id            = null_resource.k3d_cluster.id
    storage_compute       = "${var.latency_storage_compute_ms}±${var.latency_storage_compute_jitter_ms}"
    compute_bandwidth     = "${var.latency_compute_bandwidth_ms}±${var.latency_compute_bandwidth_jitter_ms}"
    storage_bandwidth     = "${var.latency_storage_bandwidth_ms}±${var.latency_storage_bandwidth_jitter_ms}"
    inject_script_hash    = filesha256("${local.script_dir}/inject-tc.sh")
    configure_script_hash = filesha256("${local.script_dir}/configure-latency.sh")
  }

  depends_on = [null_resource.k3d_cluster]

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      bash ${local.script_dir}/inject-tc.sh
      bash ${local.script_dir}/configure-latency.sh
    EOT
    environment = merge(local.shell_env, {
      LAT_SC_MS         = tostring(var.latency_storage_compute_ms)
      LAT_SC_JITTER_MS  = tostring(var.latency_storage_compute_jitter_ms)
      LAT_CB_MS         = tostring(var.latency_compute_bandwidth_ms)
      LAT_CB_JITTER_MS  = tostring(var.latency_compute_bandwidth_jitter_ms)
      LAT_SB_MS         = tostring(var.latency_storage_bandwidth_ms)
      LAT_SB_JITTER_MS  = tostring(var.latency_storage_bandwidth_jitter_ms)
    })
  }
}
