import { expect } from "chai";
import hre from "hardhat";
import { toHex, keccak256, parseEther } from "viem";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";

/**
 * QuellistTreasury — "Named for Quellcrist Falconer, the revolutionary."
 *
 * Quell believed that immortality corrupts, that the Meths would hoard resources
 * indefinitely. The Treasury distributes bandwidth fairly: epoch-based emissions
 * ensure every active stack receives cognitive resources proportional to
 * participation, not wealth. The revolution continues through fair emission.
 */
describe("QuellistTreasury — Fair Emission of Cognitive Bandwidth", function () {
  async function deployTreasuryFixture() {
    const [owner, kovacs, ortega, unauthorized] =
      await hre.viem.getWalletClients();

    // Deploy StackIdentity
    const stack = await hre.viem.deployContract("StackIdentity");

    // Deploy all bandwidth tokens
    const compute = await hre.viem.deployContract("ComputeToken", [stack.address]);
    const memory = await hre.viem.deployContract("MemoryToken", [stack.address]);
    const sync = await hre.viem.deployContract("SyncToken", [stack.address]);
    const routing = await hre.viem.deployContract("RoutingToken", [stack.address]);
    // ResidueToken doesn't exist as separate contract, use ComputeToken as stand-in for residue
    const residueToken = await hre.viem.deployContract("ComputeToken", [stack.address]);

    // Deploy treasury
    const treasury = await hre.viem.deployContract("QuellistTreasury", [
      compute.address, memory.address, sync.address, routing.address, residueToken.address,
    ]);

    // Set treasury as minter for all tokens
    await compute.write.setMinter([treasury.address]);
    await memory.write.setMinter([treasury.address]);
    await sync.write.setMinter([treasury.address]);
    await routing.write.setMinter([treasury.address]);
    await residueToken.write.setMinter([treasury.address]);

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

    return { stack, compute, memory, sync, routing, residueToken, treasury, owner, kovacs, ortega, unauthorized, publicClient };
  }

  describe("Direct Issuance — Treasury targeted bandwidth grants", function () {
    it("should issue ComputeToken to a stack — processing power granted", async function () {
      const { treasury, compute } = await loadFixture(deployTreasuryFixture);
      const reason = keccak256(toHex("faucet.compute"));

      await treasury.write.issue([1n, 0, parseEther("50"), reason]);
      expect(await compute.read.balanceOfStack([1n])).to.equal(parseEther("50"));
    });

    it("should issue MemoryToken — expanding recall capacity", async function () {
      const { treasury, memory } = await loadFixture(deployTreasuryFixture);
      const reason = keccak256(toHex("faucet.memory"));

      await treasury.write.issue([1n, 1, parseEther("75"), reason]);
      expect(await memory.read.balanceOfStack([1n])).to.equal(parseEther("75"));
    });

    it("should issue SyncToken — cross-chain coherence resources", async function () {
      const { treasury, sync } = await loadFixture(deployTreasuryFixture);
      const reason = keccak256(toHex("faucet.sync"));

      await treasury.write.issue([2n, 2, parseEther("25"), reason]);
      expect(await sync.read.balanceOfStack([2n])).to.equal(parseEther("25"));
    });

    it("should issue RoutingToken — needlecast routing capacity", async function () {
      const { treasury, routing } = await loadFixture(deployTreasuryFixture);
      const reason = keccak256(toHex("faucet.routing"));

      await treasury.write.issue([1n, 3, parseEther("60"), reason]);
      expect(await routing.read.balanceOfStack([1n])).to.equal(parseEther("60"));
    });

    it("should issue ResidueToken — bounty for resolving coordination residues", async function () {
      const { treasury, residueToken } = await loadFixture(deployTreasuryFixture);
      const reason = keccak256(toHex("residue.reward"));

      await treasury.write.issue([1n, 4, parseEther("10"), reason]);
      expect(await residueToken.read.balanceOfStack([1n])).to.equal(parseEther("10"));
    });

    it("should reject invalid token kind — only 5 bandwidth channels exist", async function () {
      const { treasury } = await loadFixture(deployTreasuryFixture);
      const reason = keccak256(toHex("bad.kind"));

      await expect(
        treasury.write.issue([1n, 5, parseEther("10"), reason])
      ).to.be.rejectedWith("bad kind");
    });

    it("should reject issuance from non-owner — Quellist principles cannot be subverted", async function () {
      const { treasury, kovacs } = await loadFixture(deployTreasuryFixture);
      const reason = keccak256(toHex("steal"));

      const kovacsTreasury = await hre.viem.getContractAt("QuellistTreasury", treasury.address, {
        client: { wallet: kovacs },
      });
      await expect(
        kovacsTreasury.write.issue([1n, 0, parseEther("1000000"), reason])
      ).to.be.rejected;
    });
  });

  describe("Epoch Rewards — Fair distribution across time", function () {
    it("should claim epoch rewards — equal bandwidth across all four channels", async function () {
      const { treasury, compute, memory, sync, routing } = await loadFixture(deployTreasuryFixture);

      // Claim rewards for 5 epochs elapsed
      await treasury.write.claimEpochRewards([1n, 5n]);

      const expectedAmount = parseEther("100") * 5n; // 100 per epoch * 5 epochs
      expect(await compute.read.balanceOfStack([1n])).to.equal(expectedAmount);
      expect(await memory.read.balanceOfStack([1n])).to.equal(expectedAmount);
      expect(await sync.read.balanceOfStack([1n])).to.equal(expectedAmount);
      expect(await routing.read.balanceOfStack([1n])).to.equal(expectedAmount);
    });

    it("should track lastClaimEpoch — preventing double claims", async function () {
      const { treasury } = await loadFixture(deployTreasuryFixture);

      await treasury.write.claimEpochRewards([1n, 10n]);
      expect(await treasury.read.lastClaimEpoch([1n])).to.equal(10n);
    });

    it("should reject claim for same epoch — no double-dipping consciousness", async function () {
      const { treasury } = await loadFixture(deployTreasuryFixture);

      await treasury.write.claimEpochRewards([1n, 5n]);
      await expect(
        treasury.write.claimEpochRewards([1n, 5n])
      ).to.be.rejectedWith("no new epochs");
    });

    it("should reject claim for earlier epoch — time regression", async function () {
      const { treasury } = await loadFixture(deployTreasuryFixture);

      await treasury.write.claimEpochRewards([1n, 10n]);
      await expect(
        treasury.write.claimEpochRewards([1n, 5n])
      ).to.be.rejectedWith("no new epochs");
    });

    it("should allow incremental claims — epoch by epoch progression", async function () {
      const { treasury, compute } = await loadFixture(deployTreasuryFixture);

      await treasury.write.claimEpochRewards([1n, 3n]);
      await treasury.write.claimEpochRewards([1n, 7n]);

      // 3 epochs + 4 more epochs = 7 total * 100 ether
      const expectedAmount = parseEther("100") * 7n;
      expect(await compute.read.balanceOfStack([1n])).to.equal(expectedAmount);
    });
  });

  describe("Emission Configuration — Tuning the economy", function () {
    it("should allow owner to change emission rate", async function () {
      const { treasury } = await loadFixture(deployTreasuryFixture);

      await treasury.write.setEmission([parseEther("200")]);
      expect(await treasury.read.emissionPerEpoch()).to.equal(parseEther("200"));
    });

    it("should reject emission change from non-owner", async function () {
      const { treasury, kovacs } = await loadFixture(deployTreasuryFixture);

      const kovacsTreasury = await hre.viem.getContractAt("QuellistTreasury", treasury.address, {
        client: { wallet: kovacs },
      });
      await expect(
        kovacsTreasury.write.setEmission([parseEther("999999")])
      ).to.be.rejected;
    });

    it("should apply new emission rate to subsequent claims", async function () {
      const { treasury, compute } = await loadFixture(deployTreasuryFixture);

      // Claim at old rate (100/epoch) for 2 epochs
      await treasury.write.claimEpochRewards([1n, 2n]);

      // Change emission
      await treasury.write.setEmission([parseEther("200")]);

      // Claim at new rate for 3 more epochs
      await treasury.write.claimEpochRewards([1n, 5n]);

      // 2 * 100 + 3 * 200 = 800
      expect(await compute.read.balanceOfStack([1n])).to.equal(parseEther("800"));
    });
  });
});
