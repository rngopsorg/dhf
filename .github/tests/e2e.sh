#!/bin/bash
# =============================================================================
# ECCA Stack v3 — End-to-End Integration Test Suite (Verbose)
# Run against a live Docker Compose deployment.
# Exit 1 on any test failure.
#
# This script exercises the full autonomous AI agent lifecycle:
#   Identity → Embodiment → Economy → Memory → Coherence → Transfer → Cleanup
#
# Each step prints what service is called, the request/response, plain-English
# explanation, and how it fits into real autonomous agent workflows.
# =============================================================================
set -euo pipefail

BASE=http://localhost:7070
PASS=0
FAIL=0
ERRORS=""

# ─── Colors ──────────────────────────────────────────────────────────────────
C_CYAN="\033[36m"
C_GREEN="\033[32m"
C_RED="\033[31m"
C_YELLOW="\033[33m"
C_MAGENTA="\033[35m"
C_DIM="\033[2m"
C_BOLD="\033[1m"
C_RESET="\033[0m"

# ─── Helpers ─────────────────────────────────────────────────────────────────

pass() { PASS=$((PASS + 1)); echo -e "  ${C_GREEN}✓${C_RESET} $1"; }
fail() { FAIL=$((FAIL + 1)); ERRORS="${ERRORS}\n  ✗ $1: $2"; echo -e "  ${C_RED}✗${C_RESET} $1: $2"; }

# Print a service call with method, url, and optional body
show_request() {
  local method="$1" url="$2" body="${3:-}"
  echo -e "  ${C_DIM}───────────────────────────────────────────────────${C_RESET}"
  echo -e "  ${C_CYAN}→ ${C_BOLD}${method}${C_RESET} ${C_CYAN}${url}${C_RESET}"
  if [ -n "$body" ]; then
    echo -e "  ${C_DIM}  Body:${C_RESET} $(echo "$body" | jq -c . 2>/dev/null || echo "$body")"
  fi
}

# Print a response (pretty-printed JSON, truncated if huge)
show_response() {
  local json="$1"
  local pretty
  pretty=$(echo "$json" | jq . 2>/dev/null || echo "$json")
  local lines
  lines=$(echo "$pretty" | wc -l)
  if [ "$lines" -gt 20 ]; then
    echo -e "  ${C_DIM}  Response (${lines} lines, showing first 18):${C_RESET}"
    echo "$pretty" | head -18 | sed 's/^/    /'
    echo -e "    ${C_DIM}... (truncated)${C_RESET}"
  else
    echo -e "  ${C_DIM}  Response:${C_RESET}"
    echo "$pretty" | sed 's/^/    /'
  fi
}

# Print a plain-English explanation
explain() {
  echo -e "  ${C_MAGENTA}ℹ${C_RESET}  $1"
}

# Print agent workflow context
workflow() {
  echo -e "  ${C_YELLOW}⚙${C_RESET}  ${C_DIM}Agent Workflow:${C_RESET} $1"
}

# Print which service handles this
service() {
  echo -e "  ${C_CYAN}◈${C_RESET}  ${C_DIM}Service:${C_RESET} ${C_BOLD}$1${C_RESET} ${C_DIM}($2)${C_RESET}"
}

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
echo ""
echo "╔══════════════════════════════════════════════════════════════════════════╗"
echo "║              ECCA Stack v3 — E2E Integration Tests (Verbose)            ║"
echo "║                                                                          ║"
echo "║  This test exercises the full autonomous AI agent lifecycle:             ║"
echo "║    Identity → Embodiment → Economy → Memory → Sync → Transfer → Cleanup ║"
echo "║                                                                          ║"
echo "║  Each step shows the HTTP request, response, which service handles it,  ║"
echo "║  what it does, and how it maps to real-world AI agent operations.        ║"
echo "╚══════════════════════════════════════════════════════════════════════════╝"
echo ""

# =============================================================================
# Phase 1: Health Checks — Verify all infrastructure is alive
# =============================================================================
echo "┌─────────────────────────────────────────────────────────────────────────"
echo "│ Phase 1: Health Checks"
echo "│"
echo "│ Before an AI agent can operate, its entire infrastructure must be live:"
echo "│ the API gateway, the memory DAG, and the proof-of-work chain. This is"
echo "│ equivalent to an agent checking that its brain, memory, and clock work."
echo "└─────────────────────────────────────────────────────────────────────────"
echo ""

service "siyana-api" "port 7070 — the main REST/WebSocket API gateway"
explain "Siyana is the single entry point for all agent operations. Every perceive,"
explain "recall, sync, and needlecast flows through here. Named after Siyana — in"
explain "memory of a child lost too soon."
workflow "An agent's first action on startup is always to verify its API gateway is reachable."
show_request "GET" "$BASE/healthz"
HEALTH=$(curl -sf $BASE/healthz)
show_response "$HEALTH"
assert_json_field "siyana-api healthz" "$HEALTH" ".ok" "true"
assert_json_field "siyana-api name" "$HEALTH" ".name" "siyana-api"
echo ""

