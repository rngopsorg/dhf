variable "cluster_name" {
  description = "k3d cluster name"
  type        = string
  default     = "playfair"
}

variable "epochs" {
  description = "Number of game epochs the orchestrator runs"
  type        = number
  default     = 50
}

variable "agents" {
  description = "Number of k3d agent nodes (one per region; must be 3 for tripartite)"
  type        = number
  default     = 3
}

variable "image_tag" {
  description = "Tag applied to all locally-built ECCA images"
  type        = string
  default     = "local"
}

variable "regions" {
  description = "Region labels applied to agent nodes (in agent index order)"
  type        = list(string)
  default     = ["region-storage", "region-compute", "region-bandwidth"]
}

# ─── Cross-region latency profile (one-way ms ± jitter) ──────────────
variable "latency_storage_compute_ms" {
  type    = number
  default = 33
}
variable "latency_storage_compute_jitter_ms" {
  type    = number
  default = 5
}
variable "latency_compute_bandwidth_ms" {
  type    = number
  default = 42
}
variable "latency_compute_bandwidth_jitter_ms" {
  type    = number
  default = 8
}
variable "latency_storage_bandwidth_ms" {
  type    = number
  default = 75
}
variable "latency_storage_bandwidth_jitter_ms" {
  type    = number
  default = 12
}

# ─── Host port mappings (chosen to avoid Docker Desktop conflicts) ───
variable "port_map" {
  description = "host:nodePort mappings exposed by the k3d server"
  type        = list(string)
  default = [
    "27070-27072:30070-30072", # siyana-api per region
    "28332-28334:30332-30334", # medulla-pow
    "25001-25003:30501-30503", # hippocampus-dag
    "28545-28547:30545-30547", # cortex-evm
  ]
}

# ─── Skip flags (for fast iteration) ─────────────────────────────────
variable "skip_images" {
  description = "Skip docker image builds (assumes images already built)"
  type        = bool
  default     = false
}

variable "skip_latency" {
  description = "Skip tc netem latency injection"
  type        = bool
  default     = false
}

variable "skip_orchestrator" {
  description = "Skip launching the orchestrator job (deploys infra only)"
  type        = bool
  default     = false
}

# ─── Image rebuild knob ──────────────────────────────────────────────
variable "force_image_rebuild" {
  description = "Bump this string (e.g. timestamp) to force a docker rebuild even if file hashes are unchanged"
  type        = string
  default     = ""
}

variable "wait_timeout_seconds" {
  description = "Timeout per kubectl wait step (chains, services, etc.)"
  type        = number
  default     = 240
}
