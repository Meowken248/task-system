import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import hre from "hardhat";

// Frozen v2 bytecode matches the deployed registry's read-only code hash.
// These tests deploy that version only on Hardhat, never on the target node.
const fixture = JSON.parse(readFileSync("tests/fixtures/workspace-registry-v2.json", "utf8"));
const { ethers } = hre;
describe("Direct wallet provisioning on the existing v2 registry", function () {
  let registry: any, owner: any, admin: any, member: any, stranger: any;
  beforeEach(async () => {
    [owner, admin, member, stranger] = await ethers.getSigners();
    registry = await new ethers.ContractFactory(fixture.abi, fixture.bytecode, owner).deploy();
    await registry.waitForDeployment();
    assert.equal(ethers.keccak256(await ethers.provider.getCode(await registry.getAddress())), fixture.runtimeCodeHash);
    assert.equal(await registry.workspacePolicyVersion(), 2n);
    await registry.createWorkspace("wallet-team", "Wallet team", "fixture-snapshot");
    await registry.addMember("wallet-team", admin.address, 2);
  });
  it("lets the Admin grant access in one transaction without any recipient transaction", async () => {
    const nonce = await ethers.provider.getTransactionCount(member.address);
    const transaction = await registry.connect(admin).addMember("wallet-team", member.address, 1);
    assert.equal((await transaction.wait()).status, 1);
    assert.equal(await registry.getMemberRole("wallet-team", member.address), 1n);
    assert.deepEqual(Array.from(await registry.getUserWorkspaces(member.address)), ["wallet-team"]);
    assert.equal(await ethers.provider.getTransactionCount(member.address), nonce);
  });
  it("does not let an ordinary member grant access or promote another wallet", async () => {
    await registry.addMember("wallet-team", member.address, 1);
    await assert.rejects(
      registry.connect(member).addMember("wallet-team", stranger.address, 2),
      (error: any) =>
        typeof error.data === "string" && registry.interface.parseError(error.data)?.name === "Unauthorized"
    );
    assert.equal(await registry.getMemberRole("wallet-team", stranger.address), 0n);
  });
  it("does not duplicate the member or workspace indexes when a grant is repeated", async () => {
    await registry.addMember("wallet-team", member.address, 1);
    await registry.addMember("wallet-team", member.address, 1);
    assert.equal(
      (await registry.getWorkspaceMembers("wallet-team")).filter((wallet: string) => wallet === member.address).length,
      1
    );
    assert.deepEqual(Array.from(await registry.getUserWorkspaces(member.address)), ["wallet-team"]);
  });
  it("removes the wallet from its discovery index when an Admin revokes access", async () => {
    await registry.addMember("wallet-team", member.address, 1);
    await registry.connect(admin).removeMember("wallet-team", member.address);
    assert.equal(await registry.getMemberRole("wallet-team", member.address), 0n);
    assert.equal((await registry.getUserWorkspaces(member.address)).length, 0);
  });
});
