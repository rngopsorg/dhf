import { expect } from "chai";
import hre from "hardhat";
import { toHex, keccak256, parseEther } from "viem";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";

/**
 * BandwidthToken — "Bandwidth is the currency of consciousness."
 *
 * In Altered Carbon, the ultra-wealthy (Meths) have limitless resources to
 * maintain multiple sleeves and backup stacks. In our system, bandwidth tokens
 * represent cognitive capacity — compute, memory, sync, routing. They are
 * keyed to Stack identity (not wallet), because bandwidth follows consciousness.
 */
describe("BandwidthToken — Cognitive Bandwidth Economy", function () {
  async function deployBandwidthFixture() {
    const [owner, kovacs, ortega, sleeveRuntime, unauthorized] =
      await hre.viem.getWalletClients();

    // Deploy StackIdentity first — bandwidth is bound to stack identity
    const stack = await hre.viem.deployContract("StackIdentity");

    // Deploy ComputeToken (concrete BandwidthToken) linked to the StackIdentity
    const compute = await hre.viem.deployContract("ComputeToken", [stack.address]);
    const memory = await hre.viem.deployContract("MemoryToken", [stack.address]);

    // Mint a stack for Kovacs
    const kovacsStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
      client: { wallet: kovacs },
    });
    const pubkey = toHex(new Uint8Array(32).fill(0xAC));
    const cpv: [bigint, bigint, bigint, bigint, bigint] = [1_000_000n, 1_000_000n, 1_000_000n, 1_000_000n, 1_000_000n];
    await kovacsStack.write.mintStack([pubkey, cpv, 100_000n, 200_000n]);

    // Mint a stack for Ortega
    const ortegaStack = await hre.viem.getContractAt("StackIdentity", stack.address, {
      client: { wallet: ortega },
    });
    await ortegaStack.write.mintStack([toHex(new Uint8Array(32).fill(0xBE)), cpv, 100_000n, 200_000n]);

    const publicClient = await hre.viem.getPublicClient();

    return { stack, compute, memory, owner, kovacs, ortega, sleeveRuntime, unauthorized, publicClient };
  }

  describe("Token Metadata — Identity of bandwidth channels", function () {
    it("should have correct name and symbol for ComputeToken", async function () {
      const { compute } = await loadFixture(deployBandwidthFixture);
      expect(await compute.read.name()).to.equal("ECCA ComputeToken");
      expect(await compute.read.symbol()).to.equal("CMP");
    });

    it("should have correct name and symbol for MemoryToken", async function () {
      const { memory } = await loadFixture(deployBandwidthFixture);
      expect(await memory.read.name()).to.equal("ECCA MemoryToken");
      expect(await memory.read.symbol()).to.equal("MEM");
    });

    it("should have 18 decimals — fine-grained cognitive capacity", async function () {
      const { compute } = await loadFixture(deployBandwidthFixture);
      expect(await compute.read.decimals()).to.equal(18);
    });
  });

  describe("Minting — Bandwidth allocation to a stack", function () {
    it("should mint bandwidth to a stack — consciousness comes alive", async function () {
      const { compute } = await loadFixture(deployBandwidthFixture);
      const reason = keccak256(toHex("epoch.compute"));

      await compute.write.mint([1n, parseEther("100"), reason]);
      expect(await compute.read.balanceOfStack([1n])).to.equal(parseEther("100"));
    });

    it("should increase totalSupply on mint — more bandwidth in the system", async function () {
      const { compute } = await loadFixture(deployBandwidthFixture);
      const reason = keccak256(toHex("faucet.drip"));

      await compute.write.mint([1n, parseEther("50"), reason]);
      await compute.write.mint([2n, parseEther("30"), reason]);

      expect(await compute.read.totalSupply()).to.equal(parseEther("80"));
    });

    it("should reject mint from non-minter — only the treasury can issue bandwidth", async function () {
      const { compute, kovacs } = await loadFixture(deployBandwidthFixture);
      const reason = keccak256(toHex("stolen"));

      const kovacsCompute = await hre.viem.getContractAt("ComputeToken", compute.address, {
        client: { wallet: kovacs },
      });
      await expect(
        kovacsCompute.write.mint([1n, parseEther("1000000"), reason])
      ).to.be.rejectedWith("not minter");
    });

    it("should allow owner to change the minter — treasury upgrade", async function () {
      const { compute, kovacs } = await loadFixture(deployBandwidthFixture);

      await compute.write.setMinter([kovacs.account.address]);
      const minter = (await compute.read.minter()).toLowerCase();
      expect(minter).to.equal(kovacs.account.address.toLowerCase());
    });
  });

  describe("Sleeve Authorization — Who can spend your bandwidth", function () {
    it("should allow stack owner to authorize a sleeve runtime", async function () {
      const { compute, kovacs, sleeveRuntime } = await loadFixture(deployBandwidthFixture);

      const kovacsCompute = await hre.viem.getContractAt("ComputeToken", compute.address, {
        client: { wallet: kovacs },
      });
      await kovacsCompute.write.authorizeSleeve([1n, sleeveRuntime.account.address, true]);

      expect(await compute.read.sleeveAuthorized([1n, sleeveRuntime.account.address])).to.be.true;
    });

    it("should reject authorization from non-owner — you don't own that stack", async function () {
      const { compute, ortega, sleeveRuntime } = await loadFixture(deployBandwidthFixture);

      // Ortega trying to authorize a sleeve on Kovacs' stack (id=1)
      const ortegaCompute = await hre.viem.getContractAt("ComputeToken", compute.address, {
        client: { wallet: ortega },
      });
      await expect(
        ortegaCompute.write.authorizeSleeve([1n, sleeveRuntime.account.address, true])
      ).to.be.rejectedWith("not stack owner");
    });

    it("should allow revoking sleeve authorization — decommission", async function () {
      const { compute, kovacs, sleeveRuntime } = await loadFixture(deployBandwidthFixture);

      const kovacsCompute = await hre.viem.getContractAt("ComputeToken", compute.address, {
        client: { wallet: kovacs },
      });
      await kovacsCompute.write.authorizeSleeve([1n, sleeveRuntime.account.address, true]);
      await kovacsCompute.write.authorizeSleeve([1n, sleeveRuntime.account.address, false]);

      expect(await compute.read.sleeveAuthorized([1n, sleeveRuntime.account.address])).to.be.false;
    });
  });

  describe("Spending — Burning bandwidth on cognitive operations", function () {
    it("should allow authorized sleeve to spend bandwidth", async function () {
      const { compute, kovacs, sleeveRuntime } = await loadFixture(deployBandwidthFixture);
      const reason = keccak256(toHex("perceive.visual"));

      // Mint bandwidth
      await compute.write.mint([1n, parseEther("100"), reason]);

      // Authorize sleeve
      const kovacsCompute = await hre.viem.getContractAt("ComputeToken", compute.address, {
        client: { wallet: kovacs },
      });
      await kovacsCompute.write.authorizeSleeve([1n, sleeveRuntime.account.address, true]);

      // Sleeve spends bandwidth on cognitive op
      const sleeveCompute = await hre.viem.getContractAt("ComputeToken", compute.address, {
        client: { wallet: sleeveRuntime },
      });
      await sleeveCompute.write.spend([1n, parseEther("25"), reason]);

      expect(await compute.read.balanceOfStack([1n])).to.equal(parseEther("75"));
    });

    it("should allow stack owner to spend directly", async function () {
      const { compute, kovacs } = await loadFixture(deployBandwidthFixture);
      const reason = keccak256(toHex("recall.deep"));

      await compute.write.mint([1n, parseEther("50"), reason]);

      const kovacsCompute = await hre.viem.getContractAt("ComputeToken", compute.address, {
        client: { wallet: kovacs },
      });
      await kovacsCompute.write.spend([1n, parseEther("20"), reason]);

      expect(await compute.read.balanceOfStack([1n])).to.equal(parseEther("30"));
    });

    it("should reject spend from unauthorized address — no stealing bandwidth", async function () {
      const { compute, unauthorized } = await loadFixture(deployBandwidthFixture);
      const reason = keccak256(toHex("hack.attempt"));

      await compute.write.mint([1n, parseEther("100"), reason]);

      const badActor = await hre.viem.getContractAt("ComputeToken", compute.address, {
        client: { wallet: unauthorized },
      });
      await expect(
        badActor.write.spend([1n, parseEther("50"), reason])
      ).to.be.rejectedWith("not authorized to spend");
    });

    it("should reject overspend — insufficient bandwidth for cognitive op", async function () {
      const { compute, kovacs } = await loadFixture(deployBandwidthFixture);
      const reason = keccak256(toHex("overload"));

      await compute.write.mint([1n, parseEther("10"), reason]);

      const kovacsCompute = await hre.viem.getContractAt("ComputeToken", compute.address, {
        client: { wallet: kovacs },
      });
      await expect(
        kovacsCompute.write.spend([1n, parseEther("100"), reason])
      ).to.be.rejectedWith("insufficient bandwidth");
    });

    it("should decrease totalSupply on spend — bandwidth consumed", async function () {
      const { compute, kovacs } = await loadFixture(deployBandwidthFixture);
      const reason = keccak256(toHex("compute.fold"));

      await compute.write.mint([1n, parseEther("100"), reason]);

      const kovacsCompute = await hre.viem.getContractAt("ComputeToken", compute.address, {
        client: { wallet: kovacs },
      });
      await kovacsCompute.write.spend([1n, parseEther("40"), reason]);

      expect(await compute.read.totalSupply()).to.equal(parseEther("60"));
    });
  });

  describe("Stack-to-Stack Transfer — Bandwidth follows consciousness", function () {
    it("should transfer bandwidth between stacks", async function () {
      const { compute, kovacs } = await loadFixture(deployBandwidthFixture);
      const reason = keccak256(toHex("allocation"));

      await compute.write.mint([1n, parseEther("100"), reason]);

      const kovacsCompute = await hre.viem.getContractAt("ComputeToken", compute.address, {
        client: { wallet: kovacs },
      });
      // Kovacs transfers bandwidth to Ortega's stack (id=2)
      await kovacsCompute.write.transferStack([1n, 2n, parseEther("30")]);

      expect(await compute.read.balanceOfStack([1n])).to.equal(parseEther("70"));
      expect(await compute.read.balanceOfStack([2n])).to.equal(parseEther("30"));
    });

    it("should reject transfer from non-owner — can't move someone else's bandwidth", async function () {
      const { compute, ortega } = await loadFixture(deployBandwidthFixture);
      const reason = keccak256(toHex("legit"));

      await compute.write.mint([1n, parseEther("100"), reason]);

      // Ortega tries to transfer from Kovacs' stack
      const ortegaCompute = await hre.viem.getContractAt("ComputeToken", compute.address, {
        client: { wallet: ortega },
      });
      await expect(
        ortegaCompute.write.transferStack([1n, 2n, parseEther("50")])
      ).to.be.rejectedWith("not stack owner");
    });

    it("should reject transfer exceeding balance — can't overdraft consciousness", async function () {
      const { compute, kovacs } = await loadFixture(deployBandwidthFixture);
      const reason = keccak256(toHex("bootstrap"));

      await compute.write.mint([1n, parseEther("10"), reason]);

      const kovacsCompute = await hre.viem.getContractAt("ComputeToken", compute.address, {
        client: { wallet: kovacs },
      });
      await expect(
        kovacsCompute.write.transferStack([1n, 2n, parseEther("100")])
      ).to.be.rejectedWith("insufficient");
    });
  });
});
