#!/bin/bash
# =============================================================================
# ECCA Stack v3 — End-to-End Integration Test Suite
# Run against a live Docker Compose deployment.
# Exit 1 on any test failure.
# =============================================================================
set -euo pipefail

BASE=http://localhost:7070
PASS=0
FAIL=0
ERRORS=""

# ─── Helpers ─────────────────────────────────────────────────────────────────

pass() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL + 1)); ERRORS="${ERRORS}\n  ✗ $1: $2"; echo "  ✗ $1: $2"; }

assert_status() {
  local desc="$1" url="$2" method="${3:-GET}" body="${4:-}" expected="${5:-200}"
  local status
  if [ -n "$body" ]; then
    status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url" -H "Content-Type: application/json" -d "$body")
  else
    status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url")
  fi
  if [ "$status" = "$expected" ]; then
    pass "$desc (HTTP $status)"
  else
    fail "$desc" "expected $expected, got $status"
  fi
}

assert_json_field() {
  local desc="$1" json="$2" field="$3" expected="$4"
  local actual
  actual=$(echo "$json" | jq -r "$field")
  if [ "$actual" = "$expected" ]; then
    pass "$desc"
  else
    fail "$desc" "expected '$expected', got '$actual'"
  fi
}

assert_json_not_null() {
  local desc="$1" json="$2" field="$3"
  local actual
  actual=$(echo "$json" | jq -r "$field")
  if [ "$actual" != "null" ] && [ -n "$actual" ]; then
    pass "$desc"
  else
    fail "$desc" "field $field is null/empty"
  fi
}

assert_json_gt() {
  local desc="$1" json="$2" field="$3" threshold="$4"
  local actual
  actual=$(echo "$json" | jq -r "$field")
  if [ "$(echo "$actual > $threshold" | bc -l 2>/dev/null || echo 0)" = "1" ]; then
    pass "$desc ($actual > $threshold)"
  else
    fail "$desc" "$field=$actual not > $threshold"
  fi
}

# =============================================================================
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          ECCA Stack v3 — E2E Integration Tests              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ─── Phase 1: Health Checks ──────────────────────────────────────────────────
echo "┌─ Phase 1: Health Checks"

HEALTH=$(curl -sf $BASE/healthz)
assert_json_field "siyana-api healthz" "$HEALTH" ".ok" "true"
assert_json_field "siyana-api name" "$HEALTH" ".name" "siyana-api"

assert_status "medulla-pow health" "http://localhost:8332/health"
assert_status "hippocampus-dag health" "http://localhost:15001/health"
echo ""

# ─── Phase 2: Stack Identity ─────────────────────────────────────────────────
echo "┌─ Phase 2: Stack Identity"

STACK=$(curl -s -X POST $BASE/v1/stacks -H "Content-Type: application/json" -d '{"name":"ci-test-agent"}')
STACK_ID=$(echo $STACK | jq -r .id)
assert_json_not_null "stack created" "$STACK" ".id"
assert_json_field "stack kind" "$STACK" ".kind" "human"
assert_json_not_null "stack pubKey" "$STACK" ".pubKey"
assert_json_not_null "stack identityPriv" "$STACK" ".identityPriv"

# Retrieve
STACK_GET=$(curl -s $BASE/v1/stacks/$STACK_ID)
assert_json_field "stack GET matches" "$STACK_GET" ".id" "$STACK_ID"
echo ""

# ─── Phase 3: Sleeve Spawning ────────────────────────────────────────────────
echo "┌─ Phase 3: Sleeve Spawning"

SLEEVE_H=$(curl -s -X POST $BASE/v1/sleeves -H "Content-Type: application/json" -d "{\"stackId\":\"$STACK_ID\",\"embodimentType\":\"human\"}")
SLEEVE_H_ID=$(echo $SLEEVE_H | jq -r .id)
assert_json_not_null "human sleeve created" "$SLEEVE_H" ".id"
assert_json_field "human sleeve type" "$SLEEVE_H" ".embodimentType" "human"
assert_json_field "human sleeve alive" "$SLEEVE_H" ".alive" "true"

