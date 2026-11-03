import assert from "node:assert/strict";
import { ethers } from "hardhat";

describe("Fresh Plane deployment", () => {
  it("starts with an empty workspace and correct owner on all contracts", async () => {
    const [owner] = await ethers.getSigners();
    const registry: any = await (await ethers.getContractFactory("PlaneWorkspaceRegistry")).deploy();
    const data: any = await (await ethers.getContractFactory("OffchainDataRegistry")).deploy();
    const tasks: any = await (await ethers.getContractFactory("PlaneTaskManager")).deploy();
    await registry.createWorkspace("fresh-test", "Fresh test", "");
    assert.equal(await registry.getMemberRole("fresh-test", owner.address), 3n);
    assert.equal((await registry.getWorkspace("fresh-test"))[2], "");
    assert.equal(await registry.operator(), owner.address);
    assert.equal(await tasks.owner(), owner.address);
    assert.equal(await tasks.admins(owner.address), true);
    assert.equal(await tasks.taskCount(), 0n);
    assert.equal(await data.getCID(owner.address, "plane"), "");
  });

  it("propagates actual leaf reports through two parent levels and computes confirmed KPI", async () => {
    const [owner] = await ethers.getSigners();
    const tasks: any = await (await ethers.getContractFactory("PlaneTaskManager")).deploy();
    const h = (value: string) => ethers.sha256(ethers.toUtf8Bytes(value));
    await tasks.createTask(h("root"), h("metadata"), owner.address, 0, 0);
    await tasks.createChildTask(0, h("middle"), h("metadata"), owner.address, 0, 0, h("middle-link"), h("metadata"));
    await tasks.createChildTask(1, h("leaf"), h("metadata"), owner.address, 0, 0, h("leaf-link"), h("metadata"));
    await tasks.createChildTask(1, h("sibling"), h("metadata"), owner.address, 0, 0, h("sibling-link"), h("metadata"));
    await tasks.submitDailyReportAndSyncAncestors(2, 100, h("work"), h("difficulty"), h("evidence"), [1, 0], [0, 0]);
    await tasks.submitDailyReportAndSyncAncestors(3, 84, h("work"), h("difficulty"), h("evidence"), [1, 0], [1, 0]);
    assert.equal((await tasks.getTask(2)).progress, 100n);
    assert.equal((await tasks.getTask(2)).status, 2n);
    assert.equal((await tasks.getTask(1)).progress, 92n);
    assert.equal((await tasks.getTask(0)).progress, 92n);
    assert.equal(await tasks.getReportCount(2), 1n);
    assert.equal((await tasks.getDailyReport(2, 0)).workHash, h("work"));
    assert.equal((await tasks.getKPI(owner.address)).completed, 1n);
    assert.equal((await tasks.getKPI(owner.address)).averageProgress, 92n);
  });

  it("grants a wallet access directly without another admin or member confirmation", async () => {
    const [, member] = await ethers.getSigners();
    const registry: any = await (await ethers.getContractFactory("PlaneWorkspaceRegistry")).deploy();
    await registry.createWorkspace("fresh-test", "Fresh test", "");
    const before = await ethers.provider.getTransactionCount(member.address);
    await registry.addMember("fresh-test", member.address, 1);
    assert.equal(await registry.getMemberRole("fresh-test", member.address), 1n);
    assert.equal(await ethers.provider.getTransactionCount(member.address), before);
  });
});
