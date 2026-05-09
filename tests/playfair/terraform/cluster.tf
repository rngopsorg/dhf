# ─── k3d cluster ──────────────────────────────────────────────────────
# Create the k3d cluster with port mappings + region-labeled agent nodes.
# Re-runs only when cluster_name, agent count, or port mappings change.

resource "null_resource" "k3d_cluster" {
  triggers = {
    cluster_name = var.cluster_name
    agents       = var.agents
    ports        = join(",", var.port_map)
    script_hash  = filesha256("${local.script_dir}/cluster-up.sh")
  }

  provisioner "local-exec" {
    when    = create
    command = "bash ${local.script_dir}/cluster-up.sh"
    environment = merge(local.shell_env, {
      AGENTS = tostring(var.agents)
      PORTS  = join("|", var.port_map)
    })
  }

  provisioner "local-exec" {
    when       = destroy
    command    = "k3d cluster delete ${self.triggers.cluster_name} 2>/dev/null || true"
    on_failure = continue
  }
}

# ─── Label agent nodes by region ──────────────────────────────────────
resource "null_resource" "node_labels" {
  triggers = {
    cluster_id = null_resource.k3d_cluster.id
    regions    = join(",", var.regions)
  }

  depends_on = [null_resource.k3d_cluster]

  provisioner "local-exec" {
    command = "bash ${local.script_dir}/label-nodes.sh"
    environment = merge(local.shell_env, {
      REGIONS = join(",", var.regions)
    })
  }
}

# ─── Create namespaces ────────────────────────────────────────────────
resource "null_resource" "namespaces" {
  triggers = {
    cluster_id = null_resource.k3d_cluster.id
    regions    = join(",", var.regions)
  }

  depends_on = [null_resource.node_labels]

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      kubectl create namespace ecca-shared --dry-run=client -o yaml | kubectl apply -f -
      for region in ${join(" ", var.regions)}; do
        kubectl create namespace "$region" --dry-run=client -o yaml | kubectl apply -f -
      done
    EOT
  }
}
