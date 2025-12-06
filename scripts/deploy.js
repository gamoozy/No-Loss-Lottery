const hre = require("hardhat");

async function main() {
  console.log("Deploying No-Loss Lottery contracts...");

  // Get the deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // 1. Deploy MockDAI
  console.log("\n1. Deploying MockDAI...");
  const MockDAI = await hre.ethers.getContractFactory("MockDAI");
  const mockDAI = await MockDAI.deploy();
  await mockDAI.waitForDeployment();
  const mockDAIAddress = await mockDAI.getAddress();
  console.log("MockDAI deployed to:", mockDAIAddress);

  // 2. Deploy MockYieldStrategy
  console.log("\n2. Deploying MockYieldStrategy...");
  const MockYieldStrategy = await hre.ethers.getContractFactory("MockYieldStrategy");
  const yieldStrategy = await MockYieldStrategy.deploy(mockDAIAddress);
  await yieldStrategy.waitForDeployment();
  const yieldStrategyAddress = await yieldStrategy.getAddress();
  console.log("MockYieldStrategy deployed to:", yieldStrategyAddress);

  // 3. Deploy VRF Coordinator Mock
  console.log("\n3. Deploying VRFCoordinatorV2Mock...");
  const VRFCoordinatorV2Mock = await hre.ethers.getContractFactory("VRFCoordinatorV2Mock");
  const vrfCoordinator = await VRFCoordinatorV2Mock.deploy();
  await vrfCoordinator.waitForDeployment();
  const vrfCoordinatorAddress = await vrfCoordinator.getAddress();
  console.log("VRFCoordinatorV2Mock deployed to:", vrfCoordinatorAddress);

  // 4. Create and fund VRF subscription
  console.log("\n4. Creating VRF subscription...");
  const createSubTx = await vrfCoordinator.createSubscription();
  await createSubTx.wait();
  const subscriptionId = 1; // First subscription
  console.log("VRF Subscription ID:", subscriptionId);

  console.log("Funding VRF subscription...");
  await vrfCoordinator.fundSubscription(subscriptionId, hre.ethers.parseEther("10"));
  console.log("VRF subscription funded");

  // 5. Deploy NoLossLottery
  console.log("\n5. Deploying NoLossLottery...");
  const NoLossLottery = await hre.ethers.getContractFactory("NoLossLottery");
  const lottery = await NoLossLottery.deploy(
    mockDAIAddress,
    yieldStrategyAddress,
    vrfCoordinatorAddress,
    subscriptionId
  );
  await lottery.waitForDeployment();
  const lotteryAddress = await lottery.getAddress();
  console.log("NoLossLottery deployed to:", lotteryAddress);

  // 6. Add lottery as VRF consumer
  console.log("\n6. Adding lottery as VRF consumer...");
  await vrfCoordinator.addConsumer(subscriptionId, lotteryAddress);
  console.log("Lottery added as VRF consumer");

  // 7. Mint some DAI to deployer for testing
  console.log("\n7. Minting test DAI...");
  await mockDAI.mint(deployer.address, hre.ethers.parseEther("100000"));
  console.log("Minted 100,000 DAI to deployer");

  // Print summary
  console.log("\n========================================");
  console.log("Deployment Summary");
  console.log("========================================");
  console.log("MockDAI:", mockDAIAddress);
  console.log("MockYieldStrategy:", yieldStrategyAddress);
  console.log("VRFCoordinatorV2Mock:", vrfCoordinatorAddress);
  console.log("NoLossLottery:", lotteryAddress);
  console.log("VRF Subscription ID:", subscriptionId);
  console.log("========================================");

  // Save deployment addresses to a file
  const fs = require("fs");
  const deploymentInfo = {
    network: hre.network.name,
    mockDAI: mockDAIAddress,
    yieldStrategy: yieldStrategyAddress,
    vrfCoordinator: vrfCoordinatorAddress,
    lottery: lotteryAddress,
    subscriptionId: subscriptionId,
    deployer: deployer.address,
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(
    "deployment-info.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("\nDeployment info saved to deployment-info.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
