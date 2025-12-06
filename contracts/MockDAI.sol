// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockDAI
 * @dev Mock DAI token for testing the No-Loss Lottery
 */
contract MockDAI is ERC20, Ownable {
    constructor() ERC20("Mock DAI", "mDAI") Ownable(msg.sender) {
        // Mint 1 million DAI to deployer for testing
        _mint(msg.sender, 1_000_000 * 10**decimals());
    }

    /**
     * @dev Mint tokens to any address (for testing purposes)
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @dev Faucet function - anyone can get 1000 DAI for testing
     */
    function faucet() external {
        _mint(msg.sender, 1000 * 10**decimals());
    }
}