SLEEVE_A=$(curl -s -X POST $BASE/v1/sleeves -H "Content-Type: application/json" -d "{\"stackId\":\"$STACK_ID\",\"embodimentType\":\"ai\"}")
SLEEVE_A_ID=$(echo $SLEEVE_A | jq -r .id)
assert_json_not_null "ai sleeve created" "$SLEEVE_A" ".id"
assert_json_field "ai sleeve type" "$SLEEVE_A" ".embodimentType" "ai"

# List sleeves
SLEEVES_LIST=$(curl -s $BASE/v1/sleeves)
SLEEVE_COUNT=$(echo $SLEEVES_LIST | jq 'length')
if [ "$SLEEVE_COUNT" -ge 2 ]; then
  pass "sleeves list count >= 2 ($SLEEVE_COUNT)"
else
  fail "sleeves list count" "expected >= 2, got $SLEEVE_COUNT"
fi
echo ""

# ─── Phase 4: Token Balances ─────────────────────────────────────────────────
echo "┌─ Phase 4: Token Balances"

BALANCES=$(curl -s $BASE/v1/tokens/balances/$STACK_ID)
assert_json_field "balances stackId" "$BALANCES" ".stackId" "$STACK_ID"
assert_json_field "compute tokens" "$BALANCES" ".sleeveTotals.compute" "500"
assert_json_field "memory tokens" "$BALANCES" ".sleeveTotals.memory" "500"
assert_json_field "sync tokens" "$BALANCES" ".sleeveTotals.sync" "500"
assert_json_field "routing tokens" "$BALANCES" ".sleeveTotals.routing" "500"
echo ""

# ─── Phase 5: Perceive (Memory Storage) ──────────────────────────────────────
echo "┌─ Phase 5: Perceive (Memory Storage)"

P1=$(curl -s -X POST $BASE/v1/sleeves/$SLEEVE_H_ID/perceive -H "Content-Type: application/json" -d '{"input":"The quick brown fox jumped over the lazy dog"}')
CID1=$(echo $P1 | jq -r .cid)
assert_json_not_null "perceive 1 returns cid" "$P1" ".cid"
assert_json_not_null "perceive 1 returns thought" "$P1" ".thought"

P2=$(curl -s -X POST $BASE/v1/sleeves/$SLEEVE_A_ID/perceive -H "Content-Type: application/json" -d '{"input":"Artificial intelligence is transforming every industry"}')
CID2=$(echo $P2 | jq -r .cid)
assert_json_not_null "perceive 2 returns cid" "$P2" ".cid"

P3=$(curl -s -X POST $BASE/v1/sleeves/$SLEEVE_H_ID/perceive -H "Content-Type: application/json" -d '{"input":"Memory is the treasury of the mind"}')
CID3=$(echo $P3 | jq -r .cid)
assert_json_not_null "perceive 3 returns cid" "$P3" ".cid"

# Verify CIDs are unique
if [ "$CID1" != "$CID2" ] && [ "$CID2" != "$CID3" ] && [ "$CID1" != "$CID3" ]; then
  pass "all CIDs are unique"
else
  fail "CID uniqueness" "CIDs: $CID1, $CID2, $CID3"
fi

# Verify CID format (ecca:// prefix)
if echo "$CID1" | grep -q "^ecca://"; then
  pass "CID has ecca:// prefix"
else
  fail "CID format" "expected ecca:// prefix, got $CID1"
fi
echo ""

# ─── Phase 5b: Stack Remember (Direct Memory) ────────────────────────────────
echo "┌─ Phase 5b: Stack Remember"

REMEMBER=$(curl -s -X POST $BASE/v1/stacks/$STACK_ID/remember -H "Content-Type: application/json" -d '{"text":"Pinned memory via remember endpoint","pin":true}')
assert_json_not_null "remember returns cid" "$REMEMBER" ".cid"
echo ""

# ─── Phase 6: Recall (Memory Retrieval) ──────────────────────────────────────
echo "┌─ Phase 6: Recall"

