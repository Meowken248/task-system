import assert from "node:assert/strict";
import hre from "hardhat";

const { ethers, network } = hre;

describe("PlaneWorkspaceRegistry membership policy", function () {
  let registry: any;
  let owner: any, admin: any, member: any, outsider: any, nextOwner: any;
  let expiry: number;
  const rejected = (action: Promise<unknown>, error: string) => assert.rejects(action, new RegExp(error));

  beforeEach(async function () {
    [owner, admin, member, outsider, nextOwner] = await ethers.getSigners();
    registry = await (await ethers.getContractFactory("PlaneWorkspaceRegistry")).deploy();
    await registry.waitForDeployment();
    await registry.createWorkspace("alpha", "Alpha", "cid-1");
    await registry.createWorkspace("beta", "Beta", "cid-2");
    await registry.addMember("alpha", admin.address, 2);
    expiry = Number((await ethers.provider.getBlock("latest"))!.timestamp) + 3600;
  });

  it("blocks permissionless joins", async function () {
    await rejected(registry.connect(outsider).joinWorkspace("alpha"), "InvitationRequired");
    assert.equal(await registry.getMemberRole("alpha", outsider.address), 0n);
  });
  it("joins only the invited wallet, with its authorised role", async function () {
    await registry.inviteMember("alpha", member.address, 2, expiry);
    await rejected(registry.connect(outsider).joinWorkspace("alpha"), "InvitationRequired");
    await registry.connect(member).joinWorkspace("alpha");
    assert.equal(await registry.getMemberRole("alpha", member.address), 2n);
    assert.equal((await registry.getInvitation("alpha", member.address))[0], 0n);
  });
  it("does not permit a cross-workspace replay", async function () {
    await registry.inviteMember("alpha", member.address, 1, expiry);
    await rejected(registry.connect(member).joinWorkspace("beta"), "InvitationRequired");
  });
  it("rejects expired invitations", async function () {
    await registry.inviteMember("alpha", member.address, 1, expiry);
    await network.provider.send("evm_setNextBlockTimestamp", [expiry]);
    await network.provider.send("evm_mine");
    await rejected(registry.connect(member).joinWorkspace("alpha"), "InvitationRequired");
  });
  it("revokes invitations at the common source", async function () {
    await registry.inviteMember("alpha", member.address, 1, expiry);
    await registry.revokeInvitation("alpha", member.address);
    await rejected(registry.connect(member).joinWorkspace("alpha"), "InvitationRequired");
  });
  it("does not let removed members rejoin using a consumed invitation", async function () {
    await registry.inviteMember("alpha", member.address, 1, expiry);
    await registry.connect(member).joinWorkspace("alpha");
    await registry.removeMember("alpha", member.address);
    await rejected(registry.connect(member).joinWorkspace("alpha"), "InvitationRequired");
  });
  it("lets admins invite but prevents members granting themselves rights", async function () {
    await registry.connect(admin).inviteMember("alpha", member.address, 1, expiry);
    await registry.connect(member).joinWorkspace("alpha");
    await rejected(registry.connect(member).addMember("alpha", member.address, 2), "Unauthorized");
    await rejected(registry.connect(member).inviteMember("alpha", outsider.address, 2, expiry), "Unauthorized");
  });
  it("protects the owner against demotion", async function () {
    await rejected(registry.connect(admin).addMember("alpha", owner.address, 1), "Unauthorized");
    await rejected(registry.addMember("alpha", owner.address, 2), "Unauthorized");
    assert.equal(await registry.getMemberRole("alpha", owner.address), 3n);
  });
  it("prevents demote-then-remove bypass against a peer admin", async function () {
    await registry.addMember("alpha", member.address, 2);
    await rejected(registry.connect(admin).addMember("alpha", member.address, 1), "Unauthorized");
    await rejected(registry.connect(admin).removeMember("alpha", member.address), "Unauthorized");
  });
  it("deduplicates member and workspace lists across removal and re-addition", async function () {
    for (let i = 0; i < 3; i++) {
      await registry.addMember("alpha", member.address, 1);
      await registry.removeMember("alpha", member.address);
    }
    await registry.addMember("alpha", member.address, 1);
    const members = await registry.getWorkspaceMembers("alpha");
    assert.equal(members.filter((value: string) => value === member.address).length, 1);
    assert.deepEqual(Array.from(await registry.getUserWorkspaces(member.address)), ["alpha"]);
  });
  it("transfers ownership and registers the new owner in all lists", async function () {
    await registry.setWorkspaceOwner("alpha", nextOwner.address);
    assert.equal(await registry.getMemberRole("alpha", nextOwner.address), 3n);
    assert.equal(await registry.getMemberRole("alpha", owner.address), 2n);
    assert((await registry.getWorkspaceMembers("alpha")).includes(nextOwner.address));
    assert((await registry.getUserWorkspaces(nextOwner.address)).includes("alpha"));
  });
  it("rejects zero recipients, invalid roles and expiry", async function () {
    await rejected(registry.inviteMember("alpha", ethers.ZeroAddress, 1, expiry), "InvalidAddress");
    await rejected(registry.inviteMember("alpha", member.address, 3, expiry), "Unauthorized");
    await rejected(registry.inviteMember("alpha", member.address, 1, 1), "InvalidExpiry");
  });
  it("rejects stale snapshot writes instead of silently overwriting", async function () {
    await registry.updateWorkspaceCIDIfMatches("alpha", "cid-1", "cid-a");
    await rejected(registry.connect(admin).updateWorkspaceCIDIfMatches("alpha", "cid-1", "cid-b"), "CIDConflict");
    assert.equal(await registry.getWorkspaceCID("alpha"), "cid-a");
  });

  it("restores the reviewed member list and resumes without duplicate writes", async function () {
    const { restoreWorkspaceOnRegistry } = await import("../scripts/restore-workspace-registry.mjs");
    const target = await (await ethers.getContractFactory("PlaneWorkspaceRegistry")).deploy();
    const plan = { slug: "restored", name: "Restored", cid: "snapshot-cid", owner: nextOwner.address, members: [
      { address: nextOwner.address, role: 3 }, { address: admin.address, role: 2 }, { address: member.address, role: 1 },
    ] };
    let writes = 0;
    const send = async (_operation: string, method: string, args: any[]) => { writes++; await (await target.getFunction(method)(...args)).wait(); };
    const result = await restoreWorkspaceOnRegistry(target, plan, send);
    assert.equal(result.verified, true);
    assert.equal(await target.getMemberRole("restored", owner.address), 0n, "incidental deployer membership must be removed");
    const firstWrites = writes;
    await restoreWorkspaceOnRegistry(target, plan, send);
    assert.equal(writes, firstWrites, "resuming a verified restoration must not send again");
  });

  it("stops restoration when target snapshot data differs", async function () {
    const { restoreWorkspaceOnRegistry } = await import("../scripts/restore-workspace-registry.mjs");
    const plan = { slug: "alpha", name: "Alpha", cid: "different-cid", owner: owner.address, members: [{ address: owner.address, role: 3 }] };
    let writes = 0;
    await assert.rejects(restoreWorkspaceOnRegistry(registry, plan, async () => { writes++; }), /Target data differs/);
    assert.equal(writes, 0);
    assert.equal(await registry.getWorkspaceCID("alpha"), "cid-1");
  });
});
