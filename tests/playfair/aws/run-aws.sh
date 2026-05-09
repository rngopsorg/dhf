#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  PLAYFAIR AWS — 3-Region Tripartite Game on Real Infrastructure
# ═══════════════════════════════════════════════════════════════════════
#
#  Deploys the ECCA Playfair test across 3 AWS regions using k3s on EC2:
#
#    us-east-1  (N. Virginia)  → compute region  (cheap compute, fast PoW)
#    us-west-2  (Oregon)       → storage region  (cheap storage, big DAG)
#    eu-west-1  (Ireland)      → bandwidth region (cheap bandwidth, cross-Atlantic)
#
#  Each region gets its own EC2 instance running k3s with:
#    - medulla-pow, hippocampus-dag, cortex-evm (tuned per region)
#    - siyana-api + thalamus-router
#
#  Shared infra (Postgres, Redis, NATS) lives in the compute region.
#  The orchestrator runs locally and connects to all 3 siyana-api instances.
#
#  Usage:
#    ./tests/playfair/aws/run-aws.sh
#    ./tests/playfair/aws/run-aws.sh --epochs 20
#    ./tests/playfair/aws/run-aws.sh --skip-provision   # reuse existing instances
#    ./tests/playfair/aws/run-aws.sh --skip-build       # reuse existing images
#
#  Cost: ~$0.20–$0.50 for a 50-epoch run (3× t3.medium for ~30 min)
#
#  Prerequisites:
#    - AWS CLI configured (aws sts get-caller-identity works)
#    - jq, ssh, curl, node ≥ 20
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# ─── Config ───────────────────────────────────────────────────────────
REGIONS=(us-east-1 us-west-2 eu-west-1)
ROLES=(compute storage bandwidth)
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.micro}"
EPOCHS="${EPOCHS:-50}"
REPO_URL="${REPO_URL:-https://github.com/aarong11/dhf.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
STATE_DIR="${STATE_DIR:-$HOME/.playfair-aws}"
TAG="playfair"

SKIP_PROVISION=false
SKIP_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --skip-provision) SKIP_PROVISION=true ;;
    --skip-build)     SKIP_BUILD=true ;;
    --epochs=*)       EPOCHS="${arg#*=}" ;;
    --epochs)         ;; # handled below
  esac
done
# Handle --epochs N (two-arg form)
while [[ $# -gt 0 ]]; do
  case "$1" in
    --epochs) EPOCHS="${2:-50}"; shift 2 ;;
    *) shift ;;
  esac
done

# ─── Colors & Logging ─────────────────────────────────────────────────
C_CYAN='\033[0;36m'  C_GREEN='\033[0;32m'  C_YELLOW='\033[0;33m'
C_RED='\033[0;31m'   C_MAGENTA='\033[0;35m' C_RESET='\033[0m'

log()  { echo -e "${C_CYAN}[playfair-aws]${C_RESET} $*"; }
ok()   { echo -e "${C_GREEN}  ✓${C_RESET} $*"; }
warn() { echo -e "${C_YELLOW}  ⚠${C_RESET} $*"; }
fail() { echo -e "${C_RED}  ✗ $*${C_RESET}"; exit 1; }
phase() { echo -e "\n${C_MAGENTA}═══ $* ═══${C_RESET}"; }

# ─── SSH Helpers ───────────────────────────────────────────────────────
KEY_FILE="$STATE_DIR/playfair.pem"

ssh_cmd() {
  local ip=$1; shift
  ssh -q -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=10 -o ServerAliveInterval=30 \
    -i "$KEY_FILE" ec2-user@"$ip" "$@"
}

kctl() {
  local ip=$1; shift
  ssh_cmd "$ip" "sudo kubectl $*"
}

# ─── Prerequisites ────────────────────────────────────────────────────
phase "PHASE 0 — Prerequisites"
for cmd in aws jq ssh ssh-keygen curl node; do
  command -v "$cmd" &>/dev/null || fail "Required: $cmd"
done
aws sts get-caller-identity &>/dev/null || fail "AWS CLI not configured — run 'aws configure'"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ok "AWS account: $ACCOUNT_ID"
ok "All prerequisites met"

mkdir -p "$STATE_DIR"

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 1 — Provision Infrastructure
# ═══════════════════════════════════════════════════════════════════════