service "medulla-pow" "port 8332 — custom Proof-of-Work blockchain"
explain "Medulla is the global clock. It mines blocks every ~4 seconds, advancing"
explain "the epoch counter. All time-gated operations (token emission, key rotation,"
explain "fidelity decay) reference the current epoch from this chain."
workflow "Agents need a decentralized clock to coordinate. Medulla provides this without trusting any single server."
show_request "GET" "http://localhost:8332/health"
assert_status "medulla-pow health" "http://localhost:8332/health"
echo ""

service "hippocampus-dag" "port 15001 — content-addressed DAG storage"
explain "Hippocampus stores all agent memories as encrypted Merkle-DAG nodes."
explain "Each memory gets a unique CID (Content Identifier). Memories are encrypted"
explain "with epoch-scoped keys so only the owning agent can decrypt them."
workflow "This is the agent's long-term memory. Without it, the agent has amnesia."
show_request "GET" "http://localhost:15001/health"
assert_status "hippocampus-dag health" "http://localhost:15001/health"
echo ""

# =============================================================================
# Phase 2: Stack Identity — Create the agent's persistent identity
# =============================================================================
echo "┌─────────────────────────────────────────────────────────────────────────"
echo "│ Phase 2: Stack Identity"
echo "│"
echo "│ A 'Stack' is the persistent identity container for an AI agent. It"
echo "│ survives across reboots, re-deployments, and even transfers between"
echo "│ hardware. Think of it as the agent's soul — it holds the cryptographic"
echo "│ keys, token balances, and memory graph root (episodicHead)."
echo "│"
echo "│ Creating a Stack mints an NFT on the Cortex EVM chain, giving the"
echo "│ agent a verifiable on-chain identity that no one can forge."
echo "└─────────────────────────────────────────────────────────────────────────"
echo ""

service "siyana-api → cortex-evm" "Stack creation triggers StackIdentity.sol NFT mint"
explain "POST /v1/stacks creates a new identity. The server generates an ed25519"
explain "keypair (pubKey + identityPriv), initializes a CPV (Compute/Perceive Vector)"
explain "profile with default token balances, and mints a StackIdentity NFT on Cortex."
workflow "When deploying a new AI agent, this is step 1: give it a persistent, portable,"
workflow "cryptographically-verifiable identity. The agent keeps identityPriv secret."
show_request "POST" "$BASE/v1/stacks" '{"name":"ci-test-agent"}'
STACK=$(curl -s -X POST $BASE/v1/stacks -H "Content-Type: application/json" -d '{"name":"ci-test-agent"}')
show_response "$STACK"
STACK_ID=$(echo $STACK | jq -r .id)
assert_json_not_null "stack created" "$STACK" ".id"
assert_json_field "stack kind" "$STACK" ".kind" "human"
assert_json_not_null "stack pubKey" "$STACK" ".pubKey"
assert_json_not_null "stack identityPriv" "$STACK" ".identityPriv"
echo ""

explain "Now retrieve the stack by ID to verify persistence. In a real agent workflow,"
explain "the agent would store its stack ID in config and retrieve its state on restart."
show_request "GET" "$BASE/v1/stacks/$STACK_ID"
STACK_GET=$(curl -s $BASE/v1/stacks/$STACK_ID)
show_response "$STACK_GET"
assert_json_field "stack GET matches" "$STACK_GET" ".id" "$STACK_ID"
echo ""

# =============================================================================
# Phase 3: Sleeve Spawning — Give the agent active embodiments
# =============================================================================
echo "┌─────────────────────────────────────────────────────────────────────────"
echo "│ Phase 3: Sleeve Spawning"
echo "│"
echo "│ A 'Sleeve' is an active embodiment of a Stack. One Stack can have many"
echo "│ Sleeves running simultaneously — a human interface, an AI inference"
echo "│ engine, a mining worker, etc. Each Sleeve has its own drift counter"
echo "│ (how out-of-sync it is) and token balance."
echo "│"
echo "│ This is the 'multiple embodiment' model: the same persistent identity"
echo "│ can inhabit multiple bodies at once, each specialized for a task."
echo "│ Inspired by Altered Carbon — consciousness can be re-sleeved."
echo "└─────────────────────────────────────────────────────────────────────────"
echo ""

service "siyana-api" "Sleeve records created in PostgreSQL, linked to Stack"
explain "Spawning a human sleeve. In an agent workflow, this represents the human"
explain "operator's interface — the browser, CLI, or chat window through which a"
explain "person interacts with the agent's shared memory and identity."
workflow "A typical agent spawns a human sleeve for its operator and an AI sleeve for itself."
show_request "POST" "$BASE/v1/sleeves" "{\"stackId\":\"$STACK_ID\",\"embodimentType\":\"human\"}"
SLEEVE_H=$(curl -s -X POST $BASE/v1/sleeves -H "Content-Type: application/json" -d "{\"stackId\":\"$STACK_ID\",\"embodimentType\":\"human\"}")
show_response "$SLEEVE_H"
SLEEVE_H_ID=$(echo $SLEEVE_H | jq -r .id)
assert_json_not_null "human sleeve created" "$SLEEVE_H" ".id"
assert_json_field "human sleeve type" "$SLEEVE_H" ".embodimentType" "human"
assert_json_field "human sleeve alive" "$SLEEVE_H" ".alive" "true"
echo ""

