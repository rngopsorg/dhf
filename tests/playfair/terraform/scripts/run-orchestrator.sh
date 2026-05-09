#!/usr/bin/env bash
# Apply the orchestrator job, wait for completion, collect results, generate report.
set -euo pipefail

: "${PLAYFAIR_DIR:?PLAYFAIR_DIR required}"
: "${REPO_ROOT:?REPO_ROOT required}"
: "${K8S_DIR:?K8S_DIR required}"
: "${RESULTS_DIR:?RESULTS_DIR required}"
: "${EPOCHS:?EPOCHS required}"

mkdir -p "$RESULTS_DIR"

# Idempotent re-run: delete prior job
kubectl -n ecca-shared delete job playfair-orchestrator --ignore-not-found

# Capture environment metadata so the report shows commit/runner/etc.
GIT_COMMIT="${GIT_COMMIT:-${GITHUB_SHA:-$(cd "$REPO_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo local)}}"
GIT_BRANCH="${GIT_BRANCH:-${GITHUB_REF_NAME:-$(cd "$REPO_ROOT" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)}}"
PLAYFAIR_CLUSTER="${PLAYFAIR_CLUSTER:-${CLUSTER_NAME:-playfair}}"
PLAYFAIR_RUNNER="${PLAYFAIR_RUNNER:-${GITHUB_ACTIONS:+github-actions}}"
PLAYFAIR_RUNNER="${PLAYFAIR_RUNNER:-local}"
PLAYFAIR_LATENCY="${PLAYFAIR_LATENCY:-storage↔compute 33±5ms · compute↔bandwidth 42±8ms · storage↔bandwidth 75±12ms}"

# Inject EPOCHS + env metadata into the manifest at apply time
sed \
  -e "s|EPOCHS_PLACEHOLDER|${EPOCHS}|g" \
  -e "s|PLAYFAIR_CLUSTER_PLACEHOLDER|${PLAYFAIR_CLUSTER}|g" \
  -e "s|PLAYFAIR_LATENCY_PLACEHOLDER|${PLAYFAIR_LATENCY}|g" \
  -e "s|GIT_COMMIT_PLACEHOLDER|${GIT_COMMIT}|g" \
  -e "s|PLAYFAIR_RUNNER_PLACEHOLDER|${PLAYFAIR_RUNNER}|g" \
  -e "s|GIT_BRANCH_PLACEHOLDER|${GIT_BRANCH}|g" \
  "${K8S_DIR}/04-orchestrator.yaml" \
  | kubectl apply -f -

# Wait — give it 10 seconds per epoch + 120s startup buffer.
TIMEOUT=$((EPOCHS * 10 + 120))
echo "Waiting up to ${TIMEOUT}s for orchestrator to complete (${EPOCHS} epochs)..."

if ! kubectl -n ecca-shared wait --for=condition=complete \
       job/playfair-orchestrator --timeout=${TIMEOUT}s; then
  echo "WARN: orchestrator did not complete; collecting partial results"
  kubectl -n ecca-shared logs job/playfair-orchestrator --tail=50 || true
fi

# Collect results
kubectl -n ecca-shared logs job/playfair-orchestrator > "${RESULTS_DIR}/orchestrator.log" 2>/dev/null || true

ORCH_POD=$(kubectl -n ecca-shared get pods -l job-name=playfair-orchestrator -o name | head -1)
if [ -n "$ORCH_POD" ]; then
  # Try the in-container results file first
  if ! kubectl -n ecca-shared cp "${ORCH_POD#pod/}:/results/playfair-results.json" \
         "${RESULTS_DIR}/playfair-results.json" 2>/dev/null; then
    # Fallback: extract JSON from the orchestrator log via the explicit marker.
    # Stop at the next banner line so the trailing summary doesn't corrupt JSON.
    awk '
      /^═══ RESULTS JSON ═══/ { flag=1; next }
      flag && /^═══════════════════════════════════════════════════════════/ { exit }
      flag { print }
    ' "${RESULTS_DIR}/orchestrator.log" \
      > "${RESULTS_DIR}/playfair-results.json" || true
  fi
fi

# Validate JSON; fall back to empty object if extraction produced garbage
if [ -s "${RESULTS_DIR}/playfair-results.json" ]; then
  if ! python3 -c "import json,sys; json.load(open('${RESULTS_DIR}/playfair-results.json'))" 2>/dev/null; then
    echo "WARN: extracted JSON is not valid; report will show partial data"
    echo '{}' > "${RESULTS_DIR}/playfair-results.json"
  fi
fi

# Per-region service logs
for region in region-storage region-compute region-bandwidth; do
  kubectl -n "$region" logs -l app=thalamus-router --tail=200 \
    > "${RESULTS_DIR}/${region}-thalamus.log" 2>/dev/null || true
  kubectl -n "$region" logs -l app=siyana-api --tail=200 \
    > "${RESULTS_DIR}/${region}-siyana.log" 2>/dev/null || true
done
echo "✓ Results collected in $RESULTS_DIR"

# Generate HTML report
if [ -s "${RESULTS_DIR}/playfair-results.json" ]; then
  cd "$REPO_ROOT"
  node "${PLAYFAIR_DIR}/generate-playfair-report.js" \
    "${RESULTS_DIR}/playfair-results.json" \
    "${PLAYFAIR_DIR}/playfair-report.html" \
    "${REPO_ROOT}/docs/playfair-report.html" || \
    echo "WARN: report generation failed"
  echo "✓ Report at ${PLAYFAIR_DIR}/playfair-report.html"
else
  echo "WARN: no results JSON to render"
fi
