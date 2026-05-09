#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  PLAYFAIR — Tripartite Game Test (thin wrapper around terraform/)
# ═══════════════════════════════════════════════════════════════════════
#
#  All actual orchestration lives in tests/playfair/terraform/.
#  This wrapper just forwards args as terraform variables.
#
#  Usage:
#    ./tests/playfair/run.sh                        # full apply
#    ./tests/playfair/run.sh --skip-images          # reuse local images
#    ./tests/playfair/run.sh --skip-latency         # skip tc netem
#    ./tests/playfair/run.sh --skip-orchestrator    # deploy infra only
#    ./tests/playfair/run.sh --epochs 200           # custom epoch count
#    ./tests/playfair/run.sh --destroy              # tear down cluster
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="${SCRIPT_DIR}/terraform"
ACTION="apply"
TF_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-images)        TF_ARGS+=(-var "skip_images=true") ;;
    --skip-latency)       TF_ARGS+=(-var "skip_latency=true") ;;
    --skip-orchestrator)  TF_ARGS+=(-var "skip_orchestrator=true") ;;
    --force-rebuild)      TF_ARGS+=(-var "force_image_rebuild=$(date +%s)") ;;
    --epochs)             shift; TF_ARGS+=(-var "epochs=${1}") ;;
    --epochs=*)           TF_ARGS+=(-var "epochs=${1#*=}") ;;
    --destroy)            ACTION="destroy" ;;
    --plan)               ACTION="plan" ;;
    --help|-h)
      sed -n '2,16p' "$0" | sed 's/^#//; s/^ //'
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

cd "$TF_DIR"

if [ ! -d .terraform ]; then
  echo "→ Initializing terraform..."
  terraform init
fi

case "$ACTION" in
  apply)   terraform apply -auto-approve "${TF_ARGS[@]}" ;;
  destroy) terraform destroy -auto-approve "${TF_ARGS[@]}" ;;
  plan)    terraform plan "${TF_ARGS[@]}" ;;
esac
