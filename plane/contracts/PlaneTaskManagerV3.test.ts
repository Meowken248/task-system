import assert from "node:assert/strict";
import { ethers } from "hardhat";

describe("Workspace-bound task writes", function () {
  const h = ethers.id;
  async function fixture() {
    const [owner, member, outsider] = await ethers.getSigners();
    const registry: any = await (await ethers.getContractFactory("PlaneWorkspaceRegistry")).deploy();
    await registry.createWorkspace("team", "Team", "");
    await registry.addMember("team", member.address, 1);
    const tasks: any = await (await ethers.getContractFactory("PlaneTaskManagerV3")).deploy(await registry.getAddress());
    await tasks.createWorkspaceTask("team", h("task"), h("meta"), member.address, 0, 0);
    await tasks.createSubTask(0, h("sub"), h("meta"));
    return { owner, member, outsider, registry, tasks };
  }
  it("allows a current assignee and refuses the same wallet after workspace revocation", async () => {
    const { member, registry, tasks } = await fixture();
    await tasks.deleteSubTask(0, 0); // Progress is reported on leaves, not parents with active subtasks.
    await tasks.connect(member).updateProgress(0, 25);
    await registry.removeMember("team", member.address);
    await assert.rejects(tasks.connect(member).updateProgress(0, 100), /Unauthorized/);
    assert.equal((await tasks.getTask(0)).progress, 25n);
    await registry.addMember("team", member.address, 1);
    await tasks.connect(member).updateProgress(0, 100);
    assert.equal((await tasks.getTask(0)).progress, 100n);
  });
  it("checks every task write entry point even for a cached global task Admin", async () => {
    const { member, registry, tasks } = await fixture();
    await tasks.setAdmin(member.address, true);
    await registry.removeMember("team", member.address);
    const actor = tasks.connect(member);
    for (const operation of [
      () => actor.createSubTask(0, h("other-sub"), h("meta")),
      () => actor.createChildTask(0, h("child"), h("meta"), member.address, 0, 0, h("link"), h("meta")),
      () => actor.updateSubTaskMetadata(0, 0, h("new")),
      () => actor.updateSubTaskStatus(0, 0, 1),
      () => actor.updateSubTaskProgress(0, 0, 10),
      () => actor.deleteSubTask(0, 0),
      () => actor.updateTaskMetadata(0, h("new")),
      () => actor.assignTask(0, member.address),
      () => actor.updateSchedule(0, 1, 1),
      () => actor.updateProgress(0, 50),
      () => actor.cancelTask(0),
      () => actor.deleteTask(0),
      () => actor.submitDailyReport(0, 10, h("work"), h("difficulty"), h("evidence")),
      () => actor.submitDailyReportAndSyncAncestors(0, 10, h("work"), h("difficulty"), h("evidence"), [], []),
      () => actor.recordTaskContent(0, 0, h("content")),
    ]) await assert.rejects(operation(), /Unauthorized/);
    assert.equal(await tasks.getReportCount(0), 0n);
  });
  it("rejects unscoped creation, outsiders and assignments outside the workspace", async () => {
    const { outsider, tasks } = await fixture();
    await assert.rejects(tasks.createTask(h("unscoped"), h("meta"), outsider.address, 0, 0), /WorkspaceRequired/);
    await assert.rejects(tasks.connect(outsider).createWorkspaceTask("team", h("outsider"), h("meta"), outsider.address, 0, 0), /Unauthorized/);
    await assert.rejects(tasks.assignTask(0, outsider.address), /Unauthorized/);
    await assert.rejects(tasks.createChildTask(0, h("child"), h("meta"), outsider.address, 0, 0, h("link"), h("meta")), /Unauthorized/);
  });
  it("binds children to the parent's workspace and guards child writes after revocation", async () => {
    const { member, registry, tasks } = await fixture();
    await tasks.createChildTask(0, h("child"), h("meta"), member.address, 0, 0, h("link"), h("meta"));
    await tasks.setAdmin(member.address, true);
    assert.equal(await tasks.getTaskWorkspace(1), "team");
    await registry.removeMember("team", member.address);
    await assert.rejects(tasks.connect(member).updateProgress(1, 100), /Unauthorized/);
    await assert.rejects(tasks.connect(member).deleteChildTask(1, 0, 1), /Unauthorized/);
  });
});