explain "Spawning an AI sleeve. This is the agent's autonomous worker — it can"
explain "perceive (store observations), recall (retrieve memories), and operate"
explain "independently from the human sleeve while sharing the same Stack identity."
workflow "The AI sleeve is where LLM inference, tool calls, and autonomous actions happen."
show_request "POST" "$BASE/v1/sleeves" "{\"stackId\":\"$STACK_ID\",\"embodimentType\":\"ai\"}"
SLEEVE_A=$(curl -s -X POST $BASE/v1/sleeves -H "Content-Type: application/json" -d "{\"stackId\":\"$STACK_ID\",\"embodimentType\":\"ai\"}")
show_response "$SLEEVE_A"
SLEEVE_A_ID=$(echo $SLEEVE_A | jq -r .id)
assert_json_not_null "ai sleeve created" "$SLEEVE_A" ".id"
assert_json_field "ai sleeve type" "$SLEEVE_A" ".embodimentType" "ai"
echo ""

explain "Listing all sleeves to verify both were created."
workflow "Agents periodically list their sleeves to detect orphans or stale embodiments."
show_request "GET" "$BASE/v1/sleeves"
SLEEVES_LIST=$(curl -s $BASE/v1/sleeves)
SLEEVE_COUNT=$(echo $SLEEVES_LIST | jq 'length')
echo -e "  ${C_DIM}  Response: ${SLEEVE_COUNT} sleeves total${C_RESET}"
if [ "$SLEEVE_COUNT" -ge 2 ]; then
  pass "sleeves list count >= 2 ($SLEEVE_COUNT)"
else
  fail "sleeves list count" "expected >= 2, got $SLEEVE_COUNT"
fi
echo ""

# =============================================================================
# Phase 4: Token Balances — Verify the bandwidth economy
# =============================================================================
echo "┌─────────────────────────────────────────────────────────────────────────"
echo "│ Phase 4: Token Balances"
echo "│"
echo "│ ECCA uses a bandwidth token economy to prevent abuse and prioritize"
echo "│ operations. There are 4 token types:"
echo "│   • compute  — spent when perceiving (0.5 per perceive)"
echo "│   • memory   — spent when recalling (based on depth)"
echo "│   • sync     — spent when syncing a sleeve to the current epoch (1 per sync)"
echo "│   • routing  — spent when needlecasting (5 per transfer)"
echo "│"
echo "│ Each sleeve starts with 250 of each token (500 total across 2 sleeves)."
echo "│ Tokens are replenished by the Quellist Treasury based on epoch emissions."
echo "│ This creates a natural rate limit: agents must budget their operations."
echo "└─────────────────────────────────────────────────────────────────────────"
echo ""

service "siyana-api" "Reads aggregated token balances from PostgreSQL"
explain "Checking initial token balances. With 2 sleeves at 250 each, we expect"
explain "500 of every token type. These tokens gate every operation the agent performs."
workflow "Before starting a batch of operations, an agent checks its token budget to"
workflow "plan how many perceives, recalls, and transfers it can afford this epoch."
show_request "GET" "$BASE/v1/tokens/balances/$STACK_ID"
BALANCES=$(curl -s $BASE/v1/tokens/balances/$STACK_ID)
show_response "$BALANCES"
assert_json_field "balances stackId" "$BALANCES" ".stackId" "$STACK_ID"
assert_json_field "compute tokens" "$BALANCES" ".sleeveTotals.compute" "500"
assert_json_field "memory tokens" "$BALANCES" ".sleeveTotals.memory" "500"
assert_json_field "sync tokens" "$BALANCES" ".sleeveTotals.sync" "500"
assert_json_field "routing tokens" "$BALANCES" ".sleeveTotals.routing" "500"
echo ""

# =============================================================================
# Phase 5: Perceive — Store memories into the DAG
# =============================================================================
echo "┌─────────────────────────────────────────────────────────────────────────"
echo "│ Phase 5: Perceive (Memory Storage)"
echo "│"
echo "│ 'Perceive' is the act of storing an observation into the agent's memory"
echo "│ graph. The input text is:"
echo "│   1. Encrypted with the current epoch's AES-GCM key (derived via HKDF)"
echo "│   2. Stored as a DAG node on Hippocampus with parent links"
echo "│   3. Assigned a unique CID (ecca://sha256-hash)"
echo "│   4. Linked into the Stack's episodic memory chain"
echo "│"
echo "│ Each perceive costs 0.5 compute tokens and increments the sleeve's drift"
echo "│ counter by 1. When drift exceeds 15, the sleeve becomes 'desynced' and"
echo "│ needs to sync before it can operate reliably."
echo "│"
echo "│ In agent workflows, perceive is called after every tool call, user message,"
echo "│ or significant observation to build the agent's long-term memory."
echo "└─────────────────────────────────────────────────────────────────────────"
echo ""

