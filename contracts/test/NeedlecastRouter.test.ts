import { expect } from "chai";
import hre from "hardhat";
import { toHex, keccak256 } from "viem";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";

/**
 * NeedlecastRouter — "The needle carries you between worlds."
 *
 * In Altered Carbon, needlecasting is the transmission of a digitized
 * consciousness (DHF) across interstellar distances into a new sleeve.
 * The NeedlecastRouter coordinates these state-transfer events: it validates
 * that the caller owns the stack, records the transfer on the StackIdentity
 * contract, and anchors epoch progress from the mining network.
 */
describe("NeedlecastRouter — Consciousness Transfer Coordination", function () {
  async function deployNeedlecastFixture() {
    const [owner, kovacs, ortega, miner, unauthorized] =
      await hre.viem.getWalletClients();

    // Deploy StackIdentity
    const stack = await hre.viem.deployContract("StackIdentity");

    // Deploy NeedlecastRouter pointing to StackIdentity
    const router = await hre.viem.deployContract("NeedlecastRouter", [stack.address]);

    // Authorize the router on the StackIdentity contract
    await stack.write.setRouter([router.address, true]);

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

    return { stack, router, owner, kovacs, ortega, miner, unauthorized, publicClient };
  }

  const MERKLE_ROOT = keccak256(toHex("kovacs-full-dht-state-epoch-5"));
  const FROM_SLEEVE = keccak256(toHex("sleeve:synth-combat-model"));
  const TO_SLEEVE = keccak256(toHex("sleeve:organic-ryker-body"));
  const CROSS_ROOT = keccak256(toHex("cross-root:all-chains-coherent:epoch-1"));

  describe("Epoch Anchoring — Miners commit cross-chain state", function () {
    it("should allow anyone to anchor an epoch — mining is permissionless", async function () {
      const { router, miner } = await loadFixture(deployNeedlecastFixture);

      const minerRouter = await hre.viem.getContractAt("NeedlecastRouter", router.address, {
        client: { wallet: miner },
      });
      await minerRouter.write.anchorEpoch([CROSS_ROOT, 1n]);

      expect(await router.read.anchorCount()).to.equal(1n);
    });

    it("should store anchor data — epoch, root, miner, timestamp", async function () {
      const { router, miner } = await loadFixture(deployNeedlecastFixture);

      const minerRouter = await hre.viem.getContractAt("NeedlecastRouter", router.address, {
        client: { wallet: miner },
      });
      await minerRouter.write.anchorEpoch([CROSS_ROOT, 42n]);

      const anchor = await router.read.anchors([0n]);
      expect(anchor[0]).to.equal(CROSS_ROOT); // crossRoot
      expect(anchor[1]).to.equal(42n); // epoch
      expect(anchor[2]).to.be.greaterThan(0n); // timestamp
    });

    it("should accumulate anchors — building the coherence timeline", async function () {
      const { router, miner } = await loadFixture(deployNeedlecastFixture);

      const minerRouter = await hre.viem.getContractAt("NeedlecastRouter", router.address, {
        client: { wallet: miner },
      });
      const root2 = keccak256(toHex("cross-root:epoch-2"));
      const root3 = keccak256(toHex("cross-root:epoch-3"));

      await minerRouter.write.anchorEpoch([CROSS_ROOT, 1n]);
      await minerRouter.write.anchorEpoch([root2, 2n]);
      await minerRouter.write.anchorEpoch([root3, 3n]);

      expect(await router.read.anchorCount()).to.equal(3n);
    });
  });

  describe("Needlecast Routing — Consciousness in transit", function () {
    it("should route a needlecast for the stack owner", async function () {
      const { stack, router, kovacs } = await loadFixture(deployNeedlecastFixture);

      const kovacsRouter = await hre.viem.getContractAt("NeedlecastRouter", router.address, {
        client: { wallet: kovacs },
      });
      await kovacsRouter.write.route([1n, MERKLE_ROOT, 5n, FROM_SLEEVE, TO_SLEEVE]);

      // Verify it updated the StackIdentity state
      expect(await stack.read.latestRoot([1n])).to.equal(MERKLE_ROOT);
      expect(await stack.read.stackEpoch([1n])).to.equal(5n);
    });

    it("should track lastAnchorOf — linking stacks to their latest needlecast point", async function () {
      const { router, kovacs, miner } = await loadFixture(deployNeedlecastFixture);

      // First, anchor some epochs
      const minerRouter = await hre.viem.getContractAt("NeedlecastRouter", router.address, {
        client: { wallet: miner },
      });
      await minerRouter.write.anchorEpoch([CROSS_ROOT, 1n]);
      await minerRouter.write.anchorEpoch([keccak256(toHex("epoch-2")), 2n]);

      // Route a needlecast
      const kovacsRouter = await hre.viem.getContractAt("NeedlecastRouter", router.address, {
        client: { wallet: kovacs },
      });
      await kovacsRouter.write.route([1n, MERKLE_ROOT, 5n, FROM_SLEEVE, TO_SLEEVE]);

      // lastAnchorOf should point to current anchor count (2)
      expect(await router.read.lastAnchorOf([1n])).to.equal(2n);
    });

    it("should reject route from non-owner — can't needlecast someone else's stack", async function () {
      const { router, ortega } = await loadFixture(deployNeedlecastFixture);

      // Ortega tries to route Kovacs' stack (tokenId=1)
      const ortegaRouter = await hre.viem.getContractAt("NeedlecastRouter", router.address, {
        client: { wallet: ortega },
      });
      await expect(
        ortegaRouter.write.route([1n, MERKLE_ROOT, 5n, FROM_SLEEVE, TO_SLEEVE])
      ).to.be.rejectedWith("not stack owner");
    });

    it("should allow owner to needlecast their own stack", async function () {
      const { router, ortega } = await loadFixture(deployNeedlecastFixture);
      const ortegaRoot = keccak256(toHex("ortega-memories-epoch-3"));

      // Ortega routes their own stack (tokenId=2)
      const ortegaRouter = await hre.viem.getContractAt("NeedlecastRouter", router.address, {
        client: { wallet: ortega },
      });
      await ortegaRouter.write.route([2n, ortegaRoot, 3n, FROM_SLEEVE, TO_SLEEVE]);
    });

    it("should allow multiple needlecasts — consciousness can move many times", async function () {
      const { stack, router, kovacs } = await loadFixture(deployNeedlecastFixture);
      const sleeve2 = keccak256(toHex("sleeve:military-combat-grade"));
      const sleeve3 = keccak256(toHex("sleeve:diplomat-envoy-body"));
      const root2 = keccak256(toHex("kovacs-state-epoch-10"));

      const kovacsRouter = await hre.viem.getContractAt("NeedlecastRouter", router.address, {
        client: { wallet: kovacs },
      });

      // First needlecast: synthetic → organic
      await kovacsRouter.write.route([1n, MERKLE_ROOT, 5n, FROM_SLEEVE, TO_SLEEVE]);

      // Second needlecast: organic → military
      await kovacsRouter.write.route([1n, root2, 10n, TO_SLEEVE, sleeve2]);

      expect(await stack.read.latestRoot([1n])).to.equal(root2);
      expect(await stack.read.stackEpoch([1n])).to.equal(10n);
    });

    it("should reject epoch regression in needlecast — no going back in time", async function () {
      const { router, kovacs } = await loadFixture(deployNeedlecastFixture);

      const kovacsRouter = await hre.viem.getContractAt("NeedlecastRouter", router.address, {
        client: { wallet: kovacs },
      });

      // First cast at epoch 10
      await kovacsRouter.write.route([1n, MERKLE_ROOT, 10n, FROM_SLEEVE, TO_SLEEVE]);

      // Try to cast at epoch 5 — rejected
      await expect(
        kovacsRouter.write.route([1n, MERKLE_ROOT, 5n, FROM_SLEEVE, TO_SLEEVE])
      ).to.be.rejectedWith("epoch regression");
    });
  });

  describe("Full Lifecycle — Anchor → Needlecast → Verify", function () {
    it("should support complete flow: mine epoch, then needlecast through it", async function () {
      const { stack, router, kovacs, miner } = await loadFixture(deployNeedlecastFixture);

      // Step 1: Miner anchors epoch
      const minerRouter = await hre.viem.getContractAt("NeedlecastRouter", router.address, {
        client: { wallet: miner },
      });
      await minerRouter.write.anchorEpoch([CROSS_ROOT, 1n]);

      // Step 2: Kovacs needlecasts through that epoch
      const kovacsRouter = await hre.viem.getContractAt("NeedlecastRouter", router.address, {
        client: { wallet: kovacs },
      });
      await kovacsRouter.write.route([1n, MERKLE_ROOT, 1n, FROM_SLEEVE, TO_SLEEVE]);

      // Step 3: Verify stack state updated
      expect(await stack.read.latestRoot([1n])).to.equal(MERKLE_ROOT);
      expect(await stack.read.stackEpoch([1n])).to.equal(1n);
      expect(await router.read.lastAnchorOf([1n])).to.equal(1n);
    });
  });
});
