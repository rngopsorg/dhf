import { expect } from "chai";
import hre from "hardhat";
import { keccak256, toHex } from "viem";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";

/**
 * EpochAnchor — "The bridge between worlds — anchoring time itself."
 *
 * In Altered Carbon, the needle is the beam that carries consciousness across
 * vast distances. The EpochAnchor serves a similar role for coherence: it
 * receives anchor commits from the medulla-pow mining network and stores the
 * rolling Synaptic-Field MMR root. Each epoch is a heartbeat of the system —
 * a synchronization point across all chains.
 */
describe("EpochAnchor — Cross-Chain Temporal Anchoring", function () {
  async function deployEpochAnchorFixture() {
    const [owner, bridger, miner, unauthorized] =
      await hre.viem.getWalletClients();

    const epochAnchor = await hre.viem.deployContract("EpochAnchor");
    const publicClient = await hre.viem.getPublicClient();

    return { epochAnchor, owner, bridger, miner, unauthorized, publicClient };
  }

  // Coherence roots — think of them as memory hashes across dimensional layers
  const CROSS_ROOT = keccak256(toHex("cross-root:epoch-1:all-chains-aligned"));
  const EVM_ROOT = keccak256(toHex("evm-root:cortex-state-hash"));
  const IPFS_ROOT = keccak256(toHex("ipfs-root:hippocampus-dag-head"));
  const SLEEVES_ROOT = keccak256(toHex("sleeves-root:all-active-sleeves"));
  const SYNAPTIC_ROOT = keccak256(toHex("synaptic-field:mmr-rolling-root"));

  describe("Bridger Authorization — Who can commit anchors", function () {
    it("should allow owner to authorize a bridger — the needle operator", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);

      await epochAnchor.write.setBridger([bridger.account.address, true]);
      expect(await epochAnchor.read.bridgers([bridger.account.address])).to.be.true;
    });

    it("should allow owner to revoke bridger — decommissioning the needle", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);

      await epochAnchor.write.setBridger([bridger.account.address, true]);
      await epochAnchor.write.setBridger([bridger.account.address, false]);
      expect(await epochAnchor.read.bridgers([bridger.account.address])).to.be.false;
    });

    it("should reject non-owner from setting bridger — CTAC-only authority", async function () {
      const { epochAnchor, miner, bridger } = await loadFixture(deployEpochAnchorFixture);

      const minerAnchor = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: miner },
      });
      await expect(
        minerAnchor.write.setBridger([bridger.account.address, true])
      ).to.be.rejected;
    });
  });

  describe("Anchor Commits — Heartbeats of cross-chain coherence", function () {
    it("should commit an epoch anchor with all coherence roots", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);

      await epochAnchor.write.setBridger([bridger.account.address, true]);

      const bridgerAnchor = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: bridger },
      });
      await bridgerAnchor.write.commitAnchor([
        1n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
      ]);

      const anchor = await epochAnchor.read.byEpoch([1n]);
      expect(anchor[0]).to.equal(CROSS_ROOT); // crossRoot
      expect(anchor[1]).to.equal(EVM_ROOT); // evmRoot
      expect(anchor[2]).to.equal(IPFS_ROOT); // ipfsRoot
      expect(anchor[3]).to.equal(SLEEVES_ROOT); // sleevesRoot
      expect(anchor[4]).to.equal(SYNAPTIC_ROOT); // synapticFieldRoot
      expect(anchor[5]).to.equal(100n); // medullaHeight
    });

    it("should advance the head epoch pointer — time marches forward", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);

      await epochAnchor.write.setBridger([bridger.account.address, true]);

      const bridgerAnchor = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: bridger },
      });
      await bridgerAnchor.write.commitAnchor([
        1n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
      ]);

      expect(await epochAnchor.read.head()).to.equal(1n);
    });

    it("should allow multiple epoch commits in sequence — building the timeline", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);

      await epochAnchor.write.setBridger([bridger.account.address, true]);

      const bridgerAnchor = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: bridger },
      });

      const root2 = keccak256(toHex("cross-root:epoch-2"));
      const root3 = keccak256(toHex("cross-root:epoch-3"));

      await bridgerAnchor.write.commitAnchor([
        1n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
      ]);
      await bridgerAnchor.write.commitAnchor([
        2n, root2, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 200n,
      ]);
      await bridgerAnchor.write.commitAnchor([
        3n, root3, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 300n,
      ]);

      expect(await epochAnchor.read.head()).to.equal(3n);

      const anchor3 = await epochAnchor.read.byEpoch([3n]);
      expect(anchor3[0]).to.equal(root3);
      expect(anchor3[5]).to.equal(300n);
    });

    it("should reject epoch regression — no time travel allowed", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);

      await epochAnchor.write.setBridger([bridger.account.address, true]);

      const bridgerAnchor = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: bridger },
      });
      await bridgerAnchor.write.commitAnchor([
        5n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 500n,
      ]);

      await expect(
        bridgerAnchor.write.commitAnchor([
          3n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 300n,
        ])
      ).to.be.rejectedWith("epoch regression");
    });

    it("should reject same epoch re-commit — each heartbeat is unique", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);

      await epochAnchor.write.setBridger([bridger.account.address, true]);

      const bridgerAnchor = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: bridger },
      });
      await bridgerAnchor.write.commitAnchor([
        1n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
      ]);

      await expect(
        bridgerAnchor.write.commitAnchor([
          1n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
        ])
      ).to.be.rejectedWith("epoch regression");
    });

    it("should reject commit from non-bridger — unauthorized needle transmission", async function () {
      const { epochAnchor, unauthorized } = await loadFixture(deployEpochAnchorFixture);

      const badAnchor = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: unauthorized },
      });
      await expect(
        badAnchor.write.commitAnchor([
          1n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
        ])
      ).to.be.rejectedWith("not bridger");
    });

    it("should record timestamp — when the anchor was committed to the chain", async function () {
      const { epochAnchor, bridger } = await loadFixture(deployEpochAnchorFixture);

      await epochAnchor.write.setBridger([bridger.account.address, true]);

      const bridgerAnchor = await hre.viem.getContractAt("EpochAnchor", epochAnchor.address, {
        client: { wallet: bridger },
      });
      await bridgerAnchor.write.commitAnchor([
        1n, CROSS_ROOT, EVM_ROOT, IPFS_ROOT, SLEEVES_ROOT, SYNAPTIC_ROOT, 100n,
      ]);

      const anchor = await epochAnchor.read.byEpoch([1n]);
      expect(anchor[6]).to.be.greaterThan(0n); // ts > 0
    });
  });

  describe("Epoch State Queries — Reading the timeline", function () {
    it("should return zero-state for uncommitted epochs", async function () {
      const { epochAnchor } = await loadFixture(deployEpochAnchorFixture);

      const anchor = await epochAnchor.read.byEpoch([999n]);
      expect(anchor[0]).to.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
      expect(anchor[5]).to.equal(0n);
    });

    it("should start with head at 0 — no epochs committed yet", async function () {
      const { epochAnchor } = await loadFixture(deployEpochAnchorFixture);
      expect(await epochAnchor.read.head()).to.equal(0n);
    });
  });
});
