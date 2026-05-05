import { expect } from "chai";
import hre from "hardhat";
import { toHex, keccak256 } from "viem";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";

/**
 * SleeveRegistry — "A sleeve is just a body. What matters is the stack inside."
 *
 * In Altered Carbon, sleeves are biological or synthetic bodies that host
 * a consciousness (DHF stored on a cortical stack). Sleeves can be human,
 * synthetic, or purpose-built. The SleeveRegistry tracks which sleeves are
 * bound to which stack, their embodiment type (Human/AI/Mining/Memory),
 * and whether they're still alive or decommissioned.
 */
describe("SleeveRegistry — Body Management & Embodiment Tracking", function () {
  async function deploySleeveFixture() {
    const [owner, kovacs, ortega, unauthorized] =
      await hre.viem.getWalletClients();

    // Deploy StackIdentity
    const stack = await hre.viem.deployContract("StackIdentity");

    // Deploy SleeveRegistry
    const registry = await hre.viem.deployContract("SleeveRegistry", [stack.address]);

    // Mint stacks
    const cpv: [bigint, bigint, bigint, bigint, bigint] = [1_000_000n, 1_000_000n, 1_000_000n, 1_000_000n, 1_000_000n];

    const kovacsStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
      client: { wallet: kovacs },
    });
    await kovacsStack.write.mintStack([toHex(new Uint8Array(32).fill(0xAC)), cpv, 100_000n, 200_000n]);

    const ortegaStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
      client: { wallet: ortega },
    });
    await ortegaStack.write.mintStack([toHex(new Uint8Array(32).fill(0xBE)), cpv, 100_000n, 200_000n]);

    const publicClient = await hre.viem.getPublicClient();

    return { stack, registry, owner, kovacs, ortega, unauthorized, publicClient };
  }

  // Sleeve IDs — unique identifiers for each body
  const SYNTH_SLEEVE = keccak256(toHex("sleeve:envoy-combat-synth-v7"));
  const ORGANIC_SLEEVE = keccak256(toHex("sleeve:elias-ryker-organic"));
  const MINING_SLEEVE = keccak256(toHex("sleeve:medulla-mining-rig-001"));
  const MEMORY_SLEEVE = keccak256(toHex("sleeve:hippocampus-storage-node"));
  const AI_SLEEVE = keccak256(toHex("sleeve:poe-hotel-ai-construct"));

  // Host IDs — where the sleeve runs (container/machine)
  const HOST_NODE_1 = keccak256(toHex("host:datacenter-harlan-world-01"));
  const HOST_NODE_2 = keccak256(toHex("host:orbital-millsport-02"));

  describe("Sleeve Registration — Spinning up a new body", function () {
    it("should register a Human embodiment sleeve — organic body", async function () {
      const { registry, kovacs } = await loadFixture(deploySleeveFixture);

      const kovacsRegistry = await hre.viem.getContractAt("SleeveRegistry", registry.address, {
        client: { wallet: kovacs },
      });
      await kovacsRegistry.write.register([ORGANIC_SLEEVE, 1n, 0, HOST_NODE_1]); // 0 = Human

      const sleeve = await registry.read.sleeves([ORGANIC_SLEEVE]);
      expect(sleeve[0]).to.equal(1n); // tokenId
      expect(sleeve[1]).to.equal(0); // Embodiment.Human
      expect(sleeve[2]).to.be.true; // alive
    });

    it("should register an AI embodiment sleeve — digital construct", async function () {
      const { registry, kovacs } = await loadFixture(deploySleeveFixture);

      const kovacsRegistry = await hre.viem.getContractAt("SleeveRegistry", registry.address, {
        client: { wallet: kovacs },
      });
      await kovacsRegistry.write.register([AI_SLEEVE, 1n, 1, HOST_NODE_1]); // 1 = Ai

      const sleeve = await registry.read.sleeves([AI_SLEEVE]);
      expect(sleeve[1]).to.equal(1); // Embodiment.Ai
    });

    it("should register a Mining embodiment sleeve — proof-of-work body", async function () {
      const { registry, kovacs } = await loadFixture(deploySleeveFixture);

      const kovacsRegistry = await hre.viem.getContractAt("SleeveRegistry", registry.address, {
        client: { wallet: kovacs },
      });
      await kovacsRegistry.write.register([MINING_SLEEVE, 1n, 2, HOST_NODE_2]); // 2 = Mining

      const sleeve = await registry.read.sleeves([MINING_SLEEVE]);
      expect(sleeve[1]).to.equal(2); // Embodiment.Mining
    });

    it("should register a Memory embodiment sleeve — hippocampus storage", async function () {
      const { registry, kovacs } = await loadFixture(deploySleeveFixture);

      const kovacsRegistry = await hre.viem.getContractAt("SleeveRegistry", registry.address, {
        client: { wallet: kovacs },
      });
      await kovacsRegistry.write.register([MEMORY_SLEEVE, 1n, 3, HOST_NODE_1]); // 3 = Memory

      const sleeve = await registry.read.sleeves([MEMORY_SLEEVE]);
      expect(sleeve[1]).to.equal(3); // Embodiment.Memory
    });

    it("should store host ID — which machine runs this sleeve", async function () {
      const { registry, kovacs } = await loadFixture(deploySleeveFixture);

      const kovacsRegistry = await hre.viem.getContractAt("SleeveRegistry", registry.address, {
        client: { wallet: kovacs },
      });
      await kovacsRegistry.write.register([SYNTH_SLEEVE, 1n, 0, HOST_NODE_1]);

      const sleeve = await registry.read.sleeves([SYNTH_SLEEVE]);
      expect(sleeve[4]).to.equal(HOST_NODE_1); // hostId
    });

    it("should reject duplicate registration — each sleeve is unique", async function () {
      const { registry, kovacs } = await loadFixture(deploySleeveFixture);

      const kovacsRegistry = await hre.viem.getContractAt("SleeveRegistry", registry.address, {
        client: { wallet: kovacs },
      });
      await kovacsRegistry.write.register([SYNTH_SLEEVE, 1n, 0, HOST_NODE_1]);

      await expect(
        kovacsRegistry.write.register([SYNTH_SLEEVE, 1n, 0, HOST_NODE_1])
      ).to.be.rejectedWith("already registered");
    });

    it("should reject registration from non-stack-owner — only you can clothe yourself", async function () {
      const { registry, ortega } = await loadFixture(deploySleeveFixture);

      // Ortega tries to register a sleeve on Kovacs' stack (tokenId=1)
      const ortegaRegistry = await hre.viem.getContractAt("SleeveRegistry", registry.address, {
        client: { wallet: ortega },
      });
      await expect(
        ortegaRegistry.write.register([SYNTH_SLEEVE, 1n, 0, HOST_NODE_1])
      ).to.be.rejectedWith("not stack owner");
    });

    it("should add sleeve to stack's sleeve list — tracking all bodies", async function () {
      const { registry, kovacs } = await loadFixture(deploySleeveFixture);

      const kovacsRegistry = await hre.viem.getContractAt("SleeveRegistry", registry.address, {
        client: { wallet: kovacs },
      });
      await kovacsRegistry.write.register([SYNTH_SLEEVE, 1n, 1, HOST_NODE_1]);
      await kovacsRegistry.write.register([ORGANIC_SLEEVE, 1n, 0, HOST_NODE_2]);
      await kovacsRegistry.write.register([MINING_SLEEVE, 1n, 2, HOST_NODE_1]);

      const sleeves = await registry.read.listOf([1n]);
      expect(sleeves.length).to.equal(3);
      expect(sleeves[0]).to.equal(SYNTH_SLEEVE);
      expect(sleeves[1]).to.equal(ORGANIC_SLEEVE);
      expect(sleeves[2]).to.equal(MINING_SLEEVE);
    });
  });

  describe("Sleeve Decommission — Body death / retirement", function () {
    it("should decommission a sleeve — the body dies, but the stack lives on", async function () {
      const { registry, kovacs } = await loadFixture(deploySleeveFixture);

      const kovacsRegistry = await hre.viem.getContractAt("SleeveRegistry", registry.address, {
        client: { wallet: kovacs },
      });
      await kovacsRegistry.write.register([SYNTH_SLEEVE, 1n, 1, HOST_NODE_1]);
      await kovacsRegistry.write.decommission([SYNTH_SLEEVE]);

      const sleeve = await registry.read.sleeves([SYNTH_SLEEVE]);
      expect(sleeve[2]).to.be.false; // no longer alive
    });

    it("should reject decommission of already-dead sleeve — can't kill what's dead", async function () {
      const { registry, kovacs } = await loadFixture(deploySleeveFixture);

      const kovacsRegistry = await hre.viem.getContractAt("SleeveRegistry", registry.address, {
        client: { wallet: kovacs },
      });
      await kovacsRegistry.write.register([ORGANIC_SLEEVE, 1n, 0, HOST_NODE_1]);
      await kovacsRegistry.write.decommission([ORGANIC_SLEEVE]);

      await expect(
        kovacsRegistry.write.decommission([ORGANIC_SLEEVE])
      ).to.be.rejectedWith("not alive");
    });

    it("should reject decommission from non-owner — only you can retire your body", async function () {
      const { registry, kovacs, ortega } = await loadFixture(deploySleeveFixture);

      const kovacsRegistry = await hre.viem.getContractAt("SleeveRegistry", registry.address, {
        client: { wallet: kovacs },
      });
      await kovacsRegistry.write.register([SYNTH_SLEEVE, 1n, 1, HOST_NODE_1]);

      // Ortega tries to decommission Kovacs' sleeve
      const ortegaRegistry = await hre.viem.getContractAt("SleeveRegistry", registry.address, {
        client: { wallet: ortega },
      });
      await expect(
        ortegaRegistry.write.decommission([SYNTH_SLEEVE])
      ).to.be.rejectedWith("not stack owner");
    });
  });

  describe("Multi-Sleeve Stacks — The Meth lifestyle", function () {
    it("should allow a stack to have multiple active sleeves simultaneously", async function () {
      const { registry, kovacs } = await loadFixture(deploySleeveFixture);

      const kovacsRegistry = await hre.viem.getContractAt("SleeveRegistry", registry.address, {
        client: { wallet: kovacs },
      });

      // Kovacs spins up 4 sleeves across different embodiment types
      await kovacsRegistry.write.register([SYNTH_SLEEVE, 1n, 1, HOST_NODE_1]);     // AI
      await kovacsRegistry.write.register([ORGANIC_SLEEVE, 1n, 0, HOST_NODE_2]);   // Human
      await kovacsRegistry.write.register([MINING_SLEEVE, 1n, 2, HOST_NODE_1]);    // Mining
      await kovacsRegistry.write.register([MEMORY_SLEEVE, 1n, 3, HOST_NODE_2]);    // Memory

      const sleeves = await registry.read.listOf([1n]);
      expect(sleeves.length).to.equal(4);
    });

    it("should keep decommissioned sleeves in the list — history is preserved", async function () {
      const { registry, kovacs } = await loadFixture(deploySleeveFixture);

      const kovacsRegistry = await hre.viem.getContractAt("SleeveRegistry", registry.address, {
        client: { wallet: kovacs },
      });
      await kovacsRegistry.write.register([SYNTH_SLEEVE, 1n, 1, HOST_NODE_1]);
      await kovacsRegistry.write.register([ORGANIC_SLEEVE, 1n, 0, HOST_NODE_2]);
      await kovacsRegistry.write.decommission([SYNTH_SLEEVE]);

      // List still shows both — sleeve death doesn't erase the record
      const sleeves = await registry.read.listOf([1n]);
      expect(sleeves.length).to.equal(2);
    });

    it("should return empty list for stack with no sleeves — a naked stack", async function () {
      const { registry } = await loadFixture(deploySleeveFixture);

      const sleeves = await registry.read.listOf([1n]);
      expect(sleeves.length).to.equal(0);
    });
  });
});
