#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
//  Playfair Report Generator (v2)
//  Reads playfair-results.json → produces a rich, self-contained HTML
//  report with inline SVG charts, agent cards, and an embedded
//  "what this means" explainer.
//
//  Usage:
//    node generate-playfair-report.js <results.json> [out1.html ...]
//
//  Inputs may be:
//    - the full results JSON written by tests/playfair/orchestrator.js
//    - a partial JSON containing at least { meta, summary, perEpochTimeline }
// ═══════════════════════════════════════════════════════════════════════

'use strict';

const fs = require('fs');
const path = require('path');

const [, , inputFile, ...outFiles] = process.argv;
if (!inputFile) {
  console.error('Usage: node generate-playfair-report.js <results.json> [out1.html ...]');
  process.exit(2);
}
if (!fs.existsSync(inputFile)) {
  console.error(`Input file not found: ${inputFile}`);
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const meta = data.meta || {};
const regions = data.regions || {};
const agents = data.agents || {};
const needlecasts = data.needlecasts || [];
const residues = data.residues || [];
const audits = data.audits || [];
const scenarios = data.scenarios || [];
const summary = data.summary || {};
const timeline = data.perEpochTimeline || [];
const env = data.env || {};

const REGION_COLORS = {
  storage:   { primary: '#00ff88', bg: 'rgba(0,255,136,0.06)' },
  compute:   { primary: '#00f0ff', bg: 'rgba(0,240,255,0.06)' },
  bandwidth: { primary: '#ff00e6', bg: 'rgba(255,0,230,0.06)' },
};

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function num(n, d = 0) { return Number(n || 0).toFixed(d); }

// ─── SVG: per-epoch stacked area chart ───────────────────────────────
function timelineChart(rows) {
  if (!rows.length) return '<div class="empty">No timeline data</div>';
  const W = 960, H = 220, P = { l: 40, r: 12, t: 16, b: 26 };
  const innerW = W - P.l - P.r;
  const innerH = H - P.t - P.b;
  const xMax = rows.length;
  const yMax = Math.max(1, ...rows.map(r => (r.perceptions || 0) + (r.stores || 0) + (r.routes || 0) + (r.syncs || 0)));
  const xs = (i) => P.l + (i / Math.max(1, xMax - 1)) * innerW;
  const ys = (v) => P.t + innerH - (v / yMax) * innerH;

  const series = [
    { key: 'perceptions', color: '#00ff88', label: 'perceive' },
    { key: 'stores',      color: '#00f0ff', label: 'store'    },
    { key: 'routes',      color: '#ff00e6', label: 'route'    },
    { key: 'syncs',       color: '#ffcc00', label: 'sync'     },
  ];

  // Build stacked polygons
  const stack = rows.map(() => 0);
  const polygons = series.map(s => {
    const top = rows.map((r, i) => {
      stack[i] += (r[s.key] || 0);
      return [xs(i), ys(stack[i])];
    });
    const bottom = rows.map((_, i) => [xs(i), ys(stack[i] - (rows[i][s.key] || 0))]).reverse();
    const points = [...top, ...bottom].map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
    return `<polygon points="${points}" fill="${s.color}" fill-opacity="0.55" stroke="${s.color}" stroke-width="1"/>`;
  });

  // Y-axis ticks
  const ticks = [0, Math.round(yMax / 2), yMax];
  const yTicks = ticks.map(v => `
    <line x1="${P.l}" x2="${W - P.r}" y1="${ys(v)}" y2="${ys(v)}" stroke="#1a1a2e" stroke-dasharray="2,3"/>
    <text x="${P.l - 6}" y="${ys(v) + 3}" text-anchor="end" font-size="9" fill="#5a5a6e">${v}</text>`).join('');

  // X-axis ticks (every 10 epochs)
  const xLabels = rows.filter((_, i) => i % 10 === 0 || i === rows.length - 1).map((r, _ignored, _arr) => {
    const i = rows.indexOf(r);
    return `<text x="${xs(i)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#5a5a6e">E${r.epoch}</text>`;
  }).join('');

  // Unfair markers
  const unfairMarks = rows.map((r, i) => r.fair === false
    ? `<circle cx="${xs(i)}" cy="${P.t + 4}" r="3" fill="#ff0055"/>` : '').join('');

  const legend = series.map((s, i) =>
    `<g transform="translate(${P.l + i * 90}, ${H - 4})"><rect width="10" height="10" y="-9" fill="${s.color}" fill-opacity="0.6"/><text x="14" y="0" font-size="10" fill="#c8c8d4">${s.label}</text></g>`
  ).join('');

  return `<svg viewBox="0 0 ${W} ${H + 18}" preserveAspectRatio="xMidYMid meet" class="chart">
    ${yTicks}
    ${polygons.join('\n')}
    ${unfairMarks}
    ${xLabels}
    <g transform="translate(0,${H + 14})">${legend}</g>
  </svg>`;
}

// ─── SVG: per-agent activity sparkline ───────────────────────────────
function agentSparkline(agent) {
  const hist = agent.epochHistory || [];
  if (!hist.length) return '';
  const W = 260, H = 36;
  const xMax = hist.length;
  const series = ['perceived', 'stored', 'routed', 'synced'].map((k, idx) => ({
    key: k,
    color: ['#00ff88', '#00f0ff', '#ff00e6', '#ffcc00'][idx],
  }));
  const cumulative = (key) => {
    let s = 0;
    return hist.map(h => (s += h[key] ? 1 : 0));
  };
  const yMax = Math.max(1, hist.length);
  const xs = (i) => (i / Math.max(1, xMax - 1)) * (W - 2) + 1;
  const ys = (v) => (H - 2) - (v / yMax) * (H - 4);

  const lines = series.map(s => {
    const vals = cumulative(s.key);
    const d = vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xs(i).toFixed(1)} ${ys(v).toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.4"/>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="spark">${lines}</svg>`;
}

// ─── SVG: per-region token-usage bars ────────────────────────────────
function regionTokenBars() {
  const totals = {};
  for (const [k] of Object.entries(regions)) totals[k] = { compute: 0, storage: 0, bandwidth: 0 };
  for (const a of Object.values(agents)) {
    const r = a.currentRegion;
    if (!totals[r]) continue;
    totals[r].compute   += a.tokenUsage?.compute   || 0;
    totals[r].storage   += a.tokenUsage?.storage   || 0;
    totals[r].bandwidth += a.tokenUsage?.bandwidth || 0;
  }
  const cats = ['compute', 'storage', 'bandwidth'];
  const max = Math.max(1, ...Object.values(totals).flatMap(t => cats.map(c => t[c])));
  const W = 280, H = 120, BARW = 18, GAP = 8;
  const groups = Object.entries(totals).map(([rname, t], gi) => {
    const xBase = 40 + gi * (cats.length * (BARW + GAP) + 28);
    const bars = cats.map((c, ci) => {
      const x = xBase + ci * (BARW + 4);
      const h = (t[c] / max) * (H - 30);
      const y = H - 18 - h;
      const color = c === 'compute' ? '#00f0ff' : c === 'storage' ? '#00ff88' : '#ff00e6';
      return `<rect x="${x}" y="${y}" width="${BARW}" height="${h}" fill="${color}" fill-opacity="0.7"/>`;
    }).join('');
    return `${bars}<text x="${xBase + (cats.length * (BARW + 4)) / 2}" y="${H - 4}" text-anchor="middle" font-size="9" fill="${REGION_COLORS[rname]?.primary || '#c8c8d4'}">${esc(rname)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W * 2} ${H}" preserveAspectRatio="xMidYMid meet" class="chart">
    <text x="6" y="14" font-size="10" fill="#5a5a6e">tokens</text>
    ${groups}
    <g transform="translate(${W * 2 - 200}, 8)">
      <rect width="10" height="10" fill="#00f0ff" fill-opacity="0.7"/><text x="14" y="9" font-size="10" fill="#c8c8d4">compute</text>
      <rect x="68" width="10" height="10" fill="#00ff88" fill-opacity="0.7"/><text x="82" y="9" font-size="10" fill="#c8c8d4">storage</text>
      <rect x="138" width="10" height="10" fill="#ff00e6" fill-opacity="0.7"/><text x="152" y="9" font-size="10" fill="#c8c8d4">bandwidth</text>
    </g>
  </svg>`;
}

// ─── HTML fragments ──────────────────────────────────────────────────
const allFair = !!summary.allEpochsFair;

const regionCards = Object.entries(regions).map(([key, region]) => {
  const rc = REGION_COLORS[key] || REGION_COLORS.compute;
  const here = Object.entries(agents).filter(([, a]) => a.currentRegion === key);
  return `
<div class="region-card" style="border-top: 3px solid ${rc.primary};">
  <div class="region-name" style="color:${rc.primary}">${esc(region.name || key)}</div>
  <div class="region-profile">
    <span>compute cost: <strong>${esc(region.profile?.computeCost)}</strong></span>
    <span>storage cost: <strong>${esc(region.profile?.storageCost)}</strong></span>
    <span>bandwidth cost: <strong>${esc(region.profile?.bandwidthCost)}</strong></span>
  </div>
  <div class="region-budgets">budget — C=${region.budgets?.compute} S=${region.budgets?.storage} B=${region.budgets?.bandwidth}</div>
  <div class="region-agents">${here.length} agents currently here</div>
</div>`;
}).join('');

const agentCards = Object.entries(agents).map(([name, agent]) => {
  const rc = REGION_COLORS[agent.currentRegion] || REGION_COLORS.compute;
  const migrated = agent.homeRegion !== agent.currentRegion;
  const drift = agent.finalDrift ?? 0;
  return `
<div class="agent-card" style="border-left:3px solid ${rc.primary}; background:${rc.bg};">
  <div class="agent-header">
    <span class="agent-name" style="color:${rc.primary}">${esc(name)}</span>
    <span class="agent-kind">${esc(agent.sleeveKind)}</span>
  </div>
  <div class="agent-desc">${esc(agent.description)}</div>
  ${agentSparkline(agent)}
  <div class="agent-stats">
    <div class="agent-stat"><span class="stat-n">${agent.totalPerceived || 0}</span><span class="stat-l">perceived</span></div>
    <div class="agent-stat"><span class="stat-n">${agent.totalStored || 0}</span><span class="stat-l">stored</span></div>
    <div class="agent-stat"><span class="stat-n">${agent.totalRouted || 0}</span><span class="stat-l">routed</span></div>
    <div class="agent-stat"><span class="stat-n">${agent.totalSynced || 0}</span><span class="stat-l">synced</span></div>
  </div>
  <div class="agent-tokens">
    <span class="token compute">⚡ ${num(agent.tokenUsage?.compute)}</span>
    <span class="token storage">💾 ${num(agent.tokenUsage?.storage)}</span>
    <span class="token bandwidth">📡 ${num(agent.tokenUsage?.bandwidth)}</span>
  </div>
  <div class="agent-region">
    ${migrated ? `<span class="migration">⚡ ${esc(agent.homeRegion)} → ${esc(agent.currentRegion)}</span>` : `<span>📍 ${esc(agent.currentRegion)}</span>`}
    <span class="drift ${drift > 10 ? 'high' : drift > 5 ? 'medium' : 'low'}">drift: ${drift}</span>
  </div>
  <div class="agent-cpv">CPV: [${Object.values(agent.cpv || {}).map(v => Number(v).toFixed(1)).join(', ')}]</div>
</div>`;
}).join('');

const ncLog = needlecasts.length ? needlecasts.map(nc => {
  const fc = REGION_COLORS[nc.fromRegion]?.primary || '#fff';
  const tc = REGION_COLORS[nc.toRegion]?.primary   || '#fff';
  return `<div class="log-row">
    <span class="row-epoch">E${nc.epoch}</span>
    <span class="row-name">${esc(nc.agent)}</span>
    <span style="color:${fc}">${esc(nc.fromRegion)}</span><span class="row-arrow">→</span><span style="color:${tc}">${esc(nc.toRegion)}</span>
    <span class="row-cost">${nc.cost} RTE · ${nc.shardCount} shards</span>
  </div>`;
}).join('') : '<div class="empty">No needlecasts</div>';

const scenarioLog = scenarios.length ? scenarios.map(s => `
  <div class="log-row">
    <span class="row-epoch">E${s.epoch}</span>
    <span class="row-tag">${esc(s.type)}</span>
    <span class="row-desc">${esc(s.description)}</span>
  </div>`).join('') : '<div class="empty">No scripted events</div>';

const residueLog = residues.length ? residues.map(r => `
  <div class="log-row">
    <span class="row-epoch">E${r.epoch}</span>
    <span class="row-tag">${esc(r.kind)}</span>
    <span style="color:${REGION_COLORS[r.region]?.primary || '#fff'}">${esc(r.region)}</span>
    <span class="row-desc">${r.resolved ? `resolved by ${esc(r.resolver)} (+${r.payout} RES)` : 'pending'}</span>
  </div>`).join('') : '<div class="empty">No residues</div>';

// ─── Compact runtime config panel ────────────────────────────────────
const cfg = [
  ['Cluster',          env.cluster || 'playfair'],
  ['Epochs',           meta.epochs ?? '—'],
  ['Epoch interval',   `${meta.epochIntervalMs ?? '—'} ms`],
  ['Agents',           meta.agentCount ?? '—'],
  ['Regions',          meta.regionCount ?? '—'],
  ['Latency profile',  env.latencyProfile || 'storage↔compute 33±5ms · compute↔bandwidth 42±8ms · storage↔bandwidth 75±12ms'],
  ['Started',          meta.startTime || '—'],
  ['Ended',            meta.endTime || '—'],
  ['Duration',         meta.durationMs ? `${(meta.durationMs / 1000).toFixed(1)} s` : '—'],
  ['Commit',           env.commit || '—'],
  ['Runner',           env.runner || '—'],
];
const cfgPanel = cfg.map(([k, v]) =>
  `<div class="cfg-row"><span class="cfg-k">${esc(k)}</span><span class="cfg-v">${esc(v)}</span></div>`
).join('');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ECCA // Playfair — Tripartite Game Report</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Orbitron:wght@400;700;900&display=swap');
:root {
  --bg-deep: #030308; --bg-panel: #0a0a14; --bg-card: #0f0f1a;
  --neon-cyan: #00f0ff; --neon-magenta: #ff00e6; --neon-green: #00ff88;
  --neon-red: #ff0055; --neon-yellow: #ffcc00; --neon-purple: #b347ff;
  --text: #c8c8d4; --text-dim: #5a5a6e; --border: #1a1a2e;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--bg-deep); color: var(--text); font-family: 'JetBrains Mono', monospace; font-size: 13px; line-height: 1.55; }
body::before { content: ''; position: fixed; inset: 0; background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,240,255,0.008) 2px, rgba(0,240,255,0.008) 4px); pointer-events: none; z-index: 9999; }
.header { background: linear-gradient(180deg, var(--bg-panel), var(--bg-deep)); border-bottom: 1px solid var(--neon-cyan); padding: 2.5rem 1rem 1.6rem; text-align: center; }
.header h1 { font-family: 'Orbitron', sans-serif; font-size: 2.2rem; font-weight: 900; letter-spacing: 0.3em; background: linear-gradient(135deg, var(--neon-cyan), var(--neon-magenta)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 0.4rem; }
.header .sub { font-size: 0.72rem; color: var(--text-dim); letter-spacing: 0.15em; text-transform: uppercase; }
.header .ts { margin-top: 0.5rem; font-size: 0.65rem; color: var(--neon-cyan); opacity: 0.7; }
.stats-bar { display: flex; justify-content: center; gap: 2rem; padding: 1.2rem; background: var(--bg-panel); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.stat { text-align: center; min-width: 90px; }
.stat-value { font-family: 'Orbitron', sans-serif; font-size: 1.9rem; font-weight: 700; }
.stat-value.green { color: var(--neon-green); } .stat-value.cyan { color: var(--neon-cyan); }
.stat-value.magenta { color: var(--neon-magenta); } .stat-value.yellow { color: var(--neon-yellow); }
.stat-value.purple { color: var(--neon-purple); } .stat-value.red { color: var(--neon-red); }
.stat-label { font-size: 0.55rem; text-transform: uppercase; letter-spacing: 0.2em; color: var(--text-dim); margin-top: 0.2rem; }
.content { max-width: 1080px; margin: 1.6rem auto 3rem; padding: 0 1.4rem; }
h2 { font-family: 'Orbitron', sans-serif; font-size: 0.95rem; font-weight: 700; color: var(--neon-cyan); margin: 2.2rem 0 0.8rem; letter-spacing: 0.12em; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; }
h2 .sub { font-size: 0.6rem; color: var(--text-dim); letter-spacing: 0.1em; margin-left: 0.6rem; text-transform: uppercase; }
.callout { background: var(--bg-card); border: 1px solid var(--border); border-left: 3px solid var(--neon-purple); padding: 1rem 1.2rem; margin: 0.6rem 0 1.4rem; border-radius: 4px; font-size: 0.78rem; color: var(--text); }
.callout strong { color: var(--neon-purple); }
.callout p + p { margin-top: 0.5rem; }
.region-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.8rem; margin: 0.6rem 0; }
.region-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 0.9rem; }
.region-name { font-family: 'Orbitron', sans-serif; font-size: 0.85rem; font-weight: 700; margin-bottom: 0.5rem; }
.region-profile { display: flex; flex-direction: column; gap: 0.18rem; font-size: 0.7rem; color: var(--text-dim); }
.region-profile strong { color: var(--text); }
.region-budgets { font-size: 0.7rem; color: var(--neon-yellow); margin-top: 0.4rem; }
.region-agents { font-size: 0.66rem; color: var(--text-dim); margin-top: 0.2rem; }
.agent-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0.8rem; margin: 0.6rem 0; }
.agent-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 0.9rem; }
.agent-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem; }
.agent-name { font-family: 'Orbitron', sans-serif; font-size: 0.78rem; font-weight: 700; }
.agent-kind { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-dim); background: rgba(255,255,255,0.05); padding: 0.18rem 0.45rem; border-radius: 3px; }
.agent-desc { font-size: 0.7rem; color: var(--text-dim); margin-bottom: 0.5rem; line-height: 1.5; }
.spark { display: block; width: 100%; height: 36px; margin-bottom: 0.4rem; background: rgba(0,0,0,0.25); border-radius: 3px; }
.agent-stats { display: flex; gap: 0.7rem; margin-bottom: 0.45rem; }
.agent-stat { text-align: center; }
.stat-n { display: block; font-family: 'Orbitron', sans-serif; font-size: 1.05rem; font-weight: 700; color: var(--neon-cyan); }
.stat-l { font-size: 0.5rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-dim); }
.agent-tokens { display: flex; gap: 0.4rem; margin-bottom: 0.35rem; }
.token { font-size: 0.66rem; padding: 0.18rem 0.5rem; border-radius: 3px; background: rgba(255,255,255,0.03); }
.token.compute { color: var(--neon-cyan); } .token.storage { color: var(--neon-green); } .token.bandwidth { color: var(--neon-magenta); }
.agent-region { display: flex; justify-content: space-between; font-size: 0.66rem; margin-bottom: 0.25rem; }
.migration { color: var(--neon-yellow); }
.drift.low { color: var(--neon-green); } .drift.medium { color: var(--neon-yellow); } .drift.high { color: var(--neon-red); }
.agent-cpv { font-size: 0.6rem; color: var(--text-dim); }
.chart-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 0.8rem; margin: 0.5rem 0; }
.chart { display: block; width: 100%; height: auto; max-height: 260px; }
.log-list { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 0.4rem 0.6rem; max-height: 360px; overflow: auto; }
.log-row { display: flex; gap: 0.6rem; align-items: center; padding: 0.32rem 0.4rem; border-bottom: 1px solid rgba(255,255,255,0.03); font-size: 0.7rem; flex-wrap: wrap; }
.log-row:last-child { border-bottom: none; }
.row-epoch { font-family: 'Orbitron', sans-serif; font-size: 0.6rem; color: var(--neon-magenta); min-width: 2.5rem; }
.row-name { color: var(--neon-cyan); font-weight: 700; min-width: 8rem; }
.row-arrow { color: var(--text-dim); }
.row-cost { color: var(--neon-yellow); font-size: 0.65rem; margin-left: auto; }
.row-tag { font-weight: 700; color: var(--neon-yellow); text-transform: uppercase; font-size: 0.58rem; background: rgba(255,204,0,0.08); padding: 0.1rem 0.4rem; border-radius: 3px; }
.row-desc { color: var(--text); }
.empty { color: var(--text-dim); padding: 0.6rem; text-align: center; font-size: 0.72rem; }
.cfg-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.4rem; }
.cfg-row { display: flex; justify-content: space-between; padding: 0.32rem 0.6rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 4px; font-size: 0.7rem; }
.cfg-k { color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.6rem; }
.cfg-v { color: var(--text); font-weight: 500; text-align: right; }
.result-banner { margin: 1.6rem 0 0; padding: 1.4rem; text-align: center; border-radius: 10px; border: 1px solid; background: var(--bg-card); }
.result-banner.pass { border-color: var(--neon-green); }
.result-banner.fail { border-color: var(--neon-red); }
.result-banner h2 { font-family: 'Orbitron', sans-serif; font-size: 1.15rem; border: none; padding: 0; margin: 0 0 0.3rem; letter-spacing: 0.1em; }
.result-banner.pass h2 { color: var(--neon-green); } .result-banner.fail h2 { color: var(--neon-red); }
.result-banner p { color: var(--text-dim); font-size: 0.72rem; }
.nav-links { display: flex; justify-content: center; gap: 0.6rem; padding: 0.7rem; background: var(--bg-panel); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.nav-links a { font-size: 0.62rem; color: var(--text-dim); text-decoration: none; letter-spacing: 0.1em; text-transform: uppercase; padding: 0.3rem 0.6rem; border-radius: 3px; }
.nav-links a:hover, .nav-links a.active { color: var(--neon-cyan); background: rgba(0,240,255,0.06); }
.footer { text-align: center; padding: 1.6rem; color: var(--text-dim); font-size: 0.55rem; letter-spacing: 0.15em; border-top: 1px solid var(--border); }
.toc { display: flex; gap: 0.4rem; flex-wrap: wrap; padding: 0.6rem 0; font-size: 0.65rem; color: var(--text-dim); }
.toc a { color: var(--neon-cyan); text-decoration: none; padding: 0.2rem 0.5rem; border: 1px solid var(--border); border-radius: 3px; }
.toc a:hover { background: rgba(0,240,255,0.05); }
@media (max-width: 720px) { .region-grid { grid-template-columns: 1fr; } .agent-grid { grid-template-columns: 1fr; } .stats-bar { gap: 1rem; } .stat-value { font-size: 1.4rem; } }
</style>
</head>
<body>
<div class="header">
  <h1>PLAYFAIR</h1>
  <div class="sub">Tripartite Game · 3-Region Asynchronous Agent Test</div>
  <div class="ts">${esc(meta.startTime || '')}${meta.durationMs ? ' &middot; ' + (meta.durationMs / 1000).toFixed(0) + 's runtime' : ''}</div>
</div>
<div class="stats-bar">
  <div class="stat"><div class="stat-value green">${summary.totalPerceptions ?? 0}</div><div class="stat-label">Perceptions</div></div>
  <div class="stat"><div class="stat-value cyan">${summary.totalStores ?? 0}</div><div class="stat-label">Stored</div></div>
  <div class="stat"><div class="stat-value magenta">${summary.totalRoutes ?? 0}</div><div class="stat-label">Routes</div></div>
  <div class="stat"><div class="stat-value yellow">${summary.regionMigrations ?? 0}</div><div class="stat-label">Migrations</div></div>
  <div class="stat"><div class="stat-value purple">${meta.epochs ?? 0}</div><div class="stat-label">Epochs</div></div>
  <div class="stat"><div class="stat-value ${allFair ? 'green' : 'red'}">${allFair ? 'FAIR' : 'UNFAIR'}</div><div class="stat-label">Verdict</div></div>
</div>
<div class="nav-links">
  <a href="index.html">Docs</a>
  <a href="playfair.html">Playfair Guide</a>
  <a href="playfair-report.html" class="active">This Report</a>
  <a href="e2e-report.html">E2E</a>
  <a href="changelog.html">Changelog</a>
</div>
<div class="content">

<div class="toc">
  <a href="#what">What is this?</a>
  <a href="#config">Runtime config</a>
  <a href="#regions">Regions</a>
  <a href="#timeline">Timeline</a>
  <a href="#tokens">Tokens</a>
  <a href="#agents">Agents</a>
  <a href="#scenarios">Scenarios</a>
  <a href="#needlecasts">Needlecasts</a>
  <a href="#residues">Residues</a>
  <a href="#interpret">How to read</a>
</div>

<h2 id="what">WHAT IS THIS? <span class="sub">why we run it</span></h2>
<div class="callout">
  <p><strong>Playfair</strong> is a 50-epoch, 3-region, 6-agent tripartite-game test. Each region has a different
  cost profile (storage cheap, compute cheap, bandwidth cheap respectively), and agents are assigned a home region
  whose profile matches their workload.</p>
  <p>The orchestrator drives realistic activity (perceives, stores, routes, syncs) and scripts dramatic events
  (spot preemption, drift spike, residue injection) to force cross-region needlecasts. After each epoch the
  TripartiteGame contract is audited via <code>verifyAllocationFair()</code>. The test passes only if
  <strong>every epoch</strong> stays within its per-region budgets.</p>
  <p>This is the closest thing in the repo to a system-level integration test: it exercises the full stack —
  the EVM (cortex), the DAG (hippocampus), PoW (medulla), the API (siyana), the router (thalamus), the bus (NATS),
  the registry (Postgres), and the cross-region latency profile injected with <code>tc netem</code>.</p>
</div>

<h2 id="config">RUNTIME CONFIG <span class="sub">reproducibility</span></h2>
<div class="cfg-grid">${cfgPanel}</div>

<h2 id="regions">REGIONS <span class="sub">cost profiles & budgets</span></h2>
<div class="region-grid">${regionCards}</div>

<h2 id="timeline">EPOCH TIMELINE <span class="sub">activity per epoch · red dots = unfair</span></h2>
<div class="chart-card">${timelineChart(timeline)}</div>

<h2 id="tokens">TOKEN USAGE BY REGION <span class="sub">where each region's budget went</span></h2>
<div class="chart-card">${regionTokenBars()}</div>

<h2 id="agents">AGENTS <span class="sub">cumulative perceived/stored/routed/synced</span></h2>
<div class="agent-grid">${agentCards}</div>

<h2 id="scenarios">SCENARIO EVENTS <span class="sub">scripted at fixed epochs</span></h2>
<div class="log-list">${scenarioLog}</div>

<h2 id="needlecasts">NEEDLECASTS <span class="sub">cross-region migrations</span></h2>
<div class="log-list">${ncLog}</div>

<h2 id="residues">RESIDUES <span class="sub">drift / shard-loss / reorg events</span></h2>
<div class="log-list">${residueLog}</div>

<h2 id="interpret">HOW TO READ <span class="sub">what the numbers mean</span></h2>
<div class="callout">
  <p><strong>Verdict — FAIR / UNFAIR.</strong> If any single epoch's activity violates a region's per-epoch token
  budget the verdict flips to UNFAIR. A fair run means the protocol's allocation accounting matches reality.</p>
  <p><strong>Migrations.</strong> Each entry in the needlecast log is a real cross-region move: the agent's
  sleeve is decommissioned in the source region, shards are paid for, and a new sleeve is spawned in the
  destination. Higher migration counts mean the cost arbitrage between regions is large enough to be worth paying for.</p>
  <p><strong>Drift.</strong> Drift accumulates when an agent perceives faster than it syncs. High final drift in
  the agent cards is fine in isolation but should be roughly correlated with sync activity — an agent with high
  drift and zero syncs would be a bug in the sync loop.</p>
  <p><strong>Sparklines.</strong> Each agent card has a 4-line sparkline showing its cumulative
  perceives/stores/routes/syncs over the run. Steeper lines = higher activity. A line that flatlines mid-run
  usually means the agent's sleeve was decommissioned (e.g. spot preemption).</p>
  <p><strong>Conditions vary.</strong> The same scenario script under a different latency profile (set via
  <code>terraform apply -var latency_storage_compute_ms=80</code>) will shift the timing of needlecasts and the
  shape of the timeline; under different per-region budgets it can flip the verdict. The <em>structure</em> of
  the test is deterministic; the <em>content</em> is randomised within agent perceive/store/route rates.</p>
</div>

<div class="result-banner ${allFair ? 'pass' : 'fail'}">
  <h2>${allFair ? 'ALL EPOCHS VERIFIED FAIR' : 'ALLOCATION VIOLATIONS DETECTED'}</h2>
  <p>${meta.agentCount ?? '?'} agents across ${meta.regionCount ?? '?'} regions over ${meta.epochs ?? '?'} epochs &mdash;
  ${summary.totalPerceptions ?? 0} perceptions, ${summary.regionMigrations ?? 0} cross-region migrations,
  ${summary.totalResidues ?? 0} residues (${summary.residuesResolved ?? 0} resolved)${summary.unfairEpochs && summary.unfairEpochs.length ? ` &middot; unfair epochs: ${summary.unfairEpochs.join(', ')}` : ''}.</p>
</div>
</div>
<div class="footer">ECCA STACK &mdash; PLAYFAIR REPORT &mdash; GENERATED ${new Date().toISOString()}</div>
</body>
</html>`;

const outputs = outFiles.length ? outFiles : [inputFile.replace(/\.json$/, '.html')];
for (const out of outputs) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`  Generated: ${out}`);
}
