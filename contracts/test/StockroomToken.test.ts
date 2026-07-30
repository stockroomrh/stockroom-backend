import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { StockroomToken } from "../typechain-types";

const NAME = "Stockroom Token";
const SYMBOL = "STOCK";
const TOTAL_SUPPLY = ethers.parseUnits("1000000", 18); // 1,000,000 * 10**18

describe("StockroomToken", () => {
  let deployer: HardhatEthersSigner;
  let initialRecipient: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  beforeEach(async () => {
    [deployer, initialRecipient, treasury, owner, stranger] =
      await ethers.getSigners();
  });

  async function deployToken(overrides: {
    totalSupply?: bigint;
    initialRecipient?: string;
    treasury?: string;
    treasuryAllocationBps?: number;
    initialOwner?: string;
  } = {}): Promise<StockroomToken> {
    const Factory = await ethers.getContractFactory("StockroomToken");
    const token = await Factory.deploy(
      NAME,
      SYMBOL,
      overrides.totalSupply ?? TOTAL_SUPPLY,
      overrides.initialRecipient ?? initialRecipient.address,
      overrides.treasury ?? ethers.ZeroAddress,
      overrides.treasuryAllocationBps ?? 0,
      overrides.initialOwner ?? owner.address
    );
    await token.waitForDeployment();
    return token as unknown as StockroomToken;
  }

  describe("basic metadata", () => {
    it("has the correct name, symbol, and decimals", async () => {
      const token = await deployToken();
      expect(await token.name()).to.equal(NAME);
      expect(await token.symbol()).to.equal(SYMBOL);
      expect(await token.decimals()).to.equal(18);
    });

    it("mints exactly totalSupply and nothing more", async () => {
      const token = await deployToken();
      expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY);
    });
  });

  describe("supply split", () => {
    it("sends the full supply to the initial recipient when treasury allocation is zero", async () => {
      const token = await deployToken({ treasuryAllocationBps: 0 });
      expect(await token.balanceOf(initialRecipient.address)).to.equal(
        TOTAL_SUPPLY
      );
      expect(await token.balanceOf(treasury.address)).to.equal(0n);
      expect(await token.treasuryAllocation()).to.equal(0n);
    });

    it("splits supply between initial recipient and treasury per the bps allocation", async () => {
      const bps = 2_000; // 20%
      const token = await deployToken({
        treasury: treasury.address,
        treasuryAllocationBps: bps,
      });

      const expectedTreasury = (TOTAL_SUPPLY * BigInt(bps)) / 10_000n;
      const expectedRecipient = TOTAL_SUPPLY - expectedTreasury;

      expect(await token.balanceOf(treasury.address)).to.equal(
        expectedTreasury
      );
      expect(await token.balanceOf(initialRecipient.address)).to.equal(
        expectedRecipient
      );
      expect(await token.treasuryAllocation()).to.equal(expectedTreasury);
      expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY);
    });

    it("supports a 100% treasury allocation (recipient gets nothing)", async () => {
      const token = await deployToken({
        treasury: treasury.address,
        treasuryAllocationBps: 10_000,
      });
      expect(await token.balanceOf(treasury.address)).to.equal(TOTAL_SUPPLY);
      expect(await token.balanceOf(initialRecipient.address)).to.equal(0n);
    });

    it("reverts if a treasury allocation is set without a treasury address", async () => {
      const Factory = await ethers.getContractFactory("StockroomToken");
      await expect(
        Factory.deploy(
          NAME,
          SYMBOL,
          TOTAL_SUPPLY,
          initialRecipient.address,
          ethers.ZeroAddress,
          1_000,
          owner.address
        )
      ).to.be.reverted;
    });

    it("reverts if a treasury address is set with a zero allocation", async () => {
      const Factory = await ethers.getContractFactory("StockroomToken");
      await expect(
        Factory.deploy(
          NAME,
          SYMBOL,
          TOTAL_SUPPLY,
          initialRecipient.address,
          treasury.address,
          0,
          owner.address
        )
      ).to.be.reverted;
    });

    it("reverts if the treasury allocation exceeds 100%", async () => {
      const Factory = await ethers.getContractFactory("StockroomToken");
      await expect(
        Factory.deploy(
          NAME,
          SYMBOL,
          TOTAL_SUPPLY,
          initialRecipient.address,
          treasury.address,
          10_001,
          owner.address
        )
      ).to.be.reverted;
    });

    it("reverts if the initial recipient is the zero address", async () => {
      const Factory = await ethers.getContractFactory("StockroomToken");
      await expect(
        Factory.deploy(
          NAME,
          SYMBOL,
          TOTAL_SUPPLY,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          0,
          owner.address
        )
      ).to.be.reverted;
    });
  });

  describe("ownership has no special power", () => {
    it("records the configured owner", async () => {
      const token = await deployToken();
      expect(await token.owner()).to.equal(owner.address);
    });

    it("exposes no mint function of any kind", async () => {
      const token = await deployToken();
      const abiFunctionNames = token.interface.fragments
        .filter((f) => f.type === "function")
        .map((f) => (f as { name: string }).name.toLowerCase());
      expect(abiFunctionNames).to.not.include("mint");
    });

    it("exposes no pause/blacklist-style admin functions", async () => {
      const token = await deployToken();
      const abiFunctionNames = token.interface.fragments
        .filter((f) => f.type === "function")
        .map((f) => (f as { name: string }).name.toLowerCase());
      for (const forbidden of ["pause", "unpause", "blacklist", "whitelist", "seize", "freeze"]) {
        expect(abiFunctionNames).to.not.include(forbidden);
      }
    });

    it("allows the owner to transfer ownership (Ownable's only real capability), and non-owners cannot", async () => {
      const token = await deployToken();

      await expect(
        token.connect(stranger).transferOwnership(stranger.address)
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");

      await expect(token.connect(owner).transferOwnership(stranger.address))
        .to.not.be.reverted;
      expect(await token.owner()).to.equal(stranger.address);
    });

    it("allows the owner to renounce ownership, and non-owners cannot", async () => {
      const token = await deployToken();

      await expect(
        token.connect(stranger).renounceOwnership()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");

      await expect(token.connect(owner).renounceOwnership()).to.not.be
        .reverted;
      expect(await token.owner()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("standard ERC-20 behavior", () => {
    it("supports transfer", async () => {
      const token = await deployToken();
      const amount = ethers.parseUnits("100", 18);

      await expect(
        token.connect(initialRecipient).transfer(stranger.address, amount)
      )
        .to.emit(token, "Transfer")
        .withArgs(initialRecipient.address, stranger.address, amount);

      expect(await token.balanceOf(stranger.address)).to.equal(amount);
      expect(await token.balanceOf(initialRecipient.address)).to.equal(
        TOTAL_SUPPLY - amount
      );
    });

    it("reverts a transfer that exceeds balance", async () => {
      const token = await deployToken();
      await expect(
        token.connect(stranger).transfer(initialRecipient.address, 1n)
      ).to.be.reverted;
    });

    it("supports approve + transferFrom", async () => {
      const token = await deployToken();
      const amount = ethers.parseUnits("50", 18);

      await expect(
        token.connect(initialRecipient).approve(stranger.address, amount)
      )
        .to.emit(token, "Approval")
        .withArgs(initialRecipient.address, stranger.address, amount);

      expect(
        await token.allowance(initialRecipient.address, stranger.address)
      ).to.equal(amount);

      await expect(
        token
          .connect(stranger)
          .transferFrom(initialRecipient.address, treasury.address, amount)
      )
        .to.emit(token, "Transfer")
        .withArgs(initialRecipient.address, treasury.address, amount);

      expect(await token.balanceOf(treasury.address)).to.equal(amount);
      expect(
        await token.allowance(initialRecipient.address, stranger.address)
      ).to.equal(0n);
    });

    it("reverts transferFrom beyond the approved allowance", async () => {
      const token = await deployToken();
      const amount = ethers.parseUnits("10", 18);
      await token.connect(initialRecipient).approve(stranger.address, amount);

      await expect(
        token
          .connect(stranger)
          .transferFrom(
            initialRecipient.address,
            treasury.address,
            amount + 1n
          )
      ).to.be.reverted;
    });
  });
});
