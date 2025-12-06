// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VRFCoordinatorV2Mock
 * @dev Mock Chainlink VRF Coordinator for testing
 * Simplified version that provides deterministic randomness for testing
 */
contract VRFCoordinatorV2Mock {
    uint64 private s_currentSubId;
    uint256 private s_requestId = 1;
    
    struct Subscription {
        address owner;
        uint96 balance;
    }
    
    mapping(uint64 => Subscription) public s_subscriptions;
    mapping(uint256 => address) public s_requestIdToConsumer;
    
    event SubscriptionCreated(uint64 indexed subId, address owner);
    event RandomWordsRequested(
        uint256 indexed requestId,
        uint64 indexed subId,
        address indexed consumer
    );
    event RandomWordsFulfilled(uint256 indexed requestId, uint256 randomWord);
    
    /**
     * @dev Create a new subscription
     * @return subId The subscription ID
     */
    function createSubscription() external returns (uint64 subId) {
        s_currentSubId++;
        subId = s_currentSubId;
        s_subscriptions[subId] = Subscription({owner: msg.sender, balance: 0});
        emit SubscriptionCreated(subId, msg.sender);
        return subId;
    }
    
    /**
     * @dev Fund a subscription (mock - no actual LINK needed)
     * @param subId The subscription ID
     * @param amount Amount to fund (not actually transferred in mock)
     */
    function fundSubscription(uint64 subId, uint96 amount) external {
        require(s_subscriptions[subId].owner != address(0), "Invalid subId");
        s_subscriptions[subId].balance += amount;
    }
    
    /**
     * @dev Add a consumer to a subscription
     * @param subId The subscription ID
     * @param consumer The consumer contract address
     */
    function addConsumer(uint64 subId, address consumer) external {
        require(s_subscriptions[subId].owner == msg.sender, "Not subscription owner");
        // In mock, we just verify ownership, no actual storage needed
    }
    
    /**
     * @dev Request random words (mock version)
     * @param subId Subscription ID
     * @param requestConfirmations Number of confirmations
     * @param callbackGasLimit Gas limit for callback
     * @param numWords Number of random words
     * @return requestId The request ID
     */
    function requestRandomWords(
        bytes32, // keyHash (unused in mock)
        uint64 subId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords
    ) external returns (uint256 requestId) {
        require(s_subscriptions[subId].owner != address(0), "Invalid subId");
        require(numWords <= 500, "Too many words requested");
        
        requestId = s_requestId++;
        s_requestIdToConsumer[requestId] = msg.sender;
        
        emit RandomWordsRequested(requestId, subId, msg.sender);
        return requestId;
    }
    
    /**
     * @dev Fulfill random words request (manual fulfillment for testing)
     * @param requestId The request ID
     * @param consumer The consumer contract
     */
    function fulfillRandomWords(uint256 requestId, address consumer) external {
        require(s_requestIdToConsumer[requestId] == consumer, "Invalid consumer");
        
        // Generate pseudo-random number for testing
        uint256 randomWord = uint256(
            keccak256(
                abi.encodePacked(
                    blockhash(block.number - 1),
                    block.timestamp,
                    requestId,
                    consumer
                )
            )
        );
        
        // Create array of random words (for now just one)
        uint256[] memory randomWords = new uint256[](1);
        randomWords[0] = randomWord;
        
        // Call the consumer contract
        VRFConsumerBaseV2Mock(consumer).rawFulfillRandomWords(requestId, randomWords);
        
        emit RandomWordsFulfilled(requestId, randomWord);
    }
    
    /**
     * @dev Fulfill with specific random word (for deterministic testing)
     * @param requestId The request ID
     * @param consumer The consumer contract
     * @param randomWord The specific random word to use
     */
    function fulfillRandomWordsWithOverride(
        uint256 requestId,
        address consumer,
        uint256 randomWord
    ) external {
        require(s_requestIdToConsumer[requestId] == consumer, "Invalid consumer");
        
        uint256[] memory randomWords = new uint256[](1);
        randomWords[0] = randomWord;
        
        VRFConsumerBaseV2Mock(consumer).rawFulfillRandomWords(requestId, randomWords);
        
        emit RandomWordsFulfilled(requestId, randomWord);
    }
}

/**
 * @title VRFConsumerBaseV2Mock
 * @dev Base contract for VRF consumers
 */
abstract contract VRFConsumerBaseV2Mock {
    error OnlyCoordinatorCanFulfill(address have, address want);
    
    address private immutable vrfCoordinator;
    
    constructor(address _vrfCoordinator) {
        vrfCoordinator = _vrfCoordinator;
    }
    
    /**
     * @dev Fulfill random words - only callable by VRF Coordinator
     */
    function rawFulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external {
        if (msg.sender != vrfCoordinator) {
            revert OnlyCoordinatorCanFulfill(msg.sender, vrfCoordinator);
        }
        fulfillRandomWords(requestId, randomWords);
    }
    
    /**
     * @dev Override this function in your contract
     */
    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal virtual;
}
