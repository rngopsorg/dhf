#!/bin/bash
BASE=http://localhost:7070

echo "=== Phase 1: Health Checks ==="
echo -n "siyana-api: "; curl -sf $BASE/healthz | jq -r .name
echo -n "medulla-pow: "; curl -sf http://localhost:8332/health; echo
echo -n "hippocampus-dag: "; curl -sf http://localhost:15001/health; echo
echo ""

echo "=== Phase 2: Create Stack ==="
STACK=$(curl -s -X POST $BASE/v1/stacks -H "Content-Type: application/json" -d '{"name":"test-agent-1"}')
echo "Stack: $STACK"
STACK_ID=$(echo $STACK | jq -r .id)
echo "Stack ID: $STACK_ID"
if [ "$STACK_ID" = "null" ] || [ -z "$STACK_ID" ]; then
  echo "FAIL: Could not create stack"
  exit 1
fi

echo "=== Phase 3: Spawn Sleeves ==="
SLEEVE_H=$(curl -s -X POST $BASE/v1/sleeves -H "Content-Type: application/json" -d "{\"stackId\":\"$STACK_ID\",\"embodimentType\":\"human\"}")
echo "Human Sleeve: $SLEEVE_H"
SLEEVE_H_ID=$(echo $SLEEVE_H | jq -r .id)

SLEEVE_A=$(curl -s -X POST $BASE/v1/sleeves -H "Content-Type: application/json" -d "{\"stackId\":\"$STACK_ID\",\"embodimentType\":\"ai\"}")
echo "AI Sleeve: $SLEEVE_A"
SLEEVE_A_ID=$(echo $SLEEVE_A | jq -r .id)

echo "=== Phase 4: Token Balances ==="
BALANCES=$(curl -s $BASE/v1/tokens/balances/$STACK_ID)
echo "Balances: $BALANCES"

echo "=== Phase 5: Perceive (Store Memories) ==="
P1=$(curl -s -X POST $BASE/v1/sleeves/$SLEEVE_H_ID/perceive -H "Content-Type: application/json" -d '{"input":"The quick brown fox jumped over the lazy dog"}')
echo "Perceive 1: $P1"
CID1=$(echo $P1 | jq -r .cid)

P2=$(curl -s -X POST $BASE/v1/sleeves/$SLEEVE_A_ID/perceive -H "Content-Type: application/json" -d '{"input":"Artificial intelligence is transforming every industry"}')
echo "Perceive 2: $P2"
CID2=$(echo $P2 | jq -r .cid)

P3=$(curl -s -X POST $BASE/v1/sleeves/$SLEEVE_H_ID/perceive -H "Content-Type: application/json" -d '{"input":"Memory is the treasury of the mind"}')
echo "Perceive 3: $P3"
CID3=$(echo $P3 | jq -r .cid)

echo "=== Phase 5b: Store via Stack Remember ==="
R_STORE=$(curl -s -X POST $BASE/v1/stacks/$STACK_ID/remember -H "Content-Type: application/json" -d '{"text":"Direct memory through stack remember endpoint","pin":true}')
echo "Remember: $R_STORE"

echo "=== Phase 6: Recall ==="
RECALL=$(curl -s "$BASE/v1/stacks/$STACK_ID/recall")
echo "Recall: $RECALL"

echo "=== Phase 7: Sync Sleeve ==="
SYNC=$(curl -s -X POST $BASE/v1/sleeves/$SLEEVE_H_ID/sync)
echo "Sync: $SYNC"

echo "=== Phase 8: Epoch / Mining ==="
EPOCH=$(curl -s $BASE/v1/epochs/current)
echo "Current Epoch: $EPOCH"

MINE=$(curl -s -X POST $BASE/v1/mining/block)
echo "Mine Block: $MINE"

echo "=== Phase 9: Needlecast ==="
NC=$(curl -s -X POST $BASE/v1/needlecast -H "Content-Type: application/json" -d "{\"from\":\"$SLEEVE_H_ID\",\"to\":\"$SLEEVE_A_ID\"}")
echo "Needlecast: $NC"

echo "=== Phase 10: Coordination / Residues ==="
DESYNC=$(curl -s $BASE/v1/coordination/desync)
echo "Desync: $DESYNC"

RESIDUES=$(curl -s $BASE/v1/coordination/residues)
echo "Residues: $RESIDUES"

echo "=== Phase 11: Get Stack State ==="
STATE=$(curl -s "$BASE/v1/stacks/$STACK_ID")
echo "Stack State: $STATE"

echo "=== Phase 12: Cleanup (Decommission Sleeves) ==="
DEL1=$(curl -s -X DELETE $BASE/v1/sleeves/$SLEEVE_H_ID)
echo "Delete Human Sleeve: $DEL1"
DEL2=$(curl -s -X DELETE $BASE/v1/sleeves/$SLEEVE_A_ID)
echo "Delete AI Sleeve: $DEL2"

echo ""
echo "=== ALL TESTS COMPLETE ==="
