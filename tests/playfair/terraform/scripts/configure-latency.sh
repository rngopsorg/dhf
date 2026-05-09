#!/usr/bin/env bash
# Configure tc netem rules to simulate cross-region latency.
# Inputs (env): CLUSTER_NAME, LAT_SC_MS, LAT_SC_JITTER_MS, LAT_CB_MS, LAT_CB_JITTER_MS, LAT_SB_MS, LAT_SB_JITTER_MS
set -euo pipefail

: "${CLUSTER_NAME:?CLUSTER_NAME required}"

K3D_NET="k3d-${CLUSTER_NAME}"
NODE_STORAGE="k3d-${CLUSTER_NAME}-agent-0"
NODE_COMPUTE="k3d-${CLUSTER_NAME}-agent-1"
NODE_BANDWIDTH="k3d-${CLUSTER_NAME}-agent-2"

ip_of() {
  docker inspect -f "{{(index .NetworkSettings.Networks \"${K3D_NET}\").IPAddress}}" "$1"
}

IP_S=$(ip_of "$NODE_STORAGE")
IP_C=$(ip_of "$NODE_COMPUTE")
IP_B=$(ip_of "$NODE_BANDWIDTH")

[ -n "$IP_S" ] && [ -n "$IP_C" ] && [ -n "$IP_B" ] || {
  echo "ERROR: could not resolve all node IPs (S=$IP_S C=$IP_C B=$IP_B)" >&2
  exit 1
}

echo "Node IPs: storage=$IP_S compute=$IP_C bandwidth=$IP_B"

# Apply two-band priority qdisc with one netem class per peer.
configure() {
  local node="$1" ip1="$2" delay1="$3" jitter1="$4" ip2="$5" delay2="$6" jitter2="$7"
  docker exec "$node" sh -c "
    tc qdisc del dev eth0 root 2>/dev/null || true
    tc qdisc add dev eth0 root handle 1: prio bands 3
    tc qdisc add dev eth0 parent 1:2 handle 20: netem delay ${delay1}ms ${jitter1}ms
    tc qdisc add dev eth0 parent 1:3 handle 30: netem delay ${delay2}ms ${jitter2}ms
    tc filter add dev eth0 parent 1:0 protocol ip prio 1 u32 match ip dst ${ip1}/32 flowid 1:2
    tc filter add dev eth0 parent 1:0 protocol ip prio 2 u32 match ip dst ${ip2}/32 flowid 1:3
  "
}

configure "$NODE_STORAGE"   "$IP_C" "$LAT_SC_MS" "$LAT_SC_JITTER_MS" "$IP_B" "$LAT_SB_MS" "$LAT_SB_JITTER_MS"
configure "$NODE_COMPUTE"   "$IP_S" "$LAT_SC_MS" "$LAT_SC_JITTER_MS" "$IP_B" "$LAT_CB_MS" "$LAT_CB_JITTER_MS"
configure "$NODE_BANDWIDTH" "$IP_S" "$LAT_SB_MS" "$LAT_SB_JITTER_MS" "$IP_C" "$LAT_CB_MS" "$LAT_CB_JITTER_MS"

# Quick verification
echo "Verifying latency (3-packet ping):"
for pair in "S→C $NODE_STORAGE $IP_C ${LAT_SC_MS}" \
            "S→B $NODE_STORAGE $IP_B ${LAT_SB_MS}" \
            "C→B $NODE_COMPUTE $IP_B ${LAT_CB_MS}"; do
  set -- $pair
  label=$1; from=$2; to=$3; target=$4
  avg=$(docker exec "$from" ping -c 3 -q "$to" 2>&1 | awk -F'/' '/avg/{print $5}' || echo "?")
  echo "  $label: ${avg}ms (target ${target}ms)"
done

echo "✓ Network latency simulation active"
