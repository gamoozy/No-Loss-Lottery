const hre = require("hardhat");

async function main() {
  const deploymentInfo = require("../deployment-info.json");

  console.log("Interacting with deployed contracts...");
  console.log("Network:", hre.network.name);

  const [deployer, user1, user2] = await hre.ethers.getSigners();

  // Get contract instances
  const mockDAI = await hre.ethers.getContractAt("MockDAI", deploymentInfo.mockDAI);
  const lottery = await hre.ethers.getContractAt("NoLossLottery", deploymentInfo.lottery);
  const vrfCoordinator = await hre.ethers.getContractAt(
    "VRFCoordinatorV2Mock",
    deploymentInfo.vrfCoordinator
  );

  console.log("\n=== Simulating Lottery Round ===\n");

  // 1. Mint DAI to test users
  console.log("1. Minting DAI to test users...");
  const mintAmount = hre.ethers.parseEther("1000");
  await mockDAI.mint(user1.address, mintAmount);
  await mockDAI.mint(user2.address, mintAmount);
  console.log(`Minted ${hre.ethers.formatEther(mintAmount)} DAI to each user`);

  // 2. Approve lottery to spend DAI
  console.log("\n2. Approving lottery to spend DAI...");
  await mockDAI.connect(user1).approve(deploymentInfo.lottery, hre.ethers.MaxUint256);
  await mockDAI.connect(user2).approve(deploymentInfo.lottery, hre.ethers.MaxUint256);
  console.log("Approvals granted");

  // 3. Users deposit
  console.log("\n3. Users depositing...");
  const depositAmount = hre.ethers.parseEther("100");
  await lottery.connect(user1).deposit(depositAmount);
  await lottery.connect(user2).deposit(depositAmount);
  console.log(`User1 deposited: ${hre.ethers.formatEther(depositAmount)} DAI`);
  console.log(`User2 deposited: ${hre.ethers.formatEther(depositAmount)} DAI`);

  // 4. Check pool status
  console.log("\n4. Pool Status:");
  const totalDeposits = await lottery.totalDeposits();
  const poolSize = await lottery.getPoolSize();
  const depositorCount = await lottery.getDepositorCount();
  console.log(`Total Deposits: ${hre.ethers.formatEther(totalDeposits)} DAI`);
  console.log(`Pool Size: ${hre.ethers.formatEther(poolSize)} DAI`);
  console.log(`Number of Depositors: ${depositorCount}`);

  // 5. Simulate yield generation
  console.log("\n5. Simulating yield generation (1%)...");
  await lottery.simulateYield(100); // 100 basis points = 1%
  const currentYield = await lottery.getCurrentYield();
  console.log(`Current Yield: ${hre.ethers.formatEther(currentYield)} DAI`);

  // 6. Fast forward time (for local testing)
  if (hre.network.name === "hardhat" || hre.network.name === "localhost") {
    console.log("\n6. Fast forwarding time (1 day)...");
    await hre.network.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
    await hre.network.provider.send("evm_mine");
    console.log("Time advanced");
  }

  // 7. End round
  console.log("\n7. Ending round...");
  const timeUntilEnd = await lottery.getTimeUntilRoundEnd();
  console.log(`Time until round end: ${timeUntilEnd} seconds`);
  
  if (timeUntilEnd == 0n) {
    await lottery.endRound();
    console.log("Round ended, randomness requested");

    // 8. Fulfill VRF request
    const requestId = await lottery.pendingVRFRequest();
    console.log(`VRF Request ID: ${requestId}`);

    console.log("\n8. Fulfilling VRF randomness...");
    await vrfCoordinator.fulfillRandomWords(requestId, deploymentInfo.lottery);
    console.log("Randomness fulfilled");

    // 9. Check winner
    console.log("\n9. Round Results:");
    const round = await lottery.getRound(1);
    console.log(`Winner: ${round.winner}`);
    console.log(`Prize Amount: ${hre.ethers.formatEther(round.prizeAmount)} DAI`);
    console.log(`Yield Generated: ${hre.ethers.formatEther(round.yieldGenerated)} DAI`);

    // 10. Check user balances
    console.log("\n10. User Balances:");
    const user1Balance = await lottery.getUserBalance(user1.address);
    const user2Balance = await lottery.getUserBalance(user2.address);
    const user1Prize = await lottery.userPrizes(user1.address);
    const user2Prize = await lottery.userPrizes(user2.address);
    
    console.log(`User1 - Deposits: ${hre.ethers.formatEther(await lottery.userDeposits(user1.address))} DAI, Prizes: ${hre.ethers.formatEther(user1Prize)} DAI`);
    console.log(`User2 - Deposits: ${hre.ethers.formatEther(await lottery.userDeposits(user2.address))} DAI, Prizes: ${hre.ethers.formatEther(user2Prize)} DAI`);

    console.log("\n=== Round Complete ===");
  } else {
    console.log("Cannot end round yet - time requirement not met");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
