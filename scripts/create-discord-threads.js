const GUILD_ID = process.env.DISCORD_GUILD_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

// Channel IDs from creation output
const THREADS = {
  // announcements
  '1502037511411597542': [
    { name: '🚀 Mainnet Launch Timeline', message: 'Discussion thread for mainnet launch milestones and timeline updates.' },
    { name: '📋 Release Notes', message: 'Track version releases and changelogs here.' },
  ],
  // roadmap
  '1502037516096639079': [
    { name: 'Q3 2026 Milestones', message: 'Track Q3 2026 deliverables and progress.' },
    { name: 'Feature Voting', message: 'Vote and discuss upcoming feature priorities.' },
  ],
  // dev-general
  '1502037541002674267': [
    { name: 'Getting Started / Dev Setup', message: 'How to set up the ECCA development environment — Node.js, pnpm, Docker, Go.' },
    { name: 'Architecture Decisions', message: 'Discuss architecture decisions and trade-offs (ADRs).' },
    { name: 'Code Review Discussion', message: 'General code review patterns, style guides, and best practices.' },
  ],
  // chains
  '1502037544823558276': [
    { name: 'Medulla PoW — Mining & Retargeting', message: 'Discuss the custom PoW chain: difficulty retargeting, epoch advancement, MMR integration.' },
    { name: 'Hippocampus DAG — Storage & Recall', message: 'DAG-based content-addressable memory: put, get, pin, recall, fidelity scoring.' },
    { name: 'Cortex EVM — Smart Contracts', message: 'Geth-based EVM chain: Clique PoA, contract deployment, chain ID 131072.' },
    { name: 'Coherence Root & Cross-Chain Sync', message: 'How the 4-second epoch coherence root binds all three chains together.' },
  ],
  // smart-contracts
  '1502037548950884352': [
    { name: 'StackIdentity & SleeveRegistry', message: 'NFT-based identity and sleeve registration contracts.' },
    { name: 'BandwidthToken & QuellistTreasury', message: 'ERC-20 token mechanics, emission curves, and treasury distribution.' },
    { name: 'ResidueRegistry', message: 'Coordination residue detection, proof submission, and bounty payouts.' },
    { name: 'NeedlecastRouter', message: 'On-chain needlecast (memory transfer) routing and escrow.' },
  ],
  // services
  '1502037552574631966': [
    { name: 'Siyana API', message: 'REST + WebSocket API: stack creation, perceive, recall, needlecast endpoints.' },
    { name: 'Thalamus Router', message: 'Epoch tick, coherence folding, cross-chain anchor generation.' },
    { name: 'DHF Compositor', message: 'DAG walk, decryption, distributed holographic fragment reassembly.' },
    { name: 'Needlecast Router Service', message: 'Off-chain saga orchestration for memory transfers.' },
    { name: 'Sleeve Runtime', message: '4-in-1 parametric sleeve: perception, cognition, action, integration.' },
  ],
  // cryptography
  '1502037555905036522': [
    { name: 'AES-256-GCM & Epoch Keys', message: 'Symmetric encryption, HKDF-SHA512 key derivation, per-epoch key rotation.' },
    { name: 'Ed25519 Signatures', message: 'Identity keypairs, signing, verification.' },
    { name: 'Merkle Mountain Range (MMR)', message: 'Append-only accumulator: synaptic field depth, window rollover, proofs.' },
    { name: 'CID & Content Addressing', message: 'Content identifiers, DAG links, IPFS-compatible hashing.' },
  ],
  // infrastructure
  '1502037559784771645': [
    { name: 'Docker & Compose', message: '24-service Docker Compose setup, build optimisation, networking.' },
    { name: 'Kubernetes & Helm', message: 'K8s deployment, Helm charts, scaling strategies.' },
    { name: 'Observability (Prometheus/Grafana/Loki)', message: 'Metrics, logging, dashboards, alerting.' },
    { name: 'CI/CD Pipeline', message: 'GitHub Actions, build matrix, test automation.' },
  ],
  // tokenomics
  '1502037563177959587': [
    // This is actually the category, need to find the channel ID. Let me use a different approach.
  ],
  // research
  // showcase
  // help
};