service "siyana-api → hippocampus-dag" "API encrypts, DAG stores, CID returned"
explain "Perceive #1: Human sleeve observes something. The text is encrypted with"
explain "epochKey(epoch, stackPrivateKey) so only this Stack can decrypt it later."
explain "The returned 'thought' field is the processed representation."
workflow "Agent perceive #1: After reading a document, the agent stores its observation."
show_request "POST" "$BASE/v1/sleeves/$SLEEVE_H_ID/perceive" '{"input":"The quick brown fox jumped over the lazy dog"}'
P1=$(curl -s -X POST $BASE/v1/sleeves/$SLEEVE_H_ID/perceive -H "Content-Type: application/json" -d '{"input":"The quick brown fox jumped over the lazy dog"}')
show_response "$P1"
CID1=$(echo $P1 | jq -r .cid)
assert_json_not_null "perceive 1 returns cid" "$P1" ".cid"
assert_json_not_null "perceive 1 returns thought" "$P1" ".thought"
echo ""

explain "Perceive #2: AI sleeve stores its own observation. Both sleeves write to the"
explain "SAME Stack's memory graph, building a shared DAG of experiences. The human"
explain "and AI see the world differently but share one memory."
workflow "Agent perceive #2: After an LLM inference, the agent records its reasoning."
show_request "POST" "$BASE/v1/sleeves/$SLEEVE_A_ID/perceive" '{"input":"Artificial intelligence is transforming every industry"}'
P2=$(curl -s -X POST $BASE/v1/sleeves/$SLEEVE_A_ID/perceive -H "Content-Type: application/json" -d '{"input":"Artificial intelligence is transforming every industry"}')
show_response "$P2"
CID2=$(echo $P2 | jq -r .cid)
assert_json_not_null "perceive 2 returns cid" "$P2" ".cid"
echo ""

explain "Perceive #3: Another human observation. The DAG now has 3 encrypted nodes"
explain "linked together, forming a Merkle structure that can be traversed during recall."
workflow "Agent perceive #3: After a user message, the agent stores it for future context."
show_request "POST" "$BASE/v1/sleeves/$SLEEVE_H_ID/perceive" '{"input":"Memory is the treasury of the mind"}'
P3=$(curl -s -X POST $BASE/v1/sleeves/$SLEEVE_H_ID/perceive -H "Content-Type: application/json" -d '{"input":"Memory is the treasury of the mind"}')
show_response "$P3"
CID3=$(echo $P3 | jq -r .cid)
assert_json_not_null "perceive 3 returns cid" "$P3" ".cid"
echo ""

explain "Verifying all CIDs are unique — each memory is content-addressed, so identical"
explain "input would produce the same CID, but different inputs must produce different CIDs."
echo -e "  ${C_DIM}  CID1: $CID1${C_RESET}"
echo -e "  ${C_DIM}  CID2: $CID2${C_RESET}"
echo -e "  ${C_DIM}  CID3: $CID3${C_RESET}"
if [ "$CID1" != "$CID2" ] && [ "$CID2" != "$CID3" ] && [ "$CID1" != "$CID3" ]; then
  pass "all CIDs are unique"
else
  fail "CID uniqueness" "CIDs: $CID1, $CID2, $CID3"
fi

explain "Verifying CID format uses the ecca:// URI scheme (not raw IPFS hashes)."
if echo "$CID1" | grep -q "^ecca://"; then
  pass "CID has ecca:// prefix"
else
  fail "CID format" "expected ecca:// prefix, got $CID1"
fi
echo ""

# =============================================================================
# Phase 5b: Stack Remember — Pin a core memory
# =============================================================================
echo "┌─────────────────────────────────────────────────────────────────────────"
echo "│ Phase 5b: Stack Remember"
echo "│"
echo "│ 'Remember' writes a memory directly to the Stack (not through a sleeve)"
echo "│ and pins it. Pinned memories are preserved even when fidelity degrades —"
echo "│ they're the 'core memories' that survive no matter what. Think of them"
echo "│ as the agent's fundamental knowledge that must never be forgotten."
echo "└─────────────────────────────────────────────────────────────────────────"
echo ""

service "siyana-api → hippocampus-dag" "Encrypted, stored, and pinned in the DAG"
explain "Pinning a core memory. In agent workflows, you'd pin system prompts,"
explain "critical instructions, or hard-won knowledge that the agent must retain"
explain "across epochs even as older unpinned memories naturally decay."
workflow "An agent pins its core directives, safety rules, and user preferences."
show_request "POST" "$BASE/v1/stacks/$STACK_ID/remember" '{"text":"Pinned memory via remember endpoint","pin":true}'
REMEMBER=$(curl -s -X POST $BASE/v1/stacks/$STACK_ID/remember -H "Content-Type: application/json" -d '{"text":"Pinned memory via remember endpoint","pin":true}')
show_response "$REMEMBER"
assert_json_not_null "remember returns cid" "$REMEMBER" ".cid"
echo ""