RECALL=$(curl -s "$BASE/v1/stacks/$STACK_ID/recall")
FRAG_COUNT=$(echo $RECALL | jq '.fragments | length')
FIDELITY=$(echo $RECALL | jq -r '.fidelity')

if [ "$FRAG_COUNT" -ge 1 ]; then
  pass "recall returns fragments ($FRAG_COUNT)"
else
  fail "recall fragments" "expected >= 1, got $FRAG_COUNT"
fi

if [ "$FIDELITY" = "1" ]; then
  pass "recall fidelity = 1 (perfect)"
else
  fail "recall fidelity" "expected 1, got $FIDELITY"
fi

BROKEN_COUNT=$(echo $RECALL | jq '.broken | length')
if [ "$BROKEN_COUNT" = "0" ]; then
  pass "no broken links"
else
  fail "broken links" "$BROKEN_COUNT broken"
fi
echo ""

# ─── Phase 7: Sleeve Sync ────────────────────────────────────────────────────
echo "┌─ Phase 7: Sleeve Sync"

SYNC=$(curl -s -X POST $BASE/v1/sleeves/$SLEEVE_H_ID/sync)
assert_json_field "sync ok" "$SYNC" ".ok" "true"
echo ""

# ─── Phase 8: Epoch & Mining ─────────────────────────────────────────────────
echo "┌─ Phase 8: Epoch & Mining"

EPOCH=$(curl -s $BASE/v1/epochs/current)
assert_json_not_null "epoch number" "$EPOCH" ".epoch"
assert_json_not_null "chain height" "$EPOCH" ".height"
assert_json_not_null "chain tip" "$EPOCH" ".tip"

MINE=$(curl -s -X POST $BASE/v1/mining/block)
assert_json_not_null "mined block hash" "$MINE" ".blockHash"
assert_json_not_null "mined synapticFieldRoot" "$MINE" ".synapticFieldRoot"

EPOCH_AFTER=$(curl -s $BASE/v1/epochs/current)
HEIGHT_BEFORE=$(echo $EPOCH | jq -r .height)
HEIGHT_AFTER=$(echo $EPOCH_AFTER | jq -r .height)
if [ "$HEIGHT_AFTER" -gt "$HEIGHT_BEFORE" ]; then
  pass "height increased after mining ($HEIGHT_BEFORE → $HEIGHT_AFTER)"
else
  fail "height after mining" "before=$HEIGHT_BEFORE, after=$HEIGHT_AFTER"
fi
echo ""

# ─── Phase 9: Needlecast ─────────────────────────────────────────────────────
echo "┌─ Phase 9: Needlecast"

NC=$(curl -s -X POST $BASE/v1/needlecast -H "Content-Type: application/json" -d "{\"from\":\"$SLEEVE_H_ID\",\"to\":\"$SLEEVE_A_ID\"}")
assert_json_field "needlecast ok" "$NC" ".ok" "true"
assert_json_not_null "needlecast sagaId" "$NC" ".sagaId"
assert_json_not_null "needlecast route" "$NC" ".route"

SHARDS=$(echo $NC | jq -r .shards)
if [ "$SHARDS" -ge 1 ]; then
  pass "needlecast shards transferred ($SHARDS)"
else
  fail "needlecast shards" "expected >= 1, got $SHARDS"
fi
echo ""

# ─── Phase 10: Coordination State ────────────────────────────────────────────
echo "┌─ Phase 10: Coordination State"

DESYNC=$(curl -s $BASE/v1/coordination/desync)
assert_status "desync endpoint" "$BASE/v1/coordination/desync"

RESIDUES=$(curl -s $BASE/v1/coordination/residues)
assert_status "residues endpoint" "$BASE/v1/coordination/residues"
echo ""

# ─── Phase 11: Final Stack State ─────────────────────────────────────────────
echo "┌─ Phase 11: Final Stack State"

FINAL=$(curl -s "$BASE/v1/stacks/$STACK_ID")
assert_json_not_null "episodicHead set" "$FINAL" ".episodicHead"
assert_json_field "stack has sleeves" "$(echo $FINAL | jq '{c: (.sleeves | length)}')" ".c" "2"

