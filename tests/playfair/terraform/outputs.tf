output "cluster_name" {
  value = var.cluster_name
}

output "regions" {
  value = var.regions
}

output "results_dir" {
  value = local.results_dir
}

output "report_path" {
  value = "${local.playfair_dir}/playfair-report.html"
}

output "kubeconfig_hint" {
  value = "kubectl config use-context k3d-${var.cluster_name}"
}

output "endpoints" {
  description = "Per-region siyana-api endpoints exposed on the host"
  value = {
    storage   = "http://localhost:27070"
    compute   = "http://localhost:27071"
    bandwidth = "http://localhost:27072"
  }
}

output "latency_profile" {
  value = var.skip_latency ? "disabled" : join(", ", [
    "storage↔compute ${var.latency_storage_compute_ms}±${var.latency_storage_compute_jitter_ms}ms",
    "compute↔bandwidth ${var.latency_compute_bandwidth_ms}±${var.latency_compute_bandwidth_jitter_ms}ms",
    "storage↔bandwidth ${var.latency_storage_bandwidth_ms}±${var.latency_storage_bandwidth_jitter_ms}ms",
  ])
}

output "teardown" {
  value = "terraform destroy -auto-approve  # tears down cluster + state"
}
