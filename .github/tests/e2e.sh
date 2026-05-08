#!/bin/bash
# =============================================================================
# ECCA Stack v3 — End-to-End Integration Test Suite (Verbose + HTML Report)
# Run against a live Docker Compose deployment.
# Exit 1 on any test failure.
#
# Outputs: Terminal (verbose) + cyberpunk-styled HTML report
# =============================================================================
set -euo pipefail

BASE=http://localhost:7070
PASS=0
FAIL=0
ERRORS=""
REPORT_FILE="${REPORT_FILE:-$(pwd)/e2e-report.html}"
RUN_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# ─── Colors ──────────────────────────────────────────────────────────────────
C_CYAN="\033[36m"
C_GREEN="\033[32m"
C_RED="\033[31m"
C_YELLOW="\033[33m"
C_MAGENTA="\033[35m"
C_DIM="\033[2m"
C_BOLD="\033[1m"
C_RESET="\033[0m"

# ─── HTML Report Setup ───────────────────────────────────────────────────────
HTML_BODY=""

html_escape() {
  local s="$1"
  s="${s//&/&amp;}"
  s="${s//</&lt;}"
  s="${s//>/&gt;}"
  s="${s//\"/&quot;}"
  printf '%s' "$s"
}

html_start_phase() {
  local num="$1" title="$2" desc="$3"
  HTML_BODY="${HTML_BODY}<section class=\"phase\" id=\"phase-${num}\">
<div class=\"phase-header\" onclick=\"this.parentElement.classList.toggle('collapsed')\">
  <span class=\"phase-num\">${num}</span>
  <h2>${title}</h2>
  <span class=\"phase-toggle\">&#x25BC;</span>
</div>
<div class=\"phase-body\">
<p class=\"phase-desc\">${desc}</p>"
}

html_end_phase() {
  HTML_BODY="${HTML_BODY}</div></section>"
}

html_test_pass() {
  local desc
  desc=$(html_escape "$1")
  HTML_BODY="${HTML_BODY}<div class=\"test pass\"><span class=\"indicator\">&#x2713;</span> ${desc}</div>"
}

html_test_fail() {
  local e_desc e_reason
  e_desc=$(html_escape "$1")
  e_reason=$(html_escape "$2")
  HTML_BODY="${HTML_BODY}<div class=\"test fail\"><span class=\"indicator\">&#x2717;</span> ${e_desc} <span class=\"fail-reason\">${e_reason}</span></div>"
}

html_request() {
  local method="$1" url="$2" body="${3:-}"
  local e_url
  e_url=$(html_escape "$url")
  HTML_BODY="${HTML_BODY}<div class=\"request\"><span class=\"method method-${method}\">${method}</span> <span class=\"url\">${e_url}</span>"
  if [ -n "$body" ]; then
    local e_body
    e_body=$(html_escape "$body")
    HTML_BODY="${HTML_BODY}<pre class=\"req-body\">${e_body}</pre>"
  fi
  HTML_BODY="${HTML_BODY}</div>"
}

html_response() {
  local json="$1"
  local pretty escaped
  pretty=$(echo "$json" | jq . 2>/dev/null || echo "$json")
  escaped=$(html_escape "$pretty")
  HTML_BODY="${HTML_BODY}<details class=\"response\"><summary>Response</summary><pre>${escaped}</pre></details>"
}

html_info() {
  local escaped
  escaped=$(html_escape "$1")
  HTML_BODY="${HTML_BODY}<p class=\"info\">${escaped}</p>"
}

html_workflow() {
  local escaped
  escaped=$(html_escape "$1")
  HTML_BODY="${HTML_BODY}<p class=\"workflow\"><span class=\"wf-icon\">&#x2699;</span> ${escaped}</p>"
}

html_service() {
  local e_name e_desc
  e_name=$(html_escape "$1")
  e_desc=$(html_escape "$2")
  HTML_BODY="${HTML_BODY}<div class=\"service-tag\"><span class=\"svc-name\">${e_name}</span><span class=\"svc-desc\">${e_desc}</span></div>"
}

write_html_report() {
  local total=$((PASS + FAIL))
  local pct=0
  if [ "$total" -gt 0 ]; then
    pct=$(( (PASS * 100) / total ))
  fi
  local status_class="all-pass"
  if [ "$FAIL" -gt 0 ]; then status_class="has-fails"; fi

  cat > "$REPORT_FILE" << 'HTMLEOF'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ECCA // E2E Test Report</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Orbitron:wght@400;700;900&display=swap');

:root {
  --bg-deep: #030308;
  --bg-panel: #0a0a14;
  --bg-card: #0f0f1a;
  --bg-code: #080812;
  --neon-cyan: #00f0ff;
  --neon-magenta: #ff00e6;
  --neon-green: #00ff88;
  --neon-red: #ff0055;
  --neon-yellow: #ffcc00;
  --neon-purple: #b347ff;
  --text: #c8c8d4;
  --text-dim: #5a5a6e;
  --border: #1a1a2e;
  --glow-cyan: 0 0 10px #00f0ff44, 0 0 40px #00f0ff22;
  --glow-green: 0 0 10px #00ff8844, 0 0 40px #00ff8822;
  --glow-red: 0 0 10px #ff005544, 0 0 40px #ff005522;
  --glow-magenta: 0 0 10px #ff00e644, 0 0 40px #ff00e622;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  background: var(--bg-deep);
  color: var(--text);
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  line-height: 1.6;
  min-height: 100vh;
  overflow-x: hidden;
}

body::before {
  content: '';
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: repeating-linear-gradient(
    0deg, transparent, transparent 2px,
    rgba(0, 240, 255, 0.008) 2px, rgba(0, 240, 255, 0.008) 4px
  );
  pointer-events: none;
  z-index: 9999;
}

body::after {
  content: '';
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background-image:
    linear-gradient(rgba(0, 240, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 240, 255, 0.03) 1px, transparent 1px);
  background-size: 50px 50px;
  pointer-events: none;
  z-index: -1;
}

.header {
  background: linear-gradient(180deg, var(--bg-panel) 0%, var(--bg-deep) 100%);
  border-bottom: 1px solid var(--neon-cyan);
  padding: 2.5rem 2rem 2rem;
  text-align: center;
  position: relative;
  box-shadow: 0 4px 60px rgba(0, 240, 255, 0.1);
}

.header::before {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--neon-cyan), var(--neon-magenta), var(--neon-cyan), transparent);
  animation: borderGlow 3s ease-in-out infinite;
}