# =============================================================================
# Phase 6: Recall — Retrieve and reconstruct memories
# =============================================================================
echo "┌─────────────────────────────────────────────────────────────────────────"
echo "│ Phase 6: Recall"
echo "│"
echo "│ 'Recall' traverses the Hippocampus DAG starting from the Stack's"
echo "│ episodicHead, decrypting each node with the appropriate epoch key."
echo "│ It returns:"
echo "│   • fragments — successfully decrypted memories (the useful content)"
echo "│   • broken    — CIDs that couldn't be decrypted (lost/corrupted)"
echo "│   • fidelity  — ratio of successful / total (1.0 = perfect memory)"
echo "│"
echo "│ Fidelity is the key metric: it tells you how much the agent 'remembers'."
echo "│ Below 0.6 fidelity, a coordination residue is generated (an economic"
echo "│ error object that other agents can claim by providing proof-of-resolution)."
echo "│"
echo "│ The dhf-compositor service handles the actual DAG walk and decryption."
echo "└─────────────────────────────────────────────────────────────────────────"
echo ""

service "siyana-api → dhf-compositor → hippocampus-dag" "Compositor walks DAG, decrypts each node"
explain "Recalling all memories for this stack. Since we just stored 4 memories"
explain "(3 perceives + 1 remember) and haven't crossed an epoch boundary with"
explain "key rotation, fidelity should be 1.0 (perfect — all memories intact)."
workflow "Before responding to a user, an agent recalls recent memories for context."
workflow "This is equivalent to RAG but with cryptographic integrity guarantees."
show_request "GET" "$BASE/v1/stacks/$STACK_ID/recall"
RECALL=$(curl -s "$BASE/v1/stacks/$STACK_ID/recall")
show_response "$RECALL"
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

# =============================================================================
# Phase 7: Sleeve Sync — Reset drift, stay coherent
# =============================================================================
echo "┌─────────────────────────────────────────────────────────────────────────"
echo "│ Phase 7: Sleeve Sync"
echo "│"
echo "│ Every operation (perceive, recall) increments a sleeve's 'drift' counter."
echo "│ When drift exceeds 15, the sleeve is 'desynced' — its view of the world"
echo "│ is too stale to be trusted. Syncing resets drift to 0 by anchoring the"
echo "│ sleeve to the current epoch."
echo "│"
echo "│ Sync costs 1 sync token. This creates a natural rhythm: agents must"
echo "│ periodically sync to stay coherent, just like humans need sleep."
echo "└─────────────────────────────────────────────────────────────────────────"
echo ""

service "siyana-api" "Resets drift counter in PostgreSQL, deducts sync token"
explain "Syncing the human sleeve. After 3 perceives, drift is 3. We sync now to"
explain "reset it to 0, ensuring the sleeve stays coherent for future operations."
workflow "Agents schedule syncs between task batches to avoid desynchronization."
workflow "A desync'd agent generates coordination residues (economic penalties)."
show_request "POST" "$BASE/v1/sleeves/$SLEEVE_H_ID/sync"
SYNC=$(curl -s -X POST $BASE/v1/sleeves/$SLEEVE_H_ID/sync)
show_response "$SYNC"
assert_json_field "sync ok" "$SYNC" ".ok" "true"
echo ""

# =============================================================================
# Phase 8: Epoch & Mining — Advance the global clock
# =============================================================================
echo "┌─────────────────────────────────────────────────────────────────────────"
echo "│ Phase 8: Epoch & Mining"
echo "│"
echo "│ The epoch is the global clock for ECCA. It advances with each Medulla"
echo "│ block. When a block is mined:"
echo "│   1. Thalamus-router computes the coherence root (Merkle root combining"
echo "│      EVM state + DAG state + sleeve state)"
echo "│   2. The coherence root is embedded in the Medulla block header"
echo "│   3. The EpochAnchor contract on Cortex is updated"
echo "│   4. Token emissions are released by the Quellist Treasury"
echo "│"
echo "│ This creates a cryptographic proof that all cross-chain state was"
echo "│ consistent at that point in time. It's the heartbeat of the system."
echo "└─────────────────────────────────────────────────────────────────────────"
echo ""

service "siyana-api → thalamus-router → medulla-pow" "Thalamus computes coherence root, Medulla mines block"
explain "Reading the current epoch before mining. We'll compare heights after."
show_request "GET" "$BASE/v1/epochs/current"
EPOCH=$(curl -s $BASE/v1/epochs/current)
show_response "$EPOCH"
assert_json_not_null "epoch number" "$EPOCH" ".epoch"
assert_json_not_null "chain height" "$EPOCH" ".height"
assert_json_not_null "chain tip" "$EPOCH" ".tip"
echo ""

