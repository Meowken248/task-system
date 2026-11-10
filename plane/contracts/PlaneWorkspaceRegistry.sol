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
    mapping(string => mapping(address => bool)) private _listedMembers;
    mapping(address => mapping(string => bool)) private _listedWorkspaces;

    struct Invitation {
        Role role;
        uint256 expiresAt;
    }
    mapping(string => mapping(address => Invitation)) private _invitations;

    struct EmailInvitation {
        string slug;
        bytes32 recipientCommitment;
        Role role;
        uint64 expiresAt;
        uint64 version;
        address invitedBy;
        address claimedBy;
        bool revoked;
        string metadataCID;
        bool declined;
    }
    mapping(bytes32 => EmailInvitation) private _emailInvitations;
    mapping(string => bytes32[]) private _emailInvitationIds;
    mapping(string => mapping(bytes32 => address)) public claimedEmailWallet;
    struct EmailClaimReservation {
        address recipient;
        bytes32 nonce;
        uint64 version;
        uint64 validUntil;
        uint64 verifierEpoch;
    }
    mapping(bytes32 => EmailClaimReservation) public emailClaimReservation;
    mapping(string => address) public emailVerifier;
    mapping(string => uint64) public emailVerifierEpoch;
    uint64 public constant MAX_EMAIL_CLAIM_LIFETIME = 300;
    bytes32 private constant EMAIL_CLAIM_TYPEHASH = keccak256(
        "PlaneEmailClaim(uint256 chainId,address registry,bytes32 workspace,bytes32 invitationId,uint64 version,bytes32 recipientCommitment,uint8 role,address recipient,uint64 validUntil,bytes32 nonce,uint64 verifierEpoch)"
    );

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
    error InvitationRequired();
    error InvalidExpiry();
    error InvalidInvitation();
    error InvitationVersionConflict();
    error InvitationConsumed();
    error AlreadyMember();
    error InvalidClaimProof();
    error VerifierUnavailable();
    error ClaimReserved();

    event MemberInvited(string slug, address indexed member, Role role, uint256 expiresAt);
    event InvitationRevoked(string slug, address indexed member);
    event EmailVerifierChanged(string slug, address indexed verifier, uint64 epoch);
    event EmailInvitationRegistered(string slug, bytes32 indexed invitationId, uint64 version, Role role, uint64 expiresAt, address indexed invitedBy);
    event EmailInvitationRevoked(string slug, bytes32 indexed invitationId, uint64 version);
    event EmailInvitationClaimed(string slug, bytes32 indexed invitationId, uint64 version, address indexed member, Role role);
    event WorkspaceSessionAuthorized(string slug, bytes32 indexed sessionContext, address indexed member);
    event EmailClaimReserved(bytes32 indexed invitationId, address indexed recipient, uint64 validUntil);
    event EmailInvitationDeclined(bytes32 indexed invitationId, uint64 version);

    address public operator;

    constructor() {
        operator = msg.sender;
    }

    function workspacePolicyVersion() external pure returns (uint256) { return 3; }

    /// @notice Owner opts this workspace into a narrowly scoped email verifier.
    /// Rotating/disabling it invalidates all previously issued claim proofs.
    function setWorkspaceEmailVerifier(string calldata slug, address verifier) external onlyWorkspaceOwner(slug) {
        emailVerifier[slug] = verifier;
        emailVerifierEpoch[slug] += 1;
        emit EmailVerifierChanged(slug, verifier, emailVerifierEpoch[slug]);
    }

    function registerEmailInvitation(
        string calldata slug,
        bytes32 invitationId,
        bytes32 recipientCommitment,
        Role role,
        uint64 expiresAt,
        uint64 expectedVersion,
        bytes32 sessionContext,
        string calldata metadataCID
    ) external onlyWorkspaceAdmin(slug) {
        if (invitationId == bytes32(0) || recipientCommitment == bytes32(0)) revert InvalidInvitation();
        if (role != Role.Member && role != Role.Admin) revert Unauthorized();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        if (bytes(metadataCID).length == 0 || bytes(metadataCID).length > 256) revert InvalidInvitation();
        EmailInvitation storage invitation = _emailInvitations[invitationId];
        if (invitation.version != expectedVersion) revert InvitationVersionConflict();
        if (invitation.version != 0 && keccak256(bytes(invitation.slug)) != keccak256(bytes(slug))) revert InvalidInvitation();
        if (invitation.claimedBy != address(0)) revert InvitationConsumed();
        if (expectedVersion == 0) _emailInvitationIds[slug].push(invitationId);
        invitation.slug = slug;
        invitation.recipientCommitment = recipientCommitment;
        invitation.role = role;
        invitation.expiresAt = expiresAt;
        invitation.version = expectedVersion + 1;
        invitation.invitedBy = msg.sender;
        invitation.claimedBy = address(0);
        invitation.revoked = false;
        invitation.metadataCID = metadataCID;
        invitation.declined = false;
        _emitEmailInvitationRegistered(invitationId, sessionContext);
    }

    function _emitEmailInvitationRegistered(bytes32 invitationId, bytes32 sessionContext) private {
        EmailInvitation storage invitation = _emailInvitations[invitationId];
        emit EmailInvitationRegistered(invitation.slug, invitationId, invitation.version, invitation.role, invitation.expiresAt, invitation.invitedBy);
        if (sessionContext != bytes32(0)) emit WorkspaceSessionAuthorized(invitation.slug, sessionContext, msg.sender);
    }

    /// @notice Explicit wallet consent for a server session, without exporting
    /// keys or assuming the SDK supports arbitrary personal-sign requests.
    function authorizeWorkspaceSession(string calldata slug, bytes32 sessionContext) external onlyWorkspaceMember(slug) {
        if (sessionContext == bytes32(0)) revert InvalidClaimProof();
        emit WorkspaceSessionAuthorized(slug, sessionContext, msg.sender);
    }

    function revokeEmailInvitation(string calldata slug, bytes32 invitationId, uint64 expectedVersion) external onlyWorkspaceAdmin(slug) {
        EmailInvitation storage invitation = _emailInvitations[invitationId];
        if (invitation.version == 0 || keccak256(bytes(invitation.slug)) != keccak256(bytes(slug))) revert InvalidInvitation();
        if (invitation.version != expectedVersion) revert InvitationVersionConflict();
        if (invitation.claimedBy != address(0)) revert InvitationConsumed();
        invitation.revoked = true;
        invitation.version += 1;
        emit EmailInvitationRevoked(slug, invitationId, invitation.version);
    }

    function getEmailInvitation(bytes32 invitationId) external view returns (EmailInvitation memory) {
        return _emailInvitations[invitationId];
    }

    function getEmailInvitationIds(string calldata slug, uint256 offset, uint256 limit) external view returns (bytes32[] memory result) {
        if (limit > 100) revert InvalidInvitation();
        bytes32[] storage ids = _emailInvitationIds[slug];
        uint256 size = offset >= ids.length ? 0 : ids.length - offset;
        if (size > limit) size = limit;
        result = new bytes32[](size);
        for (uint256 i = 0; i < size; i++) result[i] = ids[offset + i];
    }

    /// @notice A short reservation prevents two devices preparing different wallets
    /// simultaneously. It conveys no role and only the current verifier can prepare it.
    function reserveEmailClaim(bytes32 invitationId, uint64 version, address recipient, bytes32 nonce, uint64 validUntil) external {
        EmailInvitation storage invitation = _emailInvitations[invitationId];
        if (version == 0 || invitation.version != version) revert InvitationVersionConflict();
        if (msg.sender != emailVerifier[invitation.slug] || msg.sender == address(0)) revert Unauthorized();
        if (invitation.revoked || invitation.claimedBy != address(0) || invitation.expiresAt <= block.timestamp) revert InvitationRequired();
        if (recipient == address(0) || nonce == bytes32(0)) revert InvalidClaimProof();
        if (validUntil <= block.timestamp || validUntil > invitation.expiresAt || validUntil > block.timestamp + MAX_EMAIL_CLAIM_LIFETIME) revert InvalidExpiry();
        uint64 epoch = emailVerifierEpoch[invitation.slug];
        EmailClaimReservation storage prior = emailClaimReservation[invitationId];
        if (prior.version == version && prior.verifierEpoch == epoch && prior.validUntil > block.timestamp) {
            if (prior.recipient != recipient || prior.nonce != nonce || prior.validUntil != validUntil) revert ClaimReserved();
            return;
        }
        emailClaimReservation[invitationId] = EmailClaimReservation(recipient, nonce, version, validUntil, epoch);
        emit EmailClaimReserved(invitationId, recipient, validUntil);
    }

    /// @notice The verifier can close an invitation after verifying its recipient,
    /// but cannot create invitations, change roles or revoke existing members.
    function declineEmailInvitation(bytes32 invitationId, uint64 version) external {
        EmailInvitation storage invitation = _emailInvitations[invitationId];
        if (version == 0 || invitation.version != version) revert InvitationVersionConflict();
        if (msg.sender != emailVerifier[invitation.slug] || msg.sender == address(0)) revert Unauthorized();
        if (invitation.claimedBy != address(0)) revert InvitationConsumed();
        invitation.revoked = true;
        invitation.declined = true;
        invitation.version += 1;
        emit EmailInvitationDeclined(invitationId, invitation.version);
    }

    function emailClaimDigest(
        bytes32 invitationId, uint64 version, address recipient,
        uint64 validUntil, bytes32 nonce, uint64 verifierEpoch
    ) public view returns (bytes32) {
        EmailInvitation storage invitation = _emailInvitations[invitationId];
        return keccak256(abi.encode(
            EMAIL_CLAIM_TYPEHASH, block.chainid, address(this), keccak256(bytes(invitation.slug)),
            invitationId, version, invitation.recipientCommitment, uint8(invitation.role),
            recipient, validUntil, nonce, verifierEpoch
        ));
    }

    /// @notice A transaction from recipient is the proof of wallet control.
    /// The verifier attests email identity, never an arbitrary membership role.
    function claimEmailInvitation(
        bytes32 invitationId, uint64 version, address recipient,
        uint64 validUntil, bytes32 nonce, uint64 verifierEpoch, bytes calldata signature
    ) external {
        if (recipient == address(0) || msg.sender != recipient || nonce == bytes32(0)) revert InvalidClaimProof();
        EmailInvitation storage invitation = _emailInvitations[invitationId];
        if (invitation.version == 0) revert InvalidInvitation();
        if (invitation.version != version) revert InvitationVersionConflict();
        if (invitation.claimedBy != address(0)) {
            if (invitation.claimedBy == recipient && _workspaceMembers[invitation.slug][recipient] != Role.None) return;
            revert InvitationConsumed();
        }
        if (invitation.revoked || invitation.expiresAt <= block.timestamp) revert InvitationRequired();
        if (validUntil <= block.timestamp || validUntil > invitation.expiresAt || validUntil > block.timestamp + MAX_EMAIL_CLAIM_LIFETIME) revert InvalidExpiry();
        if (_workspaceMembers[invitation.slug][recipient] != Role.None) revert AlreadyMember();
        {
            Role inviterRole = _workspaceMembers[invitation.slug][invitation.invitedBy];
            if (invitation.invitedBy != operator && inviterRole != Role.Admin && inviterRole != Role.Owner) revert Unauthorized();
            address verifier = emailVerifier[invitation.slug];
            if (verifier == address(0) || verifierEpoch != emailVerifierEpoch[invitation.slug]) revert VerifierUnavailable();
            EmailClaimReservation storage reservation = emailClaimReservation[invitationId];
            if (reservation.version != version || reservation.verifierEpoch != verifierEpoch || reservation.recipient != recipient || reservation.nonce != nonce || reservation.validUntil != validUntil) revert InvalidClaimProof();
            address existingWallet = claimedEmailWallet[invitation.slug][invitation.recipientCommitment];
            if (existingWallet != address(0) && _workspaceMembers[invitation.slug][existingWallet] != Role.None) revert AlreadyMember();
            bytes32 digest = emailClaimDigest(invitationId, version, recipient, validUntil, nonce, verifierEpoch);
            if (_recoverEmailVerifier(digest, signature) != verifier) revert InvalidClaimProof();
        }
        invitation.claimedBy = recipient;
        claimedEmailWallet[invitation.slug][invitation.recipientCommitment] = recipient;
        _workspaceMembers[invitation.slug][recipient] = invitation.role;
        _trackMembership(invitation.slug, recipient);
        emit MemberAdded(invitation.slug, recipient, invitation.role, invitation.invitedBy);
        emit EmailInvitationClaimed(invitation.slug, invitationId, version, recipient, invitation.role);
    }

    function _recoverEmailVerifier(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) revert InvalidClaimProof();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0 || (v != 27 && v != 28)) revert InvalidClaimProof();
        return ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)), v, r, s);
    }

    function leaveWorkspace(string calldata slug) external {
        if (!_workspaces[slug].exists) revert WorkspaceNotFound();
        if (_workspaces[slug].owner == msg.sender) revert Unauthorized();
        if (_workspaceMembers[slug][msg.sender] == Role.None) return;
        _workspaceMembers[slug][msg.sender] = Role.None;
        _userHasWorkspace[msg.sender][slug] = false;
        delete _invitations[slug][msg.sender];
        emit MemberRemoved(slug, msg.sender, msg.sender);
    }

    function setOperator(address newOperator) external {
        if (msg.sender != operator) revert Unauthorized();
        if (newOperator == address(0)) revert InvalidAddress();
        operator = newOperator;
    }

    modifier onlyWorkspaceAdmin(string calldata slug) {
        if (!_workspaces[slug].exists) revert WorkspaceNotFound();
        if (msg.sender != operator) {
            Role role = _workspaceMembers[slug][msg.sender];
            if (role != Role.Admin && role != Role.Owner) revert Unauthorized();
        }
        _;
    }

    modifier onlyWorkspaceOwner(string calldata slug) {
        if (!_workspaces[slug].exists) revert WorkspaceNotFound();
        if (msg.sender != operator && _workspaces[slug].owner != msg.sender) revert Unauthorized();
        _;
    }

    modifier onlyWorkspaceMember(string calldata slug) {
        if (!_workspaces[slug].exists) revert WorkspaceNotFound();
        if (msg.sender != operator) {
            Role role = _workspaceMembers[slug][msg.sender];
            if (role == Role.None) revert Unauthorized();
        }
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
        _trackMembership(slug, msg.sender);

        emit WorkspaceCreated(slug, name, msg.sender, initialCid, block.timestamp);
    }

    /// @notice Allow an invited team member to join the workspace on-chain
    /// @param slug The workspace slug
    function joinWorkspace(string calldata slug) external {
        if (!_workspaces[slug].exists) revert WorkspaceNotFound();

        bool isNew = _workspaceMembers[slug][msg.sender] == Role.None;
        if (isNew) {
            Invitation memory invitation = _invitations[slug][msg.sender];
            if (invitation.role == Role.None || invitation.expiresAt <= block.timestamp) revert InvitationRequired();
            delete _invitations[slug][msg.sender];
            _workspaceMembers[slug][msg.sender] = invitation.role;
            _trackMembership(slug, msg.sender);
            emit MemberAdded(slug, msg.sender, invitation.role, msg.sender);
        }
    }

    /// @notice Authorize a specific wallet before it can join. Email alone is not wallet ownership.
    function inviteMember(string calldata slug, address member, Role role, uint256 expiresAt) external onlyWorkspaceAdmin(slug) {
        if (member == address(0)) revert InvalidAddress();
        if (role != Role.Member && role != Role.Admin) revert Unauthorized();
        if (member == _workspaces[slug].owner || _workspaceMembers[slug][member] != Role.None) revert Unauthorized();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        _invitations[slug][member] = Invitation(role, expiresAt);
        emit MemberInvited(slug, member, role, expiresAt);
    }

    function revokeInvitation(string calldata slug, address member) external onlyWorkspaceAdmin(slug) {
        delete _invitations[slug][member];
        emit InvitationRevoked(slug, member);
    }

    function getInvitation(string calldata slug, address member) external view returns (Role role, uint256 expiresAt) {
        Invitation storage invitation = _invitations[slug][member];
        return (invitation.role, invitation.expiresAt);
    }

    function _trackMembership(string memory slug, address member) private {
        if (!_listedMembers[slug][member]) {
            _listedMembers[slug][member] = true;
            _workspaceMemberList[slug].push(member);
        }
        if (!_listedWorkspaces[member][slug]) {
            _listedWorkspaces[member][slug] = true;
            _userWorkspaces[member].push(slug);
        }
        _userHasWorkspace[member][slug] = true;
    }

    /// @notice Update the workspace IPFS CID (Any workspace member)
    /// @param slug The workspace slug
    /// @param newCid The new IPFS CID to store
    function updateWorkspaceCID(
        string calldata slug,
        string calldata newCid
    ) external onlyWorkspaceMember(slug) {
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
    ) external onlyWorkspaceMember(slug) {
        if (keccak256(bytes(_workspaces[slug].ipfsCID)) != keccak256(bytes(expectedOldCid))) {
            revert CIDConflict();
        }
        _workspaces[slug].ipfsCID = newCid;
        _workspaces[slug].updatedAt = block.timestamp;
        emit WorkspaceCIDUpdated(slug, newCid, msg.sender, block.timestamp);
    }

    /// @notice Add or update a member's role in the workspace (Admin or Owner)
    /// @param slug The workspace slug
    /// @param member The address of the team member
    /// @param role Member or Admin
    function addMember(
        string calldata slug,
        address member,
        Role role
    ) external onlyWorkspaceAdmin(slug) {
        if (member == address(0)) revert InvalidAddress();
        if (role == Role.None || role == Role.Owner) revert Unauthorized();
        if (member == _workspaces[slug].owner) revert Unauthorized();
        // An admin cannot demote a peer first to bypass removeMember's guard.
        if (msg.sender != operator && msg.sender != _workspaces[slug].owner && _workspaceMembers[slug][member] == Role.Admin) revert Unauthorized();

        bool isNew = _workspaceMembers[slug][member] == Role.None;
        _workspaceMembers[slug][member] = role;

        if (isNew) _trackMembership(slug, member);
        delete _invitations[slug][member];

        emit MemberAdded(slug, member, role, msg.sender);
    }

    /// @notice Remove a member from the workspace (Admin or Owner)
    /// @param slug The workspace slug
    /// @param member The address of the member to remove
    function removeMember(
        string calldata slug,
        address member
    ) external onlyWorkspaceAdmin(slug) {
        if (member == address(0)) revert InvalidAddress();
        if (member == _workspaces[slug].owner) revert Unauthorized(); // Cannot remove workspace owner
        if (msg.sender != operator && msg.sender != _workspaces[slug].owner && _workspaceMembers[slug][member] == Role.Admin) {
            revert Unauthorized(); // Admin cannot remove another admin
        }

        _workspaceMembers[slug][member] = Role.None;
        _userHasWorkspace[member][slug] = false;
        delete _invitations[slug][member];

        emit MemberRemoved(slug, member, msg.sender);
    }

    /// @notice Set or transfer workspace owner
    /// @param slug The workspace slug
    /// @param newOwner The new owner address
    function setWorkspaceOwner(
        string calldata slug,
        address newOwner
    ) external {
        if (!_workspaces[slug].exists) revert WorkspaceNotFound();
        if (msg.sender != operator && _workspaces[slug].owner != msg.sender) revert Unauthorized();
        if (newOwner == address(0)) revert InvalidAddress();
        address previousOwner = _workspaces[slug].owner;
        if (previousOwner != newOwner) _workspaceMembers[slug][previousOwner] = Role.Admin;
        _workspaces[slug].owner = newOwner;
        _workspaceMembers[slug][newOwner] = Role.Owner;
        delete _invitations[slug][newOwner];
        _trackMembership(slug, newOwner);
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

    /// @notice Get member list for a workspace (only active members with role != None)
    function getWorkspaceMembers(string calldata slug) external view returns (address[] memory) {
        if (!_workspaces[slug].exists) revert WorkspaceNotFound();
        address[] storage all = _workspaceMemberList[slug];
        uint256 activeCount = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (_workspaceMembers[slug][all[i]] != Role.None) {
                activeCount++;
            }
        }
        address[] memory result = new address[](activeCount);
        uint256 cursor = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (_workspaceMembers[slug][all[i]] != Role.None) {
                result[cursor++] = all[i];
            }
        }
        return result;
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
