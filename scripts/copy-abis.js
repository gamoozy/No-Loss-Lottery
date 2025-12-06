const fs = require('fs');
const path = require('path');

// Paths
const artifactsPath = path.join(__dirname, '..', 'artifacts', 'contracts');
const abisPath = path.join(__dirname, '..', 'frontend', 'src', 'abis');

// Create abis directory if it doesn't exist
if (!fs.existsSync(abisPath)) {
  fs.mkdirSync(abisPath, { recursive: true });
}

// List of contracts to copy
const contracts = [
  { name: 'NoLossLottery', file: 'NoLossLottery.sol/NoLossLottery.json' },
  { name: 'MockDAI', file: 'MockDAI.sol/MockDAI.json' },
  { name: 'MockYieldStrategy', file: 'MockYieldStrategy.sol/MockYieldStrategy.json' },
  { name: 'VRFCoordinatorV2Mock', file: 'VRFCoordinatorV2Mock.sol/VRFCoordinatorV2Mock.json' }
];

// Copy ABIs
contracts.forEach(contract => {
  const sourcePath = path.join(artifactsPath, contract.file);
  const destPath = path.join(abisPath, `${contract.name}.json`);
  
  try {
    const artifact = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const abi = {
      abi: artifact.abi,
      bytecode: artifact.bytecode
    };
    
    fs.writeFileSync(destPath, JSON.stringify(abi, null, 2));
    console.log(`✓ Copied ABI for ${contract.name}`);
  } catch (error) {
    console.error(`✗ Error copying ${contract.name}:`, error.message);
  }
});

console.log('\nABI files copied successfully!');
