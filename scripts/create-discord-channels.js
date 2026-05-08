const GUILD_ID = process.env.DISCORD_GUILD_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

const CATEGORIES = [
  {
    name: '📢 Info',
    channels: [
      { name: 'announcements', topic: 'Launches, releases, and epoch updates' },
      { name: 'roadmap', topic: 'Milestones and progress updates' },
      { name: 'faq', topic: 'Common questions and pinned answers' },
    ],
  },
  {
    name: '💬 General',
    channels: [
      { name: 'general', topic: 'Open discussion' },
      { name: 'introductions', topic: 'New members — say hello!' },
      { name: 'ideas-and-feedback', topic: 'Feature requests and suggestions' },
    ],
  },
  {
    name: '🔧 Technical',
    channels: [
      { name: 'dev-general', topic: 'Engineering discussion' },
      { name: 'chains', topic: 'Medulla PoW, Hippocampus DAG, Cortex EVM' },
      { name: 'smart-contracts', topic: 'Solidity, token mechanics, residue registry' },
      { name: 'services', topic: 'siyana-api, thalamus, compositor, needlecast' },
      { name: 'cryptography', topic: 'Coherence root, MMR, HKDF, epoch keys' },
      { name: 'infrastructure', topic: 'Docker, K8s, CI/CD, observability' },
    ],
  },
  {
    name: '🪙 Tokens & Economy',
    channels: [
      { name: 'tokenomics', topic: 'CPV, EBC, emission curves, bandwidth model' },
      { name: 'residues', topic: 'Coordination residues, proof submission, bounties' },
    ],
  },
  {
    name: '🌐 Community',
    channels: [
      { name: 'research', topic: 'Papers, neuroscience parallels, distributed consciousness' },
      { name: 'showcase', topic: 'Demos, sleeve implementations, agent builds' },
      { name: 'memes', topic: 'Keep it fun' },
    ],
  },
  {
    name: '🆘 Support',
    channels: [
      { name: 'help', topic: 'Troubleshooting and setup issues' },
      { name: 'bug-reports', topic: 'Structured bug reporting' },
    ],
  },
  {
    name: '🔊 Voice',
    channels: [
      { name: 'dev-chat', topic: 'Working sessions', type: 2 },
      { name: 'community-call', topic: 'Weekly/monthly calls', type: 2 },
    ],
  },
  {
    name: '🔒 Contributors',
    channels: [
      { name: 'contributors', topic: 'Core team coordination' },
      { name: 'pull-requests', topic: 'GitHub PR notifications via webhook' },
    ],
  },
];

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

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!GUILD_ID || !BOT_TOKEN) {
    console.error('Set DISCORD_GUILD_ID and DISCORD_BOT_TOKEN env vars');
    process.exit(1);
  }

  console.log(`Creating channels in guild ${GUILD_ID}...\n`);

  let position = 0;
  for (const cat of CATEGORIES) {
    // Create category
    const category = await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
      name: cat.name,
      type: 4, // GUILD_CATEGORY
      position: position++,
    });
    console.log(`📁 Created category: ${cat.name} (${category.id})`);
    await sleep(500);

    // Create channels under category
    for (const ch of cat.channels) {
      const channel = await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
        name: ch.name,
        type: ch.type || 0, // 0 = text, 2 = voice
        topic: ch.topic,
        parent_id: category.id,
        position: position++,
      });
      const icon = ch.type === 2 ? '🔊' : '#';
      console.log(`  ${icon} ${ch.name} — ${channel.id}`);
      await sleep(500);
    }
    console.log();
  }

  console.log('✅ All channels created!');
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