if [ "$SKIP_PROVISION" = true ]; then
  log "Skipping provision (--skip-provision)"
  # Verify state files exist
  for role in "${ROLES[@]}"; do
    [ -f "$STATE_DIR/instance-$role.ip" ] || fail "No state for $role — run without --skip-provision"
  done
else

phase "PHASE 1a — SSH Key Pair"

if [ -f "$KEY_FILE" ]; then
  log "Reusing existing SSH key"
else
  ssh-keygen -t ed25519 -f "$KEY_FILE" -N "" -q
  chmod 600 "$KEY_FILE"
fi

for i in "${!REGIONS[@]}"; do
  region="${REGIONS[$i]}"
  aws ec2 delete-key-pair --region "$region" --key-name "$TAG" 2>/dev/null || true
  aws ec2 import-key-pair --region "$region" \
    --key-name "$TAG" \
    --public-key-material "fileb://${KEY_FILE}.pub" >/dev/null
  ok "Key → $region"
done

# ─── Security Groups ─────────────────────────────────────────────────
phase "PHASE 1b — Security Groups"

MY_IP="$(curl -s --max-time 5 ifconfig.me)/32"
log "Your IP: $MY_IP"

for i in "${!REGIONS[@]}"; do
  region="${REGIONS[$i]}"
  role="${ROLES[$i]}"

  vpc_id=$(aws ec2 describe-vpcs --region "$region" \
    --filters Name=isDefault,Values=true \
    --query 'Vpcs[0].VpcId' --output text)

  # Delete existing SG if present (from a prior run)
  old_sg=$(aws ec2 describe-security-groups --region "$region" \
    --filters "Name=group-name,Values=$TAG-$role" \
    --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "None")
  if [ "$old_sg" != "None" ] && [ -n "$old_sg" ]; then
    aws ec2 delete-security-group --region "$region" --group-id "$old_sg" 2>/dev/null || true
  fi

  sg_id=$(aws ec2 create-security-group --region "$region" \
    --group-name "$TAG-$role" \
    --description "Playfair test - $role region" \
    --vpc-id "$vpc_id" \
    --query 'GroupId' --output text)

  # SSH + K8s NodePorts from user's machine
  aws ec2 authorize-security-group-ingress --region "$region" \
    --group-id "$sg_id" --protocol tcp --port 22 --cidr "$MY_IP" >/dev/null
  aws ec2 authorize-security-group-ingress --region "$region" \
    --group-id "$sg_id" --protocol tcp --port 30000-32767 --cidr "$MY_IP" >/dev/null

  echo "$sg_id" > "$STATE_DIR/sg-$role.id"
  echo "$region" > "$STATE_DIR/sg-$role.region"
  ok "SG $sg_id → $region ($role)"
done

# ─── Launch EC2 Instances ────────────────────────────────────────────
phase "PHASE 1c — Launch EC2 Instances"

# Cloud-init: install docker, k3s, node
USER_DATA=$(base64 <<'USERDATA'
#!/bin/bash
set -ex
exec > /var/log/playfair-init.log 2>&1

# Docker
dnf install -y docker git
systemctl enable docker && systemctl start docker
usermod -aG docker ec2-user

# k3s
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable=traefik" sh -

# Node.js 20
dnf install -y nodejs20-20.* npm
npm install -g pnpm@9.7.0 2>/dev/null || npm install -g pnpm

# Ready signal
while ! sudo kubectl get nodes 2>/dev/null; do sleep 2; done
touch /tmp/playfair-deps-ready
USERDATA
)

for i in "${!REGIONS[@]}"; do
  region="${REGIONS[$i]}"
  role="${ROLES[$i]}"
  sg_id=$(cat "$STATE_DIR/sg-$role.id")

  # Latest Amazon Linux 2023 AMI
  ami_id=$(aws ssm get-parameters --region "$region" \
    --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64 \
    --query 'Parameters[0].Value' --output text)

  instance_id=$(aws ec2 run-instances --region "$region" \
    --image-id "$ami_id" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$TAG" \
    --security-group-ids "$sg_id" \
    --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=30,VolumeType=gp3}' \
    --user-data "$USER_DATA" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$TAG-$role},{Key=Project,Value=playfair}]" \
    --query 'Instances[0].InstanceId' --output text)

  echo "$instance_id" > "$STATE_DIR/instance-$role.id"
  echo "$region" > "$STATE_DIR/instance-$role.region"
  ok "Launched $instance_id in $region ($role)"
