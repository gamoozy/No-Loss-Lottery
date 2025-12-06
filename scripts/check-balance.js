const { ethers } = require("hardhat");

async function main() {
  const address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const balance = await ethers.provider.getBalance(address);
  console.log(`Balance of ${address}: ${ethers.formatEther(balance)} ETH`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
