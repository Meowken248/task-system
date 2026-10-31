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
    issues: [{ id: "issue-a", project: "project-a", sequence_id: 7 }, { id: "issue-b", project: "project-b", sequence_id: 1 }],
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

const assetPath = (workspace = "team-a", assetId = "asset-a") => `/api/assets/v2/workspaces/${workspace}/${assetId}/`;
const seedAsset = (overrides = {}) => {
  const record = { id: "asset-a", workspace: "ws-a", project: "project-a", created_by: "user-a",
    entity_type: "ISSUE_DESCRIPTION", entity_identifier: "issue-a", is_uploaded: true,
    asset_url: "data:text/plain;base64,YQ==", ...overrides };
  localDB.assets.push(record);
  return record;
};

test("anonymous asset GET and DELETE do not expose or remove cached content", async () => {
  seedAsset();
  setLoggedInUser(null);
  assert.equal((await handleRoute("get", assetPath(), {})).status, 401);
  assert.equal((await handleRoute("delete", assetPath(), {})).status, 401);
  assert.equal(localDB.assets.length, 1);
});

test("a known asset id cannot be read or deleted through another workspace", async () => {
  seedAsset();
  assert.equal((await handleRoute("get", assetPath("team-b"), {})).status, 403);
  assert.equal((await handleRoute("delete", assetPath("team-b"), {})).status, 403);
  assert.equal(localDB.assets.length, 1);
  assert(!(localDB._deleted_asset_ids || []).includes("asset-a"));
});

test("an active member can read a scoped asset but a revoked chain role cannot", async () => {
  seedAsset();
  chainRole = 1;
  assert.equal((await handleRoute("get", assetPath(), {})).data.base64, "YQ==");
  chainRole = 0;
  assert.equal((await handleRoute("get", assetPath(), {})).status, 403);
});

test("private-project assets require project membership even with workspace membership", async () => {
  seedAsset();
  chainRole = 1;
  localDB.projects[0].network = 0;
  assert.equal((await handleRoute("get", assetPath(), {})).status, 403);
  localDB.project_members = [{ project: "project-a", member: "user-a", role: 15 }];
  assert.equal((await handleRoute("get", assetPath(), {})).status, 200);
});

test("mixed-scope bulk confirmation is rejected before confirming the authorized item", async () => {
  const first = seedAsset({ is_uploaded: false });
  seedAsset({ id: "asset-b", workspace: "ws-b", project: "project-b", entity_identifier: "issue-b" });
  const result = await handleRoute("post", "/api/assets/v2/workspaces/team-a/issue-a/bulk/", { asset_ids: ["asset-a", "asset-b"] });
  assert.equal(result.status, 403);
  assert.equal(first.is_uploaded, false);
});

test("a foreign entity cannot be bound through a legitimate project asset initializer", async () => {
  const result = await handleRoute("post", "/api/assets/v2/workspaces/team-a/projects/project-a/", {
    entity_type: "ISSUE_DESCRIPTION", entity_identifier: "issue-b",
  });
  assert.equal(result.status, 403);
  assert.equal(localDB.assets.length, 0);
});

test("unscoped legacy content is not assigned to the workspace in a forged path", async () => {
  localDB.assets = [{ id: "asset-a", is_uploaded: true, asset_url: "data:text/plain;base64,YQ==" }];
  assert.equal((await handleRoute("get", assetPath(), {})).status, 403);
});

test("legacy cover metadata can infer its scope from its actual project", async () => {
  localDB.assets = [{ id: "asset-a", entity_type: "PROJECT_COVER", entity_identifier: "project-a", is_uploaded: true, asset_url: "data:text/plain;base64,YQ==" }];
  assert.equal((await handleRoute("get", assetPath(), {})).status, 200);
  assert.equal((await handleRoute("get", assetPath("team-b"), {})).status, 403);
});

test("Member cannot delete an asset created by another member", async () => {
  seedAsset({ created_by: "other-user" });
  chainRole = 1;
  assert.equal((await handleRoute("delete", assetPath(), {})).status, 403);
  assert.equal(localDB.assets.length, 1);
});

test("asset initialization stores canonical scope and the authenticated creator", async () => {
  chainRole = 1;
  const result = await handleRoute("post", "/api/assets/v2/workspaces/team-a/projects/project-a/", {
    entity_type: "ISSUE_DESCRIPTION", entity_identifier: "issue-a", created_by: "spoofed-user", workspace: "ws-b",
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.workspace, "ws-a");
  assert.equal(result.data.project, "project-a");
  assert.equal(result.data.created_by, "user-a");
});

const issueMeta = (workspace = "team-a", project = "project-a", issue = "issue-a") =>
  handleRoute("get", `/api/workspaces/${workspace}/projects/${project}/issues/${issue}/meta/`, {});

test("issue UUID metadata supplies the exact project identifier and sequence for redirects", async () => {
  const result = await issueMeta();
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { project_identifier: "AAA", sequence_id: 7 });
});

test("issue metadata refuses another project or workspace path", async () => {
  assert.equal((await issueMeta("team-a", "project-a", "issue-b")).status, 403);
  assert.equal((await issueMeta("team-a", "project-b", "issue-b")).status, 403);
});

test("issue metadata does not revive deleted work items or projects", async () => {
  localDB._deleted_issue_ids = ["issue-a"];
  assert.equal((await issueMeta()).status, 404);
  localDB._deleted_issue_ids = [];
  localDB._deleted_project_ids = ["project-a"];
  assert.equal((await issueMeta()).status, 404);
});