// We need to find the actual channel IDs for tokenomics etc.
// Let's fetch all channels and match by name
async function api(endpoint, method = 'GET', body) {
  const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
    method,
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const THREADS_BY_NAME = {
  'tokenomics': [
    { name: 'Coherence Profile Vector (CPV)', message: 'How CPV scores work: fidelity, drift, bandwidth, entropy components.' },
    { name: 'Effective Balance Curve (EBC)', message: 'Token balance decay, floor mechanics, epoch delta impact.' },
    { name: 'Emission Schedule', message: 'Token emission rates, halving, treasury distribution.' },
  ],
  'residues': [
    { name: 'Residue Types & Detection', message: 'StaleOrdering, SpeculativeDivergence, ReorgOrphan, ShardLoss — how each is detected.' },
    { name: 'Proof Submission & Bounties', message: 'How to submit residue proofs and earn ResidueTokens.' },
  ],
  'research': [
    { name: 'Neuroscience Parallels', message: 'How ECCA maps to biological neural systems: hippocampus, thalamus, cortex, medulla.' },
    { name: 'Distributed Consciousness Theory', message: 'Can a distributed system exhibit coherent cognition? Discuss the philosophical foundations.' },
    { name: 'Related Papers & Reading List', message: 'Share relevant academic papers, books, and articles.' },
  ],
  'showcase': [
    { name: 'Agent Demos', message: 'Show off your AI agents running on ECCA.' },
    { name: 'Sleeve Implementations', message: 'Custom sleeve types, parametric configurations, performance results.' },
  ],
  'help': [
    { name: 'Installation Issues', message: 'Problems with pnpm, Docker, Go, Node.js setup.' },
    { name: 'Configuration & Environment', message: '.env files, chain connections, NATS, Postgres, Redis setup.' },
  ],
  'bug-reports': [
    { name: 'Bug Report Template', message: '**Environment:**\n**Steps to reproduce:**\n**Expected:**\n**Actual:**\n**Logs:**' },
  ],
};

async function main() {
  console.log('Fetching guild channels...');
  const channels = await api(`/guilds/${GUILD_ID}/channels`);
  
  // Build name→id map for text channels
  const nameToId = {};
  for (const ch of channels) {
    if (ch.type === 0) { // text channels only
      nameToId[ch.name] = ch.id;
    }
  }
  console.log(`Found ${Object.keys(nameToId).length} text channels\n`);

  // Create threads from hardcoded ID map
  for (const [channelId, threads] of Object.entries(THREADS)) {
    if (!threads.length) continue;
    for (const t of threads) {
      try {
        // Create a message first, then a thread from it
        const msg = await api(`/channels/${channelId}/messages`, 'POST', {
          content: `📌 **${t.name}**\n\n${t.message}`,
        });
        await sleep(500);
        const thread = await api(`/channels/${channelId}/messages/${msg.id}/threads`, 'POST', {
          name: t.name,
          auto_archive_duration: 10080, // 7 days
        });
        console.log(`  🧵 ${t.name} → ${thread.id}`);
        await sleep(500);
      } catch (e) {
        console.error(`  ❌ Failed: ${t.name} — ${e.message}`);
        await sleep(1000);
      }
    }
  }

  // Create threads from name-based map
  for (const [channelName, threads] of Object.entries(THREADS_BY_NAME)) {
    const channelId = nameToId[channelName];
    if (!channelId) {
      console.error(`⚠️  Channel "${channelName}" not found, skipping`);
      continue;
    }
    console.log(`\n#${channelName} (${channelId}):`);
    for (const t of threads) {
      try {
        const msg = await api(`/channels/${channelId}/messages`, 'POST', {
          content: `📌 **${t.name}**\n\n${t.message}`,
        });
        await sleep(500);
        const thread = await api(`/channels/${channelId}/messages/${msg.id}/threads`, 'POST', {
          name: t.name,
          auto_archive_duration: 10080,
        });
        console.log(`  🧵 ${t.name} → ${thread.id}`);
        await sleep(500);
      } catch (e) {
        console.error(`  ❌ Failed: ${t.name} — ${e.message}`);
        await sleep(1000);
      }
    }
  }

  console.log('\n✅ All threads created!');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