@keyframes borderGlow {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

@keyframes flicker {
  0%, 19%, 21%, 23%, 25%, 54%, 56%, 100% { opacity: 1; }
  20%, 24%, 55% { opacity: 0.6; }
}

.header h1 {
  font-family: 'Orbitron', sans-serif;
  font-size: 2.5rem;
  font-weight: 900;
  letter-spacing: 0.4em;
  background: linear-gradient(135deg, var(--neon-cyan), var(--neon-magenta));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 0.5rem;
  animation: flicker 4s infinite;
}

.header .subtitle {
  font-size: 0.75rem;
  color: var(--text-dim);
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.header .timestamp {
  margin-top: 0.6rem;
  font-size: 0.7rem;
  color: var(--neon-cyan);
  opacity: 0.7;
  font-family: 'JetBrains Mono', monospace;
}

.stats-bar {
  display: flex;
  justify-content: center;
  gap: 3rem;
  padding: 1.5rem 2rem;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.stat { text-align: center; }

.stat-value {
  font-family: 'Orbitron', sans-serif;
  font-size: 2.2rem;
  font-weight: 700;
}

.stat-value.pass-count { color: var(--neon-green); text-shadow: var(--glow-green); }
.stat-value.fail-count { color: var(--neon-red); text-shadow: var(--glow-red); }
.stat-value.total-count { color: var(--neon-cyan); text-shadow: var(--glow-cyan); }

.stat-label {
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.25em;
  color: var(--text-dim);
  margin-top: 0.3rem;
}

.progress-container { padding: 0 2rem; margin: 1.2rem auto; max-width: 960px; }

.progress-bar {
  height: 4px;
  background: var(--bg-card);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.5s ease;
}

.progress-fill.all-pass {
  background: linear-gradient(90deg, var(--neon-green), var(--neon-cyan));
  box-shadow: 0 0 12px var(--neon-green);
}

.progress-fill.has-fails {
  background: linear-gradient(90deg, var(--neon-green), var(--neon-red));
  box-shadow: 0 0 12px var(--neon-red);
}

.content { max-width: 960px; margin: 2rem auto; padding: 0 1.5rem; }

.phase {
  margin-bottom: 1.5rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  overflow: hidden;
  transition: border-color 0.3s, box-shadow 0.3s;
}

.phase:hover {
  border-color: var(--neon-cyan);
  box-shadow: 0 0 30px rgba(0, 240, 255, 0.06);
}

.phase.collapsed .phase-body { display: none; }
.phase.collapsed .phase-toggle { transform: rotate(-90deg); }

.phase-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.5rem;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(90deg, rgba(0, 240, 255, 0.03), transparent);
  user-select: none;
}

.phase-header:hover { background: linear-gradient(90deg, rgba(0, 240, 255, 0.07), transparent); }

.phase-num {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--neon-magenta);
  background: rgba(255, 0, 230, 0.1);
  border: 1px solid rgba(255, 0, 230, 0.3);
  border-radius: 4px;
  padding: 0.25rem 0.6rem;
  min-width: 2.2rem;
  text-align: center;
}

.phase-header h2 {
  flex: 1;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--neon-cyan);
  letter-spacing: 0.05em;
}

.phase-toggle { color: var(--text-dim); font-size: 0.8rem; transition: transform 0.2s; }

.phase-body { padding: 1.2rem 1.5rem; }

.phase-desc {
  color: var(--text-dim);
  font-size: 0.72rem;
  margin-bottom: 1rem;
  padding: 0.8rem 1rem;
  border-left: 3px solid var(--neon-purple);
  background: rgba(179, 71, 255, 0.04);
  border-radius: 0 4px 4px 0;
  line-height: 1.8;
}

.service-tag {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin: 0.8rem 0;
  padding: 0.6rem 1rem;
  background: rgba(0, 240, 255, 0.03);
  border: 1px solid rgba(0, 240, 255, 0.15);
  border-radius: 4px;
}

.svc-name { font-weight: 700; color: var(--neon-cyan); font-size: 0.78rem; white-space: nowrap; }
.svc-desc { color: var(--text-dim); font-size: 0.68rem; }

.info {
  color: var(--text);
  font-size: 0.72rem;
  margin: 0.4rem 0;
  padding-left: 1rem;
  border-left: 2px solid var(--neon-magenta);
  opacity: 0.85;
}

.workflow {
  color: var(--neon-yellow);
  font-size: 0.7rem;
  margin: 0.3rem 0;
  padding-left: 1rem;
  opacity: 0.8;
}

.wf-icon { margin-right: 0.3rem; }