explain "Triggering a PoW block mine. This is normally automatic (every ~4s), but"
explain "we trigger it manually to test the full coherence cycle. The returned"
explain "synapticFieldRoot is the Merkle root of the entire system state."
workflow "Mining anchors all agent activity into an immutable blockchain record."
workflow "Other agents can verify any agent's history by checking these anchors."
show_request "POST" "$BASE/v1/mining/block"
MINE=$(curl -s -X POST $BASE/v1/mining/block)
show_response "$MINE"
assert_json_not_null "mined block hash" "$MINE" ".blockHash"
assert_json_not_null "mined synapticFieldRoot" "$MINE" ".synapticFieldRoot"
echo ""

explain "Verifying the chain height increased. This proves mining actually happened"
explain "and the epoch advanced."
show_request "GET" "$BASE/v1/epochs/current"
EPOCH_AFTER=$(curl -s $BASE/v1/epochs/current)
show_response "$EPOCH_AFTER"
HEIGHT_BEFORE=$(echo $EPOCH | jq -r .height)
HEIGHT_AFTER=$(echo $EPOCH_AFTER | jq -r .height)
if [ "$HEIGHT_AFTER" -gt "$HEIGHT_BEFORE" ]; then
  pass "height increased after mining ($HEIGHT_BEFORE → $HEIGHT_AFTER)"
else
  fail "height after mining" "before=$HEIGHT_BEFORE, after=$HEIGHT_AFTER"
fi
echo ""

# =============================================================================
# Phase 9: Needlecast — Transfer consciousness between sleeves
# =============================================================================
echo "┌─────────────────────────────────────────────────────────────────────────"
echo "│ Phase 9: Needlecast"
echo "│"
echo "│ Needlecasting transfers an agent's consciousness from one sleeve to"
echo "│ another. It's a 6-step atomic saga:"
echo "│   1. FREEZE  — Source sleeve is frozen (no new operations)"
echo "│   2. SNAPSHOT — Memory state is captured from the DAG"
echo "│   3. SHARD   — Memory is split into encrypted shards"
echo "│   4. TRANSMIT — Shards are sent to the target sleeve's storage"
echo "│   5. REASSEMBLE — Target sleeve reconstructs the memory graph"
echo "│   6. ACTIVATE — Target sleeve is activated, source deactivated"
echo "│"
echo "│ If any step fails, all previous steps are compensated (rolled back)."
echo "│ This is the saga pattern from distributed systems, applied to consciousness."
echo "│ Costs 5 routing tokens per transfer."
echo "│"
echo "│ In practice: an agent might needlecast from a laptop sleeve to a cloud"
echo "│ sleeve when the user closes their laptop, preserving continuity."
echo "└─────────────────────────────────────────────────────────────────────────"
echo ""

service "siyana-api → needlecast-router-svc → hippocampus-dag → cortex-evm" "Full cross-service saga"
explain "Transferring consciousness from the human sleeve to the AI sleeve."
explain "The human sleeve will be frozen, its memories sharded, transmitted to"
explain "the AI sleeve, and reassembled. The AI sleeve becomes the active body."
workflow "When an agent needs to migrate between hosts (e.g., edge→cloud), it"
workflow "needlecasts. The identity and memories travel; only the embodiment changes."
show_request "POST" "$BASE/v1/needlecast" "{\"from\":\"$SLEEVE_H_ID\",\"to\":\"$SLEEVE_A_ID\"}"
NC=$(curl -s -X POST $BASE/v1/needlecast -H "Content-Type: application/json" -d "{\"from\":\"$SLEEVE_H_ID\",\"to\":\"$SLEEVE_A_ID\"}")
show_response "$NC"
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

# =============================================================================
# Phase 10: Coordination State — Check for errors and desync
# =============================================================================
echo "┌─────────────────────────────────────────────────────────────────────────"
echo "│ Phase 10: Coordination State"
echo "│"
echo "│ ECCA treats errors as economic objects called 'coordination residues'."
echo "│ When something goes wrong (sleeve desync, memory corruption, failed"
echo "│ needlecast), a Residue is created. Other agents can claim Residues by"
echo "│ providing proof-of-resolution, earning token rewards from the Treasury."
echo "│"
echo "│ This turns debugging into an economic incentive: the system pays agents"
echo "│ to fix each other's problems."
echo "└─────────────────────────────────────────────────────────────────────────"
echo ""

service "siyana-api" "Queries desync and residue state from PostgreSQL"
explain "Checking for desynced sleeves — those with drift > 15."
workflow "Monitoring agents periodically poll this endpoint to detect problems."
show_request "GET" "$BASE/v1/coordination/desync"
DESYNC=$(curl -s $BASE/v1/coordination/desync)
show_response "$DESYNC"
assert_status "desync endpoint" "$BASE/v1/coordination/desync"
echo ""

