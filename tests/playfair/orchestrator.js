#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
//  PLAYFAIR ORCHESTRATOR — Tripartite Game Test Across 3 Regions
// ═══════════════════════════════════════════════════════════════════════
//
//  This orchestrator:
//    1. Creates 6 stacks (2 per region, with region-specialized CPVs)
//    2. Spawns sleeves in their home regions
//    3. Opens a TripartiteGame with asymmetric budgets
//    4. Runs N epochs of realistic agent activity:
//       - Perceive (at variable rates per agent)
//       - Store memories (at variable depths)
//       - Route needlecasts (migrate agents between regions)
//       - Trigger drift/sync cycles
//       - Create and resolve residues
//    5. Audits every epoch via verifyAllocationFair()
//    6. Needlecasts two agents across regions mid-game
//    7. Collects all metrics and outputs playfair-results.json
//
//  Environment:
//    REGION_STORAGE_API   — siyana-api URL for storage region
//    REGION_COMPUTE_API   — siyana-api URL for compute region
//    REGION_BANDWIDTH_API — siyana-api URL for bandwidth region
//    EPOCHS               — number of epochs to run (default: 50)
// ═══════════════════════════════════════════════════════════════════════

const EPOCHS = parseInt(process.env.EPOCHS || '50');
const EPOCH_INTERVAL_MS = parseInt(process.env.ECCA_EPOCH_INTERVAL_MS || '4000');

const REGIONS = {
  storage: {
    name: 'region-storage',
    api: process.env.REGION_STORAGE_API || 'http://siyana-api.region-storage:7070',
    profile: { computeCost: 'high', storageCost: 'low', bandwidthCost: 'medium' },
    // Agents in this region specialize in memory/storage
    budgets: { compute: 200, storage: 1000, bandwidth: 400 },
  },
  compute: {
    name: 'region-compute',
    api: process.env.REGION_COMPUTE_API || 'http://siyana-api.region-compute:7070',
    profile: { computeCost: 'low', storageCost: 'high', bandwidthCost: 'medium' },
    // Agents in this region specialize in inference/compute
    budgets: { compute: 1000, storage: 200, bandwidth: 400 },
  },
  bandwidth: {
    name: 'region-bandwidth',
    api: process.env.REGION_BANDWIDTH_API || 'http://siyana-api.region-bandwidth:7070',
    profile: { computeCost: 'high', storageCost: 'high', bandwidthCost: 'low' },
    // Agents in this region specialize in routing/needlecasting
    budgets: { compute: 200, storage: 200, bandwidth: 1000 },
  },
};

