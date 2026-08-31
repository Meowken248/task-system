// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title OffchainDataRegistry
/// @notice Decentralized registry for users to store IPFS CIDs mapped by string keys.
contract OffchainDataRegistry {
    // Stores CID: user_address => key => cid
    mapping(address => mapping(string => string)) private _cids;

    event DataUpdated(
        address indexed user,
        bytes32 indexed keyHash,
        string key,
        string cid,
        uint256 timestamp
    );

    /// @notice Sets a CID for a specific key for the caller (msg.sender)
    /// @param key The identifier/type of data (e.g. "profile")
    /// @param cid The IPFS CID pointing to the off-chain data
    function setCID(string calldata key, string calldata cid) external {
        _cids[msg.sender][key] = cid;
        emit DataUpdated(msg.sender, keccak256(bytes(key)), key, cid, block.timestamp);
    }

    /// @notice Sets a CID only if the current CID matches the expected one (Optimistic Concurrency)
    /// @param key The identifier/type of data
    /// @param expectedOldCid The CID that the caller believes is currently on-chain
    /// @param newCid The new IPFS CID to store
    function setCIDIfMatches(string calldata key, string calldata expectedOldCid, string calldata newCid) external {
        require(
            keccak256(bytes(_cids[msg.sender][key])) == keccak256(bytes(expectedOldCid)),
            "CID_CONFLICT: data changed elsewhere, please reload"
        );
        _cids[msg.sender][key] = newCid;
        emit DataUpdated(msg.sender, keccak256(bytes(key)), key, newCid, block.timestamp);
    }

    /// @notice Deletes the CID for a specific key for the caller, refunding some gas
    /// @param key The identifier/type of data to clear
    function deleteCID(string calldata key) external {
        delete _cids[msg.sender][key];
        // Emit event with empty cid to notify clients of deletion
        emit DataUpdated(msg.sender, keccak256(bytes(key)), key, "", block.timestamp);
    }

    /// @notice Gets the CID for a given user and key
    /// @param user The address of the user
    /// @param key The identifier/type of data
    /// @return The IPFS CID string, or an empty string if not set
    function getCID(address user, string calldata key) external view returns (string memory) {
        return _cids[user][key];
    }
}
