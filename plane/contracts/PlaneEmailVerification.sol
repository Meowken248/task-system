// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPlaneEmailPolicy {
    struct EmailInvitation {
        string slug;
        bytes32 recipientCommitment;
        uint8 role;
        uint64 expiresAt;
        uint64 version;
        address invitedBy;
        address claimedBy;
        bool revoked;
        string metadataCID;
        bool declined;
    }
    function getEmailInvitation(bytes32 invitationId) external view returns (EmailInvitation memory);
    function emailVerifier(string calldata slug) external view returns (address);
    function emailVerifierEpoch(string calldata slug) external view returns (uint64);
}

/// @notice Durable OTP limits for a stateless verifier. No email, OTP, session
/// secret or unkeyed low-entropy OTP hash is stored here. The configured verifier
/// submits HMAC commitments; ordinary wallets cannot reset attempts or verify.
/// This contract attests verification state only; it cannot grant membership.
contract PlaneEmailVerification {
    struct Challenge {
        bytes32 invitationId;
        bytes32 codeCommitment;
        bytes32 sessionCommitment;
        uint64 invitationVersion;
        uint64 verifierEpoch;
        uint64 expiresAt;
        uint64 verifiedAt;
        uint8 attempts;
    }
    struct RateWindow { uint64 startedAt; uint16 count; }
    IPlaneEmailPolicy public immutable policy;
    mapping(bytes32 => Challenge) private _challenges;
    mapping(bytes32 => bytes32) public latestChallenge;
    mapping(bytes32 => uint64) public nextRequestAt;
    mapping(bytes32 => RateWindow) private _rates;
    uint64 public constant MAX_CODE_LIFETIME = 600;
    uint8 public constant MAX_ATTEMPTS = 5;
    uint64 public constant RESEND_DELAY = 60;
    uint64 public constant RATE_PERIOD = 3600;
    uint16 public constant MAX_INVITATION_REQUESTS = 6;
    uint16 public constant MAX_NETWORK_REQUESTS = 30;

    error InvalidChallenge();
    error Unauthorized();
    error ChallengeConflict();
    error RateLimited();
    error ChallengeUnavailable();
    event ChallengeRegistered(bytes32 indexed challengeId, bytes32 indexed invitationId, uint64 version, uint64 expiresAt);
    event ChallengeAttempted(bytes32 indexed challengeId, uint8 attempts, bool verified);
    enum DeliveryState { NotStarted, Sending, Accepted, Ambiguous, Failed }
    struct Delivery {
        bytes32 requestId;
        uint64 leaseUntil;
        uint64 retryAfter;
        uint8 attempts;
        DeliveryState state;
    }
    mapping(bytes32 => Delivery) public delivery;
    event DeliveryStarted(bytes32 indexed challengeId, bytes32 indexed requestId);
    event DeliveryUpdated(bytes32 indexed challengeId, DeliveryState state);

    constructor(address registry) {
        require(registry != address(0) && registry.code.length != 0, "INVALID_POLICY");
        policy = IPlaneEmailPolicy(registry);
    }

    function getChallenge(bytes32 challengeId) external view returns (Challenge memory) { return _challenges[challengeId]; }

    function registerChallenge(
        bytes32 challengeId, bytes32 invitationId, uint64 version,
        bytes32 codeCommitment, bytes32 sessionCommitment, uint64 expiresAt,
        bytes32 networkBucket
    ) external {
        IPlaneEmailPolicy.EmailInvitation memory invitation = _activeInvitation(invitationId, version);
        uint64 epoch = _authorize(invitation.slug);
        if (challengeId == bytes32(0) || codeCommitment == bytes32(0) || sessionCommitment == bytes32(0) || networkBucket == bytes32(0)) revert InvalidChallenge();
        Challenge storage existing = _challenges[challengeId];
        if (existing.invitationVersion != 0) {
            if (existing.invitationId != invitationId || existing.invitationVersion != version || existing.verifierEpoch != epoch ||
                existing.codeCommitment != codeCommitment || existing.sessionCommitment != sessionCommitment || existing.expiresAt != expiresAt) revert ChallengeConflict();
            return; // Recover a lost response without resetting attempts or consuming another rate slot.
        }
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + MAX_CODE_LIFETIME || expiresAt > invitation.expiresAt) revert InvalidChallenge();
        // Version changes do not let a client erase resend or hourly limits.
        if (nextRequestAt[invitationId] > block.timestamp) revert RateLimited();
        _consumeRate(keccak256(abi.encode("invitation", invitationId)), MAX_INVITATION_REQUESTS);
        _consumeRate(keccak256(abi.encode("network", networkBucket)), MAX_NETWORK_REQUESTS);
        nextRequestAt[invitationId] = uint64(block.timestamp) + RESEND_DELAY;
        _challenges[challengeId] = Challenge(invitationId, codeCommitment, sessionCommitment, version, epoch, expiresAt, 0, 0);
        latestChallenge[invitationId] = challengeId;
        emit ChallengeRegistered(challengeId, invitationId, version, expiresAt);
    }

    /// @notice Failed attempts must be committed (not reverted) to survive restarts.
    /// Request IDs let a transport retry a failed attempt without spending two tries.
    mapping(bytes32 => mapping(bytes32 => bytes32)) private _attempts;
    function verifyChallenge(bytes32 challengeId, bytes32 attemptId, bytes32 submittedCommitment) external returns (bool) {
        Challenge storage challenge = _challenges[challengeId];
        if (challenge.invitationVersion == 0 || attemptId == bytes32(0) || submittedCommitment == bytes32(0)) revert InvalidChallenge();
        IPlaneEmailPolicy.EmailInvitation memory invitation = _activeInvitation(challenge.invitationId, challenge.invitationVersion);
        if (_authorize(invitation.slug) != challenge.verifierEpoch) revert ChallengeUnavailable();
        bytes32 prior = _attempts[challengeId][attemptId];
        if (prior != bytes32(0)) {
            if (prior != submittedCommitment) revert ChallengeConflict();
            return prior == challenge.codeCommitment;
        }
        if (challenge.verifiedAt != 0) {
            // Recover success after a lost response; the service still requires the
            // sealed challenge cookie + correct code + session secret, never this bool alone.
            if (submittedCommitment != challenge.codeCommitment) revert ChallengeUnavailable();
            return true;
        }
        if (latestChallenge[challenge.invitationId] != challengeId || challenge.expiresAt <= block.timestamp || challenge.attempts >= MAX_ATTEMPTS) revert ChallengeUnavailable();
        _attempts[challengeId][attemptId] = submittedCommitment;
        challenge.attempts += 1;
        bool matched = submittedCommitment == challenge.codeCommitment;
        if (matched) challenge.verifiedAt = uint64(block.timestamp);
        emit ChallengeAttempted(challengeId, challenge.attempts, matched);
        return matched;
    }

    function _activeInvitation(bytes32 invitationId, uint64 version) private view returns (IPlaneEmailPolicy.EmailInvitation memory invitation) {
        invitation = policy.getEmailInvitation(invitationId);
        if (version == 0 || invitation.version != version || invitation.revoked || invitation.claimedBy != address(0) || invitation.expiresAt <= block.timestamp) revert ChallengeUnavailable();
    }

    /// @notice Outbox lease is durable on-chain, not in a service file. A lease
    /// abandoned after a crash becomes ambiguous; it never triggers an automatic
    /// resend because the provider may already have accepted the previous request.
    function beginDelivery(bytes32 challengeId, bytes32 requestId, bool explicitRetry) external {
        Challenge storage challenge = _challenges[challengeId];
        IPlaneEmailPolicy.EmailInvitation memory invitation = _activeInvitation(challenge.invitationId, challenge.invitationVersion);
        if (_authorize(invitation.slug) != challenge.verifierEpoch) revert ChallengeUnavailable();
        if (requestId == bytes32(0) || challenge.expiresAt <= block.timestamp || challenge.verifiedAt != 0 || latestChallenge[challenge.invitationId] != challengeId) revert ChallengeUnavailable();
        Delivery storage job = delivery[challengeId];
        if (job.state == DeliveryState.Sending) {
            if (job.leaseUntil <= block.timestamp) {
                job.state = DeliveryState.Ambiguous;
                emit DeliveryUpdated(challengeId, job.state);
            }
            return;
        }
        if (job.state == DeliveryState.Accepted) return;
        if (job.state != DeliveryState.NotStarted && (!explicitRetry || job.retryAfter > block.timestamp || job.requestId == requestId)) return;
        if (job.attempts >= 3) revert RateLimited();
        job.requestId = requestId;
        job.leaseUntil = uint64(block.timestamp) + 60;
        job.retryAfter = uint64(block.timestamp) + RESEND_DELAY;
        job.attempts += 1;
        job.state = DeliveryState.Sending;
        emit DeliveryStarted(challengeId, requestId);
    }

    function finishDelivery(bytes32 challengeId, bytes32 requestId, DeliveryState result) external {
        Challenge storage challenge = _challenges[challengeId];
        IPlaneEmailPolicy.EmailInvitation memory invitation = policy.getEmailInvitation(challenge.invitationId);
        if (_authorize(invitation.slug) != challenge.verifierEpoch) revert ChallengeUnavailable();
        if (result != DeliveryState.Accepted && result != DeliveryState.Ambiguous && result != DeliveryState.Failed) revert InvalidChallenge();
        Delivery storage job = delivery[challengeId];
        if (job.requestId != requestId) revert ChallengeConflict();
        if (job.state == result) return;
        if (job.state != DeliveryState.Sending && job.state != DeliveryState.Ambiguous) revert ChallengeConflict();
        job.state = result;
        emit DeliveryUpdated(challengeId, result);
    }

    function _authorize(string memory slug) private view returns (uint64) {
        if (msg.sender != policy.emailVerifier(slug) || msg.sender == address(0)) revert Unauthorized();
        return policy.emailVerifierEpoch(slug);
    }

    function _consumeRate(bytes32 bucket, uint16 limit) private {
        RateWindow storage window = _rates[bucket];
        if (block.timestamp >= uint256(window.startedAt) + RATE_PERIOD) {
            window.startedAt = uint64(block.timestamp);
            window.count = 0;
        }
        if (window.count >= limit) revert RateLimited();
        window.count += 1;
    }
}