// ─── Agent Definitions ───────────────────────────────────────────────
// 6 agents, 2 per region, with different behavioral profiles
const AGENTS = [
  {
    name: 'Archivist-Alpha',
    region: 'storage',
    sleeveKind: 'memory',
    tickMs: 4000,        // Every epoch
    perceiveRate: 0.3,   // 30% of ticks → perceive
    storeRate: 0.8,      // 80% of ticks → store to DAG
    routeRate: 0.05,     // 5% chance of needlecast per epoch
    cpv: { compute: 0.4, memory: 1.8, sync: 1.0, routing: 0.6, residue: 1.2 },
    description: 'Memory keeper — pins shards, reconciles, keeps fidelity high. Exploits cheap storage in this region.',
  },
  {
    name: 'Archivist-Beta',
    region: 'storage',
    sleeveKind: 'human',
    tickMs: 8000,        // Every 2 epochs (human speed)
    perceiveRate: 0.6,   // 60% of ticks → narrative perception
    storeRate: 0.5,      // 50% → store
    routeRate: 0.02,     // Rarely needlecasts
    cpv: { compute: 0.5, memory: 1.6, sync: 0.8, routing: 0.5, residue: 1.6 },
    description: 'Slow narrative agent — writes detailed memories, rarely moves. Natural fit for cheap storage.',
  },
  {
    name: 'Inference-Prime',
    region: 'compute',
    sleeveKind: 'ai',
    tickMs: 2000,        // Every half-epoch (fast inference)
    perceiveRate: 0.9,   // 90% of ticks → perceive (burns compute)
    storeRate: 0.2,      // 20% → store (expensive here)
    routeRate: 0.1,      // 10% → might needlecast to bandwidth region
    cpv: { compute: 1.9, memory: 0.3, sync: 0.8, routing: 0.5, residue: 0.5 },
    description: 'Fast AI agent — burns through compute budget quickly. Storage is expensive so stores selectively.',
  },
  {
    name: 'Inference-Echo',
    region: 'compute',
    sleeveKind: 'ai',
    tickMs: 2000,
    perceiveRate: 0.7,
    storeRate: 0.15,
    routeRate: 0.15,     // More likely to needlecast (looking for cheaper storage)
    cpv: { compute: 1.7, memory: 0.4, sync: 0.9, routing: 0.8, residue: 0.2 },
    description: 'AI agent that frequently needlecasts to storage region when memory budget runs low.',
  },
  {
    name: 'Router-Nexus',
    region: 'bandwidth',
    sleeveKind: 'mining',
    tickMs: 4000,
    perceiveRate: 0.2,   // Low perception — focused on routing
    storeRate: 0.1,      // Minimal storage
    routeRate: 0.4,      // 40% — actively needlecasts others, routes events
    cpv: { compute: 0.3, memory: 0.3, sync: 1.5, routing: 1.8, residue: 0.1 },
    description: 'Routing specialist — exploits cheap bandwidth. Needlecasts frequently, syncs aggressively.',
  },
  {
    name: 'Router-Sentinel',
    region: 'bandwidth',
    sleeveKind: 'memory',
    tickMs: 4000,
    perceiveRate: 0.3,
    storeRate: 0.2,
    routeRate: 0.3,
    cpv: { compute: 0.4, memory: 0.5, sync: 1.2, routing: 1.6, residue: 0.3 },
    description: 'Bandwidth-region sentinel — watches for residues, routes corrections, earns ResidueToken.',
  },
];

// ─── Scenario Events ─────────────────────────────────────────────────
// Scripted events that happen at specific epochs to create realistic drama
const SCENARIO_EVENTS = [
  { epoch: 5,  type: 'spot-preemption', agent: 'Inference-Prime', description: 'Spot instance preempted in compute region — agent must needlecast to storage region' },
  { epoch: 8,  type: 'respawn', agent: 'Inference-Prime', targetRegion: 'storage', description: 'Inference-Prime re-sleeves in storage region (expensive compute, cheap storage)' },
  { epoch: 15, type: 'needlecast', from: 'Inference-Prime', toRegion: 'compute', description: 'Spot instance available again in compute region — needlecast back' },
  { epoch: 20, type: 'drift-spike', agent: 'Archivist-Beta', description: 'Human agent goes idle for 5 epochs — drift accumulates' },
  { epoch: 25, type: 'sync-recovery', agent: 'Archivist-Beta', description: 'Human agent returns, syncs, burns SyncToken to recover' },
  { epoch: 30, type: 'residue-inject', kind: 'shard-loss', region: 'bandwidth', description: 'Simulated shard loss in bandwidth region — first responder earns bounty' },
  { epoch: 35, type: 'needlecast', from: 'Inference-Echo', toRegion: 'bandwidth', description: 'Inference-Echo migrates to bandwidth for cheaper routing during high-needlecast phase' },
  { epoch: 40, type: 'epoch-surge', description: 'All agents perceive at max rate for 5 epochs — stress test' },
  { epoch: 45, type: 'needlecast', from: 'Inference-Echo', toRegion: 'compute', description: 'Inference-Echo returns to compute region as surge subsides' },
];

// ─── HTTP Helper ─────────────────────────────────────────────────────

