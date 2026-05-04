// Deploys the full ECCA contract suite to cortex-evm and writes deployments.json.
// Run: pnpm --filter @ecca/contracts run deploy:local

import hre from 'hardhat';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DEPLOY_DIR = join(__dirname, '..', 'deployments');

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  console.log(`[deployer] ${deployer.account.address}`);

  // 1. StackIdentity
  const stackIdentity = await hre.viem.deployContract('StackIdentity');
  console.log(`StackIdentity:    ${stackIdentity.address}`);

  // 2. Five bandwidth tokens
  const compute = await hre.viem.deployContract('ComputeToken', [stackIdentity.address]);
  const memT    = await hre.viem.deployContract('MemoryToken',  [stackIdentity.address]);
  const syncT   = await hre.viem.deployContract('SyncToken',    [stackIdentity.address]);
  const routing = await hre.viem.deployContract('RoutingToken', [stackIdentity.address]);
  const residue = await hre.viem.deployContract('ResidueToken', [stackIdentity.address]);
  console.log(`ComputeToken:     ${compute.address}`);
  console.log(`MemoryToken:      ${memT.address}`);
  console.log(`SyncToken:        ${syncT.address}`);
  console.log(`RoutingToken:     ${routing.address}`);
  console.log(`ResidueToken:     ${residue.address}`);

  // 3. Treasury (owns mint authority for tokens)
  const treasury = await hre.viem.deployContract('QuellistTreasury', [
    compute.address, memT.address, syncT.address, routing.address, residue.address,
  ]);
  console.log(`QuellistTreasury: ${treasury.address}`);

  // Hand minter rights to treasury for each token
  for (const t of [compute, memT, syncT, routing, residue]) {
    await t.write.setMinter([treasury.address]);
  }

  // 4. Routers + registries
  const router = await hre.viem.deployContract('NeedlecastRouter', [stackIdentity.address]);
  console.log(`NeedlecastRouter: ${router.address}`);
  await stackIdentity.write.setRouter([router.address, true]);

  const sleeveReg = await hre.viem.deployContract('SleeveRegistry', [stackIdentity.address]);
  console.log(`SleeveRegistry:   ${sleeveReg.address}`);

  const residueReg = await hre.viem.deployContract('ResidueRegistry', [residue.address, stackIdentity.address]);
  console.log(`ResidueRegistry:  ${residueReg.address}`);
  await residue.write.setMinter([residueReg.address]);

  const epochAnchor = await hre.viem.deployContract('EpochAnchor');
  console.log(`EpochAnchor:      ${epochAnchor.address}`);

  // Persist for off-chain services
  mkdirSync(DEPLOY_DIR, { recursive: true });
  const out = {
    chainId: Number(process.env.CORTEX_CHAIN_ID ?? 131072),
    deployer: deployer.account.address,
    StackIdentity: stackIdentity.address,
    ComputeToken: compute.address,
    MemoryToken: memT.address,
    SyncToken: syncT.address,
    RoutingToken: routing.address,
    ResidueToken: residue.address,
    QuellistTreasury: treasury.address,
    NeedlecastRouter: router.address,
    SleeveRegistry: sleeveReg.address,
    ResidueRegistry: residueReg.address,
    EpochAnchor: epochAnchor.address,
  };
  writeFileSync(join(DEPLOY_DIR, 'cortex.json'), JSON.stringify(out, null, 2));
  console.log(`\nWrote ${join(DEPLOY_DIR, 'cortex.json')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