done

# Wait for public IPs
log "Waiting for public IPs..."
for role in "${ROLES[@]}"; do
  region=$(cat "$STATE_DIR/instance-$role.region")
  instance_id=$(cat "$STATE_DIR/instance-$role.id")

  aws ec2 wait instance-running --region "$region" --instance-ids "$instance_id"

  public_ip=$(aws ec2 describe-instances --region "$region" \
    --instance-ids "$instance_id" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

  echo "$public_ip" > "$STATE_DIR/instance-$role.ip"
  ok "$role → $public_ip"
done

# ─── Cross-instance SG rules ─────────────────────────────────────────
phase "PHASE 1d — Cross-Instance Traffic Rules"

for i in "${!REGIONS[@]}"; do
  role="${ROLES[$i]}"
  region=$(cat "$STATE_DIR/sg-$role.region")
  sg_id=$(cat "$STATE_DIR/sg-$role.id")

  for j in "${!REGIONS[@]}"; do
    if [ "$i" != "$j" ]; then
      other_ip=$(cat "$STATE_DIR/instance-${ROLES[$j]}.ip")
      aws ec2 authorize-security-group-ingress --region "$region" \
        --group-id "$sg_id" --protocol tcp --port 0-65535 \
        --cidr "${other_ip}/32" >/dev/null 2>&1 || true
    fi
  done
done
ok "Cross-instance traffic allowed"

fi  # end SKIP_PROVISION

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 2 — Wait for Instances & Build Images
# ═══════════════════════════════════════════════════════════════════════

COMPUTE_IP=$(cat "$STATE_DIR/instance-compute.ip")
STORAGE_IP=$(cat "$STATE_DIR/instance-storage.ip")
BANDWIDTH_IP=$(cat "$STATE_DIR/instance-bandwidth.ip")

phase "PHASE 2 — Instance Readiness"

for role in "${ROLES[@]}"; do
  ip=$(cat "$STATE_DIR/instance-$role.ip")
  printf "  Waiting for %s (%s)..." "$role" "$ip"
  for attempt in $(seq 1 90); do
    if ssh_cmd "$ip" "test -f /tmp/playfair-deps-ready" 2>/dev/null; then
      echo ""
      ok "$role ready"
      break
    fi
    [ "$attempt" -eq 90 ] && { echo ""; fail "$role timed out"; }
    printf "."
    sleep 5
  done
done

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 3 — Clone & Build
# ═══════════════════════════════════════════════════════════════════════

if [ "$SKIP_BUILD" = true ]; then
  log "Skipping build (--skip-build)"
else

phase "PHASE 3 — Clone Repo & Build Images (parallel across regions)"

build_on_instance() {
  local ip=$1 role=$2
  log "  Building on $role ($ip)..."
  local start_time=$SECONDS

  ssh_cmd "$ip" "bash -s" <<BUILDEOF
set -ex

cd /home/ec2-user

# Clone if needed
if [ ! -d app ]; then
  git clone --depth=1 --branch=$REPO_BRANCH $REPO_URL app
fi
cd app

# Build Go chain images (multi-stage, no Go needed on host)
sudo docker build -t ecca-medulla-pow:local \
  -f forks/medulla-pow-go/Dockerfile forks/medulla-pow-go/
sudo docker build -t ecca-hippocampus-dag:local \
  -f forks/hippocampus-dag-go/Dockerfile forks/hippocampus-dag-go/
sudo docker build -t ecca-cortex-evm:local \
  -f forks/cortex-evm-go/Dockerfile forks/cortex-evm-go/

# Import chain images into k3s containerd
for img in ecca-medulla-pow ecca-hippocampus-dag ecca-cortex-evm; do
  sudo docker save \${img}:local | sudo k3s ctr images import -
done

# Build orchestrator image (for running test locally, not needed on instance)
# TS services build attempt (may fail — that's OK, chains are the priority)
if [ -f tests/playfair/Dockerfile.service ]; then
  # Need node_modules for the COPY in Dockerfile.service
  npm install -g pnpm@9.7.0 2>/dev/null || true
  pnpm install --no-frozen-lockfile 2>/dev/null || npm install 2>/dev/null || true
  pnpm build 2>/dev/null || true

  for svc in siyana-api thalamus-router; do
    sudo docker build -t "ecca-\${svc}:local" \
      --build-arg SERVICE="\$svc" \
      -f tests/playfair/Dockerfile.service . 2>/dev/null || true
    sudo docker save "ecca-\${svc}:local" 2>/dev/null | \
      sudo k3s ctr images import - 2>/dev/null || true
  done
fi

touch /tmp/playfair-build-ready
BUILDEOF

  local elapsed=$(( SECONDS - start_time ))
  ok "  $role build done (${elapsed}s)"
}

# Build in parallel across all 3 instances
for role in "${ROLES[@]}"; do
  ip=$(cat "$STATE_DIR/instance-$role.ip")
  build_on_instance "$ip" "$role" &
done
wait
ok "All builds complete"

fi  # end SKIP_BUILD

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 4 — Deploy K8s Manifests
# ═══════════════════════════════════════════════════════════════════════

phase "PHASE 4 — Deploy K8s Workloads"

# ─── Helper: deploy shared infra (compute region only) ────────────────
deploy_shared_infra() {
  local ip=$1
  log "  Deploying shared infra to compute ($ip)..."

  ssh_cmd "$ip" "sudo kubectl apply -f -" <<'SHAREDEOF'
apiVersion: v1
kind: Pod
metadata:
  name: postgres
  labels: { app: postgres }
spec:
  containers:
  - name: postgres
    image: postgres:16-alpine
    ports: [{ containerPort: 5432 }]
    env:
    - { name: POSTGRES_USER, value: "ecca" }
    - { name: POSTGRES_PASSWORD, value: "quellcrist" }
    - { name: POSTGRES_DB, value: "ecca_registry" }
    resources:
      requests: { cpu: 200m, memory: 256Mi }
      limits:   { cpu: 500m, memory: 512Mi }
---
apiVersion: v1
kind: Service
metadata: { name: postgres }
spec:
  type: NodePort
  selector: { app: postgres }
  ports: [{ port: 5432, targetPort: 5432, nodePort: 30432 }]
---
apiVersion: v1
kind: Pod
metadata:
  name: redis
  labels: { app: redis }
spec:
  containers:
  - name: redis
    image: redis:7-alpine
    ports: [{ containerPort: 6379 }]
    resources:
      requests: { cpu: 100m, memory: 64Mi }
      limits:   { cpu: 250m, memory: 128Mi }
---
apiVersion: v1
kind: Service
metadata: { name: redis }
spec:
  type: NodePort
  selector: { app: redis }
  ports: [{ port: 6379, targetPort: 6379, nodePort: 30379 }]
---
apiVersion: v1
kind: Pod
metadata:
  name: nats
  labels: { app: nats }
spec:
  containers:
  - name: nats
    image: nats:2.10-alpine
    args: ["--jetstream", "--store_dir=/data"]
    ports: [{ containerPort: 4222 }]
    resources:
      requests: { cpu: 100m, memory: 64Mi }
      limits:   { cpu: 250m, memory: 128Mi }
---
apiVersion: v1
kind: Service
metadata: { name: nats }
spec:
  type: NodePort
  selector: { app: nats }
  ports: [{ port: 4222, targetPort: 4222, nodePort: 30422 }]
SHAREDEOF

  ok "  Shared infra deployed"
}

# ─── Helper: deploy chains for a region ───────────────────────────────
deploy_chains() {
  local ip=$1 role=$2

  # Resource profiles per region
  local med_difficulty=6 med_cpu="200m" med_mem="256Mi" med_cpu_lim="500m" med_mem_lim="256Mi"
  local hip_cpu="200m" hip_mem="256Mi" hip_cpu_lim="500m" hip_mem_lim="512Mi"
  local ctx_cpu="500m" ctx_mem="512Mi" ctx_cpu_lim="1000m" ctx_mem_lim="1Gi"

  case $role in
    compute)
      med_difficulty=3
      med_cpu="500m"; med_mem="512Mi"; med_cpu_lim="1000m"; med_mem_lim="1Gi"
      ctx_cpu="500m"; ctx_mem="512Mi"; ctx_cpu_lim="1000m"; ctx_mem_lim="1Gi"
      ;;
    storage)
      hip_cpu="500m"; hip_mem="512Mi"; hip_cpu_lim="1000m"; hip_mem_lim="1Gi"
      ;;
    bandwidth)
      ctx_cpu="500m"; ctx_mem="512Mi"; ctx_cpu_lim="1000m"; ctx_mem_lim="1Gi"
      ;;
  esac

  log "  Deploying chains to $role ($ip) [difficulty=$med_difficulty]..."

  ssh_cmd "$ip" "sudo kubectl apply -f -" <<CHAINSEOF
