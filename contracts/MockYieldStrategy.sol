// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockYieldStrategy
 * @dev Simulates a yield-generating strategy (like Aave/Compound)
 * Accepts deposits and allows simulation of yield generation
 */
contract MockYieldStrategy is Ownable {
    IERC20 public immutable token;
    
    // Track total underlying balance (principal + yield)
    uint256 public underlyingBalance;
    
    // Map of depositor to their shares
    mapping(address => uint256) public deposits;
    
    event Deposited(address indexed depositor, uint256 amount);
    event Withdrawn(address indexed depositor, uint256 amount);
    event YieldSimulated(uint256 yieldAmount, uint256 newBalance);
    
    constructor(address _token) Ownable(msg.sender) {
        token = IERC20(_token);
    }
    
    /**
     * @dev Deposit tokens into the strategy
     * @param amount Amount of tokens to deposit
     */
    function deposit(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        
        token.transferFrom(msg.sender, address(this), amount);
        deposits[msg.sender] += amount;
        underlyingBalance += amount;
        
        emit Deposited(msg.sender, amount);
    }
    
    /**
     * @dev Withdraw tokens from the strategy
     * @param amount Amount of tokens to withdraw
     */
    function withdraw(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(deposits[msg.sender] >= amount, "Insufficient balance");
        require(underlyingBalance >= amount, "Insufficient pool balance");
        
        deposits[msg.sender] -= amount;
        underlyingBalance -= amount;
        token.transfer(msg.sender, amount);
        
        emit Withdrawn(msg.sender, amount);
    }
    
    /**
     * @dev Simulate yield generation (admin only for testing)
     * @param basisPoints Yield in basis points (100 = 1%)
     */
    function simulateYield(uint256 basisPoints) external {
        require(basisPoints > 0 && basisPoints <= 10000, "Invalid basis points");
        
        uint256 yieldAmount = (underlyingBalance * basisPoints) / 10000;
        underlyingBalance += yieldAmount;
        
        // Mint the yield to this contract to simulate actual yield
        // In production, this would come from actual DeFi protocols
        
        emit YieldSimulated(yieldAmount, underlyingBalance);
    }
    
    /**
     * @dev Get the balance of a specific depositor
     * @param depositor Address of the depositor
     * @return Balance of the depositor
     */
    function balanceOf(address depositor) external view returns (uint256) {
        return deposits[depositor];
    }
    
    /**
     * @dev Get total balance including yield
     * @return Total underlying balance
     */
    function totalBalance() external view returns (uint256) {
        return underlyingBalance;
    }
}
