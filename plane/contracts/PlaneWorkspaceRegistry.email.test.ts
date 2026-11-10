/* oxlint-disable no-await-in-loop -- Ordered chain writes are required to verify replay and role transitions. */
import assert from "node:assert/strict";
import hre from "hardhat";
import { claimDigest, emailCommitment, randomId, signClaim } from "../services/member-auth/protocol.mjs";

const { ethers, network } = hre;
describe("PlaneWorkspaceRegistry v3 email invitation protocol", function () {
  let registry: any, owner: any, admin: any, member: any, outsider: any;
  let verifier: any, invitationId: string, commitment: string, expiry: number, ticketExpiry: number, claimNonce: string;
  const reject = (promise: Promise<unknown>, code: string) => assert.rejects(promise, new RegExp(code));
  beforeEach(async () => {
    [owner, admin, member, outsider] = await ethers.getSigners();
    verifier = ethers.Wallet.createRandom().connect(ethers.provider);
    await owner.sendTransaction({ to: verifier.address, value: ethers.parseEther("10") });
    registry = await (await ethers.getContractFactory("PlaneWorkspaceRegistry")).deploy();
    await registry.waitForDeployment();
    await registry.createWorkspace("alpha", "Alpha", "cid-one");
    await registry.addMember("alpha", admin.address, 2);
    await registry.setWorkspaceEmailVerifier("alpha", verifier.address);
    invitationId = randomId();
    commitment = emailCommitment("recipient@example.invalid", randomId());
    expiry = Number((await ethers.provider.getBlock("latest"))!.timestamp) + 3600;
    ticketExpiry = expiry - 3360;
    claimNonce = randomId();
  });
  const register = async (role = 1) =>
    registry
      .connect(admin)
      .registerEmailInvitation(
        "alpha",
        invitationId,
        commitment,
        role,
        expiry,
        0,
        ethers.ZeroHash,
        "encrypted-metadata-cid"
      );
  const ticket = async (overrides: any = {}, domainOverrides: any = {}) => {
    const record = await registry.getEmailInvitation(invitationId);
    const domain = {
      chainId: (await ethers.provider.getNetwork()).chainId,
      registry: await registry.getAddress(),
      ...domainOverrides,
    };
    const proof = {
      recipient: member.address,
      validUntil: ticketExpiry,
      nonce: claimNonce,
      verifierEpoch: 1,
      ...overrides,
    };
    const invitation = {
      id: invitationId,
      slug: record.slug,
      version: record.version,
      recipientCommitment: record.recipientCommitment,
      role: record.role,
    };
    const digest = claimDigest(domain, invitation, proof);
    const signature = signClaim(verifier.privateKey, digest);
    const now = Number((await ethers.provider.getBlock("latest"))!.timestamp);
    if (proof.validUntil > now && proof.validUntil <= now + 300) {
      await registry
        .connect(verifier)
        .reserveEmailClaim(invitationId, record.version, proof.recipient, proof.nonce, proof.validUntil);
    }
    return { ...proof, signature, digest, version: record.version };
  };
  const claim = (proof: any, sender = member) =>
    registry
      .connect(sender)
      .claimEmailInvitation(
        invitationId,
        proof.version,
        proof.recipient,
        proof.validUntil,
        proof.nonce,
        proof.verifierEpoch,
        proof.signature
      );

  it("registers an email before knowing the recipient wallet; only that wallet transaction can claim", async () => {
    await register();
    const proof = await ticket();
    assert.equal(
      await registry.emailClaimDigest(
        invitationId,
        proof.version,
        proof.recipient,
        proof.validUntil,
        proof.nonce,
        proof.verifierEpoch
      ),
      proof.digest
    );
    await reject(claim(proof, outsider), "InvalidClaimProof");
    assert.equal(await registry.getMemberRole("alpha", member.address), 0n);
    await claim(proof);
    assert.equal(await registry.getMemberRole("alpha", member.address), 1n);
    assert.equal((await registry.getEmailInvitation(invitationId)).claimedBy, member.address);
  });
  it("cannot let a verifier create invitations or choose a role different from the admin record", async () => {
    await reject(
      registry
        .connect(member)
        .registerEmailInvitation("alpha", invitationId, commitment, 2, expiry, 0, ethers.ZeroHash, "cid"),
      "Unauthorized"
    );
    await register();
    const proof = await ticket();
    const wrongDigest = claimDigest(
      { chainId: (await ethers.provider.getNetwork()).chainId, registry: await registry.getAddress() },
      { id: invitationId, slug: "alpha", version: 1, recipientCommitment: commitment, role: 2 },
      proof
    );
    await reject(claim({ ...proof, signature: signClaim(verifier.privateKey, wrongDigest) }), "InvalidClaimProof");
  });
  it("binds proofs to chain, registry, nonce and recipient", async () => {
    await register();
    for (const domain of [{ chainId: 1 }, { registry: outsider.address }])
      await reject(claim(await ticket({}, domain)), "InvalidClaimProof");
    const proof = await ticket();
    await reject(claim({ ...proof, nonce: randomId() }), "InvalidClaimProof");
    await reject(claim({ ...proof, recipient: outsider.address }, outsider), "InvalidClaimProof");
  });
  it("invalidates tickets on revoke, reissue and verifier rotation", async () => {
    await register();
    const proof = await ticket();
    await registry.revokeEmailInvitation("alpha", invitationId, 1);
    await reject(claim(proof), "InvitationVersionConflict");
    await registry.registerEmailInvitation("alpha", invitationId, commitment, 2, expiry, 2, ethers.ZeroHash, "cid");
    const replacement = await ticket();
    await registry.setWorkspaceEmailVerifier("alpha", verifier.address);
    await reject(claim(replacement), "VerifierUnavailable");
  });
  it("does not accept expired or overlong proofs and rejects invalid signatures", async () => {
    await register();
    const now = Number((await ethers.provider.getBlock("latest"))!.timestamp);
    await reject(claim(await ticket({ validUntil: now - 1 })), "InvalidExpiry");
    await reject(claim(await ticket({ validUntil: now + 1000 })), "InvalidExpiry");
    await reject(claim({ ...(await ticket()), signature: "0x12" }), "InvalidClaimProof");
  });
  it("does not consume an invite twice or restore a removed member", async () => {
    await register();
    const proof = await ticket();
    await claim(proof);
    await claim(proof);
    assert.equal(
      (await registry.getWorkspaceMembers("alpha")).filter((wallet: string) => wallet === member.address).length,
      1
    );
    await registry.removeMember("alpha", member.address);
    await reject(claim(proof), "InvitationConsumed");
  });
  it("does not implicitly upgrade existing members through another invitation", async () => {
    await register(2);
    await registry.addMember("alpha", member.address, 1);
    await reject(claim(await ticket()), "AlreadyMember");
    assert.equal(await registry.getMemberRole("alpha", member.address), 1n);
  });
  it("checks the inviter still manages the workspace at claim time", async () => {
    await register(2);
    const proof = await ticket();
    await registry.addMember("alpha", admin.address, 1);
    await reject(claim(proof), "Unauthorized");
  });
  it("supports actual self-leave and prevents the owner from leaving", async () => {
    await registry.addMember("alpha", member.address, 1);
    await registry.connect(member).leaveWorkspace("alpha");
    assert.equal(await registry.getMemberRole("alpha", member.address), 0n);
    assert.equal((await registry.getUserWorkspaces(member.address)).length, 0);
    await reject(registry.leaveWorkspace("alpha"), "Unauthorized");
  });
  it("invalidates a ticket when it expires during the wallet prompt", async () => {
    await register();
    const proof = await ticket();
    await network.provider.send("evm_setNextBlockTimestamp", [proof.validUntil]);
    await network.provider.send("evm_mine");
    await reject(claim(proof), "InvalidExpiry");
  });
});