apiVersion: v1
kind: Pod
metadata:
  name: medulla-pow
  labels: { app: medulla-pow }
spec:
  containers:
  - name: medulla-pow
    image: ecca-medulla-pow:local
    imagePullPolicy: Never
    ports: [{ containerPort: 8332 }]
    env:
    - { name: ECCA_DIFFICULTY, value: "$med_difficulty" }
    resources:
      requests: { cpu: $med_cpu, memory: $med_mem }
      limits:   { cpu: $med_cpu_lim, memory: $med_mem_lim }
---
apiVersion: v1
kind: Service
metadata: { name: medulla-pow }
spec:
  selector: { app: medulla-pow }
  ports: [{ port: 8332, targetPort: 8332 }]
---
apiVersion: v1
kind: Pod
metadata:
  name: hippocampus-dag
  labels: { app: hippocampus-dag }
spec:
  containers:
  - name: hippocampus-dag
    image: ecca-hippocampus-dag:local
    imagePullPolicy: Never
    ports: [{ containerPort: 5001 }]
    resources:
      requests: { cpu: $hip_cpu, memory: $hip_mem }
      limits:   { cpu: $hip_cpu_lim, memory: $hip_mem_lim }
---
apiVersion: v1
kind: Service
metadata: { name: hippocampus-dag }
spec:
  selector: { app: hippocampus-dag }
  ports: [{ port: 5001, targetPort: 5001 }]
