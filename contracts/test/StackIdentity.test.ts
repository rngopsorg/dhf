import { expect } from "chai";
import hre from "hardhat";
import { getAddress, toHex, hexToBytes, keccak256 } from "viem";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";

/**
 * StackIdentity — "The cortical stack is what makes you, you."
 *
 * In the Altered Carbon universe, a cortical stack stores your consciousness.
 * Here, a StackIdentity NFT anchors a persistent cognitive identity on-chain.
 * Memory, sleeves, and cognitive state live off-chain; on-chain we record
 * the identity pubkey, coherence root, epoch, CPV, and EBC.
 */
describe("StackIdentity — Cortical Stack Registry", function () {
  async function deployStackFixture() {
    const [owner, kovacs, ortega, kawahara, router, unauthorized] =
      await hre.viem.getWalletClients();

    const stack = await hre.viem.deployContract("StackIdentity");
    const publicClient = await hre.viem.getPublicClient();

    return { stack, owner, kovacs, ortega, kawahara, router, unauthorized, publicClient };
  }

  // A fake ed25519 pubkey (32 bytes)
  const KOVACS_PUBKEY = toHex(new Uint8Array(32).fill(0xAC));
  const ORTEGA_PUBKEY = toHex(new Uint8Array(32).fill(0xBE));
  // Default CPV: balanced across all cognitive dimensions
  const BALANCED_CPV: [bigint, bigint, bigint, bigint, bigint] = [
    1_000_000n, 1_000_000n, 1_000_000n, 1_000_000n, 1_000_000n,
  ];
  // Decay: 10% per epoch, floor at 20%
  const DEFAULT_DECAY = 100_000n;
  const DEFAULT_FLOOR = 200_000n;

  describe("Stack Minting — Spinning up a new DHF", function () {
    it("should mint a cortical stack with correct identity pubkey", async function () {
      const { stack, kovacs } = await loadFixture(deployStackFixture);

      const kovacsStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet: kovacs },
      });
      await kovacsStack.write.mintStack([KOVACS_PUBKEY, BALANCED_CPV, DEFAULT_DECAY, DEFAULT_FLOOR]);

      const pubkey = await stack.read.pubkey([1n]);
      expect(pubkey).to.equal(KOVACS_PUBKEY);
    });

    it("should assign sequential tokenIds like stack serial numbers", async function () {
      const { stack, kovacs, ortega } = await loadFixture(deployStackFixture);

      const kovacsStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet: kovacs },
      });
      const ortegaStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet: ortega },
      });

      await kovacsStack.write.mintStack([KOVACS_PUBKEY, BALANCED_CPV, DEFAULT_DECAY, DEFAULT_FLOOR]);
      await ortegaStack.write.mintStack([ORTEGA_PUBKEY, BALANCED_CPV, DEFAULT_DECAY, DEFAULT_FLOOR]);

      expect(await stack.read.nextTokenId()).to.equal(3n);
    });

    it("should emit StackMinted event — consciousness comes online", async function () {
      const { stack, kovacs, publicClient } = await loadFixture(deployStackFixture);

      const kovacsStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet: kovacs },
      });
      const hash = await kovacsStack.write.mintStack([KOVACS_PUBKEY, BALANCED_CPV, DEFAULT_DECAY, DEFAULT_FLOOR]);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      expect(receipt.status).to.equal("success");
    });

    it("should store the Coherence Profile Vector (CPV) — cognitive personality matrix", async function () {
      const { stack, kovacs } = await loadFixture(deployStackFixture);
      const heavyCompute: [bigint, bigint, bigint, bigint, bigint] = [
        2_000_000n, 500_000n, 800_000n, 600_000n, 300_000n,
      ];

      const kovacsStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet: kovacs },
      });
      await kovacsStack.write.mintStack([KOVACS_PUBKEY, heavyCompute, DEFAULT_DECAY, DEFAULT_FLOOR]);

      const cpv = await stack.read.cpv([1n]);
      expect(cpv.computeCoeff).to.equal(2_000_000n);
      expect(cpv.memoryCoeff).to.equal(500_000n);
    });

    it("should store Epoch Binding Curve — how fast memories decay", async function () {
      const { stack, kovacs } = await loadFixture(deployStackFixture);

      const kovacsStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet: kovacs },
      });
      await kovacsStack.write.mintStack([KOVACS_PUBKEY, BALANCED_CPV, 500_000n, 100_000n]);

      const binding = await stack.read.binding([1n]);
      expect(binding.decayRateX1e6).to.equal(500_000n);
      expect(binding.floorX1e6).to.equal(100_000n);
    });

    it("should reject CPV coefficient > 2.0 — no consciousness can exceed limits", async function () {
      const { stack, kovacs } = await loadFixture(deployStackFixture);
      const overloaded: [bigint, bigint, bigint, bigint, bigint] = [
        3_000_000n, 1_000_000n, 1_000_000n, 1_000_000n, 1_000_000n,
      ];

      const kovacsStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet: kovacs },
      });
      await expect(
        kovacsStack.write.mintStack([KOVACS_PUBKEY, overloaded, DEFAULT_DECAY, DEFAULT_FLOOR])
      ).to.be.rejectedWith("cpv coeff > 2.0");
    });

    it("should reject decay rate > 1.0 — binding cannot exceed unity", async function () {
      const { stack, kovacs } = await loadFixture(deployStackFixture);

      const kovacsStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet: kovacs },
      });
      await expect(
        kovacsStack.write.mintStack([KOVACS_PUBKEY, BALANCED_CPV, 2_000_000n, DEFAULT_FLOOR])
      ).to.be.rejectedWith("binding out of range");
    });
  });

  describe("Router Authorization — Who can needlecast", function () {
    it("should allow owner to authorize a router contract", async function () {
      const { stack, router } = await loadFixture(deployStackFixture);

      await stack.write.setRouter([router.account.address, true]);
      expect(await stack.read.authorizedRouters([router.account.address])).to.be.true;
    });

    it("should allow owner to revoke router authorization", async function () {
      const { stack, router } = await loadFixture(deployStackFixture);

      await stack.write.setRouter([router.account.address, true]);
      await stack.write.setRouter([router.account.address, false]);
      expect(await stack.read.authorizedRouters([router.account.address])).to.be.false;
    });

    it("should reject non-owner from authorizing routers — only CTAC has that power", async function () {
      const { stack, kovacs, router } = await loadFixture(deployStackFixture);

      const kovacsStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet: kovacs },
      });
      await expect(
        kovacsStack.write.setRouter([router.account.address, true])
      ).to.be.rejected;
    });
  });

  describe("Needlecast Recording — Consciousness transfer on-chain proof", function () {
    const MERKLE_ROOT = keccak256(toHex("kovacs-memories-epoch-7"));
    const FROM_SLEEVE = keccak256(toHex("synth-sleeve-envoy"));
    const TO_SLEEVE = keccak256(toHex("organic-sleeve-ryker"));

    it("should record a needlecast from an authorized router", async function () {
      const { stack, kovacs, router } = await loadFixture(deployStackFixture);

      // Mint a stack for Kovacs
      const kovacsStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet: kovacs },
      });
      await kovacsStack.write.mintStack([KOVACS_PUBKEY, BALANCED_CPV, DEFAULT_DECAY, DEFAULT_FLOOR]);

      // Authorize the router
      await stack.write.setRouter([router.account.address, true]);

      // Router records the needlecast
      const routerStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet: router },
      });
      await routerStack.write.recordNeedlecast([1n, MERKLE_ROOT, 7n, FROM_SLEEVE, TO_SLEEVE]);

      // Verify state update
      expect(await stack.read.latestRoot([1n])).to.equal(MERKLE_ROOT);
      expect(await stack.read.stackEpoch([1n])).to.equal(7n);
    });

    it("should reject needlecast from unauthorized sender — only sanctioned routes", async function () {
      const { stack, kovacs, unauthorized } = await loadFixture(deployStackFixture);

      const kovacsStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet: kovacs },
      });
      await kovacsStack.write.mintStack([KOVACS_PUBKEY, BALANCED_CPV, DEFAULT_DECAY, DEFAULT_FLOOR]);

      const badRouter = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet: unauthorized },
      });
      await expect(
        badRouter.write.recordNeedlecast([1n, MERKLE_ROOT, 1n, FROM_SLEEVE, TO_SLEEVE])
      ).to.be.rejectedWith("not router");
    });

    it("should reject epoch regression — time only moves forward", async function () {
      const { stack, kovacs, router } = await loadFixture(deployStackFixture);

      const kovacsStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet: kovacs },
      });
      await kovacsStack.write.mintStack([KOVACS_PUBKEY, BALANCED_CPV, DEFAULT_DECAY, DEFAULT_FLOOR]);
      await stack.write.setRouter([router.account.address, true]);

      const routerStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet: router },
      });
      // Record epoch 10
      await routerStack.write.recordNeedlecast([1n, MERKLE_ROOT, 10n, FROM_SLEEVE, TO_SLEEVE]);

      // Try to regress to epoch 5 — real death of temporal coherence
      await expect(
        routerStack.write.recordNeedlecast([1n, MERKLE_ROOT, 5n, FROM_SLEEVE, TO_SLEEVE])
      ).to.be.rejectedWith("epoch regression");
    });

    it("should reject needlecast on non-existent stack — can't cast into void", async function () {
      const { stack, router } = await loadFixture(deployStackFixture);
      await stack.write.setRouter([router.account.address, true]);

      const routerStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet: router },
      });
      await expect(
        routerStack.write.recordNeedlecast([99n, MERKLE_ROOT, 1n, FROM_SLEEVE, TO_SLEEVE])
      ).to.be.rejectedWith("no stack");
    });
  });

  describe("Read Accessors — Querying consciousness state", function () {
    it("should return zero-state for freshly minted stack", async function () {
      const { stack, kovacs } = await loadFixture(deployStackFixture);

      const kovacsStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
        client: { wallet: kovacs },
      });
      await kovacsStack.write.mintStack([KOVACS_PUBKEY, BALANCED_CPV, DEFAULT_DECAY, DEFAULT_FLOOR]);

      expect(await stack.read.stackEpoch([1n])).to.equal(0n);
      expect(await stack.read.latestRoot([1n])).to.equal(
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      );
    });
  });
});