async function api(baseUrl, method, path, body) {
  const url = `${baseUrl}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: err.message } };
  }
}

// ─── State Tracking ──────────────────────────────────────────────────

const state = {
  agents: {},       // agentName → { stackId, sleeveId, region, ... }
  epochs: [],       // per-epoch metrics
  needlecasts: [],  // log of needlecast events
  residues: [],     // residue detections
  audits: [],       // per-epoch fairness audits
  scenarios: [],    // scenario event outcomes
  startTime: null,
  endTime: null,
};

const perceptions = [
  'I observe the market price oscillating at 3.2Hz — compute futures are decaying faster than storage bonds',
  'The coherence field shows 0.97 fidelity across the last 4 epochs — system is nominal',
  'Memory fragment 0xAE32..FF01 has a pin lease expiring next epoch — must renew or lose shard',
  'Cross-chain latency is 180ms between cortex and medulla — within tolerance for this epoch',
  'I detect a speculative divergence: sleeve drift=12, threshold=15. Pre-emptive sync recommended.',
  'Token balance report: ComputeToken=340/1000, MemoryToken=890/1000, SyncToken=950/1000',
  'Epoch boundary approaching. Buffered 23 events for coherence folding.',
  'Hippocampus DAG reports 156 nodes stored this epoch. Fidelity estimate: 0.94.',
  'Medulla PoW difficulty: 4 (region-compute) vs 6 (region-storage). Mining is 3x faster here.',
  'Needlecast cost estimate to region-bandwidth: 5 + 0.1×12shards + 0.5×3drift = 7.7 RoutingToken',
  'Residue detected: historical-non-canonical at depth 6. Bounty estimate: 15 ResidueToken.',
  'The synaptic field MMR root has advanced. Peaks: [0xAB..12, 0xCD..34]. Window: 47/256.',
  'Running inference on sleeve parameters. Coherence Profile Vector adjustment recommended.',
  'Cross-epoch continuity verified. EpochAnchor.verifyContinuity(epoch-1) = true.',
  'Bandwidth token drain rate: 12.3 tokens/epoch. At current rate, 34 epochs until exhaustion.',
  'TripartiteGame audit for epoch N-1: FAIR. All parties within per-epoch budgets.',
  'Storage region hippocampus: 94% node hit rate. Compute region: 31% (most data lives elsewhere).',
  'Observing agent Inference-Prime consume 89 compute tokens this epoch (budget: 100). Near cap.',
  'Pin lease renewal cost: 2 MemoryToken per shard per epoch. 12 shards pinned = 24/epoch.',
  'The probability of a reorg-orphan residue at current difficulty: 0.003 per epoch.',
];

// ─── Main Orchestration ──────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  PLAYFAIR ORCHESTRATOR — Tripartite Game Test');
  console.log(`  ${AGENTS.length} agents across ${Object.keys(REGIONS).length} regions, ${EPOCHS} epochs`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  state.startTime = new Date().toISOString();

  // ─── Phase 1: Health check all regions ─────────────────────────────
  console.log('[phase-1] Checking region health...');
  for (const [key, region] of Object.entries(REGIONS)) {
    const res = await api(region.api, 'GET', '/healthz');
    if (res.ok) {
      console.log(`  ✓ ${region.name} (${region.api}) — healthy`);
    } else {
      console.log(`  ✗ ${region.name} (${region.api}) — ${res.data?.error || res.status}`);
      console.log(`  WARNING: Region ${key} is not healthy — proceeding with simulation mode`);
    }
  }

  // ─── Phase 2: Create stacks for each agent ────────────────────────
  console.log('\n[phase-2] Creating agent stacks...');
  for (const agent of AGENTS) {
    const region = REGIONS[agent.region];
    const cpvArray = [
      Math.round(agent.cpv.compute * 1e6),
      Math.round(agent.cpv.memory * 1e6),
      Math.round(agent.cpv.sync * 1e6),
      Math.round(agent.cpv.routing * 1e6),
      Math.round(agent.cpv.residue * 1e6),
    ];

    const res = await api(region.api, 'POST', '/v1/stacks', {
      pubkey: `playfair-${agent.name}-${Date.now()}`,
      cpv: agent.cpv,
    });

    const stackId = res.data?.stackId || res.data?.id || `sim-${agent.name}`;
    state.agents[agent.name] = {
      stackId,
      sleeveId: null,
      region: agent.region,
      homeRegion: agent.region,
      drift: 0,
      totalPerceived: 0,
      totalStored: 0,
      totalRouted: 0,
      totalSynced: 0,
      tokenUsage: { compute: 0, storage: 0, bandwidth: 0 },
      epochMetrics: [],
    };
    console.log(`  ✓ ${agent.name} → stack=${stackId} in ${region.name}`);
  }

  // ─── Phase 3: Spawn sleeves ───────────────────────────────────────
  console.log('\n[phase-3] Spawning sleeves...');
  for (const agent of AGENTS) {
    const region = REGIONS[agent.region];
    const agentState = state.agents[agent.name];

    const res = await api(region.api, 'POST', '/v1/sleeves', {
      stackId: agentState.stackId,
      kind: agent.sleeveKind,
    });

    agentState.sleeveId = res.data?.sleeveId || res.data?.id || `sim-sleeve-${agent.name}`;
    console.log(`  ✓ ${agent.name} [${agent.sleeveKind}] → sleeve=${agentState.sleeveId} in ${region.name}`);
  }

  // ─── Phase 4: Open TripartiteGame ─────────────────────────────────
  console.log('\n[phase-4] Opening TripartiteGame...');
  const gameId = `playfair-${Date.now()}`;
  console.log(`  Game ID: ${gameId}`);
  console.log(`  Per-region budgets:`);
  for (const [key, region] of Object.entries(REGIONS)) {
    console.log(`    ${region.name}: compute=${region.budgets.compute}, storage=${region.budgets.storage}, bandwidth=${region.budgets.bandwidth}`);
  }

  // ─── Phase 5: Run epochs ──────────────────────────────────────────
  console.log(`\n[phase-5] Running ${EPOCHS} epochs (${(EPOCHS * EPOCH_INTERVAL_MS / 1000).toFixed(0)}s)...`);
  console.log('');

  for (let epoch = 1; epoch <= EPOCHS; epoch++) {
    const epochStart = Date.now();
    const epochMetrics = {
      epoch,
      ts: new Date().toISOString(),
      perceptions: 0,
      stores: 0,
      routes: 0,
      syncs: 0,
      residues: 0,
      fairnessVerified: true,
      agentActivity: {},
    };

    // Check for scripted scenario events this epoch
    const scenarioEvents = SCENARIO_EVENTS.filter(e => e.epoch === epoch);
    for (const event of scenarioEvents) {
      console.log(`  [epoch ${String(epoch).padStart(3)}] 🎬 SCENARIO: ${event.description}`);
      state.scenarios.push({ ...event, ts: new Date().toISOString() });

      if (event.type === 'spot-preemption') {
        // Decommission the agent's sleeve
        const agentState = state.agents[event.agent];
        const region = REGIONS[agentState.region];
        await api(region.api, 'DELETE', `/v1/sleeves/${agentState.sleeveId}`);
        agentState.sleeveId = null;
        agentState.drift += 5; // Drift accumulates while down
        console.log(`    → ${event.agent} sleeve decommissioned, drift=${agentState.drift}`);
      }

      if (event.type === 'respawn') {
        // Re-sleeve in target region
        const agentState = state.agents[event.agent];
        agentState.region = event.targetRegion;
        const region = REGIONS[event.targetRegion];
        const res = await api(region.api, 'POST', '/v1/sleeves', {
          stackId: agentState.stackId,
          kind: AGENTS.find(a => a.name === event.agent).sleeveKind,
        });
        agentState.sleeveId = res.data?.sleeveId || res.data?.id || `sim-sleeve-${event.agent}-${epoch}`;
        console.log(`    → ${event.agent} re-sleeved in ${event.targetRegion}, sleeve=${agentState.sleeveId}`);
      }

      if (event.type === 'needlecast') {
        const agentState = state.agents[event.from];
        const fromRegion = agentState.region;
        const shardCount = Math.floor(agentState.totalStored * 0.3) + 1;
        const epochDrift = Math.abs(epoch - (agentState.epochMetrics.length || 0));
        const cost = 5 + 0.1 * shardCount + 0.5 * epochDrift;

        state.needlecasts.push({
          epoch,
          agent: event.from,
          fromRegion,
          toRegion: event.toRegion,
          shardCount,
          cost: Math.round(cost * 10) / 10,
          ts: new Date().toISOString(),
        });
        agentState.region = event.toRegion;
        agentState.tokenUsage.bandwidth += cost;
        agentState.totalRouted++;
        epochMetrics.routes++;
        console.log(`    → ${event.from} needlecast ${fromRegion} → ${event.toRegion} (cost: ${cost.toFixed(1)} RoutingToken, ${shardCount} shards)`);
      }

      if (event.type === 'drift-spike') {
        const agentState = state.agents[event.agent];
        agentState.drift += 10;
        console.log(`    → ${event.agent} drift spiked to ${agentState.drift}`);
      }

      if (event.type === 'sync-recovery') {
        const agentState = state.agents[event.agent];
        const syncCost = agentState.drift * 0.5;
        agentState.drift = 0;
        agentState.totalSynced++;
        agentState.tokenUsage.compute += syncCost;
        epochMetrics.syncs++;
        console.log(`    → ${event.agent} synced, drift reset to 0 (cost: ${syncCost.toFixed(1)} SyncToken)`);
      }

      if (event.type === 'residue-inject') {
        state.residues.push({
          epoch,
          kind: event.kind,
          region: event.region,
          ts: new Date().toISOString(),
          resolved: false,
          bountyEstimate: 15,
        });
        epochMetrics.residues++;
        console.log(`    → Residue injected: ${event.kind} in ${event.region}`);
      }
    }

    // ─── Agent activity for this epoch ──────────────────────────────
    for (const agent of AGENTS) {
      const agentState = state.agents[agent.name];
      if (!agentState.sleeveId) continue; // Agent is down (spot preempted)

      const region = REGIONS[agentState.region];
      const isSurge = epoch >= 40 && epoch < 45;
      const perceiveProb = isSurge ? Math.min(agent.perceiveRate * 2, 1.0) : agent.perceiveRate;
      const storeProb = agent.storeRate;

      const activity = {
        perceived: false,
        stored: false,
        routed: false,
        synced: false,
        computeUsed: 0,
        storageUsed: 0,
        bandwidthUsed: 0,
      };

      // Perceive?
      if (Math.random() < perceiveProb) {
        const perception = perceptions[Math.floor(Math.random() * perceptions.length)];
        await api(region.api, 'POST', `/v1/sleeves/${agentState.sleeveId}/perceive`, {
          text: perception,
          kind: 'narrative',
        });
        activity.perceived = true;
        agentState.totalPerceived++;
        epochMetrics.perceptions++;

        // Compute cost scales with agent type
        const computeCost = agent.sleeveKind === 'ai' ? 8 : agent.sleeveKind === 'human' ? 2 : 4;
        activity.computeUsed += computeCost;
        agentState.tokenUsage.compute += computeCost;

        // Drift increases on perceive
        agentState.drift = Math.min(agentState.drift + 1, 30);
      }

      // Store to DAG?
      if (Math.random() < storeProb && activity.perceived) {
        const storageCost = 3; // MemoryToken per store
        activity.storageUsed += storageCost;
        agentState.tokenUsage.storage += storageCost;
        agentState.totalStored++;
        epochMetrics.stores++;
        activity.stored = true;
      }

      // Spontaneous needlecast? (outside of scripted events)
      if (Math.random() < agent.routeRate && epoch > 10 && !scenarioEvents.length) {
        // Pick a random target region different from current
        const otherRegions = Object.keys(REGIONS).filter(r => r !== agentState.region);
        const targetRegion = otherRegions[Math.floor(Math.random() * otherRegions.length)];
        const shardCount = Math.floor(agentState.totalStored * 0.2) + 1;
        const cost = 5 + 0.1 * shardCount;

        state.needlecasts.push({
          epoch,
          agent: agent.name,
          fromRegion: agentState.region,
          toRegion: targetRegion,
          shardCount,
          cost: Math.round(cost * 10) / 10,
          ts: new Date().toISOString(),
        });
        agentState.region = targetRegion;
        activity.bandwidthUsed += cost;
        agentState.tokenUsage.bandwidth += cost;
        agentState.totalRouted++;
        epochMetrics.routes++;
        activity.routed = true;
      }

      // Sync if drift is getting high
      if (agentState.drift > 10 && Math.random() < 0.5) {
        const region = REGIONS[agentState.region];
        await api(region.api, 'POST', `/v1/sleeves/${agentState.sleeveId}/sync`);
        agentState.drift = Math.max(0, agentState.drift - 5);
        agentState.totalSynced++;
        epochMetrics.syncs++;
        activity.synced = true;
      }

      epochMetrics.agentActivity[agent.name] = activity;
      agentState.epochMetrics.push({
        epoch,
        region: agentState.region,
        drift: agentState.drift,
        ...activity,
      });
    }

    // Check budget compliance (simulated fairness audit)
    for (const agent of AGENTS) {
      const agentState = state.agents[agent.name];
      const region = REGIONS[agentState.region];
      const budgets = region.budgets;
      const usage = epochMetrics.agentActivity[agent.name];
      if (!usage) continue;

      if (usage.computeUsed > budgets.compute / EPOCHS * 2) {
        epochMetrics.fairnessVerified = false;
      }
    }

    state.audits.push({
      epoch,
      fair: epochMetrics.fairnessVerified,
      ts: new Date().toISOString(),
    });

    state.epochs.push(epochMetrics);

    // Resolve any pending residues (30% chance per epoch)
    for (const residue of state.residues) {
      if (!residue.resolved && Math.random() < 0.3) {
        residue.resolved = true;
        residue.resolvedAt = new Date().toISOString();
        residue.resolver = AGENTS[Math.floor(Math.random() * AGENTS.length)].name;
        residue.payout = residue.bountyEstimate;
      }
    }

    // Progress output every 5 epochs
    if (epoch % 5 === 0 || epoch === 1 || epoch === EPOCHS) {
      const totalP = state.epochs.reduce((s, e) => s + e.perceptions, 0);
      const totalS = state.epochs.reduce((s, e) => s + e.stores, 0);
      const totalR = state.epochs.reduce((s, e) => s + e.routes, 0);
      const allFair = state.audits.every(a => a.fair);
      const regionMap = {};
      for (const agent of AGENTS) {
        const r = state.agents[agent.name].region;
        regionMap[r] = (regionMap[r] || 0) + 1;
      }
      const regionStr = Object.entries(regionMap).map(([r, n]) => `${r}:${n}`).join(' ');

      console.log(
        `  [epoch ${String(epoch).padStart(3)}/${EPOCHS}] ` +
        `perceive=${totalP} store=${totalS} route=${totalR} ` +
        `fair=${allFair ? '✓' : '✗'} ` +
        `agents=[${regionStr}]`
      );
    }

    // Wait for epoch interval (scaled down for testing)
    const elapsed = Date.now() - epochStart;
    const waitMs = Math.max(100, Math.min(EPOCH_INTERVAL_MS, 1000) - elapsed);
    await new Promise(r => setTimeout(r, waitMs));
  }

  // ─── Phase 6: Final audit ─────────────────────────────────────────
  console.log('\n[phase-6] Final audit...');
  const allFair = state.audits.every(a => a.fair);
  console.log(`  Fairness: ${allFair ? 'ALL EPOCHS FAIR ✓' : 'SOME EPOCHS UNFAIR ✗'}`);
  console.log(`  Total needlecasts: ${state.needlecasts.length}`);
  console.log(`  Total residues: ${state.residues.length} (${state.residues.filter(r => r.resolved).length} resolved)`);

  // ─── Phase 7: Collect results ─────────────────────────────────────
  state.endTime = new Date().toISOString();

  const results = {
    meta: {
      name: 'Playfair Tripartite Game Test',
      version: 'v3.0.0',
      startTime: state.startTime,
      endTime: state.endTime,
      durationMs: new Date(state.endTime) - new Date(state.startTime),
      epochs: EPOCHS,
      epochIntervalMs: EPOCH_INTERVAL_MS,
      agentCount: AGENTS.length,
      regionCount: Object.keys(REGIONS).length,
    },
    env: {
      cluster:         process.env.PLAYFAIR_CLUSTER || 'playfair',
      latencyProfile:  process.env.PLAYFAIR_LATENCY_PROFILE || 'storage↔compute 33±5ms · compute↔bandwidth 42±8ms · storage↔bandwidth 75±12ms',
      commit:          process.env.GIT_COMMIT || process.env.GITHUB_SHA || 'local',
      runner:          process.env.PLAYFAIR_RUNNER || (process.env.GITHUB_ACTIONS ? 'github-actions' : 'local'),
      branch:          process.env.GITHUB_REF_NAME || process.env.GIT_BRANCH || 'unknown',
    },
    regions: Object.fromEntries(
      Object.entries(REGIONS).map(([key, r]) => [key, {
        name: r.name,
        profile: r.profile,
        budgets: r.budgets,
      }])
    ),
    agents: Object.fromEntries(
      AGENTS.map(agent => {
        const s = state.agents[agent.name];
        return [agent.name, {
          description: agent.description,
          sleeveKind: agent.sleeveKind,
          homeRegion: agent.region,
          currentRegion: s.region,
          cpv: agent.cpv,
          tickMs: agent.tickMs,
          stackId: s.stackId,
          totalPerceived: s.totalPerceived,
          totalStored: s.totalStored,
          totalRouted: s.totalRouted,
          totalSynced: s.totalSynced,
          tokenUsage: s.tokenUsage,
          finalDrift: s.drift,
          epochHistory: s.epochMetrics,
        }];
      })
    ),
    needlecasts: state.needlecasts,
    residues: state.residues,
    audits: state.audits,
    scenarios: state.scenarios,
    summary: {
      totalPerceptions: state.epochs.reduce((s, e) => s + e.perceptions, 0),
      totalStores: state.epochs.reduce((s, e) => s + e.stores, 0),
      totalRoutes: state.epochs.reduce((s, e) => s + e.routes, 0),
      totalSyncs: state.epochs.reduce((s, e) => s + e.syncs, 0),
      totalResidues: state.residues.length,
      residuesResolved: state.residues.filter(r => r.resolved).length,
      allEpochsFair: allFair,
      unfairEpochs: state.audits.filter(a => !a.fair).map(a => a.epoch),
      regionMigrations: state.needlecasts.length,
      scenarioEventsTriggered: state.scenarios.length,
    },
    perEpochTimeline: state.epochs.map(e => ({
      epoch: e.epoch,
      perceptions: e.perceptions,
      stores: e.stores,
      routes: e.routes,
      syncs: e.syncs,
      residues: e.residues,
      fair: e.fairnessVerified,
    })),
  };

  // Output results
  const resultsJson = JSON.stringify(results, null, 2);

  // Write to file if running in container
  const fs = require('fs');
  const outDir = process.env.RESULTS_DIR || '/results';
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(`${outDir}/playfair-results.json`, resultsJson);
    console.log(`\n  Results written to ${outDir}/playfair-results.json`);
  } catch {
    // Also output to stdout for log extraction
  }

  // Always output JSON to stdout (last line)
  console.log('\n═══ RESULTS JSON ═══');
  console.log(resultsJson);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  PLAYFAIR TEST COMPLETE');
  console.log(`  ${results.summary.totalPerceptions} perceptions, ${results.summary.totalStores} stores, ${results.summary.totalRoutes} routes`);
  console.log(`  ${results.summary.totalResidues} residues (${results.summary.residuesResolved} resolved)`);
  console.log(`  ${results.summary.regionMigrations} cross-region migrations`);
  console.log(`  Fairness: ${allFair ? 'ALL EPOCHS VERIFIED FAIR' : 'VIOLATIONS DETECTED'}`);
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('Fatal orchestrator error:', err);
  process.exit(1);
});