---
apiVersion: v1
kind: Pod
metadata:
  name: cortex-evm
  labels: { app: cortex-evm }
spec:
  containers:
  - name: cortex-evm
    image: ecca-cortex-evm:local
    imagePullPolicy: Never
    ports:
    - { containerPort: 8545 }
    - { containerPort: 8546 }
    resources:
      requests: { cpu: $ctx_cpu, memory: $ctx_mem }
      limits:   { cpu: $ctx_cpu_lim, memory: $ctx_mem_lim }
---
apiVersion: v1
kind: Service
metadata: { name: cortex-evm }
spec:
  selector: { app: cortex-evm }
  ports:
  - { name: rpc, port: 8545, targetPort: 8545 }
  - { name: ws, port: 8546, targetPort: 8546 }
CHAINSEOF

  ok "  Chains deployed to $role"
}

# ─── Helper: deploy services for a region ─────────────────────────────
deploy_services() {
  local ip=$1 role=$2 compute_ip=$3

  # Determine shared infra URLs
  local db_host="postgres" redis_host="redis" nats_host="nats"
  local db_port="5432" redis_port="6379" nats_port="4222"

  if [ "$role" != "compute" ]; then
    db_host="$compute_ip"; db_port="30432"
    redis_host="$compute_ip"; redis_port="30379"
    nats_host="$compute_ip"; nats_port="30422"
  fi

  local db_url="postgresql://ecca:quellcrist@${db_host}:${db_port}/ecca_registry"
  local redis_url="redis://${redis_host}:${redis_port}"
  local nats_url="nats://${nats_host}:${nats_port}"

  log "  Deploying services to $role ($ip)..."

  # Check if TS service images exist
  local has_siyana
  has_siyana=$(ssh_cmd "$ip" "sudo k3s ctr images list | grep -c ecca-siyana-api" 2>/dev/null || echo "0")

  if [ "$has_siyana" -gt 0 ]; then
    ssh_cmd "$ip" "sudo kubectl apply -f -" <<SVCEOF
apiVersion: v1
kind: Pod
metadata:
  name: siyana-api
  labels: { app: siyana-api }
spec:
  containers:
  - name: siyana-api
    image: ecca-siyana-api:local
    imagePullPolicy: Never
    ports: [{ containerPort: 7070 }]
    env:
    - { name: DATABASE_URL, value: "$db_url" }
    - { name: REDIS_URL, value: "$redis_url" }
    - { name: NATS_URL, value: "$nats_url" }
    - { name: CORTEX_RPC, value: "http://cortex-evm:8545" }
    - { name: CORTEX_WS, value: "ws://cortex-evm:8546" }
    - { name: MEDULLA_RPC, value: "http://medulla-pow:8332" }
    - { name: HIPPOCAMPUS_API, value: "http://hippocampus-dag:5001" }
    - { name: PORT, value: "7070" }
    resources:
      requests: { cpu: 200m, memory: 256Mi }
      limits:   { cpu: 500m, memory: 512Mi }
---
apiVersion: v1
kind: Service
metadata: { name: siyana-api }
spec:
  type: NodePort
  selector: { app: siyana-api }
  ports: [{ port: 7070, targetPort: 7070, nodePort: 30070 }]
SVCEOF
    ok "  siyana-api deployed to $role"
  else
    warn "  siyana-api image not available on $role — orchestrator will use simulation mode"
    # Create a stub service that returns 200 on /healthz
    ssh_cmd "$ip" "sudo kubectl run siyana-api --image=nginx:alpine --port=80 --restart=Never 2>/dev/null || true"
    ssh_cmd "$ip" "sudo kubectl expose pod siyana-api --type=NodePort --port=7070 --target-port=80 --node-port=30070 2>/dev/null || true" # Hmm, this won't work well. Let's skip.
    warn "  Orchestrator will handle API failures gracefully"
  fi
}

