#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  PLAYFAIR AWS — Teardown
# ═══════════════════════════════════════════════════════════════════════
#
#  Terminates all EC2 instances, deletes security groups and key pairs
#  created by run-aws.sh. Safe to run multiple times.
#
#  Usage:
#    ./tests/playfair/aws/teardown.sh          # interactive (asks confirmation)
#    ./tests/playfair/aws/teardown.sh --force   # no confirmation
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

STATE_DIR="${STATE_DIR:-$HOME/.playfair-aws}"
TAG="playfair"
FORCE=false
[ "${1:-}" = "--force" ] && FORCE=true

C_CYAN='\033[0;36m' C_GREEN='\033[0;32m' C_RED='\033[0;31m'
C_YELLOW='\033[0;33m' C_RESET='\033[0m'
log()  { echo -e "${C_CYAN}[teardown]${C_RESET} $*"; }
ok()   { echo -e "${C_GREEN}  ✓${C_RESET} $*"; }
warn() { echo -e "${C_YELLOW}  ⚠${C_RESET} $*"; }

if [ ! -d "$STATE_DIR" ]; then
  log "No state directory found at $STATE_DIR — nothing to tear down"
  exit 0
fi

# Show what will be destroyed
log "Resources to destroy:"
ROLES=(compute storage bandwidth)
for role in "${ROLES[@]}"; do
  if [ -f "$STATE_DIR/instance-$role.id" ]; then
    id=$(cat "$STATE_DIR/instance-$role.id")
    region=$(cat "$STATE_DIR/instance-$role.region" 2>/dev/null || echo "unknown")
    ip=$(cat "$STATE_DIR/instance-$role.ip" 2>/dev/null || echo "unknown")
    echo "  Instance: $id ($role, $region, $ip)"
  fi
  if [ -f "$STATE_DIR/sg-$role.id" ]; then
    echo "  SG:       $(cat "$STATE_DIR/sg-$role.id") ($role)"
  fi
done

if [ "$FORCE" != true ]; then
  echo ""
  read -rp "Destroy all resources? (y/N) " confirm
  [ "$confirm" = "y" ] || [ "$confirm" = "Y" ] || { log "Aborted"; exit 0; }
fi

echo ""

# ─── Terminate instances ──────────────────────────────────────────────
for role in "${ROLES[@]}"; do
  if [ -f "$STATE_DIR/instance-$role.id" ]; then
    id=$(cat "$STATE_DIR/instance-$role.id")
    region=$(cat "$STATE_DIR/instance-$role.region" 2>/dev/null || echo "us-east-1")

    log "Terminating $role instance $id in $region..."
    aws ec2 terminate-instances --region "$region" --instance-ids "$id" >/dev/null 2>&1 || warn "Failed to terminate $id"
    ok "$role instance terminated"
  fi
done

# Wait for instances to terminate before deleting SGs
log "Waiting for instances to terminate..."
for role in "${ROLES[@]}"; do
  if [ -f "$STATE_DIR/instance-$role.id" ]; then
    id=$(cat "$STATE_DIR/instance-$role.id")
    region=$(cat "$STATE_DIR/instance-$role.region" 2>/dev/null || echo "us-east-1")
    aws ec2 wait instance-terminated --region "$region" --instance-ids "$id" 2>/dev/null || true
  fi
done
ok "All instances terminated"

# ─── Delete security groups ───────────────────────────────────────────
for role in "${ROLES[@]}"; do
  if [ -f "$STATE_DIR/sg-$role.id" ]; then
    sg_id=$(cat "$STATE_DIR/sg-$role.id")
    region=$(cat "$STATE_DIR/sg-$role.region" 2>/dev/null || echo "us-east-1")

    log "Deleting SG $sg_id in $region..."
    aws ec2 delete-security-group --region "$region" --group-id "$sg_id" 2>/dev/null || warn "SG $sg_id may already be deleted"
    ok "SG deleted"
  fi
done

# ─── Delete key pairs ────────────────────────────────────────────────
REGIONS=(us-east-1 us-west-2 eu-west-1)
for region in "${REGIONS[@]}"; do
  aws ec2 delete-key-pair --region "$region" --key-name "$TAG" 2>/dev/null || true
done
ok "Key pairs deleted"

# ─── Clean up state ──────────────────────────────────────────────────
log "Cleaning up state directory..."
rm -f "$STATE_DIR"/instance-*.{id,ip,region}
rm -f "$STATE_DIR"/sg-*.{id,region}
rm -f "$STATE_DIR/playfair.pem" "$STATE_DIR/playfair.pem.pub"
rm -f "$STATE_DIR/latency.json"
rmdir "$STATE_DIR" 2>/dev/null || true
ok "State cleaned"

echo ""
log "═══════════════════════════════════════════════════════════════"
log "  TEARDOWN COMPLETE — all Playfair AWS resources destroyed"
log "═══════════════════════════════════════════════════════════════"
