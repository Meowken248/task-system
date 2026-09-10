// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PlaneWorkspaceRegistry
/// @notice Decentralized Workspace and Multi-user Data Sharing Registry for Plane.
///         Stores workspace metadata, member roles, and IPFS CIDs mapped by workspace slug.
contract PlaneWorkspaceRegistry {
    enum Role {
        None,
        Member,
        Admin,
        Owner
    }

    struct Workspace {
        string slug;
        string name;
        address owner;
        string ipfsCID;
        uint256 updatedAt;
        bool exists;
    }

    // Mapping: workspaceSlug => Workspace
    mapping(string => Workspace) private _workspaces;

    // Mapping: workspaceSlug => userAddress => Role
    mapping(string => mapping(address => Role)) private _workspaceMembers;

    // Mapping: userAddress => array of workspace slugs
    mapping(address => string[]) private _userWorkspaces;

    // Mapping: userAddress => workspaceSlug => exists in user list
    mapping(address => mapping(string => bool)) private _userHasWorkspace;

    // Mapping: workspaceSlug => array of member addresses
    mapping(string => address[]) private _workspaceMemberList;

    event WorkspaceCreated(
        string indexed slug,
        string name,
        address indexed owner,
        string ipfsCID,
        uint256 timestamp
    );

    event WorkspaceCIDUpdated(
        string indexed slug,
        string newCid,
        address indexed updatedBy,
        uint256 timestamp
    );

    event MemberAdded(
        string indexed slug,
        address indexed member,
        Role role,
        address indexed addedBy
    );

    event MemberRemoved(
        string indexed slug,
        address indexed member,
        address indexed removedBy
    );

    error WorkspaceAlreadyExists();
    error WorkspaceNotFound();
    error Unauthorized();
    error InvalidAddress();
    error InvalidSlug();
    error CIDConflict();

    modifier onlyWorkspaceAdmin(string calldata slug) {
        if (!_workspaces[slug].exists) revert WorkspaceNotFound();
        Role role = _workspaceMembers[slug][msg.sender];
        if (role != Role.Admin && role != Role.Owner) revert Unauthorized();
        _;
    }

    modifier onlyWorkspaceOwner(string calldata slug) {
        if (!_workspaces[slug].exists) revert WorkspaceNotFound();
        if (_workspaces[slug].owner != msg.sender) revert Unauthorized();
        _;
    }

    /// @notice Create a new workspace and become its owner
    /// @param slug Unique workspace identifier (e.g. "fiai" or "dao-core")
    /// @param name Human-readable workspace name
    /// @param initialCid Initial IPFS CID containing projects/issues snapshot
    function createWorkspace(
        string calldata slug,
        string calldata name,
        string calldata initialCid
    ) external {
        if (bytes(slug).length == 0) revert InvalidSlug();
        if (_workspaces[slug].exists) revert WorkspaceAlreadyExists();

        _workspaces[slug] = Workspace({
            slug: slug,
            name: name,
            owner: msg.sender,
            ipfsCID: initialCid,
            updatedAt: block.timestamp,
            exists: true
        });

        _workspaceMembers[slug][msg.sender] = Role.Owner;
        _workspaceMemberList[slug].push(msg.sender);

        if (!_userHasWorkspace[msg.sender][slug]) {
            _userHasWorkspace[msg.sender][slug] = true;
            _userWorkspaces[msg.sender].push(slug);
        }

        emit WorkspaceCreated(slug, name, msg.sender, initialCid, block.timestamp);
    }

    /// @notice Update the workspace IPFS CID (Admin or Owner only)
    /// @param slug The workspace slug
    /// @param newCid The new IPFS CID to store
    function updateWorkspaceCID(
        string calldata slug,
        string calldata newCid
    ) external onlyWorkspaceAdmin(slug) {
        _workspaces[slug].ipfsCID = newCid;
        _workspaces[slug].updatedAt = block.timestamp;
        emit WorkspaceCIDUpdated(slug, newCid, msg.sender, block.timestamp);
    }

    /// @notice Update workspace CID only if current CID matches expected (Optimistic Concurrency)
    /// @param slug The workspace slug
    /// @param expectedOldCid The CID the client currently has in memory
    /// @param newCid The new IPFS CID to save
    function updateWorkspaceCIDIfMatches(
        string calldata slug,
        string calldata expectedOldCid,
        string calldata newCid
    ) external onlyWorkspaceAdmin(slug) {
        if (keccak256(bytes(_workspaces[slug].ipfsCID)) != keccak256(bytes(expectedOldCid))) {
            revert CIDConflict();
        }
        _workspaces[slug].ipfsCID = newCid;
        _workspaces[slug].updatedAt = block.timestamp;
        emit WorkspaceCIDUpdated(slug, newCid, msg.sender, block.timestamp);
    }

    /// @notice Add or update a member's role in the workspace (Owner only)
    /// @param slug The workspace slug
    /// @param member The address of the team member
    /// @param role Member or Admin
    function addMember(
        string calldata slug,
        address member,
        Role role
    ) external onlyWorkspaceOwner(slug) {
        if (member == address(0)) revert InvalidAddress();
        if (role == Role.None || role == Role.Owner) revert Unauthorized();

        bool isNew = _workspaceMembers[slug][member] == Role.None;
        _workspaceMembers[slug][member] = role;

        if (isNew) {
            _workspaceMemberList[slug].push(member);
            if (!_userHasWorkspace[member][slug]) {
                _userHasWorkspace[member][slug] = true;
                _userWorkspaces[member].push(slug);
            }
        }

        emit MemberAdded(slug, member, role, msg.sender);
    }

    /// @notice Remove a member from the workspace (Owner only)
    /// @param slug The workspace slug
    /// @param member The address of the member to remove
    function removeMember(
        string calldata slug,
        address member
    ) external onlyWorkspaceOwner(slug) {
        if (member == address(0)) revert InvalidAddress();
        if (member == msg.sender) revert Unauthorized(); // Owner cannot remove self

        _workspaceMembers[slug][member] = Role.None;
        _userHasWorkspace[member][slug] = false;

        emit MemberRemoved(slug, member, msg.sender);
    }

    /// @notice Get workspace summary and latest IPFS CID
    function getWorkspace(string calldata slug) external view returns (
        string memory name,
        address owner,
        string memory ipfsCID,
        uint256 updatedAt
    ) {
        if (!_workspaces[slug].exists) revert WorkspaceNotFound();
        Workspace storage ws = _workspaces[slug];
        return (ws.name, ws.owner, ws.ipfsCID, ws.updatedAt);
    }

    /// @notice Get the latest IPFS CID for a workspace
    function getWorkspaceCID(string calldata slug) external view returns (string memory) {
        if (!_workspaces[slug].exists) revert WorkspaceNotFound();
        return _workspaces[slug].ipfsCID;
    }

    /// @notice Return all workspace slugs that a user is part of
    function getUserWorkspaces(address user) external view returns (string[] memory) {
        string[] storage allSlugs = _userWorkspaces[user];
        uint256 activeCount = 0;
        for (uint256 i = 0; i < allSlugs.length; i++) {
            if (_workspaceMembers[allSlugs[i]][user] != Role.None) {
                activeCount++;
            }
        }

        string[] memory result = new string[](activeCount);
        uint256 cursor = 0;
        for (uint256 i = 0; i < allSlugs.length; i++) {
            if (_workspaceMembers[allSlugs[i]][user] != Role.None) {
                result[cursor++] = allSlugs[i];
            }
        }
        return result;
    }

    /// @notice Get member list for a workspace
    function getWorkspaceMembers(string calldata slug) external view returns (address[] memory) {
        if (!_workspaces[slug].exists) revert WorkspaceNotFound();
        return _workspaceMemberList[slug];
    }

    /// @notice Get a user's role in a workspace
    function getMemberRole(string calldata slug, address member) external view returns (Role) {
        return _workspaceMembers[slug][member];
    }

    /// @notice Check if a workspace exists
    function workspaceExists(string calldata slug) external view returns (bool) {
        return _workspaces[slug].exists;
    }
}