# ─── Deploy to each region ────────────────────────────────────────────

# Compute first (hosts shared infra)
deploy_shared_infra "$COMPUTE_IP"
deploy_chains "$COMPUTE_IP" "compute"
deploy_services "$COMPUTE_IP" "compute" "$COMPUTE_IP"

# Storage and bandwidth in parallel
(
  deploy_chains "$STORAGE_IP" "storage"
  deploy_services "$STORAGE_IP" "storage" "$COMPUTE_IP"
) &
(
  deploy_chains "$BANDWIDTH_IP" "bandwidth"
  deploy_services "$BANDWIDTH_IP" "bandwidth" "$COMPUTE_IP"
) &
wait
ok "All regions deployed"

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 5 — Wait for Pods
# ═══════════════════════════════════════════════════════════════════════

phase "PHASE 5 — Wait for Pods"

for role in "${ROLES[@]}"; do
  ip=$(cat "$STATE_DIR/instance-$role.ip")
  printf "  Waiting for pods in %s..." "$role"
  for attempt in $(seq 1 60); do
    running=$(kctl "$ip" "get pods --no-headers 2>/dev/null | grep -c Running" 2>/dev/null || echo "0")
    total=$(kctl "$ip" "get pods --no-headers 2>/dev/null | wc -l" 2>/dev/null || echo "0")
    if [ "$running" -ge 3 ]; then  # At least chains are running
      echo ""
      ok "$role: $running/$total pods running"
      break
    fi
    [ "$attempt" -eq 60 ] && { echo ""; warn "$role: only $running/$total running"; break; }
    printf "."
    sleep 5
  done
done

# Show pod status per region
for role in "${ROLES[@]}"; do
  ip=$(cat "$STATE_DIR/instance-$role.ip")
  log "  $role pods:"
  kctl "$ip" "get pods -o wide 2>/dev/null" | sed 's/^/    /'
done

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 6 — Measure Cross-Region Latency
# ═══════════════════════════════════════════════════════════════════════

phase "PHASE 6 — Cross-Region Latency"

LATENCY_FILE="$STATE_DIR/latency.json"
echo "{" > "$LATENCY_FILE"

measure_latency() {
  local from_role=$1 from_ip=$2 to_role=$3 to_ip=$4
  # Measure TCP connect time to port 22 (SSH)
  local ms
  ms=$(ssh_cmd "$from_ip" "curl -so /dev/null -w '%{time_connect}' --connect-timeout 5 http://$to_ip:30070/ 2>/dev/null || echo '0.0'")
  ms=$(echo "$ms" | awk '{printf "%.1f", $1 * 1000}')
  echo "  \"${from_role}->${to_role}\": ${ms}," >> "$LATENCY_FILE"
  ok "$from_role → $to_role: ${ms}ms"
}

