import { expect } from "chai";
import hre from "hardhat";
import { toHex, keccak256, parseEther } from "viem";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";

/**
 * ResidueRegistry — "Every resleeving leaves traces."
 *
 * In Altered Carbon, every time consciousness transfers between sleeves,
 * fragmented memories and glitches remain — residues. In our system,
 * coordination residues are MEV-like artifacts: stale orderings, speculative
 * divergences, reorg orphans. They aren't extracted for profit — they're
 * resolved into canonical state. The first valid resolution proof earns
 * the bounty in ResidueToken.
 */
describe("ResidueRegistry — Coordination Residue Resolution", function () {
  async function deployResidueFixture() {
    const [owner, detector, resolver, kovacs, unauthorized] =
      await hre.viem.getWalletClients();

    // Deploy StackIdentity
    const stack = await hre.viem.deployContract("StackIdentity");

    // Deploy a token for residue payouts
    const residueToken = await hre.viem.deployContract("ComputeToken", [stack.address]);

    // Deploy ResidueRegistry
    const registry = await hre.viem.deployContract("ResidueRegistry", [
      residueToken.address, stack.address,
    ]);

    // Set registry as minter for the residue token
    await residueToken.write.setMinter([registry.address]);

    // Mint stacks for resolver and Kovacs
    const cpv: [bigint, bigint, bigint, bigint, bigint] = [1_000_000n, 1_000_000n, 1_000_000n, 1_000_000n, 1_000_000n];

    const resolverStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
      client: { wallet: resolver },
    });
    await resolverStack.write.mintStack([toHex(new Uint8Array(32).fill(0x01)), cpv, 100_000n, 200_000n]);

    const kovacsStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
      client: { wallet: kovacs },
    });
    await kovacsStack.write.mintStack([toHex(new Uint8Array(32).fill(0xAC)), cpv, 100_000n, 200_000n]);

    const publicClient = await hre.viem.getPublicClient();

    return { stack, residueToken, registry, owner, detector, resolver, kovacs, unauthorized, publicClient };
  }

  // Residue IDs (think of them as glitch signatures)
  const STALE_ORDERING_ID = keccak256(toHex("residue:stale-ordering:epoch-7:tx-0x1234"));
  const SPECULATIVE_DIV_ID = keccak256(toHex("residue:speculative-divergence:epoch-12"));
  const REORG_ORPHAN_ID = keccak256(toHex("residue:reorg-orphan:medulla-block-999"));

  describe("Residue Detection — Identifying coordination ghosts", function () {
    it("should detect a StaleOrdering residue — routing lag artifact", async function () {
      const { registry, detector } = await loadFixture(deployResidueFixture);

      const detectorRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: detector },
      });
      await detectorRegistry.write.detect([STALE_ORDERING_ID, 0, 1n, parseEther("5")]);

      const r = await registry.read.residue([STALE_ORDERING_ID]);
      expect(r[0]).to.equal(0); // Kind.StaleOrdering
      expect(r[1]).to.equal(1n); // stackId
      expect(r[2]).to.equal(parseEther("5")); // bountyEst
      expect(r[3]).to.equal(0); // Status.Open
    });

    it("should detect a SpeculativeDivergence residue — compute/memory mismatch", async function () {
      const { registry, detector } = await loadFixture(deployResidueFixture);

      const detectorRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: detector },
      });
      await detectorRegistry.write.detect([SPECULATIVE_DIV_ID, 1, 0n, parseEther("10")]);

      const r = await registry.read.residue([SPECULATIVE_DIV_ID]);
      expect(r[0]).to.equal(1); // Kind.SpeculativeDivergence
      expect(r[1]).to.equal(0n); // global (stackId=0)
    });

    it("should detect a ReorgOrphan residue — medulla-pow chain reorg crossed anchor", async function () {
      const { registry, detector } = await loadFixture(deployResidueFixture);

      const detectorRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: detector },
      });
      await detectorRegistry.write.detect([REORG_ORPHAN_ID, 3, 2n, parseEther("20")]);

      const r = await registry.read.residue([REORG_ORPHAN_ID]);
      expect(r[0]).to.equal(3); // Kind.ReorgOrphan
    });

    it("should reject duplicate residue detection — each glitch is unique", async function () {
      const { registry, detector } = await loadFixture(deployResidueFixture);

      const detectorRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: detector },
      });
      await detectorRegistry.write.detect([STALE_ORDERING_ID, 0, 1n, parseEther("5")]);

      await expect(
        detectorRegistry.write.detect([STALE_ORDERING_ID, 0, 1n, parseEther("5")])
      ).to.be.rejectedWith("already detected");
    });

    it("should reject bounty exceeding MAX_BOUNTY — prevent economic overflow", async function () {
      const { registry, detector } = await loadFixture(deployResidueFixture);
      const hugeAmount = BigInt("2000000000000000000000000"); // 2e24

      const detectorRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: detector },
      });
      await expect(
        detectorRegistry.write.detect([STALE_ORDERING_ID, 0, 1n, hugeAmount])
      ).to.be.rejectedWith("bounty too large");
    });

    it("should track residue count — how many ghosts haunt the system", async function () {
      const { registry, detector } = await loadFixture(deployResidueFixture);

      const detectorRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: detector },
      });
      await detectorRegistry.write.detect([STALE_ORDERING_ID, 0, 1n, parseEther("5")]);
      await detectorRegistry.write.detect([SPECULATIVE_DIV_ID, 1, 0n, parseEther("10")]);
      await detectorRegistry.write.detect([REORG_ORPHAN_ID, 3, 2n, parseEther("20")]);

      expect(await registry.read.residueCount()).to.equal(3n);
    });
  });

  describe("Proof Submission — Resolving the ghost into canonical state", function () {
    it("should resolve a residue with valid proof — ghost exorcised", async function () {
      const { registry, residueToken, detector, resolver } = await loadFixture(deployResidueFixture);

      // Detect residue
      const detectorRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: detector },
      });
      await detectorRegistry.write.detect([STALE_ORDERING_ID, 0, 1n, parseEther("5")]);

      // Resolver submits proof (resolver owns stack tokenId=1)
      const proof = toHex("merkle-proof:canonical-ordering-restored");
      const resolverRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: resolver },
      });
      await resolverRegistry.write.submitProof([STALE_ORDERING_ID, 1n, proof]);

      // Verify resolution
      const r = await registry.read.residue([STALE_ORDERING_ID]);
      expect(r[3]).to.equal(2); // Status.Resolved
      expect(r[4]).to.equal(1n); // resolverTokenId
      expect(r[5]).to.equal(parseEther("5")); // payout == bountyEst
    });

    it("should mint ResidueToken as bounty to resolver — reward for fixing coherence", async function () {
      const { registry, residueToken, detector, resolver } = await loadFixture(deployResidueFixture);

      const detectorRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: detector },
      });
      await detectorRegistry.write.detect([STALE_ORDERING_ID, 0, 1n, parseEther("5")]);

      const proof = toHex("proof:stale-ordering-fixed");
      const resolverRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: resolver },
      });
      await resolverRegistry.write.submitProof([STALE_ORDERING_ID, 1n, proof]);

      // Resolver's stack (tokenId=1) should have received bounty
      expect(await residueToken.read.balanceOfStack([1n])).to.equal(parseEther("5"));
    });

    it("should reject proof on non-existent residue — can't fix what isn't broken", async function () {
      const { registry, resolver } = await loadFixture(deployResidueFixture);
      const fakeId = keccak256(toHex("ghost:doesnt:exist"));
      const proof = toHex("fake-proof");

      const resolverRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: resolver },
      });
      await expect(
        resolverRegistry.write.submitProof([fakeId, 1n, proof])
      ).to.be.rejectedWith("no residue");
    });

    it("should reject double-resolution — first valid proof wins", async function () {
      const { registry, detector, resolver, kovacs } = await loadFixture(deployResidueFixture);

      const detectorRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: detector },
      });
      await detectorRegistry.write.detect([STALE_ORDERING_ID, 0, 1n, parseEther("5")]);

      // First resolver succeeds
      const resolverRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: resolver },
      });
      await resolverRegistry.write.submitProof([STALE_ORDERING_ID, 1n, toHex("proof-1")]);

      // Second resolver fails — ghost already resolved
      const kovacsRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: kovacs },
      });
      await expect(
        kovacsRegistry.write.submitProof([STALE_ORDERING_ID, 2n, toHex("proof-2")])
      ).to.be.rejectedWith("already resolved");
    });

    it("should reject proof from non-stack-owner — impersonation prevented", async function () {
      const { registry, detector, unauthorized } = await loadFixture(deployResidueFixture);

      const detectorRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: detector },
      });
      await detectorRegistry.write.detect([STALE_ORDERING_ID, 0, 1n, parseEther("5")]);

      // Unauthorized tries to claim resolver's stack
      const badRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: unauthorized },
      });
      await expect(
        badRegistry.write.submitProof([STALE_ORDERING_ID, 1n, toHex("stolen-proof")])
      ).to.be.rejectedWith("not resolver owner");
    });

    it("should store proofHash — keccak of the resolution evidence", async function () {
      const { registry, detector, resolver } = await loadFixture(deployResidueFixture);

      const detectorRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: detector },
      });
      await detectorRegistry.write.detect([STALE_ORDERING_ID, 0, 1n, parseEther("5")]);

      const proof = toHex("canonical-state-proof-data-goes-here");
      const resolverRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: resolver },
      });
      await resolverRegistry.write.submitProof([STALE_ORDERING_ID, 1n, proof]);

      const r = await registry.read.residue([STALE_ORDERING_ID]);
      // proofHash should be non-zero
      expect(r[6]).to.not.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
    });
  });

  describe("Payout Model Configuration — Economic philosophy", function () {
    it("should default to first-valid-proof model — meritocratic resolution", async function () {
      const { registry } = await loadFixture(deployResidueFixture);
      expect(await registry.read.payoutModel()).to.equal("first-valid-proof");
    });

    it("should allow owner to change payout model — governance decision", async function () {
      const { registry } = await loadFixture(deployResidueFixture);
      await registry.write.setPayoutModel(["auction"]);
      expect(await registry.read.payoutModel()).to.equal("auction");
    });

    it("should reject model change from non-owner — only governance can alter economics", async function () {
      const { registry, kovacs } = await loadFixture(deployResidueFixture);

      const kovacsRegistry = await hre.viem.getContractAt("ResidueRegistry", registry.address, {
        client: { wallet: kovacs },
      });
      await expect(
        kovacsRegistry.write.setPayoutModel(["free-for-all"])
      ).to.be.rejected;
    });
  });
});