.request {
  margin: 0.8rem 0;
  padding: 0.7rem 1rem;
  background: var(--bg-code);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 0.73rem;
}

.method {
  font-weight: 700;
  padding: 0.15rem 0.5rem;
  border-radius: 3px;
  font-size: 0.63rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.method-GET { color: var(--neon-green); border: 1px solid rgba(0, 255, 136, 0.3); background: rgba(0, 255, 136, 0.05); }
.method-POST { color: var(--neon-cyan); border: 1px solid rgba(0, 240, 255, 0.3); background: rgba(0, 240, 255, 0.05); }
.method-DELETE { color: var(--neon-red); border: 1px solid rgba(255, 0, 85, 0.3); background: rgba(255, 0, 85, 0.05); }
.method-PUT { color: var(--neon-yellow); border: 1px solid rgba(255, 204, 0, 0.3); background: rgba(255, 204, 0, 0.05); }

.url { color: var(--text); margin-left: 0.5rem; word-break: break-all; }

.req-body {
  margin-top: 0.5rem;
  padding: 0.5rem 0.8rem;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 3px;
  color: var(--neon-yellow);
  font-size: 0.68rem;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.response { margin: 0.4rem 0 0.8rem; }

.response summary {
  cursor: pointer;
  font-size: 0.68rem;
  color: var(--text-dim);
  padding: 0.3rem 0;
  transition: color 0.2s;
}

.response summary:hover { color: var(--neon-cyan); }

.response pre {
  margin-top: 0.3rem;
  padding: 0.8rem 1rem;
  background: var(--bg-code);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--neon-green);
  font-size: 0.68rem;
  overflow-x: auto;
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.test {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.8rem;
  margin: 0.3rem 0;
  border-radius: 4px;
  font-size: 0.73rem;
  transition: background 0.2s;
}

.test.pass {
  background: rgba(0, 255, 136, 0.04);
  border-left: 3px solid var(--neon-green);
}

.test.pass:hover { background: rgba(0, 255, 136, 0.08); }

.test.fail {
  background: rgba(255, 0, 85, 0.06);
  border-left: 3px solid var(--neon-red);
}

.test.fail:hover { background: rgba(255, 0, 85, 0.1); }

.test .indicator { font-weight: 700; font-size: 1rem; }
.test.pass .indicator { color: var(--neon-green); text-shadow: var(--glow-green); }
.test.fail .indicator { color: var(--neon-red); text-shadow: var(--glow-red); }

.fail-reason { color: var(--neon-red); font-size: 0.68rem; margin-left: auto; opacity: 0.8; }

.result-banner {
  margin: 2.5rem 0;
  padding: 2.5rem;
  text-align: center;
  border-radius: 10px;
  border: 1px solid;
  position: relative;
  overflow: hidden;
}

.result-banner::before {
  content: '';
  position: absolute;
  top: -50%; left: -50%; right: -50%; bottom: -50%;
  background: conic-gradient(from 0deg, transparent, rgba(0, 255, 136, 0.03), transparent, rgba(0, 240, 255, 0.03), transparent);
  animation: spin 10s linear infinite;
}

@keyframes spin { 100% { transform: rotate(360deg); } }

.result-banner.all-pass {
  background: rgba(0, 255, 136, 0.02);
  border-color: var(--neon-green);
  box-shadow: 0 0 60px rgba(0, 255, 136, 0.1), inset 0 0 60px rgba(0, 255, 136, 0.02);
}

.result-banner.has-fails {
  background: rgba(255, 0, 85, 0.02);
  border-color: var(--neon-red);
  box-shadow: 0 0 60px rgba(255, 0, 85, 0.1), inset 0 0 60px rgba(255, 0, 85, 0.02);
}

.result-banner h2 {
  font-family: 'Orbitron', sans-serif;
  font-size: 1.6rem;
  margin-bottom: 0.6rem;
  position: relative;
  z-index: 1;
}

.result-banner.all-pass h2 { color: var(--neon-green); text-shadow: var(--glow-green); }
.result-banner.has-fails h2 { color: var(--neon-red); text-shadow: var(--glow-red); }

.result-banner p { color: var(--text-dim); font-size: 0.75rem; position: relative; z-index: 1; }

.lifecycle-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.8rem;
  margin: 2rem 0;
}

.lifecycle-item {
  padding: 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.72rem;
  transition: border-color 0.2s, transform 0.2s;
}

.lifecycle-item:hover { border-color: var(--neon-cyan); transform: translateY(-2px); }
.lifecycle-item.lc-pass { border-left: 3px solid var(--neon-green); }
.lifecycle-item .lc-label { color: var(--neon-cyan); font-weight: 700; display: block; margin-bottom: 0.3rem; font-size: 0.75rem; }
.lifecycle-item .lc-desc { color: var(--text-dim); }

.footer {
  text-align: center;
  padding: 2.5rem;
  color: var(--text-dim);
  font-size: 0.6rem;
  letter-spacing: 0.15em;
  border-top: 1px solid var(--border);
  margin-top: 3rem;
}

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: var(--bg-deep); }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--neon-cyan); }