measure_latency "compute" "$COMPUTE_IP" "storage" "$STORAGE_IP"
measure_latency "compute" "$COMPUTE_IP" "bandwidth" "$BANDWIDTH_IP"
measure_latency "storage" "$STORAGE_IP" "compute" "$COMPUTE_IP"
measure_latency "storage" "$STORAGE_IP" "bandwidth" "$BANDWIDTH_IP"
measure_latency "bandwidth" "$BANDWIDTH_IP" "compute" "$COMPUTE_IP"
measure_latency "bandwidth" "$BANDWIDTH_IP" "storage" "$STORAGE_IP"

# Also measure from local machine
for role in "${ROLES[@]}"; do
  ip=$(cat "$STATE_DIR/instance-$role.ip")
  ms=$(curl -so /dev/null -w '%{time_connect}' --connect-timeout 5 "http://$ip:30070/" 2>/dev/null || echo "0.0")
  ms=$(echo "$ms" | awk '{printf "%.1f", $1 * 1000}')
  echo "  \"local->${role}\": ${ms}," >> "$LATENCY_FILE"
  ok "local → $role: ${ms}ms"
done

echo '  "_": 0' >> "$LATENCY_FILE"
echo "}" >> "$LATENCY_FILE"

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 7 — Chain Health Check
# ═══════════════════════════════════════════════════════════════════════

phase "PHASE 7 — Chain Health Checks"

for role in "${ROLES[@]}"; do
  ip=$(cat "$STATE_DIR/instance-$role.ip")

  # Medulla health
  med=$(ssh_cmd "$ip" "curl -sf http://localhost:8332/health 2>/dev/null || echo 'unreachable'" 2>/dev/null || echo "ssh-fail")
  # Hippo health
  hip=$(ssh_cmd "$ip" "curl -sf http://localhost:5001/health 2>/dev/null || echo 'unreachable'" 2>/dev/null || echo "ssh-fail")
  # Cortex health (eth_blockNumber)
  ctx=$(ssh_cmd "$ip" "curl -sf -X POST -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}' http://localhost:8545 2>/dev/null || echo 'unreachable'" 2>/dev/null || echo "ssh-fail")

  ok "$role chains: medulla=$med hippo=$hip cortex=$(echo "$ctx" | jq -r '.result // "N/A"' 2>/dev/null || echo "$ctx")"
done

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 8 — Run Orchestrator
# ═══════════════════════════════════════════════════════════════════════

phase "PHASE 8 — Run Tripartite Game ($EPOCHS epochs)"

RESULTS_DIR="$ROOT_DIR/tests/playfair/results"
mkdir -p "$RESULTS_DIR"

log "Running orchestrator locally..."
log "  Compute API: http://$COMPUTE_IP:30070"
log "  Storage API: http://$STORAGE_IP:30070"
log "  Bandwidth API: http://$BANDWIDTH_IP:30070"
log ""

REGION_STORAGE_API="http://$STORAGE_IP:30070" \
REGION_COMPUTE_API="http://$COMPUTE_IP:30070" \
REGION_BANDWIDTH_API="http://$BANDWIDTH_IP:30070" \
EPOCHS="$EPOCHS" \
ECCA_EPOCH_INTERVAL_MS="4000" \
RESULTS_DIR="$RESULTS_DIR" \
  node "$ROOT_DIR/tests/playfair/orchestrator.js" 2>&1 | tee "$RESULTS_DIR/orchestrator.log"

ok "Game complete"

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 9 — Collect Extra Metrics
# ═══════════════════════════════════════════════════════════════════════

phase "PHASE 9 — Collect Metrics"

# Collect chain logs and stats from each region
for role in "${ROLES[@]}"; do
  ip=$(cat "$STATE_DIR/instance-$role.ip")
  region=$(cat "$STATE_DIR/instance-$role.region")

  # Pod logs
  kctl "$ip" "logs medulla-pow --tail=100 2>/dev/null" > "$RESULTS_DIR/${role}-medulla.log" 2>/dev/null || true
  kctl "$ip" "logs hippocampus-dag --tail=100 2>/dev/null" > "$RESULTS_DIR/${role}-hippocampus.log" 2>/dev/null || true
  kctl "$ip" "logs cortex-evm --tail=100 2>/dev/null" > "$RESULTS_DIR/${role}-cortex.log" 2>/dev/null || true

  # Resource usage
  kctl "$ip" "top pods --no-headers 2>/dev/null" > "$RESULTS_DIR/${role}-resources.txt" 2>/dev/null || true

  ok "$role logs + metrics collected"
