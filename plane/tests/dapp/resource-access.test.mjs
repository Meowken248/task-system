// oxlint-disable-next-line import/no-unassigned-import -- Install the isolated browser before DApp imports.
import "./browser.mjs";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { AbiCoder, id } from "ethers";
import { localDB, defaultDB, setLoggedInUser } from "../../packages/services/src/dapp/store.ts";
import { invalidateVaultWalletCache } from "../../packages/services/src/dapp/chain.ts";
import { handleRoute } from "../../packages/services/src/dapp/routes.ts";

const wallet = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const abi = AbiCoder.defaultAbiCoder();
let chainRole, rpcOffline, vaultWallet;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "";
  Object.keys(localDB).forEach((key) => delete localDB[key]);
  Object.assign(localDB, structuredClone(defaultDB), {
    users: [{ id: "user-a", email: "a@example.invalid", metanode_wallet_address: wallet }],
    workspaces: [{ id: "ws-a", slug: "team-a", created_by: "user-a" }, { id: "ws-b", slug: "team-b", created_by: "other" }],
    workspace_members: [{ id: "member-a", workspace: "ws-a", member: "user-a", role: 20, wallet_address: wallet }],
    projects: [{ id: "project-a", identifier: "AAA", workspace: "ws-a", network: 2 }, { id: "project-b", identifier: "BBB", workspace: "ws-b", network: 2 }],
    issues: [{ id: "issue-a", project: "project-a" }, { id: "issue-b", project: "project-b" }],
    assets: [], attachments: [],
  });
  setLoggedInUser("user-a");
  sessionStorage.setItem("plane_active_wallet_address", wallet);
  chainRole = 3;
  vaultWallet = wallet;
  rpcOffline = false;
  invalidateVaultWalletCache();
  Object.assign(process.env, {
    VITE_WORKSPACE_REGISTRY_ADDRESS: "0x3333333333333333333333333333333333333333",
    VITE_RPC_URL: "https://permission.fixture",
    VITE_AUTO_COMMIT_ONCHAIN: "false",
  });
  window.fiaiSDK = { request: async (action) => {
    if (action === "getAllWallets") return [{ address: vaultWallet }];
    if (action.startsWith("getActiveWallet")) return { address: vaultWallet };
    if (action === "getVaultStatus") return { isLocked: false, isInitialized: true };
    throw new Error("No transaction may be signed by permission tests: " + action);
  } };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://permission.fixture");
    if (rpcOffline) throw new Error("fixture RPC offline");
    const { method, params } = JSON.parse(options.body);
    assert.equal(method, "eth_call");
    const data = params[0].data;
    if (data.startsWith(id("getMemberRole(string,address)").slice(0, 10)))
      return Response.json({ result: abi.encode(["uint8"], [chainRole]) });
    if (data === id("operator()").slice(0, 10))
      return Response.json({ result: abi.encode(["address"], [other]) });
    throw new Error("Unexpected permission selector " + data.slice(0, 10));
  };
});

const workspaceDelete = () => handleRoute("delete", "/api/workspaces/team-a/", {});
const projectDelete = (workspace = "team-a", project = "project-a") =>
  handleRoute("delete", `/api/workspaces/${workspace}/projects/${project}/`, {});
const dataSnapshot = () => JSON.stringify({
  workspaces: localDB.workspaces, projects: localDB.projects, issues: localDB.issues,
  deletedWorkspaces: localDB._deleted_workspace_ids, deletedProjects: localDB._deleted_project_ids,
  deletedIssues: localDB._deleted_issue_ids,
});

test("anonymous workspace deletion is refused even with a single cached owner", async () => {
  setLoggedInUser(null);
  const before = dataSnapshot();
  assert.equal((await workspaceDelete()).status, 401);
  assert.equal(dataSnapshot(), before);
});

test("chain Member cannot delete a workspace despite a cached Admin/owner profile", async () => {
  chainRole = 1;
  const before = dataSnapshot();
  assert.equal((await workspaceDelete()).status, 403);
  assert.equal(dataSnapshot(), before);
});

test("chain Member cannot delete a project or its issues", async () => {
  chainRole = 1;
  const before = dataSnapshot();
  assert.equal((await projectDelete()).status, 403);
  assert.equal(dataSnapshot(), before);
});

test("RPC failure preserves all data and tombstones", async () => {
  rpcOffline = true;
  const before = dataSnapshot();
  assert.equal((await workspaceDelete()).status, 503);
  assert.equal(dataSnapshot(), before);
});

test("a project cannot be deleted through a different workspace path", async () => {
  const before = dataSnapshot();
  assert.equal((await projectDelete("team-a", "project-b")).status, 403);
  assert.equal(dataSnapshot(), before);
});

test("a changed Vault wallet cannot authorize deletion", async () => {
  vaultWallet = other;
  const before = dataSnapshot();
  assert((await workspaceDelete()).status >= 400);
  assert.equal(dataSnapshot(), before);
});

test("verified Admin deletes only the target project and cascades its issues", async () => {
  chainRole = 2;
  assert.equal((await projectDelete()).status, 200);
  assert.deepEqual(localDB.projects.map((project) => project.id), ["project-b"]);
  assert.deepEqual(localDB.issues.map((issue) => issue.id), ["issue-b"]);
  assert(localDB._deleted_project_ids.includes("project-a"));
});

test("verified owner workspace deletion keeps the other workspace intact", async () => {
  assert.equal((await workspaceDelete()).status, 200);
  assert.deepEqual(localDB.workspaces.map((workspace) => workspace.id), ["ws-b"]);
  assert.deepEqual(localDB.projects.map((project) => project.id), ["project-b"]);
});

test("local-only mode still rejects ordinary member deletion", async () => {
  process.env.VITE_WORKSPACE_REGISTRY_ADDRESS = "";
  localDB.workspaces[0].created_by = "other";
  localDB.workspace_members[0].role = 15;
  const before = dataSnapshot();
  assert.equal((await workspaceDelete()).status, 403);
  assert.equal(dataSnapshot(), before);
});