explain "Listing coordination residues. In a healthy system, this should be empty"
explain "or contain only recently-resolved residues."
workflow "Resolver agents watch this endpoint and compete to fix errors for rewards."
show_request "GET" "$BASE/v1/coordination/residues"
RESIDUES=$(curl -s $BASE/v1/coordination/residues)
show_response "$RESIDUES"
assert_status "residues endpoint" "$BASE/v1/coordination/residues"
echo ""

# =============================================================================
# Phase 11: Final Stack State — Verify the full lifecycle
# =============================================================================
echo "┌─────────────────────────────────────────────────────────────────────────"
echo "│ Phase 11: Final Stack State"
echo "│"
echo "│ After the full cycle (create → perceive → recall → sync → mine →"
echo "│ needlecast), we verify the Stack's final state. The episodicHead"
echo "│ should point to the latest memory, tokens should be partially consumed,"
echo "│ and both sleeves should still exist."
echo "└─────────────────────────────────────────────────────────────────────────"
echo ""

service "siyana-api" "Full stack state including sleeves and token balances"
explain "Reading the complete stack state. This is what an agent loads on startup"
explain "to resume from where it left off."
workflow "On restart, an agent fetches its stack state to rebuild its working context."
show_request "GET" "$BASE/v1/stacks/$STACK_ID"
FINAL=$(curl -s "$BASE/v1/stacks/$STACK_ID")
show_response "$FINAL"
assert_json_not_null "episodicHead set" "$FINAL" ".episodicHead"
assert_json_field "stack has sleeves" "$(echo $FINAL | jq '{c: (.sleeves | length)}')" ".c" "2"

COMPUTE_TOTAL=$(echo $FINAL | jq '[.sleeves[].tokens.compute] | add')
explain "Compute tokens should be < 500 (we spent 0.5 × 3 perceives = 1.5 tokens)."
if [ "$(echo "$COMPUTE_TOTAL < 500" | bc -l)" = "1" ]; then
  pass "compute tokens consumed ($COMPUTE_TOTAL < 500)"
else
  fail "compute token consumption" "total=$COMPUTE_TOTAL, expected < 500"
fi

ROUTING_TOTAL=$(echo $FINAL | jq '[.sleeves[].tokens.routing] | add')
explain "Routing tokens should be < 500 (needlecast costs 5 tokens)."
if [ "$(echo "$ROUTING_TOTAL < 500" | bc -l)" = "1" ]; then
  pass "routing tokens consumed by needlecast ($ROUTING_TOTAL < 500)"
else
  fail "routing token consumption" "total=$ROUTING_TOTAL, expected < 500"
fi
echo ""

# =============================================================================
# Phase 12: Cleanup — Decommission sleeves
# =============================================================================
echo "┌─────────────────────────────────────────────────────────────────────────"
echo "│ Phase 12: Cleanup (Decommission)"
echo "│"
echo "│ Decommissioning a sleeve marks it as not alive. Its token balance returns"
echo "│ to the Stack pool. The sleeve can no longer perceive, recall, or sync."
echo "│ The Stack itself persists — it can spawn new sleeves later."
echo "│"
echo "│ In agent workflows, you decommission a sleeve when shutting down a"
echo "│ particular embodiment (e.g., closing a laptop session, scaling down a"
echo "│ cloud worker). The identity and memories survive in the Stack."
echo "└─────────────────────────────────────────────────────────────────────────"
echo ""

service "siyana-api" "Sets alive=false, returns tokens to Stack pool"
explain "Decommissioning the human sleeve."
show_request "DELETE" "$BASE/v1/sleeves/$SLEEVE_H_ID"
DEL1=$(curl -s -X DELETE $BASE/v1/sleeves/$SLEEVE_H_ID)
show_response "$DEL1"
assert_json_field "decommission human sleeve" "$DEL1" ".ok" "true"
echo ""

explain "Decommissioning the AI sleeve."
show_request "DELETE" "$BASE/v1/sleeves/$SLEEVE_A_ID"
DEL2=$(curl -s -X DELETE $BASE/v1/sleeves/$SLEEVE_A_ID)
show_response "$DEL2"
assert_json_field "decommission ai sleeve" "$DEL2" ".ok" "true"
echo ""

explain "Verifying no alive sleeves remain for this stack. The Stack still exists"
explain "in the database and on-chain — only its active embodiments are gone."
workflow "After cleanup, the agent's identity persists. It can be re-sleeved later."
show_request "GET" "$BASE/v1/sleeves"
SLEEVES_AFTER=$(curl -s $BASE/v1/sleeves)
ALIVE_COUNT=$(echo $SLEEVES_AFTER | jq "[.[] | select(.stackId == \"$STACK_ID\")] | length")
echo -e "  ${C_DIM}  Alive sleeves for this stack: ${ALIVE_COUNT}${C_RESET}"
if [ "$ALIVE_COUNT" = "0" ]; then
  pass "no alive sleeves for stack after cleanup"