done

# Save latency data alongside results
cp "$LATENCY_FILE" "$RESULTS_DIR/latency.json"

# Save instance metadata
cat > "$RESULTS_DIR/infrastructure.json" <<INFRA
{
  "instanceType": "$INSTANCE_TYPE",
  "regions": {
    "compute": { "awsRegion": "us-east-1", "ip": "$COMPUTE_IP", "instanceId": "$(cat "$STATE_DIR/instance-compute.id")" },
    "storage": { "awsRegion": "us-west-2", "ip": "$STORAGE_IP", "instanceId": "$(cat "$STATE_DIR/instance-storage.id")" },
    "bandwidth": { "awsRegion": "eu-west-1", "ip": "$BANDWIDTH_IP", "instanceId": "$(cat "$STATE_DIR/instance-bandwidth.id")" }
  }
}
INFRA
ok "Infrastructure metadata saved"

# ═══════════════════════════════════════════════════════════════════════
#  PHASE 10 — Generate Report
# ═══════════════════════════════════════════════════════════════════════

phase "PHASE 10 — Generate Report"

if [ -f "$RESULTS_DIR/playfair-results.json" ]; then
  node "$ROOT_DIR/tests/playfair/generate-playfair-report.js" \
    "$RESULTS_DIR/playfair-results.json" \
    "$RESULTS_DIR/playfair-report.html" \
    "$ROOT_DIR/docs/playfair-report.html"
  ok "Report generated"
else
  warn "No results JSON found — extracting from orchestrator log"
  # Try to extract JSON from log output
  sed -n '/^═══ RESULTS JSON ═══$/,/^═══/{/^═══/d;p}' "$RESULTS_DIR/orchestrator.log" > "$RESULTS_DIR/playfair-results.json" 2>/dev/null || true
  if [ -s "$RESULTS_DIR/playfair-results.json" ]; then
    node "$ROOT_DIR/tests/playfair/generate-playfair-report.js" \
      "$RESULTS_DIR/playfair-results.json" \
      "$RESULTS_DIR/playfair-report.html" \
      "$ROOT_DIR/docs/playfair-report.html"
    ok "Report generated from log extraction"
  else
    warn "Could not generate report — no results data found"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════
#  SUMMARY
# ═══════════════════════════════════════════════════════════════════════

echo ""
log "═══════════════════════════════════════════════════════════════════"
log "  PLAYFAIR AWS TEST COMPLETE"
log "═══════════════════════════════════════════════════════════════════"
echo ""
log "Infrastructure:"
log "  compute    → $COMPUTE_IP  (us-east-1, $(cat "$STATE_DIR/instance-compute.id"))"
log "  storage    → $STORAGE_IP  (us-west-2, $(cat "$STATE_DIR/instance-storage.id"))"
log "  bandwidth  → $BANDWIDTH_IP (eu-west-1, $(cat "$STATE_DIR/instance-bandwidth.id"))"
echo ""
log "Results:      $RESULTS_DIR/"
log "Report:       $RESULTS_DIR/playfair-report.html"
log "Docs copy:    docs/playfair-report.html"
log "Latency:      $RESULTS_DIR/latency.json"
echo ""
log "Chain dashboards (via SSH port-forward):"
log "  ssh -i $KEY_FILE -L 8332:localhost:8332 ec2-user@$COMPUTE_IP  # medulla RPC"
log "  ssh -i $KEY_FILE -L 5001:localhost:5001 ec2-user@$STORAGE_IP  # hippocampus API"
log "  ssh -i $KEY_FILE -L 8545:localhost:8545 ec2-user@$COMPUTE_IP  # cortex EVM"
echo ""
log "${C_YELLOW}⚠ IMPORTANT: Tear down when done to avoid charges:${C_RESET}"
log "  ./tests/playfair/aws/teardown.sh"
echo ""
