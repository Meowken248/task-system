import { Wallet } from "ethers";
import {
  claimDigest,
  emailCommitment,
  invitationLinkToken,
  normalizeEmail,
  normalizeSlug,
  normalizeWallet,
  safeEqual,
  seal,
  secretDigest,
  signClaim,
  unseal,
  verificationCode,
} from "./protocol.mjs";

const bytes32 = (value) => {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value) || /^0x0+$/.test(value))
    throw new Error("INVALID_REQUEST_ID");
  return value.toLowerCase();
};
const integer = (value) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("INVALID_CHAIN_VALUE");
  return result;
};
const zeroWallet = (value) => !value || /^0x0{40}$/i.test(value);

/**
 * Stateless application core. All authoritative writes go through policy or
 * verification (on-chain); only encrypted metadata goes to IPFS. Adapters must
 * await confirmed receipts, serialize the service wallet and reconcile uncertain
 * submissions. No filesystem, database, process-local authority or real mail/RPC
 * configuration is supplied by this module.
 */
export function createMemberAuth({ secret, signingKey, domain, policy, verification, ipfs, mail, clock }) {
  secretDigest(secret, "configuration-check", "");
  const verifierWallet = new Wallet(signingKey).address.toLowerCase();
  const registry = normalizeWallet(domain.registry);
  const verificationAddress = normalizeWallet(domain.verification);
  const chainId = BigInt(domain.chainId).toString();
  if (BigInt(chainId) <= 0n) throw new Error("INVALID_CHAIN_ID");
  const scope = `${chainId}:${registry}:${verificationAddress}`;
  const digest = (purpose, value) => `0x${secretDigest(secret, `${scope}:${purpose}`, value)}`;
  const purpose = (kind) => `${scope}:${kind}`;
  const now = async () => integer(await clock()); // confirmed chain time, not a browser timestamp

  async function readInvitation(invitationId, active = true) {
    const id = bytes32(invitationId);
    const raw = await policy.getInvitation(id);
    const invitation = {
      ...raw,
      id,
      slug: normalizeSlug(raw.slug),
      version: integer(raw.version),
      expiresAt: integer(raw.expiresAt),
      role: integer(raw.role),
    };
    if (invitation.version === 0) throw new Error("INVITATION_UNAVAILABLE");
    if (active && (invitation.revoked || !zeroWallet(invitation.claimedBy) || invitation.expiresAt <= (await now())))
      throw new Error("INVITATION_UNAVAILABLE");
    const verifier = await policy.getVerifier(invitation.slug);
    if (normalizeWallet(verifier.address) !== verifierWallet) throw new Error("VERIFIER_UNAVAILABLE");
    invitation.verifierEpoch = integer(verifier.epoch);
    return invitation;
  }

  async function metadata(invitation) {
    const encrypted = await ipfs.get(invitation.metadataCID);
    const value = unseal(secret, purpose("invitation-metadata"), encrypted);
    if (
      value.id !== invitation.id ||
      value.slug !== invitation.slug ||
      value.version !== invitation.version ||
      value.role !== invitation.role ||
      value.expiresAt !== invitation.expiresAt ||
      emailCommitment(value.email, value.salt) !== invitation.recipientCommitment
    )
      throw new Error("METADATA_MISMATCH");
    return value;
  }

  async function readBoundToken(token, kind, allowDeclined = false) {
    const value = unseal(secret, purpose(kind), token);
    if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= (await now())) throw new Error("SESSION_EXPIRED");
    const invitation = await readInvitation(value.invitationId, !allowDeclined);
    const closed = allowDeclined && invitation.declined && invitation.version === value.version + 1;
    if (
      (!closed &&
        (value.version !== invitation.version ||
          invitation.revoked ||
          !zeroWallet(invitation.claimedBy) ||
          invitation.expiresAt <= (await now()))) ||
      value.verifierEpoch !== invitation.verifierEpoch
    )
      throw new Error("SESSION_INVALIDATED");
    const challenge = await verification.getChallenge(bytes32(value.challengeId));
    if (
      integer(challenge.invitationVersion) !== value.version ||
      challenge.invitationId !== invitation.id ||
      integer(challenge.verifierEpoch) !== invitation.verifierEpoch ||
      !safeEqual(challenge.sessionCommitment, digest("session", value.sessionSeed))
    )
      throw new Error("INVALID_TOKEN");
    if (
      kind === "verified-session" &&
      (!integer(challenge.verifiedAt) || value.expiresAt !== integer(challenge.verifiedAt) + 1800)
    )
      throw new Error("EMAIL_NOT_VERIFIED");
    return { value, invitation, challenge };
  }

  async function deliverCode(invitation, challengeId, deliveryId, retry = false) {
    // Lease acquisition is atomic on-chain. A resumed request must never send
    // twice just because the provider response or final receipt was lost.
    const lease = await verification.beginDelivery(challengeId, bytes32(deliveryId), retry);
    if (!lease.acquired) return lease.status;
    const info = await metadata(invitation);
    let status = "ambiguous";
    const abort = new AbortController();
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() =>
          mail.send({
            email: info.email,
            code: verificationCode(secret, scope, challengeId),
            challengeId,
            signal: abort.signal,
          })
        ),
        new Promise((resolve) => {
          timer = setTimeout(() => {
            abort.abort();
            resolve({ status: "ambiguous" });
          }, 8000);
        }),
      ]);
      if (["accepted", "failed", "ambiguous"].includes(result?.status)) status = result.status;
    } catch {
      /* A lost response is not proof that the provider rejected the mail. */
    } finally {
      clearTimeout(timer);
    }
    await verification.finishDelivery(challengeId, deliveryId, status);
    return status; // accepted means provider accepted, never guaranteed inbox delivery
  }

  return {
    async prepareInvitation({ slug, email, role, expiresAt, expectedVersion = 0, requestId }) {
      slug = normalizeSlug(slug);
      email = normalizeEmail(email);
      if (role !== 1 && role !== 2) throw new Error("UNSUPPORTED_ROLE");
      expiresAt = integer(expiresAt);
      expectedVersion = integer(expectedVersion);
      if (expiresAt <= (await now())) throw new Error("INVALID_EXPIRY");
      const id = digest("invitation-id", `${slug}:${bytes32(requestId)}`);
      // Stable secret salt per workspace/email prevents two active invitations
      // silently assigning the same identity to two different wallets.
      const salt = digest("email-salt", `${slug}:${email}`);
      const recipientCommitment = emailCommitment(email, salt);
      const value = { id, slug, email, salt, role, expiresAt, version: expectedVersion + 1 };
      const metadataCID = await ipfs.put(seal(secret, purpose("invitation-metadata"), value));
      return { id, slug, recipientCommitment, role, expiresAt, expectedVersion, metadataCID };
    },

    async publicInvitation(invitationId) {
      const invitation = await readInvitation(invitationId, false);
      return {
        id: invitation.id,
        slug: invitation.slug,
        role: invitation.role,
        version: invitation.version,
        expiresAt: invitation.expiresAt,
        state: !zeroWallet(invitation.claimedBy)
          ? "claimed"
          : invitation.declined
            ? "declined"
            : invitation.revoked
              ? "revoked"
              : invitation.expiresAt <= (await now())
                ? "expired"
                : "pending",
      };
    },

    async requestCode({ invitationId, linkToken, requestId, networkAddress }) {
      const invitation = await readInvitation(invitationId);
      if (!safeEqual(linkToken, invitationLinkToken(secret, domain, invitation.id, invitation.version)))
        throw new Error("INVITATION_LINK_REQUIRED");
      await metadata(invitation); // reject corrupted/mismatched metadata before writing or mailing
      const challengeId = digest(
        "challenge-id",
        `${invitation.id}:${invitation.version}:${invitation.verifierEpoch}:${bytes32(requestId)}`
      );
      const sessionSeed = digest("session-seed", challengeId);
      let challenge = await verification.getChallenge(challengeId);
      let expiresAt = integer(challenge.expiresAt);
      if (!integer(challenge.invitationVersion)) {
        expiresAt = Math.min((await now()) + 600, invitation.expiresAt);
        // The HTTP adapter must supply a trusted socket/proxy-resolved network
        // address. Never trust a client body or arbitrary X-Forwarded-For header.
        if (typeof networkAddress !== "string" || !networkAddress || networkAddress.length > 128)
          throw new Error("INVALID_NETWORK");
        await verification.registerChallenge({
          challengeId,
          invitationId: invitation.id,
          version: invitation.version,
          expiresAt,
          codeCommitment: digest("code", `${challengeId}:${verificationCode(secret, scope, challengeId)}`),
          sessionCommitment: digest("session", sessionSeed),
          networkBucket: digest("network", networkAddress),
        });
        challenge = await verification.getChallenge(challengeId);
      }
      if (expiresAt <= (await now()) || integer(challenge.verifiedAt)) throw new Error("CHALLENGE_UNAVAILABLE");
      const value = {
        invitationId: invitation.id,
        version: invitation.version,
        verifierEpoch: invitation.verifierEpoch,
        challengeId,
        sessionSeed,
        expiresAt,
      };
      const challengeToken = seal(secret, purpose("challenge"), value);
      const delivery = await deliverCode(invitation, challengeId, digest("delivery", challengeId));
      return {
        challengeToken,
        delivery,
        expiresAt,
        resendAt: integer(await verification.nextRequestAt(invitation.id)),
      };
    },

    async retryCodeDelivery({ challengeToken, requestId }) {
      const { invitation, value } = await readBoundToken(challengeToken, "challenge");
      return deliverCode(
        invitation,
        value.challengeId,
        digest("delivery-retry", `${value.challengeId}:${bytes32(requestId)}`),
        true
      );
    },

    async verifyCode({ challengeToken, code, requestId }) {
      const { value } = await readBoundToken(challengeToken, "challenge");
      if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw new Error("INVALID_CODE");
      const attemptId = digest("attempt", `${value.challengeId}:${bytes32(requestId)}`);
      const submitted = digest("code", `${value.challengeId}:${code}`);
      const matched = await verification.verifyChallenge(value.challengeId, attemptId, submitted);
      if (!matched) throw new Error("INVALID_CODE");
      const challenge = await verification.getChallenge(value.challengeId);
      if (!integer(challenge.verifiedAt) || !safeEqual(submitted, challenge.codeCommitment))
        throw new Error("EMAIL_NOT_VERIFIED");
      const expiresAt = integer(challenge.verifiedAt) + 1800;
      return { sessionToken: seal(secret, purpose("verified-session"), { ...value, expiresAt }), expiresAt };
    },

    async prepareClaim({ sessionToken, wallet, requestId }) {
      const { value, invitation } = await readBoundToken(sessionToken, "verified-session");
      const recipient = normalizeWallet(wallet);
      let reservation = await policy.getReservation(invitation.id);
      const currentTime = await now();
      const usable = (timestamp) =>
        integer(reservation.version) === invitation.version &&
        integer(reservation.verifierEpoch) === invitation.verifierEpoch &&
        integer(reservation.validUntil) > timestamp;
      if (!usable(currentTime)) {
        const nonce = digest("claim", `${value.challengeId}:${recipient}:${bytes32(requestId)}`);
        const validUntil = Math.min(currentTime + 240, invitation.expiresAt, value.expiresAt);
        await policy.reserveClaim(invitation.id, invitation.version, recipient, nonce, validUntil);
        reservation = await policy.getReservation(invitation.id);
      }
      if (!usable(await now())) throw new Error("CLAIM_EXPIRED");
      if (normalizeWallet(reservation.recipient) !== recipient) throw new Error("CLAIM_RESERVED");
      const ticket = {
        recipient,
        nonce: reservation.nonce,
        validUntil: integer(reservation.validUntil),
        verifierEpoch: invitation.verifierEpoch,
      };
      return {
        invitationId: invitation.id,
        version: invitation.version,
        ...ticket,
        signature: signClaim(signingKey, claimDigest({ chainId, registry }, invitation, ticket)),
      };
    },

    async decline({ sessionToken }) {
      const { invitation } = await readBoundToken(sessionToken, "verified-session", true);
      if (invitation.declined) return { state: "declined" };
      let failure;
      try {
        await policy.decline(invitation.id, invitation.version);
      } catch (error) {
        failure = error;
      }
      const updated = await policy.getInvitation(invitation.id);
      if (!updated.declined || integer(updated.version) !== invitation.version + 1) {
        if (failure) throw failure;
        throw new Error("DECLINE_UNCONFIRMED");
      }
      return { state: "declined" };
    },
  };
}