test("issue metadata requires login and private-project access", async () => {
  chainRole = 1;
  localDB.projects[0].network = 0;
  assert.equal((await issueMeta()).status, 403);
  setLoggedInUser(null);
  assert.equal((await issueMeta()).status, 401);
});

test("missing issue identity does not create a broken browse redirect", async () => {
  delete localDB.issues[0].sequence_id;
  assert.equal((await issueMeta()).status, 409);
});

test("upload ingestion rejects a revoked member before replacing any file bytes", async () => {
  seedAsset();
  chainRole = 0;
  const result = await handleRoute("post", "/api/assets/v2/upload/", { asset_id: "asset-a", base64: "Yg==" });
  assert.equal(result.status, 403);
  assert.equal(localDB.assets[0].asset_url, "data:text/plain;base64,YQ==");
});

test("logout while permission RPC is pending prevents a later deletion", async () => {
  const originalFetch = globalThis.fetch;
  let entered, release;
  const started = new Promise((resolve) => { entered = resolve; });
  const pendingRead = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (...args) => {
    entered();
    await pendingRead;
    return originalFetch(...args);
  };
  const before = dataSnapshot();
  const operation = workspaceDelete();
  await started;
  setLoggedInUser(null);
  release();
  const result = await operation;
  assert([401, 409].includes(result.status), "logout clears both the session and wallet; either guard must reject");
  assert.equal(dataSnapshot(), before);
});

test("absolute API URLs cannot bypass the destructive permission guard", async () => {
  chainRole = 1;
  const before = dataSnapshot();
  const result = await handleRoute("delete", "http://localhost:3000/api/workspaces/team-a/", {});
  assert.equal(result.status, 403);
  assert.equal(dataSnapshot(), before);
});

test("duplicate trailing slashes cannot fall through to unguarded generic deletion", async () => {
  chainRole = 1;
  const before = dataSnapshot();
  const result = await handleRoute("delete", "/api/workspaces/ws-a////", {});
  assert.equal(result.status, 403);
  assert.equal(dataSnapshot(), before);
});

test("a basename, uppercase method and query cannot bypass project deletion permissions", async () => {
  chainRole = 1;
  const before = dataSnapshot();
  const result = await handleRoute("DELETE", "http://localhost:3000/plane/api/workspaces/team-a/projects/project-a/?check=1", {});
  assert.equal(result.status, 403);
  assert.equal(dataSnapshot(), before);
});

test("generic collection aliases cannot delete workspaces or projects", async () => {
  chainRole = 1;
  const before = dataSnapshot();
  assert.equal((await handleRoute("delete", "/api/projects/project-a/workspaces/ws-a/", {})).status, 404);
  assert.equal((await handleRoute("delete", "/api/projects/project-a/projects/project-b/", {})).status, 404);
  assert.equal(dataSnapshot(), before);
});

test("generic asset aliases cannot read or delete metadata around the asset API", async () => {
  seedAsset();
  setLoggedInUser(null);
  assert.equal((await handleRoute("get", "/api/assets/asset-a/", {})).status, 404);
  assert.equal((await handleRoute("delete", "/api/assets/asset-a/", {})).status, 404);
  assert.equal(localDB.assets.length, 1);
});

test("the issue attachment API cannot return a different issue's attachment id", async () => {
  localDB.attachments = [{ id: "foreign-attachment", issue: "issue-b", workspace: "ws-b", project: "project-b" }];
  assert.equal((await handleRoute("get", "/api/workspaces/team-a/projects/project-a/issues/issue-a/attachments/foreign-attachment/", {})).status, 404);
});

test("workspace Admin can upload despite a lower cached project role", async () => {
  chainRole = 2;
  localDB.project_members = [{ project: "project-a", member: "user-a", role: 5 }];
  const result = await handleRoute("post", "/api/assets/v2/workspaces/team-a/projects/project-a/", { entity_type: "ISSUE_DESCRIPTION", entity_identifier: "issue-a" });
  assert.equal(result.status, 200);
});

test("a private project creator can use issue metadata before a separate project-member row exists", async () => {
  chainRole = 1;
  localDB.projects[0].network = 0;
  localDB.projects[0].created_by = "user-a";
  assert.equal((await issueMeta()).status, 200);
});

test("a project Admin may upload a project cover but may not change the workspace logo", async () => {
  chainRole = 1;
  localDB.project_members = [{ project: "project-a", member: "user-a", role: 20 }];
  const cover = await handleRoute("post", "/api/assets/v2/workspaces/team-a/projects/project-a/", { entity_type: "PROJECT_COVER", entity_identifier: "project-a" });
  assert.equal(cover.status, 200);
  const logo = await handleRoute("post", "/api/assets/v2/workspaces/team-a/", { entity_type: "WORKSPACE_LOGO", entity_identifier: "ws-a" });
  assert.equal(logo.status, 403);
});

test("project Guest remains read-only and a zero-role row cannot open a private project", async () => {
  chainRole = 1;
  localDB.project_members = [{ project: "project-a", member: "user-a", role: 5 }];
  assert.equal((await handleRoute("post", "/api/assets/v2/workspaces/team-a/projects/project-a/", { entity_type: "ISSUE_DESCRIPTION" })).status, 403);
  localDB.projects[0].network = 0;
  localDB.project_members[0].role = 0;
  assert.equal((await issueMeta()).status, 403);
});