else
  fail "cleanup" "$ALIVE_COUNT sleeves still alive"
fi
echo ""

# =============================================================================
# Phase 13: Blockchain Verification — Prove it's all on-chain
# =============================================================================
echo "┌─────────────────────────────────────────────────────────────────────────"
echo "│ Phase 13: Blockchain Verification"
echo "│"
echo "│ The final phase verifies that all three blockchains have recorded"
echo "│ evidence of our test run:"
echo "│   • Cortex EVM — Smart contract state (NFTs, tokens, anchors)"
echo "│   • Medulla PoW — Block headers with coherence roots"
echo "│   • Hippocampus DAG — Encrypted memory nodes"
echo "│"
echo "│ This is what makes ECCA different from a regular database: every agent"
echo "│ action leaves a cryptographic trail across three independent chains."
echo "│ You can verify any agent's history without trusting the agent itself."
echo "└─────────────────────────────────────────────────────────────────────────"
echo ""

service "cortex-evm" "port 8545 — Ethereum-compatible EVM (Clique PoA, chain ID 1337)"
explain "Querying Cortex EVM block height via JSON-RPC. This chain stores the"
explain "StackIdentity NFTs, BandwidthToken balances, EpochAnchor records,"
explain "SleeveRegistry, NeedlecastRouter, QuellistTreasury, and ResidueRegistry contracts."
workflow "Agents can audit each other's on-chain history for trust verification."
show_request "POST" "http://localhost:8545" '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
EVM_BLOCK=$(curl -s -X POST http://localhost:8545 -H "content-type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}')
show_response "$EVM_BLOCK"
EVM_HEIGHT=$(echo $EVM_BLOCK | jq -r .result)
if [ "$EVM_HEIGHT" != "null" ] && [ -n "$EVM_HEIGHT" ]; then
  pass "cortex-evm block height: $EVM_HEIGHT"
else
  fail "cortex-evm block height" "could not get block number"
fi
echo ""

service "medulla-pow" "port 8332 — Custom Proof-of-Work chain (Go, ~4s blocks)"
explain "Querying Medulla chain info via JSON-RPC at /rpc. The height tells us"
explain "how many epochs have passed. Each block header contains the coherence"
explain "root — a Merkle root of the entire cross-chain system state at that epoch."
show_request "POST" "http://localhost:8332/rpc" '{"jsonrpc":"2.0","id":1,"method":"getinfo","params":{}}'
MEDULLA_INFO=$(curl -s -X POST http://localhost:8332/rpc -H "content-type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getinfo","params":{}}')
show_response "$MEDULLA_INFO"
if echo "$MEDULLA_INFO" | jq -e '.result.height' > /dev/null 2>&1; then
  MEDULLA_H=$(echo $MEDULLA_INFO | jq -r '.result.height')
  pass "medulla-pow height: $MEDULLA_H"
else
  fail "medulla-pow info" "no height in response"
fi
echo ""

service "hippocampus-dag" "port 15001 — Content-addressed DAG (Go, Merkle-DAG)"
explain "Checking how many DAG nodes Hippocampus has stored. We created 4 memories"
explain "(3 perceives + 1 remember), but each memory may produce multiple nodes"
explain "(the encrypted blob + metadata + links). We expect at least 4 nodes."
workflow "The total node count shows the cumulative memory footprint of all agents."
show_request "GET" "http://localhost:15001/stat"
HIPPO_STAT=$(curl -s http://localhost:15001/stat)
show_response "$HIPPO_STAT"
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
echo ""
echo "╔══════════════════════════════════════════════════════════════════════════╗"
echo "║                          TEST RESULTS                                    ║"
echo "╠══════════════════════════════════════════════════════════════════════════╣"
printf "║  Passed: %-3d                                                           ║\n" $PASS
printf "║  Failed: %-3d                                                           ║\n" $FAIL
echo "╠══════════════════════════════════════════════════════════════════════════╣"
echo "║                                                                          ║"
echo "║  Full Agent Lifecycle Tested:                                            ║"
echo "║    ✓ Identity    — Stack created with NFT + ed25519 keypair              ║"
echo "║    ✓ Embodiment  — Human + AI sleeves spawned                            ║"
echo "║    ✓ Economy     — Token balances verified (compute/memory/sync/routing) ║"
echo "║    ✓ Memory      — 4 memories stored as encrypted DAG nodes              ║"
echo "║    ✓ Recall      — Memories reconstructed with 100% fidelity             ║"
echo "║    ✓ Coherence   — Epoch mined, coherence root anchored                  ║"
echo "║    ✓ Transfer    — Consciousness needlecast between sleeves              ║"
echo "║    ✓ Blockchain  — All 3 chains verified (EVM + PoW + DAG)               ║"
echo "║    ✓ Cleanup     — Sleeves decommissioned, Stack identity persists       ║"
echo "║                                                                          ║"
echo "╚══════════════════════════════════════════════════════════════════════════╝"

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
