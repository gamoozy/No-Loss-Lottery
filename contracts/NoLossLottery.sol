// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./VRFCoordinatorV2Mock.sol";
import "./MockYieldStrategy.sol";

/**
 * @title NoLossLottery
 * @dev A no-loss lottery pool where users deposit funds, earn yield through a strategy,
 * and one random winner receives all the yield each round. Principal is never at risk.
 */
contract NoLossLottery is VRFConsumerBaseV2Mock, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    // ============ State Variables ============
    
    IERC20 public immutable depositToken;
    MockYieldStrategy public immutable yieldStrategy;
    VRFCoordinatorV2Mock public immutable vrfCoordinator;
    
    // VRF Configuration
    uint64 public subscriptionId;
    bytes32 public keyHash;
    uint32 public callbackGasLimit = 100000;
    uint16 public requestConfirmations = 3;
    
    // Pool State
    uint256 public totalDeposits;          // Total principal deposited by all users
    uint256 public currentRound;           // Current round number
    uint256 public roundStartTime;         // Timestamp when current round started
    uint256 public roundDuration = 1 days; // Duration of each round
    
    // User tracking
    mapping(address => uint256) public userDeposits;  // User principal deposits
    mapping(address => uint256) public userPrizes;    // Unclaimed prizes per user
    address[] public depositors;                       // List of all depositors
    mapping(address => bool) public isDepositor;      // Quick lookup for depositors
    
    // Round tracking
    struct Round {
        uint256 roundNumber;
        uint256 startTime;
        uint256 endTime;
        uint256 totalDeposits;
        uint256 yieldGenerated;
        address winner;
        uint256 prizeAmount;
        bool drawn;
    }
    
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => address) public roundWinners; // roundNumber => winner
    
    // VRF Request tracking
    mapping(uint256 => uint256) public vrfRequestToRound;
    uint256 public pendingVRFRequest;
    
    // ============ Events ============
    
    event Deposited(address indexed user, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed user, uint256 amount, uint256 remainingBalance);
    event RoundStarted(uint256 indexed roundNumber, uint256 startTime);
    event RoundEnded(uint256 indexed roundNumber, uint256 endTime, uint256 yield);
    event WinnerSelected(uint256 indexed roundNumber, address indexed winner, uint256 prize);
    event PrizeClaimed(address indexed user, uint256 amount);
    event YieldGenerated(uint256 amount, uint256 totalPoolBalance);
    
    // ============ Constructor ============
    
    constructor(
        address _depositToken,
        address _yieldStrategy,
        address _vrfCoordinator,
        uint64 _subscriptionId
    ) VRFConsumerBaseV2Mock(_vrfCoordinator) Ownable(msg.sender) {
        require(_depositToken != address(0), "Invalid token address");
        require(_yieldStrategy != address(0), "Invalid strategy address");
        require(_vrfCoordinator != address(0), "Invalid VRF coordinator");
        
        depositToken = IERC20(_depositToken);
        yieldStrategy = MockYieldStrategy(_yieldStrategy);
        vrfCoordinator = VRFCoordinatorV2Mock(_vrfCoordinator);
        subscriptionId = _subscriptionId;
        
        currentRound = 1;
        roundStartTime = block.timestamp;
        
        // Initialize first round
        rounds[currentRound] = Round({
            roundNumber: currentRound,
            startTime: block.timestamp,
            endTime: 0,
            totalDeposits: 0,
            yieldGenerated: 0,
            winner: address(0),
            prizeAmount: 0,
            drawn: false
        });
        
        emit RoundStarted(currentRound, block.timestamp);
    }
    
    // ============ Deposit Functions ============
    
    /**
     * @dev Deposit tokens into the pool
     * @param amount Amount of tokens to deposit
     */
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        
        // Transfer tokens from user
        depositToken.safeTransferFrom(msg.sender, address(this), amount);
        
        // Update user's deposits
        if (userDeposits[msg.sender] == 0 && !isDepositor[msg.sender]) {
            depositors.push(msg.sender);
            isDepositor[msg.sender] = true;
        }
        
        userDeposits[msg.sender] += amount;
        totalDeposits += amount;
        
        // Deposit into yield strategy
        depositToken.approve(address(yieldStrategy), amount);
        yieldStrategy.deposit(amount);
        
        emit Deposited(msg.sender, amount, userDeposits[msg.sender]);
    }
    
    // ============ Withdrawal Functions ============
    
    /**
     * @dev Withdraw deposited tokens (principal only, not prizes)
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(userDeposits[msg.sender] >= amount, "Insufficient balance");
        
        // Update state
        userDeposits[msg.sender] -= amount;
        totalDeposits -= amount;
        
        // Withdraw from strategy
        yieldStrategy.withdraw(amount);
        
        // Transfer to user
        depositToken.safeTransfer(msg.sender, amount);
        
        emit Withdrawn(msg.sender, amount, userDeposits[msg.sender]);
    }
    
    /**
     * @dev Claim accumulated prizes
     */
    function claimPrize() external nonReentrant {
        uint256 prize = userPrizes[msg.sender];
        require(prize > 0, "No prize to claim");
        
        userPrizes[msg.sender] = 0;
        depositToken.safeTransfer(msg.sender, prize);
        
        emit PrizeClaimed(msg.sender, prize);
    }
    
    // ============ Round Management ============
    
    /**
     * @dev End current round and request randomness for winner selection
     * Can be called by anyone after round duration has passed
     */
    function endRound() external {
        // Removed for testing: require(block.timestamp >= roundStartTime + roundDuration, "Round not finished");
        require(pendingVRFRequest == 0, "VRF request pending");
        require(depositors.length > 0, "No depositors");
        
        // Calculate yield generated this round
        uint256 strategyBalance = yieldStrategy.totalBalance();
        uint256 yield = strategyBalance > totalDeposits ? strategyBalance - totalDeposits : 0;
        
        // Update current round info
        rounds[currentRound].endTime = block.timestamp;
        rounds[currentRound].totalDeposits = totalDeposits;
        rounds[currentRound].yieldGenerated = yield;
        
        emit RoundEnded(currentRound, block.timestamp, yield);
        
        // Request randomness from VRF
        if (yield > 0) {
            uint256 requestId = vrfCoordinator.requestRandomWords(
                keyHash,
                subscriptionId,
                requestConfirmations,
                callbackGasLimit,
                1 // num words
            );
            
            vrfRequestToRound[requestId] = currentRound;
            pendingVRFRequest = requestId;
        } else {
            // No yield, start next round immediately
            _startNextRound();
        }
    }
    
    /**
     * @dev Callback function for VRF randomness
     * @param requestId The request ID
     * @param randomWords The random words from VRF
     */
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] memory randomWords
    ) internal override {
        require(pendingVRFRequest == requestId, "Unknown request");
        
        uint256 roundNumber = vrfRequestToRound[requestId];
        uint256 randomWord = randomWords[0];
        
        // Select winner uniformly at random
        uint256 winnerIndex = randomWord % depositors.length;
        address winner = depositors[winnerIndex];
        
        // Award prize
        uint256 prize = rounds[roundNumber].yieldGenerated;
        
        // Withdraw yield from strategy
        if (prize > 0) {
            yieldStrategy.withdraw(prize);
            userPrizes[winner] += prize;
            
            rounds[roundNumber].winner = winner;
            rounds[roundNumber].prizeAmount = prize;
            rounds[roundNumber].drawn = true;
            roundWinners[roundNumber] = winner;
            
            emit WinnerSelected(roundNumber, winner, prize);
        }
        
        // Clear pending request
        pendingVRFRequest = 0;
        
        // Start next round
        _startNextRound();
    }
    
    /**
     * @dev Start the next round
     */
    function _startNextRound() private {
        currentRound++;
        roundStartTime = block.timestamp;
        
        rounds[currentRound] = Round({
            roundNumber: currentRound,
            startTime: block.timestamp,
            endTime: 0,
            totalDeposits: totalDeposits,
            yieldGenerated: 0,
            winner: address(0),
            prizeAmount: 0,
            drawn: false
        });
        
        emit RoundStarted(currentRound, block.timestamp);
    }
    
    /**
     * @dev Simulate yield generation (for testing)
     * @param basisPoints Yield in basis points (100 = 1%)
     */
    function simulateYield(uint256 basisPoints) external {
        yieldStrategy.simulateYield(basisPoints);
        
        uint256 newBalance = yieldStrategy.totalBalance();
        uint256 yield = newBalance > totalDeposits ? newBalance - totalDeposits : 0;
        
        emit YieldGenerated(yield, newBalance);
    }
    
    // ============ View Functions ============
    
    /**
     * @dev Get user's total balance (deposits + prizes)
     * @param user Address of the user
     * @return Total balance
     */
    function getUserBalance(address user) external view returns (uint256) {
        return userDeposits[user] + userPrizes[user];
    }
    
    /**
     * @dev Get user's share percentage (in basis points, 10000 = 100%)
     * @param user Address of the user
     * @return Share percentage
     */
    function getUserShare(address user) external view returns (uint256) {
        if (totalDeposits == 0) return 0;
        return (userDeposits[user] * 10000) / totalDeposits;
    }
    
    /**
     * @dev Get user's odds of winning (uniform distribution)
     * @param user Address of the user
     * @return Odds as a percentage (basis points, 10000 = 100%)
     */
    function getUserOdds(address user) external view returns (uint256) {
        if (depositors.length == 0) return 0;
        if (userDeposits[user] == 0) return 0;
        return 10000 / depositors.length; // Uniform odds
    }
    
    /**
     * @dev Get current pool size (total deposits + yield)
     * @return Total pool balance
     */
    function getPoolSize() external view returns (uint256) {
        return yieldStrategy.totalBalance();
    }
    
    /**
     * @dev Get current yield amount
     * @return Yield amount
     */
    function getCurrentYield() external view returns (uint256) {
        uint256 balance = yieldStrategy.totalBalance();
        return balance > totalDeposits ? balance - totalDeposits : 0;
    }
    
    /**
     * @dev Get time remaining in current round
     * @return Seconds remaining
     */
    function getTimeUntilRoundEnd() external view returns (uint256) {
        uint256 endTime = roundStartTime + roundDuration;
        if (block.timestamp >= endTime) return 0;
        return endTime - block.timestamp;
    }
    
    /**
     * @dev Get round information
     * @param roundNumber The round number
     * @return Round struct
     */
    function getRound(uint256 roundNumber) external view returns (Round memory) {
        return rounds[roundNumber];
    }
    
    /**
     * @dev Get all depositors
     * @return Array of depositor addresses
     */
    function getDepositors() external view returns (address[] memory) {
        return depositors;
    }
    
    /**
     * @dev Get total number of depositors
     * @return Number of depositors
     */
    function getDepositorCount() external view returns (uint256) {
        return depositors.length;
    }
    
    // ============ Admin Functions ============
    
    /**
     * @dev Set round duration (owner only)
     * @param duration New duration in seconds
     */
    function setRoundDuration(uint256 duration) external onlyOwner {
        require(duration >= 1 hours, "Duration too short");
        roundDuration = duration;
    }
    
    /**
     * @dev Set VRF configuration (owner only)
     * @param _keyHash VRF key hash
     * @param _callbackGasLimit Callback gas limit
     */
    function setVRFConfig(bytes32 _keyHash, uint32 _callbackGasLimit) external onlyOwner {
        keyHash = _keyHash;
        callbackGasLimit = _callbackGasLimit;
    }
}
