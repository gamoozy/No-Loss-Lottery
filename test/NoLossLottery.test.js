const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("NoLossLottery", function () {
  let mockDAI;
  let yieldStrategy;
  let vrfCoordinator;
  let lottery;
  let owner, user1, user2, user3;
  let subscriptionId;

  const INITIAL_BALANCE = ethers.parseEther("10000");
  const DEPOSIT_AMOUNT = ethers.parseEther("100");

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy MockDAI
    const MockDAI = await ethers.getContractFactory("MockDAI");
    mockDAI = await MockDAI.deploy();
    await mockDAI.waitForDeployment();

    // Deploy MockYieldStrategy
    const MockYieldStrategy = await ethers.getContractFactory("MockYieldStrategy");
    yieldStrategy = await MockYieldStrategy.deploy(await mockDAI.getAddress());
    await yieldStrategy.waitForDeployment();

    // Deploy VRF Coordinator Mock
    const VRFCoordinatorV2Mock = await ethers.getContractFactory("VRFCoordinatorV2Mock");
    vrfCoordinator = await VRFCoordinatorV2Mock.deploy();
    await vrfCoordinator.waitForDeployment();

    // Create and fund VRF subscription
    const createSubTx = await vrfCoordinator.createSubscription();
    const receipt = await createSubTx.wait();
    subscriptionId = 1; // First subscription

    await vrfCoordinator.fundSubscription(subscriptionId, ethers.parseEther("10"));

    // Deploy NoLossLottery
    const NoLossLottery = await ethers.getContractFactory("NoLossLottery");
    lottery = await NoLossLottery.deploy(
      await mockDAI.getAddress(),
      await yieldStrategy.getAddress(),
      await vrfCoordinator.getAddress(),
      subscriptionId
    );
    await lottery.waitForDeployment();

    // Add lottery as consumer
    await vrfCoordinator.addConsumer(subscriptionId, await lottery.getAddress());

    // Mint tokens to users
    await mockDAI.mint(user1.address, INITIAL_BALANCE);
    await mockDAI.mint(user2.address, INITIAL_BALANCE);
    await mockDAI.mint(user3.address, INITIAL_BALANCE);

    // Approve lottery to spend tokens
    await mockDAI.connect(user1).approve(await lottery.getAddress(), ethers.MaxUint256);
    await mockDAI.connect(user2).approve(await lottery.getAddress(), ethers.MaxUint256);
    await mockDAI.connect(user3).approve(await lottery.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the correct deposit token", async function () {
      expect(await lottery.depositToken()).to.equal(await mockDAI.getAddress());
    });

    it("Should set the correct yield strategy", async function () {
      expect(await lottery.yieldStrategy()).to.equal(await yieldStrategy.getAddress());
    });

    it("Should start at round 1", async function () {
      expect(await lottery.currentRound()).to.equal(1);
    });

    it("Should have zero total deposits initially", async function () {
      expect(await lottery.totalDeposits()).to.equal(0);
    });
  });

  describe("Deposits", function () {
    it("Should allow users to deposit", async function () {
      await lottery.connect(user1).deposit(DEPOSIT_AMOUNT);

      expect(await lottery.userDeposits(user1.address)).to.equal(DEPOSIT_AMOUNT);
      expect(await lottery.totalDeposits()).to.equal(DEPOSIT_AMOUNT);
    });

    it("Should revert on zero deposit", async function () {
      await expect(lottery.connect(user1).deposit(0)).to.be.revertedWith("Amount must be > 0");
    });

    it("Should track multiple depositors", async function () {
      await lottery.connect(user1).deposit(DEPOSIT_AMOUNT);
      await lottery.connect(user2).deposit(DEPOSIT_AMOUNT);
      await lottery.connect(user3).deposit(DEPOSIT_AMOUNT);

      expect(await lottery.getDepositorCount()).to.equal(3);
      expect(await lottery.totalDeposits()).to.equal(DEPOSIT_AMOUNT * 3n);
    });

    it("Should add depositor to list only once", async function () {
      await lottery.connect(user1).deposit(DEPOSIT_AMOUNT);
      await lottery.connect(user1).deposit(DEPOSIT_AMOUNT);

      expect(await lottery.getDepositorCount()).to.equal(1);
      expect(await lottery.userDeposits(user1.address)).to.equal(DEPOSIT_AMOUNT * 2n);
    });

    it("Should deposit funds into yield strategy", async function () {
      await lottery.connect(user1).deposit(DEPOSIT_AMOUNT);

      const strategyBalance = await yieldStrategy.totalBalance();
      expect(strategyBalance).to.equal(DEPOSIT_AMOUNT);
    });

    it("Should emit Deposited event", async function () {
      await expect(lottery.connect(user1).deposit(DEPOSIT_AMOUNT))
        .to.emit(lottery, "Deposited")
        .withArgs(user1.address, DEPOSIT_AMOUNT, DEPOSIT_AMOUNT);
    });
  });

  describe("Withdrawals", function () {
    beforeEach(async function () {
      await lottery.connect(user1).deposit(DEPOSIT_AMOUNT);
    });

    it("Should allow users to withdraw their deposits", async function () {
      const balanceBefore = await mockDAI.balanceOf(user1.address);

      await lottery.connect(user1).withdraw(DEPOSIT_AMOUNT);

      const balanceAfter = await mockDAI.balanceOf(user1.address);
      expect(balanceAfter - balanceBefore).to.equal(DEPOSIT_AMOUNT);
      expect(await lottery.userDeposits(user1.address)).to.equal(0);
    });

    it("Should revert on zero withdrawal", async function () {
      await expect(lottery.connect(user1).withdraw(0)).to.be.revertedWith("Amount must be > 0");
    });

    it("Should revert on insufficient balance", async function () {
      await expect(
        lottery.connect(user1).withdraw(DEPOSIT_AMOUNT + ethers.parseEther("1"))
      ).to.be.revertedWith("Insufficient balance");
    });

    it("Should allow partial withdrawals", async function () {
      const halfAmount = DEPOSIT_AMOUNT / 2n;
      await lottery.connect(user1).withdraw(halfAmount);

      expect(await lottery.userDeposits(user1.address)).to.equal(halfAmount);
    });

    it("Should emit Withdrawn event", async function () {
      await expect(lottery.connect(user1).withdraw(DEPOSIT_AMOUNT))
        .to.emit(lottery, "Withdrawn")
        .withArgs(user1.address, DEPOSIT_AMOUNT, 0);
    });
  });

  describe("Yield Accumulation", function () {
    beforeEach(async function () {
      await lottery.connect(user1).deposit(DEPOSIT_AMOUNT);
      await lottery.connect(user2).deposit(DEPOSIT_AMOUNT);
    });

    it("Should correctly track yield generation", async function () {
      const totalDeposits = await lottery.totalDeposits();

      // Simulate 1% yield (100 basis points)
      await lottery.simulateYield(100);

      const poolSize = await lottery.getPoolSize();
      const currentYield = await lottery.getCurrentYield();

      expect(poolSize).to.be.gt(totalDeposits);
      expect(currentYield).to.equal(totalDeposits / 100n); // 1%
    });

    it("Should not include yield in user deposits", async function () {
      const depositBefore = await lottery.userDeposits(user1.address);

      await lottery.simulateYield(100);

      const depositAfter = await lottery.userDeposits(user1.address);
      expect(depositAfter).to.equal(depositBefore);
    });

    it("Should calculate yield correctly for multiple simulations", async function () {
      await lottery.simulateYield(100); // 1%
      const yield1 = await lottery.getCurrentYield();

      await lottery.simulateYield(100); // another 1% on new balance
      const yield2 = await lottery.getCurrentYield();

      expect(yield2).to.be.gt(yield1);
    });
  });

  describe("Round Management", function () {
    beforeEach(async function () {
      await lottery.connect(user1).deposit(DEPOSIT_AMOUNT);
      await lottery.connect(user2).deposit(DEPOSIT_AMOUNT);
      await lottery.connect(user3).deposit(DEPOSIT_AMOUNT);
    });

    it("Should not allow ending round before duration passes", async function () {
      await expect(lottery.endRound()).to.be.revertedWith("Round not finished");
    });

    it("Should allow ending round after duration", async function () {
      await lottery.simulateYield(100); // Generate some yield

      // Fast forward time
      await time.increase(24 * 60 * 60 + 1); // 1 day + 1 second

      await expect(lottery.endRound()).to.not.be.reverted;
    });

    it("Should start with round 1", async function () {
      expect(await lottery.currentRound()).to.equal(1);
    });

    it("Should track round information", async function () {
      const round = await lottery.getRound(1);
      expect(round.roundNumber).to.equal(1);
      expect(round.drawn).to.equal(false);
    });
  });

  describe("Random Winner Selection", function () {
    beforeEach(async function () {
      await lottery.connect(user1).deposit(DEPOSIT_AMOUNT);
      await lottery.connect(user2).deposit(DEPOSIT_AMOUNT);
      await lottery.connect(user3).deposit(DEPOSIT_AMOUNT);
      await lottery.simulateYield(100); // 1% yield
    });

    it("Should request randomness when ending round", async function () {
      await time.increase(24 * 60 * 60 + 1);

      const tx = await lottery.endRound();
      const receipt = await tx.wait();

      expect(await lottery.pendingVRFRequest()).to.not.equal(0);
    });

    it("Should select a winner and award prize", async function () {
      await time.increase(24 * 60 * 60 + 1);

      const yieldBefore = await lottery.getCurrentYield();

      // End round (requests randomness)
      await lottery.endRound();
      const requestId = await lottery.pendingVRFRequest();

      // Fulfill randomness
      await vrfCoordinator.fulfillRandomWords(requestId, await lottery.getAddress());

      // Check that a winner was selected
      const round = await lottery.getRound(1);
      expect(round.drawn).to.equal(true);
      expect(round.winner).to.not.equal(ethers.ZeroAddress);
      expect(round.prizeAmount).to.equal(yieldBefore);

      // Check winner has prize to claim
      const winnerPrize = await lottery.userPrizes(round.winner);
      expect(winnerPrize).to.equal(yieldBefore);
    });

    it("Should advance to next round after winner selection", async function () {
      await time.increase(24 * 60 * 60 + 1);

      await lottery.endRound();
      const requestId = await lottery.pendingVRFRequest();

      await vrfCoordinator.fulfillRandomWords(requestId, await lottery.getAddress());

      expect(await lottery.currentRound()).to.equal(2);
    });

    it("Should allow winner to claim prize", async function () {
      await time.increase(24 * 60 * 60 + 1);

      const yieldAmount = await lottery.getCurrentYield();

      await lottery.endRound();
      const requestId = await lottery.pendingVRFRequest();
      await vrfCoordinator.fulfillRandomWords(requestId, await lottery.getAddress());

      const round = await lottery.getRound(1);
      const winner = round.winner;

      const balanceBefore = await mockDAI.balanceOf(winner);

      // Winner claims prize
      await lottery.connect(await ethers.getSigner(winner)).claimPrize();

      const balanceAfter = await mockDAI.balanceOf(winner);
      expect(balanceAfter - balanceBefore).to.equal(yieldAmount);
    });

    it("Should emit WinnerSelected event", async function () {
      await time.increase(24 * 60 * 60 + 1);

      await lottery.endRound();
      const requestId = await lottery.pendingVRFRequest();

      await expect(vrfCoordinator.fulfillRandomWords(requestId, await lottery.getAddress()))
        .to.emit(lottery, "WinnerSelected");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await lottery.connect(user1).deposit(DEPOSIT_AMOUNT);
      await lottery.connect(user2).deposit(DEPOSIT_AMOUNT * 2n);
    });

    it("Should return correct user balance", async function () {
      const balance = await lottery.getUserBalance(user1.address);
      expect(balance).to.equal(DEPOSIT_AMOUNT);
    });

    it("Should return correct user share", async function () {
      const share = await lottery.getUserShare(user1.address);
      // user1 has 100, total is 300, so 100/300 = 33.33% = 3333 basis points
      expect(share).to.equal(3333n);
    });

    it("Should return correct user odds (uniform)", async function () {
      // 2 depositors, so 50% odds each (5000 basis points)
      const odds = await lottery.getUserOdds(user1.address);
      expect(odds).to.equal(5000n); // 10000 / 2 depositors
    });

    it("Should return correct pool size", async function () {
      const poolSize = await lottery.getPoolSize();
      expect(poolSize).to.equal(DEPOSIT_AMOUNT * 3n);
    });

    it("Should return correct current yield", async function () {
      await lottery.simulateYield(100); // 1%
      const currentYield = await lottery.getCurrentYield();
      expect(currentYield).to.equal((DEPOSIT_AMOUNT * 3n) / 100n);
    });

    it("Should return depositors list", async function () {
      const depositors = await lottery.getDepositors();
      expect(depositors.length).to.equal(2);
      expect(depositors).to.include(user1.address);
      expect(depositors).to.include(user2.address);
    });
  });

  describe("Multi-Round Scenario", function () {
    it("Should handle multiple rounds correctly", async function () {
      // Round 1
      await lottery.connect(user1).deposit(DEPOSIT_AMOUNT);
      await lottery.connect(user2).deposit(DEPOSIT_AMOUNT);

      await lottery.simulateYield(100);
      await time.increase(24 * 60 * 60 + 1);

      await lottery.endRound();
      let requestId = await lottery.pendingVRFRequest();
      await vrfCoordinator.fulfillRandomWords(requestId, await lottery.getAddress());

      expect(await lottery.currentRound()).to.equal(2);

      // Round 2
      await lottery.connect(user3).deposit(DEPOSIT_AMOUNT);
      await lottery.simulateYield(100);
      await time.increase(24 * 60 * 60 + 1);

      await lottery.endRound();
      requestId = await lottery.pendingVRFRequest();
      await vrfCoordinator.fulfillRandomWords(requestId, await lottery.getAddress());

      expect(await lottery.currentRound()).to.equal(3);

      // Check both rounds have winners
      const round1 = await lottery.getRound(1);
      const round2 = await lottery.getRound(2);

      expect(round1.drawn).to.equal(true);
      expect(round2.drawn).to.equal(true);
      expect(round1.winner).to.not.equal(ethers.ZeroAddress);
      expect(round2.winner).to.not.equal(ethers.ZeroAddress);
    });
  });

  describe("No-Loss Property", function () {
    it("Should never reduce user principal", async function () {
      await lottery.connect(user1).deposit(DEPOSIT_AMOUNT);

      const depositAfter1 = await lottery.userDeposits(user1.address);

      // Simulate multiple rounds
      for (let i = 0; i < 3; i++) {
        await lottery.simulateYield(100);
        await time.increase(24 * 60 * 60 + 1);
        await lottery.endRound();
        const requestId = await lottery.pendingVRFRequest();
        if (requestId > 0) {
          await vrfCoordinator.fulfillRandomWords(requestId, await lottery.getAddress());
        }
      }

      const depositAfter2 = await lottery.userDeposits(user1.address);

      // User's deposit should remain the same
      expect(depositAfter2).to.equal(depositAfter1);
      expect(depositAfter2).to.equal(DEPOSIT_AMOUNT);
    });

    it("Should allow full withdrawal of principal at any time", async function () {
      await lottery.connect(user1).deposit(DEPOSIT_AMOUNT);

      await lottery.simulateYield(100);
      await time.increase(24 * 60 * 60 + 1);

      // Should be able to withdraw full amount
      await expect(lottery.connect(user1).withdraw(DEPOSIT_AMOUNT)).to.not.be.reverted;

      expect(await lottery.userDeposits(user1.address)).to.equal(0);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero yield round", async function () {
      await lottery.connect(user1).deposit(DEPOSIT_AMOUNT);

      await time.increase(24 * 60 * 60 + 1);

      // End round without generating yield
      await lottery.endRound();

      // Should advance to next round without VRF request
      expect(await lottery.currentRound()).to.equal(2);
      expect(await lottery.pendingVRFRequest()).to.equal(0);
    });

    it("Should handle single depositor", async function () {
      await lottery.connect(user1).deposit(DEPOSIT_AMOUNT);

      await lottery.simulateYield(100);
      await time.increase(24 * 60 * 60 + 1);

      await lottery.endRound();
      const requestId = await lottery.pendingVRFRequest();
      await vrfCoordinator.fulfillRandomWords(requestId, await lottery.getAddress());

      const round = await lottery.getRound(1);
      expect(round.winner).to.equal(user1.address);
    });

    it("Should revert claiming prize with no prize", async function () {
      await lottery.connect(user1).deposit(DEPOSIT_AMOUNT);

      await expect(lottery.connect(user1).claimPrize()).to.be.revertedWith("No prize to claim");
    });
  });
});
