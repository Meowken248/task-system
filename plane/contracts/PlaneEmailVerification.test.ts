/* oxlint-disable no-await-in-loop -- These scenarios advance one chain clock and deliberately exercise sequential retries. */
import assert from "node:assert/strict";
import hre from "hardhat";
import { createChainAdapters } from "../services/member-auth/chain-adapter.mjs";
import { createMemberAuth } from "../services/member-auth/service.mjs";
import { invitationLinkToken, randomId, randomToken, seal, unseal } from "../services/member-auth/protocol.mjs";

const { ethers, network } = hre;
describe("Stateless member email verification (local/IPFS/chain only)", function () {
  let registry: any, verification: any, owner: any, member: any, other: any, verifier: any;
  let chain: any, service: any, secret: string, mailStatus: string, letters: any[], blobs: Map<string, string>;
  let invitation: any, requestId: string;
  const rejects = (operation: Promise<unknown>, reason: string) => assert.rejects(operation, new RegExp(reason));
  const advance = async (seconds: number) => {
    await network.provider.send("evm_increaseTime", [seconds]);
    await network.provider.send("evm_mine");
  };
  const request = () =>
    service.requestCode({
      invitationId: invitation.id,
      linkToken: invitationLinkToken(secret, chain.domain, invitation.id, invitation.expectedVersion + 1),
      requestId,
      networkAddress: "fixture-network",
    });
  const bootstrap = () =>
    createMemberAuth({
      ...chain,
      secret,
      signingKey: verifier.privateKey,
      ipfs: {
        put: async (blob: string) => {
          const cid = `fixture-cid-${ethers.keccak256(ethers.toUtf8Bytes(blob))}`;
          blobs.set(cid, blob);
          return cid;
        },
        get: async (cid: string) => blobs.get(cid),
      },
      mail: {
        send: async (letter: any) => {
          letters.push(letter);
          return { status: mailStatus };
        },
      },
    });
  const register = (prepared: any) =>
    registry.registerEmailInvitation(
      prepared.slug,
      prepared.id,
      prepared.recipientCommitment,
      prepared.role,
      prepared.expiresAt,
      prepared.expectedVersion,
      ethers.ZeroHash,
      prepared.metadataCID
    );
  const verify = async (response: any) =>
    service.verifyCode({
      challengeToken: response.challengeToken,
      code: letters[letters.length - 1].code,
      requestId: randomId(),
    });
  const prepare = (sessionToken: string, wallet = member.address) =>
    service.prepareClaim({ sessionToken, wallet, requestId: randomId() });
  const claim = (proof: any, sender = member) =>
    registry
      .connect(sender)
      .claimEmailInvitation(
        proof.invitationId,
        proof.version,
        proof.recipient,
        proof.validUntil,
        proof.nonce,
        proof.verifierEpoch,
        proof.signature
      );

  beforeEach(async () => {
    [owner, member, other] = await ethers.getSigners();
    verifier = ethers.Wallet.createRandom().connect(ethers.provider);
    await owner.sendTransaction({ to: verifier.address, value: ethers.parseEther("20") });
    registry = await (await ethers.getContractFactory("PlaneWorkspaceRegistry")).deploy();
    verification = await (
      await ethers.getContractFactory("PlaneEmailVerification")
    ).deploy(await registry.getAddress());
    await registry.createWorkspace("alpha", "Alpha", "fixture-snapshot");
    await registry.setWorkspaceEmailVerifier("alpha", verifier.address);
    chain = await createChainAdapters({ registry, verification, signer: verifier });
    secret = randomToken();
    letters = [];
    blobs = new Map();
    mailStatus = "accepted";
    service = bootstrap();
    invitation = await service.prepareInvitation({
      slug: "alpha",
      email: "Person@Example.Invalid",
      role: 1,
      expiresAt: (await chain.clock()) + 3600,
      requestId: randomId(),
    });
    await register(invitation);
    requestId = randomId();
  });

  it("survives fresh service instances and joins without a second admin approval", async () => {
    const startBlock = await ethers.provider.getBlockNumber();
    const response = await request();
    assert.equal(response.delivery, "accepted");
    assert(!JSON.stringify(invitation).includes("person@example.invalid"));
    assert(!blobs.get(invitation.metadataCID)!.includes("person@example.invalid"));
    service = bootstrap(); // no database, shared service memory, file or browser auth flags
    const session = await verify(response);
    service = bootstrap();
    const proof = await prepare(session.sessionToken);
    await claim(proof);
    assert.equal(await registry.getMemberRole("alpha", member.address), 1n);
    assert.equal((await service.publicInvitation(invitation.id)).state, "claimed");
    assert.equal((await registry.getWorkspaceMembers("alpha")).length, 2);
    assert.equal(letters.length, 1);
    const transactions: any[] = [];
    for (let height = startBlock + 1; height <= (await ethers.provider.getBlockNumber()); height++) {
      const block = await ethers.provider.getBlock(height);
      for (const hash of block!.transactions) {
        const transaction = (await ethers.provider.getTransaction(hash))!;
        const receipt = (await ethers.provider.getTransactionReceipt(hash))!;
        const target =
          transaction.to!.toLowerCase() === (await registry.getAddress()).toLowerCase() ? registry : verification;
        transactions.push({
          function: target.interface.parseTransaction({ data: transaction.data })!.name,
          gasUsed: receipt.gasUsed.toString(),
          service: transaction.from.toLowerCase() === verifier.address.toLowerCase(),
        });
      }
    }
    assert.equal(transactions.filter((transaction) => transaction.service).length, 5);
    assert.equal(transactions.filter((transaction) => !transaction.service).length, 1);
    console.log("LOCAL_GAS_ONLY", JSON.stringify(transactions));
  });
  it("does not treat prepared IPFS metadata as an admin invitation", async () => {
    const pending = await service.prepareInvitation({
      slug: "alpha",
      email: "second@example.invalid",
      role: 2,
      expiresAt: (await chain.clock()) + 3600,
      requestId: randomId(),
    });
    await rejects(
      service.requestCode({ invitationId: pending.id, requestId: randomId(), networkAddress: "fixture-network" }),
      "INVALID_WORKSPACE|INVITATION_UNAVAILABLE"
    );
    assert.equal(letters.length, 0);
    assert.equal(await registry.getMemberRole("alpha", member.address), 0n);
  });
  it("cannot spend OTP quota or send email using only a public on-chain invitation ID", async () => {
    for (const linkToken of [undefined, "", randomToken(), { is_email_verified: true }]) {
      await rejects(
        service.requestCode({ invitationId: invitation.id, linkToken, requestId, networkAddress: "fixture-network" }),
        "INVITATION_LINK_REQUIRED"
      );
    }
    assert.equal(letters.length, 0);
    assert.equal(await verification.nextRequestAt(invitation.id), 0n);
    assert.equal((await request()).delivery, "accepted");
  });
  it("limits wrong codes durably to five attempts, including after restart", async () => {
    const response = await request();
    const code = letters[0].code === "000000" ? "111111" : "000000";
    for (let index = 0; index < 5; index++) {
      service = bootstrap();
      await rejects(
        service.verifyCode({ challengeToken: response.challengeToken, code, requestId: randomId() }),
        "INVALID_CODE"
      );
    }
    await rejects(verify(response), "ChallengeUnavailable");
    assert.equal((await registry.getWorkspaceMembers("alpha")).length, 1);
  });
  it("retries a lost OTP response without incrementing failed attempts twice", async () => {
    const response = await request();
    const attempt = randomId();
    const code = letters[0].code === "000000" ? "111111" : "000000";
    for (let index = 0; index < 2; index++)
      await rejects(
        service.verifyCode({ challengeToken: response.challengeToken, code, requestId: attempt }),
        "INVALID_CODE"
      );
    await rejects(
      service.verifyCode({ challengeToken: response.challengeToken, code: letters[0].code, requestId: attempt }),
      "ChallengeConflict"
    );
    assert.equal((await verify(response)).expiresAt > (await chain.clock()), true);
  });
  it("recovers an accepted verification after its response was lost", async () => {
    const response = await request();
    const attempt = randomId();
    const input = { challengeToken: response.challengeToken, code: letters[0].code, requestId: attempt };
    const first = await service.verifyCode(input);
    service = bootstrap();
    const recovered = await service.verifyCode(input);
    assert.equal(first.expiresAt, recovered.expiresAt);
    assert.equal((await prepare(recovered.sessionToken)).recipient, member.address.toLowerCase());
  });
  it("enforces resend cooldown and invalidates older unconsumed challenges", async () => {
    const first = await request();
    const oldCode = letters[0].code;
    requestId = randomId();
    await rejects(request(), "RateLimited");
    await advance(61);
    const second = await request();
    await rejects(
      service.verifyCode({ challengeToken: first.challengeToken, code: oldCode, requestId: randomId() }),
      "ChallengeUnavailable"
    );
    assert((await verify(second)).sessionToken);
  });
  it("does not let a public resend invalidate an already verified email session", async () => {
    const session = await verify(await request());
    await advance(61);
    requestId = randomId();
    await request();
    await claim(await prepare(session.sessionToken));
    assert.equal(await registry.getMemberRole("alpha", member.address), 1n);
  });
  it("refuses edited local auth flags, swapped token purposes and modified ciphertext", async () => {
    const response = await request();
    for (const token of [
      JSON.stringify({ is_email_verified: true }),
      response.challengeToken,
      response.challengeToken.slice(0, -2) + "00",
    ])
      await rejects(prepare(token), "INVALID_TOKEN");
    const token = seal(secret, "one-purpose", { verified: true });
    assert.throws(() => unseal(secret, "other-purpose", token), /INVALID_TOKEN/);
  });
  it("rejects ciphertext copied to a different registry domain", async () => {
    const session = await verify(await request());
    const otherScope = createMemberAuth({
      ...chain,
      domain: { ...chain.domain, registry: other.address },
      secret,
      signingKey: verifier.privateKey,
    });
    await rejects(
      otherScope.prepareClaim({ sessionToken: session.sessionToken, wallet: member.address, requestId: randomId() }),
      "INVALID_TOKEN"
    );
  });
  it("checks encrypted IPFS metadata against the admin commitment", async () => {
    blobs.set(invitation.metadataCID, seal(secret, "wrong-purpose", { email: "attacker@example.invalid" }));
    await rejects(request(), "INVALID_TOKEN");
    assert.equal(letters.length, 0);
  });
  it("invalidates sessions and signed tickets when the verifier epoch changes", async () => {
    const session = await verify(await request());
    const proof = await prepare(session.sessionToken);
    await registry.setWorkspaceEmailVerifier("alpha", verifier.address);
    await rejects(prepare(session.sessionToken), "SESSION_INVALIDATED");
    await rejects(claim(proof), "VerifierUnavailable");
  });
  it("serializes wallet choice, survives a lost preparation response and waits for expiry to change wallet", async () => {
    const session = await verify(await request());
    const first = await prepare(session.sessionToken);
    service = bootstrap();
    const recovered = await prepare(session.sessionToken);
    assert.equal(first.nonce, recovered.nonce);
    assert.equal(first.validUntil, recovered.validUntil);
    await rejects(prepare(session.sessionToken, other.address), "CLAIM_RESERVED");
    await advance(241);
    const changed = await prepare(session.sessionToken, other.address);
    await rejects(claim(first), "InvalidExpiry");
    await claim(changed, other);
    assert.equal(await registry.getMemberRole("alpha", member.address), 0n);
    assert.equal(await registry.getMemberRole("alpha", other.address), 1n);
  });
  it("atomically declines and invalidates a previously signed claim", async () => {
    const session = await verify(await request());
    const proof = await prepare(session.sessionToken);
    assert.deepEqual(await service.decline({ sessionToken: session.sessionToken }), { state: "declined" });
    assert.equal((await service.publicInvitation(invitation.id)).state, "declined");
    service = bootstrap();
    assert.deepEqual(await service.decline({ sessionToken: session.sessionToken }), { state: "declined" });
    await rejects(claim(proof), "InvitationVersionConflict");
    await rejects(prepare(session.sessionToken), "INVITATION_UNAVAILABLE");
  });
  it("does not return a ticket that expired while its reservation was being confirmed", async () => {
    const session = await verify(await request());
    const reserve = chain.policy.reserveClaim;
    chain.policy.reserveClaim = async (...args: any[]) => {
      await reserve(...args);
      await advance(241);
    };
    service = bootstrap();
    await rejects(prepare(session.sessionToken), "CLAIM_EXPIRED");
  });
  it("reconciles a lost decline receipt without reporting failure after the chain closed the invitation", async () => {
    const session = await verify(await request());
    const decline = chain.policy.decline;
    chain.policy.decline = async (...args: any[]) => {
      await decline(...args);
      throw new Error("fixture-lost-receipt");
    };
    service = bootstrap();
    assert.deepEqual(await service.decline({ sessionToken: session.sessionToken }), { state: "declined" });
    assert.equal((await service.publicInvitation(invitation.id)).state, "declined");
  });
  it("never resends automatically after an ambiguous provider result or process restart", async () => {
    mailStatus = "ambiguous";
    const first = await request();
    assert.equal(first.delivery, "ambiguous");
    service = bootstrap();
    assert.equal((await request()).delivery, "ambiguous");
    assert.equal(letters.length, 1);
    await advance(61);
    mailStatus = "accepted";
    assert.equal(
      await service.retryCodeDelivery({ challengeToken: first.challengeToken, requestId: randomId() }),
      "accepted"
    );
    assert.equal(letters.length, 2);
  });
  it("does not send twice when a successful request is repeated concurrently", async () => {
    await Promise.all([request(), request()]);
    assert.equal(letters.length, 1);
  });
  it("limits delivery retries and reports provider failure separately from membership", async () => {
    mailStatus = "failed";
    const first = await request();
    assert.equal(first.delivery, "failed");
    for (let index = 0; index < 2; index++) {
      await advance(61);
      assert.equal(
        await service.retryCodeDelivery({ challengeToken: first.challengeToken, requestId: randomId() }),
        "failed"
      );
    }
    await advance(61);
    await rejects(
      service.retryCodeDelivery({ challengeToken: first.challengeToken, requestId: randomId() }),
      "RateLimited"
    );
    assert.equal(letters.length, 3);
    assert.equal(await registry.getMemberRole("alpha", member.address), 0n);
  });
  it("limits challenge creation across fresh service instances and request IDs", async () => {
    for (let index = 0; index < 6; index++) {
      if (index) await advance(61);
      requestId = randomId();
      service = bootstrap();
      await request();
    }
    await advance(61);
    requestId = randomId();
    await rejects(request(), "RateLimited");
    assert.equal(letters.length, 6);
  });
  it("never lets an ordinary wallet create verification records or consume tries", async () => {
    await rejects(
      verification
        .connect(other)
        .registerChallenge(
          randomId(),
          invitation.id,
          1,
          randomId(),
          randomId(),
          (await chain.clock()) + 500,
          randomId()
        ),
      "Unauthorized"
    );
    await request();
    const challengeId = await verification.latestChallenge(invitation.id);
    const challenge = await verification.getChallenge(challengeId);
    await rejects(
      verification.connect(other).verifyChallenge(challengeId, randomId(), challenge.codeCommitment),
      "Unauthorized"
    );
    assert.equal((await verification.getChallenge(challengeId)).attempts, 0n);
    await rejects(registry.connect(verifier).addMember("alpha", other.address, 2), "Unauthorized");
  });
  it("recovers an abandoned outbox lease without automatically sending another email", async () => {
    // Simulate a process dying after the lease was recorded but before the final
    // provider result was recorded. Its in-memory mail call cannot be recovered.
    const original = chain.verification.finishDelivery;
    chain.verification.finishDelivery = async () => {
      throw new Error("fixture-process-stopped");
    };
    service = bootstrap();
    await rejects(request(), "fixture-process-stopped");
    assert.equal(letters.length, 1);
    chain.verification.finishDelivery = original;
    service = bootstrap();
    assert.equal((await request()).delivery, "sending");
    await advance(61);
    const recovered = await request();
    assert.equal(recovered.delivery, "ambiguous");
    assert.equal(letters.length, 1);
    assert.equal(
      await service.retryCodeDelivery({ challengeToken: recovered.challengeToken, requestId: randomId() }),
      "accepted"
    );
    assert.equal(letters.length, 2);
  });
  it("bounds code lifetime and sessions using chain time", async () => {
    const response = await request();
    await advance(601);
    await rejects(verify(response), "SESSION_EXPIRED");
    requestId = randomId();
    const session = await verify(await request());
    await advance(1801);
    await rejects(prepare(session.sessionToken), "SESSION_EXPIRED");
  });
  it("uses the same private identity commitment for invitations to the same email", async () => {
    const second = await service.prepareInvitation({
      slug: "alpha",
      email: "person@example.invalid",
      role: 1,
      expiresAt: (await chain.clock()) + 3600,
      requestId: randomId(),
    });
    assert.equal(invitation.recipientCommitment, second.recipientCommitment);
    assert.notEqual(invitation.id, second.id);
    await register(second);
    const firstSession = await verify(await request());
    await claim(await prepare(firstSession.sessionToken));
    invitation = second;
    requestId = randomId();
    const secondSession = await verify(await request());
    await rejects(claim(await prepare(secondSession.sessionToken, other.address), other), "AlreadyMember");
  });
  it("enumerates invitation IDs with bounded pagination without exposing private metadata", async () => {
    assert.deepEqual(Array.from(await registry.getEmailInvitationIds("alpha", 0, 10)), [invitation.id]);
    assert.equal((await registry.getEmailInvitationIds("alpha", 1, 10)).length, 0);
    await rejects(registry.getEmailInvitationIds("alpha", 0, 101), "InvalidInvitation");
    const detail = await service.publicInvitation(invitation.id);
    assert.equal(detail.state, "pending");
    for (const privateKey of ["email", "metadataCID", "recipientCommitment", "salt"])
      assert.equal(Object.prototype.hasOwnProperty.call(detail, privateKey), false);
  });
});
