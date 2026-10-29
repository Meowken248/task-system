import { normalizeWallet } from "./protocol.mjs";

const deliveryNames = ["not_started", "sending", "accepted", "ambiguous", "failed"];

/** One active writer per configured service key. No automatic transaction retry.
 * On restart, operation IDs and receipts/state on-chain are the recovery source.
 * Multi-instance writer election is intentionally not faked with an in-memory lock.
 */
export async function createChainAdapters({
  registry,
  verification,
  signer,
  confirmations = 1,
  receiptTimeoutMs = 30000,
}) {
  if (!Number.isInteger(confirmations) || confirmations < 1 || confirmations > 32)
    throw new Error("INVALID_CONFIRMATIONS");
  if (!Number.isInteger(receiptTimeoutMs) || receiptTimeoutMs < 1000 || receiptTimeoutMs > 120000)
    throw new Error("INVALID_RECEIPT_TIMEOUT");
  const provider = signer.provider;
  if (!provider) throw new Error("PROVIDER_REQUIRED");
  const registryAddress = normalizeWallet(await registry.getAddress());
  const verificationAddress = normalizeWallet(await verification.getAddress());
  if (
    Number(await registry.workspacePolicyVersion()) !== 3 ||
    normalizeWallet(await verification.policy()) !== registryAddress
  )
    throw new Error("POLICY_MISMATCH");
  const domain = {
    chainId: (await provider.getNetwork()).chainId.toString(),
    registry: registryAddress,
    verification: verificationAddress,
  };
  const sender = await signer.getAddress();
  let queue = Promise.resolve();

  function write(contract, method, args) {
    const run = queue.then(async () => {
      // Bypass ethers' short read cache for consecutive writes from this wallet.
      const [latestRaw, pendingRaw] = await Promise.all([
        provider.send("eth_getTransactionCount", [sender, "latest"]),
        provider.send("eth_getTransactionCount", [sender, "pending"]),
      ]);
      const latest = BigInt(latestRaw),
        pending = BigInt(pendingRaw);
      if (latest !== pending) throw new Error("CHAIN_WRITE_PENDING");
      const transaction = await contract.connect(signer)[method](...args, { nonce: pending });
      try {
        const receipt = await transaction.wait(confirmations, receiptTimeoutMs);
        if (!receipt || receipt.status !== 1) throw new Error("CHAIN_WRITE_FAILED");
        return receipt;
      } catch (error) {
        if (
          error?.code === "TRANSACTION_REPLACED" &&
          !error.cancelled &&
          error.receipt?.status === 1 &&
          error.replacement?.to?.toLowerCase() === transaction.to?.toLowerCase() &&
          error.replacement?.data === transaction.data
        )
          return error.receipt;
        // oxlint-disable-next-line preserve-caught-error -- Provider errors may contain secret-bearing RPC URLs; return only safe operation state.
        throw new Error("CHAIN_RESULT_UNCERTAIN");
      }
    });
    queue = run.catch(() => {});
    return run;
  }

  const events = (receipt, contract, name) =>
    receipt.logs.flatMap((log) => {
      if (log.address.toLowerCase() !== verificationAddress) return [];
      try {
        const event = contract.interface.parseLog(log);
        return event?.name === name ? [event.args] : [];
      } catch {
        return [];
      }
    });
  const getChallenge = async (id) => {
    const raw = await verification.getChallenge(id);
    return {
      invitationId: raw.invitationId,
      codeCommitment: raw.codeCommitment,
      sessionCommitment: raw.sessionCommitment,
      invitationVersion: raw.invitationVersion,
      verifierEpoch: raw.verifierEpoch,
      expiresAt: raw.expiresAt,
      verifiedAt: raw.verifiedAt,
      attempts: raw.attempts,
    };
  };

  return {
    domain,
    clock: async () => {
      const block = await provider.getBlock("latest");
      if (!block) throw new Error("CHAIN_UNAVAILABLE");
      return block.timestamp;
    },
    policy: {
      async getInvitation(id) {
        const raw = await registry.getEmailInvitation(id);
        return {
          slug: raw.slug,
          recipientCommitment: raw.recipientCommitment,
          role: raw.role,
          expiresAt: raw.expiresAt,
          version: raw.version,
          invitedBy: raw.invitedBy,
          claimedBy: raw.claimedBy,
          revoked: raw.revoked,
          metadataCID: raw.metadataCID,
          declined: raw.declined,
        };
      },
      async getVerifier(slug) {
        const [address, epoch] = await Promise.all([registry.emailVerifier(slug), registry.emailVerifierEpoch(slug)]);
        return { address, epoch };
      },
      async getReservation(id) {
        const raw = await registry.emailClaimReservation(id);
        return {
          recipient: raw.recipient,
          nonce: raw.nonce,
          version: raw.version,
          validUntil: raw.validUntil,
          verifierEpoch: raw.verifierEpoch,
        };
      },
      reserveClaim: (...args) => write(registry, "reserveEmailClaim", args),
      decline: (...args) => write(registry, "declineEmailInvitation", args),
    },
    verification: {
      getChallenge,
      nextRequestAt: (id) => verification.nextRequestAt(id),
      registerChallenge: (input) =>
        write(verification, "registerChallenge", [
          input.challengeId,
          input.invitationId,
          input.version,
          input.codeCommitment,
          input.sessionCommitment,
          input.expiresAt,
          input.networkBucket,
        ]),
      async verifyChallenge(id, attemptId, commitment) {
        const receipt = await write(verification, "verifyChallenge", [id, attemptId, commitment]);
        const emitted = events(receipt, verification, "ChallengeAttempted");
        if (emitted.length) return emitted[0].verified;
        const challenge = await getChallenge(id);
        return challenge.verifiedAt > 0n && challenge.codeCommitment === commitment;
      },
      async beginDelivery(id, requestId, retry) {
        const receipt = await write(verification, "beginDelivery", [id, requestId, retry]);
        const job = await verification.delivery(id);
        return {
          acquired: events(receipt, verification, "DeliveryStarted").some(
            (event) => event.challengeId === id && event.requestId === requestId
          ),
          status: deliveryNames[Number(job.state)],
        };
      },
      finishDelivery: (id, requestId, status) => {
        const state = deliveryNames.indexOf(status);
        if (state < 2) throw new Error("INVALID_DELIVERY_STATE");
        return write(verification, "finishDelivery", [id, requestId, state]);
      },
    },
  };
}