# Verify token consumption happened
COMPUTE_TOTAL=$(echo $FINAL | jq '[.sleeves[].tokens.compute] | add')
if [ "$(echo "$COMPUTE_TOTAL < 500" | bc -l)" = "1" ]; then
  pass "compute tokens consumed ($COMPUTE_TOTAL < 500)"
else
  fail "compute token consumption" "total=$COMPUTE_TOTAL, expected < 500"
fi

ROUTING_TOTAL=$(echo $FINAL | jq '[.sleeves[].tokens.routing] | add')
if [ "$(echo "$ROUTING_TOTAL < 500" | bc -l)" = "1" ]; then
  pass "routing tokens consumed by needlecast ($ROUTING_TOTAL < 500)"
else
  fail "routing token consumption" "total=$ROUTING_TOTAL, expected < 500"
fi
echo ""

# ─── Phase 12: Cleanup ───────────────────────────────────────────────────────
echo "┌─ Phase 12: Cleanup (Decommission)"

DEL1=$(curl -s -X DELETE $BASE/v1/sleeves/$SLEEVE_H_ID)
assert_json_field "decommission human sleeve" "$DEL1" ".ok" "true"

DEL2=$(curl -s -X DELETE $BASE/v1/sleeves/$SLEEVE_A_ID)
assert_json_field "decommission ai sleeve" "$DEL2" ".ok" "true"

# Verify sleeve list no longer shows them as alive
SLEEVES_AFTER=$(curl -s $BASE/v1/sleeves)
ALIVE_COUNT=$(echo $SLEEVES_AFTER | jq "[.[] | select(.stackId == \"$STACK_ID\")] | length")
if [ "$ALIVE_COUNT" = "0" ]; then
  pass "no alive sleeves for stack after cleanup"
else
  fail "cleanup" "$ALIVE_COUNT sleeves still alive"
fi
echo ""

# ─── Phase 13: Blockchain Verification ───────────────────────────────────────
echo "┌─ Phase 13: Blockchain Verification"

# Verify cortex-evm is producing blocks
EVM_BLOCK=$(curl -s -X POST http://localhost:8545 -H "content-type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}')
EVM_HEIGHT=$(echo $EVM_BLOCK | jq -r .result)
if [ "$EVM_HEIGHT" != "null" ] && [ -n "$EVM_HEIGHT" ]; then
  pass "cortex-evm block height: $EVM_HEIGHT"
else
  fail "cortex-evm block height" "could not get block number"
fi

# Verify medulla-pow chain info (JSON-RPC at /rpc)
MEDULLA_INFO=$(curl -s -X POST http://localhost:8332/rpc -H "content-type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getinfo","params":{}}')
if echo "$MEDULLA_INFO" | jq -e '.result.height' > /dev/null 2>&1; then
  MEDULLA_H=$(echo $MEDULLA_INFO | jq -r '.result.height')
  pass "medulla-pow height: $MEDULLA_H"
else
  fail "medulla-pow info" "no height in response"
fi

# Verify hippocampus-dag has stored nodes
HIPPO_STAT=$(curl -s http://localhost:15001/stat)
HIPPO_NODES=$(echo $HIPPO_STAT | jq -r .nodes)
if [ "$HIPPO_NODES" -ge 4 ]; then
  pass "hippocampus-dag stored $HIPPO_NODES nodes"
else
  fail "hippocampus-dag nodes" "expected >= 4, got $HIPPO_NODES"
fi
echo ""

# =============================================================================
# Results
# =============================================================================
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                     TEST RESULTS                            ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf "║  Passed: %-3d                                               ║\n" $PASS
printf "║  Failed: %-3d                                               ║\n" $FAIL
echo "╚══════════════════════════════════════════════════════════════╝"

if [ $FAIL -gt 0 ]; then
  echo ""
  echo "Failures:"
  echo -e "$ERRORS"
  echo ""
  exit 1
fi

echo ""
echo "All tests passed!"
exit 0