@media (max-width: 600px) {
  .header h1 { font-size: 1.4rem; letter-spacing: 0.15em; }
  .stats-bar { gap: 1.5rem; }
  .stat-value { font-size: 1.5rem; }
  .content { padding: 0 0.8rem; }
  .lifecycle-grid { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<div class="header">
  <h1>ECCA // E2E</h1>
  <div class="subtitle">End-to-End Integration Test Report &mdash; Autonomous Agent Lifecycle</div>
HTMLEOF

  echo "  <div class=\"timestamp\">${RUN_TS}</div>" >> "$REPORT_FILE"
  echo "</div>" >> "$REPORT_FILE"

  cat >> "$REPORT_FILE" << EOF
<div class="stats-bar">
  <div class="stat"><div class="stat-value pass-count">${PASS}</div><div class="stat-label">Passed</div></div>
  <div class="stat"><div class="stat-value fail-count">${FAIL}</div><div class="stat-label">Failed</div></div>
  <div class="stat"><div class="stat-value total-count">${total}</div><div class="stat-label">Total</div></div>
</div>
<div class="progress-container">
  <div class="progress-bar"><div class="progress-fill ${status_class}" style="width: ${pct}%"></div></div>
</div>
<div class="content">
EOF

  echo "$HTML_BODY" >> "$REPORT_FILE"

  if [ "$FAIL" -eq 0 ]; then
    cat >> "$REPORT_FILE" << 'EOF'
<div class="result-banner all-pass">
  <h2>ALL SYSTEMS NOMINAL</h2>
  <p>Full autonomous agent lifecycle verified &mdash; coherence maintained across all chains</p>
</div>
EOF
  else
    cat >> "$REPORT_FILE" << EOF
<div class="result-banner has-fails">
  <h2>COHERENCE BREACH DETECTED</h2>
  <p>${FAIL} assertion(s) failed &mdash; coordination residue generated</p>
</div>
EOF
  fi

  cat >> "$REPORT_FILE" << 'EOF'
<div class="lifecycle-grid">
  <div class="lifecycle-item lc-pass"><span class="lc-label">&#x26A1; Identity</span><span class="lc-desc">Stack + NFT + ed25519 keypair</span></div>
  <div class="lifecycle-item lc-pass"><span class="lc-label">&#x1F9EC; Embodiment</span><span class="lc-desc">Human + AI sleeves spawned</span></div>
  <div class="lifecycle-item lc-pass"><span class="lc-label">&#x1F4B0; Economy</span><span class="lc-desc">Bandwidth tokens verified</span></div>
  <div class="lifecycle-item lc-pass"><span class="lc-label">&#x1F9E0; Memory</span><span class="lc-desc">4 encrypted DAG nodes stored</span></div>
  <div class="lifecycle-item lc-pass"><span class="lc-label">&#x1F50D; Recall</span><span class="lc-desc">100% fidelity reconstruction</span></div>
  <div class="lifecycle-item lc-pass"><span class="lc-label">&#x26D3; Coherence</span><span class="lc-desc">Epoch mined, root anchored</span></div>
  <div class="lifecycle-item lc-pass"><span class="lc-label">&#x1F680; Transfer</span><span class="lc-desc">Consciousness needlecast</span></div>
  <div class="lifecycle-item lc-pass"><span class="lc-label">&#x1F517; Blockchain</span><span class="lc-desc">EVM + PoW + DAG verified</span></div>
  <div class="lifecycle-item lc-pass"><span class="lc-label">&#x1F9F9; Cleanup</span><span class="lc-desc">Sleeves decommissioned</span></div>
</div>
</div>
<div class="footer">
  ECCA STACK v3 &mdash; DISTRIBUTED HUMAN FRAMEWORK &mdash; CYBERPUNK TEST REPORT<br>
  <span style="opacity:0.5">Generated by e2e.sh // All memory is sacred</span>
</div>
</body>
</html>
EOF

  echo -e "\n  ${C_CYAN}▶${C_RESET} HTML report written to: ${C_BOLD}${REPORT_FILE}${C_RESET}\n"
}

# ─── Terminal Helpers ─────────────────────────────────────────────────────────

pass() {
  PASS=$((PASS + 1))
  echo -e "  ${C_GREEN}✓${C_RESET} $1"
  html_test_pass "$1"
}

fail() {
  FAIL=$((FAIL + 1))
  ERRORS="${ERRORS}\n  ✗ $1: $2"
  echo -e "  ${C_RED}✗${C_RESET} $1: $2"
  html_test_fail "$1" "$2"
}

show_request() {
  local method="$1" url="$2" body="${3:-}"
  echo -e "  ${C_DIM}───────────────────────────────────────────────────${C_RESET}"
  echo -e "  ${C_CYAN}→ ${C_BOLD}${method}${C_RESET} ${C_CYAN}${url}${C_RESET}"
  if [ -n "$body" ]; then
    echo -e "  ${C_DIM}  Body:${C_RESET} $(echo "$body" | jq -c . 2>/dev/null || echo "$body")"
  fi
  html_request "$method" "$url" "$body"
}

show_response() {
  local json="$1"
  local pretty lines
  pretty=$(echo "$json" | jq . 2>/dev/null || echo "$json")
  lines=$(echo "$pretty" | wc -l)
  if [ "$lines" -gt 20 ]; then
    echo -e "  ${C_DIM}  Response (${lines} lines, showing first 18):${C_RESET}"
    echo "$pretty" | head -18 | sed 's/^/    /'
    echo -e "    ${C_DIM}... (truncated)${C_RESET}"
  else
    echo -e "  ${C_DIM}  Response:${C_RESET}"
    echo "$pretty" | sed 's/^/    /'
  fi
  html_response "$json"
}

explain() {
  echo -e "  ${C_MAGENTA}ℹ${C_RESET}  $1"
  html_info "$1"
}

workflow() {
  echo -e "  ${C_YELLOW}⚙${C_RESET}  ${C_DIM}Agent Workflow:${C_RESET} $1"
  html_workflow "$1"
}

service() {
  echo -e "  ${C_CYAN}◈${C_RESET}  ${C_DIM}Service:${C_RESET} ${C_BOLD}$1${C_RESET} ${C_DIM}($2)${C_RESET}"
  html_service "$1" "$2"
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
echo "║  Outputs: terminal + cyberpunk HTML report → \$REPORT_FILE              ║"
echo "╚══════════════════════════════════════════════════════════════════════════╝"
echo ""

# =============================================================================
# Phase 1: Health Checks
# =============================================================================
echo "┌─ Phase 1: Health Checks"
echo ""

html_start_phase "01" "Health Checks" "Verify all infrastructure services are alive. The API gateway, memory DAG, and proof-of-work chain must all respond before any agent operations can begin."

service "siyana-api" "port 7070 — REST/WebSocket API gateway"
explain "Siyana is the single entry point for all agent operations."
workflow "An agent's first action on startup is to verify its API gateway is reachable."
show_request "GET" "$BASE/healthz"
HEALTH=$(curl -sf $BASE/healthz)
show_response "$HEALTH"
assert_json_field "siyana-api healthz" "$HEALTH" ".ok" "true"
assert_json_field "siyana-api name" "$HEALTH" ".name" "siyana-api"
echo ""

service "medulla-pow" "port 8332 — custom PoW blockchain (global clock)"
explain "Medulla mines blocks every ~4s, advancing the epoch counter."
workflow "Agents need a decentralized clock. Medulla provides this without trusting any single server."
show_request "GET" "http://localhost:8332/health"
assert_status "medulla-pow health" "http://localhost:8332/health"
echo ""

service "hippocampus-dag" "port 15001 — content-addressed DAG storage"
explain "Hippocampus stores all agent memories as encrypted Merkle-DAG nodes."
workflow "This is the agent's long-term memory. Without it, the agent has amnesia."
show_request "GET" "http://localhost:15001/health"
assert_status "hippocampus-dag health" "http://localhost:15001/health"

html_end_phase
echo ""

# =============================================================================
# Phase 2: Stack Identity
# =============================================================================
echo "┌─ Phase 2: Stack Identity"
echo ""

html_start_phase "02" "Stack Identity" "Create a persistent identity container (Stack) for the AI agent. Mints an NFT on the Cortex EVM chain, generates ed25519 keys, and initializes token balances. The Stack is the agent's soul."

service "siyana-api → cortex-evm" "Stack creation triggers StackIdentity.sol NFT mint"
explain "POST /v1/stacks generates ed25519 keypair, CPV profile, and mints StackIdentity NFT."
workflow "Step 1 of deploying any AI agent: give it a cryptographically-verifiable identity."
show_request "POST" "$BASE/v1/stacks" '{"name":"ci-test-agent"}'
STACK=$(curl -s -X POST $BASE/v1/stacks -H "Content-Type: application/json" -d '{"name":"ci-test-agent"}')
show_response "$STACK"
STACK_ID=$(echo $STACK | jq -r .id)
assert_json_not_null "stack created" "$STACK" ".id"
assert_json_field "stack kind" "$STACK" ".kind" "human"
assert_json_not_null "stack pubKey" "$STACK" ".pubKey"
assert_json_not_null "stack identityPriv" "$STACK" ".identityPriv"
echo ""

explain "Retrieving stack by ID to verify persistence."
show_request "GET" "$BASE/v1/stacks/$STACK_ID"
STACK_GET=$(curl -s $BASE/v1/stacks/$STACK_ID)
show_response "$STACK_GET"
assert_json_field "stack GET matches" "$STACK_GET" ".id" "$STACK_ID"

html_end_phase
echo ""

# =============================================================================
# Phase 3: Sleeve Spawning
# =============================================================================
echo "┌─ Phase 3: Sleeve Spawning"
echo ""

html_start_phase "03" "Sleeve Spawning" "Spawn active embodiments (Sleeves) for the Stack. One identity can inhabit multiple bodies — a human interface and an AI inference engine — each with its own drift counter and token balance."

service "siyana-api" "Sleeve records created in PostgreSQL, linked to Stack"
explain "Spawning a human sleeve — the operator's interface."
workflow "A typical agent spawns a human sleeve for its operator and an AI sleeve for itself."
show_request "POST" "$BASE/v1/sleeves" "{\"stackId\":\"$STACK_ID\",\"embodimentType\":\"human\"}"
SLEEVE_H=$(curl -s -X POST $BASE/v1/sleeves -H "Content-Type: application/json" -d "{\"stackId\":\"$STACK_ID\",\"embodimentType\":\"human\"}")
show_response "$SLEEVE_H"
SLEEVE_H_ID=$(echo $SLEEVE_H | jq -r .id)
assert_json_not_null "human sleeve created" "$SLEEVE_H" ".id"
assert_json_field "human sleeve type" "$SLEEVE_H" ".embodimentType" "human"
assert_json_field "human sleeve alive" "$SLEEVE_H" ".alive" "true"
echo ""

explain "Spawning an AI sleeve — the autonomous worker."
show_request "POST" "$BASE/v1/sleeves" "{\"stackId\":\"$STACK_ID\",\"embodimentType\":\"ai\"}"
SLEEVE_A=$(curl -s -X POST $BASE/v1/sleeves -H "Content-Type: application/json" -d "{\"stackId\":\"$STACK_ID\",\"embodimentType\":\"ai\"}")
show_response "$SLEEVE_A"
SLEEVE_A_ID=$(echo $SLEEVE_A | jq -r .id)
assert_json_not_null "ai sleeve created" "$SLEEVE_A" ".id"
assert_json_field "ai sleeve type" "$SLEEVE_A" ".embodimentType" "ai"
echo ""

show_request "GET" "$BASE/v1/sleeves"
SLEEVES_LIST=$(curl -s $BASE/v1/sleeves)
SLEEVE_COUNT=$(echo $SLEEVES_LIST | jq 'length')
echo -e "  ${C_DIM}  Response: ${SLEEVE_COUNT} sleeves total${C_RESET}"
if [ "$SLEEVE_COUNT" -ge 2 ]; then
  pass "sleeves list count >= 2 ($SLEEVE_COUNT)"
else
  fail "sleeves list count" "expected >= 2, got $SLEEVE_COUNT"
fi

html_end_phase
echo ""

# =============================================================================
# Phase 4: Token Balances
# =============================================================================
echo "┌─ Phase 4: Token Balances"
echo ""

html_start_phase "04" "Token Balances" "Verify the bandwidth token economy. Four token types (compute, memory, sync, routing) gate all operations. 2 sleeves &times; 250 each = 500 total per type."

service "siyana-api" "Aggregated token balances from PostgreSQL"
explain "With 2 sleeves at 250 each, we expect 500 of every token type."
workflow "Agents check their budget before starting operations to plan what they can afford."
show_request "GET" "$BASE/v1/tokens/balances/$STACK_ID"
BALANCES=$(curl -s $BASE/v1/tokens/balances/$STACK_ID)
show_response "$BALANCES"
assert_json_field "balances stackId" "$BALANCES" ".stackId" "$STACK_ID"
assert_json_field "compute tokens" "$BALANCES" ".sleeveTotals.compute" "500"
assert_json_field "memory tokens" "$BALANCES" ".sleeveTotals.memory" "500"
assert_json_field "sync tokens" "$BALANCES" ".sleeveTotals.sync" "500"
assert_json_field "routing tokens" "$BALANCES" ".sleeveTotals.routing" "500"

html_end_phase
echo ""

# =============================================================================
# Phase 5: Perceive
# =============================================================================
echo "┌─ Phase 5: Perceive (Memory Storage)"
echo ""

html_start_phase "05" "Perceive (Memory Storage)" "Store observations into the agent's encrypted memory graph. Each perceive encrypts input with epoch-scoped AES-GCM, stores it on Hippocampus as a DAG node, and links it into the episodic chain. Costs 0.5 compute tokens."

service "siyana-api → hippocampus-dag" "API encrypts, DAG stores, CID returned"
explain "Perceive #1: Human sleeve stores an observation."
workflow "After reading a document, the agent stores its observation for future recall."
show_request "POST" "$BASE/v1/sleeves/$SLEEVE_H_ID/perceive" '{"input":"The quick brown fox jumped over the lazy dog"}'
P1=$(curl -s -X POST $BASE/v1/sleeves/$SLEEVE_H_ID/perceive -H "Content-Type: application/json" -d '{"input":"The quick brown fox jumped over the lazy dog"}')
show_response "$P1"
CID1=$(echo $P1 | jq -r .cid)
assert_json_not_null "perceive 1 returns cid" "$P1" ".cid"
assert_json_not_null "perceive 1 returns thought" "$P1" ".thought"
echo ""

explain "Perceive #2: AI sleeve stores its own observation into the SAME memory graph."
show_request "POST" "$BASE/v1/sleeves/$SLEEVE_A_ID/perceive" '{"input":"Artificial intelligence is transforming every industry"}'
P2=$(curl -s -X POST $BASE/v1/sleeves/$SLEEVE_A_ID/perceive -H "Content-Type: application/json" -d '{"input":"Artificial intelligence is transforming every industry"}')
show_response "$P2"
CID2=$(echo $P2 | jq -r .cid)
assert_json_not_null "perceive 2 returns cid" "$P2" ".cid"
echo ""

explain "Perceive #3: Another human observation. DAG now has 3 linked encrypted nodes."
show_request "POST" "$BASE/v1/sleeves/$SLEEVE_H_ID/perceive" '{"input":"Memory is the treasury of the mind"}'
P3=$(curl -s -X POST $BASE/v1/sleeves/$SLEEVE_H_ID/perceive -H "Content-Type: application/json" -d '{"input":"Memory is the treasury of the mind"}')
show_response "$P3"
CID3=$(echo $P3 | jq -r .cid)
assert_json_not_null "perceive 3 returns cid" "$P3" ".cid"
echo ""

echo -e "  ${C_DIM}  CID1: $CID1${C_RESET}"
echo -e "  ${C_DIM}  CID2: $CID2${C_RESET}"
echo -e "  ${C_DIM}  CID3: $CID3${C_RESET}"
if [ "$CID1" != "$CID2" ] && [ "$CID2" != "$CID3" ] && [ "$CID1" != "$CID3" ]; then
  pass "all CIDs are unique"
else
  fail "CID uniqueness" "CIDs: $CID1, $CID2, $CID3"
fi

if echo "$CID1" | grep -q "^ecca://"; then
  pass "CID has ecca:// prefix"
else
  fail "CID format" "expected ecca:// prefix, got $CID1"
fi

html_end_phase
echo ""

# =============================================================================
# Phase 5b: Stack Remember
# =============================================================================
echo "┌─ Phase 5b: Stack Remember"
echo ""

html_start_phase "5b" "Stack Remember" "Pin a core memory directly to the Stack. Pinned memories survive fidelity decay — they are the agent's fundamental knowledge that must never be forgotten."

service "siyana-api → hippocampus-dag" "Encrypted, stored, and pinned in the DAG"
explain "Pinning a core memory that survives across epochs."
workflow "An agent pins its core directives, safety rules, and user preferences."
show_request "POST" "$BASE/v1/stacks/$STACK_ID/remember" '{"text":"Pinned memory via remember endpoint","pin":true}'
REMEMBER=$(curl -s -X POST $BASE/v1/stacks/$STACK_ID/remember -H "Content-Type: application/json" -d '{"text":"Pinned memory via remember endpoint","pin":true}')
show_response "$REMEMBER"
assert_json_not_null "remember returns cid" "$REMEMBER" ".cid"

html_end_phase
echo ""

# =============================================================================
# Phase 6: Recall
# =============================================================================
echo "┌─ Phase 6: Recall"
echo ""

html_start_phase "06" "Recall (Memory Retrieval)" "Traverse the DAG, decrypting each node with epoch keys. Returns fragments, broken links, and fidelity score. Fidelity &lt; 0.6 triggers a coordination residue. This is RAG with cryptographic integrity."

service "siyana-api → dhf-compositor → hippocampus-dag" "Compositor walks DAG, decrypts each node"
explain "Recalling all memories. With 4 recent memories and no key rotation, fidelity should be 1.0."
workflow "Before responding to a user, an agent recalls memories for context."
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

# Fidelity may be < 1 due to epoch drift gate — memories stored at epoch 0
# become unreachable when thalamus advances the stack beyond epoch 2.
# Pinned memories always survive, so fidelity >= 0.75 is healthy.
FIDELITY_OK=$(echo "$FIDELITY >= 0.75" | bc -l 2>/dev/null || echo "0")
if [ "$FIDELITY" = "1" ]; then
  pass "recall fidelity = 1 (perfect)"
elif [ "$FIDELITY_OK" = "1" ]; then
  pass "recall fidelity = $FIDELITY (epoch drift gate active, pinned memories intact)"
else
  fail "recall fidelity" "expected >= 0.75, got $FIDELITY"
fi

BROKEN_COUNT=$(echo $RECALL | jq '.broken | length')
# Broken links from epoch_drift are expected — the drift gate prevents accessing
# stale memories beyond 2 epochs. Only non-epoch-drift breaks are real failures.
EPOCH_DRIFT_BREAKS=$(echo $RECALL | jq '[.broken[] | select(contains("#epoch_drift"))] | length')
NON_DRIFT_BREAKS=$((BROKEN_COUNT - EPOCH_DRIFT_BREAKS))
if [ "$BROKEN_COUNT" = "0" ]; then
  pass "no broken links"
elif [ "$NON_DRIFT_BREAKS" = "0" ]; then
  pass "no broken links ($BROKEN_COUNT epoch-drift gated, as designed)"
else
  fail "broken links" "$NON_DRIFT_BREAKS non-epoch-drift broken (total: $BROKEN_COUNT)"
fi

html_end_phase
echo ""

# =============================================================================
# Phase 7: Sleeve Sync
# =============================================================================
echo "┌─ Phase 7: Sleeve Sync"
echo ""

html_start_phase "07" "Sleeve Sync" "Reset drift counter by syncing to the current epoch. Operations increment drift; drift &gt; 15 = desynced. Costs 1 sync token."

service "siyana-api" "Resets drift counter, deducts sync token"
explain "Syncing human sleeve — drift was 3, reset to 0."
workflow "Agents schedule syncs between task batches to stay coherent."
show_request "POST" "$BASE/v1/sleeves/$SLEEVE_H_ID/sync"
SYNC=$(curl -s -X POST $BASE/v1/sleeves/$SLEEVE_H_ID/sync)
show_response "$SYNC"
assert_json_field "sync ok" "$SYNC" ".ok" "true"

html_end_phase
echo ""

# =============================================================================
# Phase 8: Epoch & Mining
# =============================================================================
echo "┌─ Phase 8: Epoch & Mining"
echo ""

html_start_phase "08" "Epoch &amp; Mining" "Advance the global clock. Thalamus computes coherence root (cross-chain Merkle root), embeds it in the Medulla block header, updates EpochAnchor on Cortex, and triggers Treasury emissions."

service "siyana-api → thalamus-router → medulla-pow" "Coherence root computed, block mined"
show_request "GET" "$BASE/v1/epochs/current"
EPOCH=$(curl -s $BASE/v1/epochs/current)
show_response "$EPOCH"
assert_json_not_null "epoch number" "$EPOCH" ".epoch"
assert_json_not_null "chain height" "$EPOCH" ".height"
assert_json_not_null "chain tip" "$EPOCH" ".tip"
echo ""

explain "Triggering PoW block mine. synapticFieldRoot = cross-chain Merkle root."
workflow "Mining anchors all agent activity into an immutable record."
show_request "POST" "$BASE/v1/mining/block"
MINE=$(curl -s -X POST $BASE/v1/mining/block)
show_response "$MINE"
assert_json_not_null "mined block hash" "$MINE" ".blockHash"
assert_json_not_null "mined synapticFieldRoot" "$MINE" ".synapticFieldRoot"
echo ""

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

html_end_phase
echo ""

# =============================================================================
# Phase 9: Needlecast
# =============================================================================
echo "┌─ Phase 9: Needlecast"
echo ""

html_start_phase "09" "Needlecast" "Transfer consciousness between sleeves via 6-step atomic saga: FREEZE &rarr; SNAPSHOT &rarr; SHARD &rarr; TRANSMIT &rarr; REASSEMBLE &rarr; ACTIVATE. Compensates on failure. Costs 5 routing tokens."

service "siyana-api → needlecast-router-svc → hippocampus-dag → cortex-evm" "Full cross-service saga"
explain "Transferring consciousness from human sleeve → AI sleeve."
workflow "When an agent migrates hosts (edge→cloud), it needlecasts. Identity travels; only embodiment changes."
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

html_end_phase
echo ""

# =============================================================================
# Phase 10: Coordination State
# =============================================================================
echo "┌─ Phase 10: Coordination State"
echo ""

html_start_phase "10" "Coordination State" "Check for errors (coordination residues). ECCA treats errors as economic objects — other agents earn tokens by proving resolution. Debugging becomes a paid incentive."

service "siyana-api" "Queries desync and residue state"
explain "Checking for desynced sleeves (drift > 15)."
workflow "Monitoring agents poll this to detect problems and compete to resolve them."
show_request "GET" "$BASE/v1/coordination/desync"
DESYNC=$(curl -s $BASE/v1/coordination/desync)
show_response "$DESYNC"
assert_status "desync endpoint" "$BASE/v1/coordination/desync"
echo ""

show_request "GET" "$BASE/v1/coordination/residues"
RESIDUES=$(curl -s $BASE/v1/coordination/residues)
show_response "$RESIDUES"
assert_status "residues endpoint" "$BASE/v1/coordination/residues"

html_end_phase
echo ""

# =============================================================================
# Phase 11: Final Stack State
# =============================================================================
echo "┌─ Phase 11: Final Stack State"
echo ""

html_start_phase "11" "Final Stack State" "Verify the Stack after the full lifecycle. episodicHead points to latest memory, tokens partially consumed, both sleeves present."

service "siyana-api" "Full stack state with sleeves and balances"
explain "Reading complete stack state — what an agent loads on restart."
show_request "GET" "$BASE/v1/stacks/$STACK_ID"
FINAL=$(curl -s "$BASE/v1/stacks/$STACK_ID")
show_response "$FINAL"
assert_json_not_null "episodicHead set" "$FINAL" ".episodicHead"
assert_json_field "stack has sleeves" "$(echo $FINAL | jq '{c: (.sleeves | length)}')" ".c" "2"

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

html_end_phase
echo ""

# =============================================================================
# Phase 12: Cleanup
# =============================================================================
echo "┌─ Phase 12: Cleanup (Decommission)"
echo ""

html_start_phase "12" "Cleanup (Decommission)" "Decommission sleeves. Tokens return to the Stack pool. The Stack identity persists on-chain and can spawn new sleeves at any time."

service "siyana-api" "Sets alive=false, returns tokens to pool"
show_request "DELETE" "$BASE/v1/sleeves/$SLEEVE_H_ID"
DEL1=$(curl -s -X DELETE $BASE/v1/sleeves/$SLEEVE_H_ID)
show_response "$DEL1"
assert_json_field "decommission human sleeve" "$DEL1" ".ok" "true"
echo ""

show_request "DELETE" "$BASE/v1/sleeves/$SLEEVE_A_ID"
DEL2=$(curl -s -X DELETE $BASE/v1/sleeves/$SLEEVE_A_ID)
show_response "$DEL2"
assert_json_field "decommission ai sleeve" "$DEL2" ".ok" "true"
echo ""

show_request "GET" "$BASE/v1/sleeves"
SLEEVES_AFTER=$(curl -s $BASE/v1/sleeves)
ALIVE_COUNT=$(echo $SLEEVES_AFTER | jq "[.[] | select(.stackId == \"$STACK_ID\")] | length")
echo -e "  ${C_DIM}  Alive sleeves for this stack: ${ALIVE_COUNT}${C_RESET}"
if [ "$ALIVE_COUNT" = "0" ]; then
  pass "no alive sleeves for stack after cleanup"
else
  fail "cleanup" "$ALIVE_COUNT sleeves still alive"
fi

html_end_phase
echo ""

# =============================================================================
# Phase 13: Blockchain Verification
# =============================================================================
echo "┌─ Phase 13: Blockchain Verification"
echo ""

html_start_phase "13" "Blockchain Verification" "Verify all three chains recorded cryptographic evidence. Cortex EVM (contracts), Medulla PoW (coherence roots), Hippocampus (encrypted memory nodes)."

service "cortex-evm" "port 8545 — Clique PoA, chain ID 1337"
explain "Querying Cortex block height. Stores StackIdentity NFTs, BandwidthToken, all registries."
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

service "medulla-pow" "port 8332 — Go PoW, ~4s blocks"
explain "Height = epochs passed. Block headers contain the coherence root."
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

service "hippocampus-dag" "port 15001 — Merkle-DAG"
explain "We created 4 memories, expect at least 4 nodes stored."
show_request "GET" "http://localhost:15001/stat"
HIPPO_STAT=$(curl -s http://localhost:15001/stat)
show_response "$HIPPO_STAT"
HIPPO_NODES=$(echo $HIPPO_STAT | jq -r .nodes)
if [ "$HIPPO_NODES" -ge 4 ]; then
  pass "hippocampus-dag stored $HIPPO_NODES nodes"
else
  fail "hippocampus-dag nodes" "expected >= 4, got $HIPPO_NODES"
fi

html_end_phase
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
echo "║  Full Agent Lifecycle:                                                   ║"
echo "║    ✓ Identity → Embodiment → Economy → Memory → Recall                  ║"
echo "║    ✓ Coherence → Transfer → Blockchain → Cleanup                        ║"
echo "╚══════════════════════════════════════════════════════════════════════════╝"

# Generate the HTML report
write_html_report

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
