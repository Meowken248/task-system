// oxlint-disable-next-line import/no-unassigned-import -- Install isolated browser storage first.
import "./browser.mjs";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { defaultDB, localDB, setLoggedInUser } from "../../packages/services/src/dapp/store.ts";
import { handleRoute } from "../../packages/services/src/dapp/routes.ts";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "";
  Object.keys(localDB).forEach((key) => delete localDB[key]);
  Object.assign(localDB, structuredClone(defaultDB), {
    users: [{ id: "owner", email: "owner@example.invalid" }, { id: "elsewhere" }, { id: "pending" }],
    workspaces: [{ id: "team-id", slug: "team", created_by: "owner" }],
    workspace_members: [], invitations: [], projects: [], issues: [],
  });
  process.env.VITE_AUTO_COMMIT_ONCHAIN = "false";
  setLoggedInUser("owner");
});

const analytics = async (workspace = "team") => {
  const result = await handleRoute("get", `/api/workspaces/${workspace}/advance-analytics/`, {});
  assert.equal(result.status, 200);
  return result.data;
};

test("one actual owner is counted once despite other cached user profiles", async () => {
  const result = await analytics();
  assert.equal(result.total_users.count, 1);
  assert.equal(result.total_admins.count, 1);
  assert.equal(result.total_members.count, 0);
});

test("duplicate membership rows across workspace aliases do not inflate Analytics", async () => {
  localDB.workspace_members = [
    { workspace: "team-id", member: "owner", role: 20 },
    { workspace: "team", member: "member", role: 15 },
    { workspace: "team-id", member: "member", role: 15 },
    { workspace: "another-team", member: "elsewhere", role: 20 },
  ];
  const result = await analytics();
  assert.equal(result.total_users.count, 2);
  assert.equal(result.total_admins.count, 1);
  assert.equal(result.total_members.count, 1);
  assert.deepEqual((await analytics("team-id")).total_users, result.total_users);
});

test("pending invitations, inactive, removed, unverified and bot identities are excluded", async () => {
  localDB.invitations = [{ workspace: "team-id", email: "pending@example.invalid", accepted: false }];
  localDB.workspace_members = [
    { workspace: "team", member: "inactive", role: 15, is_active: false },
    { workspace: "team", member: "removed", role: 15 },
    { workspace: "team", member: "unverified", role: 15, verified_on_chain: false },
    { workspace: "team", member: "waiting", role: 15, chain_sync_pending: true },
    { workspace: "team", member: "bot", role: 15, is_bot: true },
    { workspace: "team", member: "guest", role: 5 },
  ];
  localDB.removed_members = { "team-id": ["removed"] };
  const result = await analytics();
  assert.equal(result.total_users.count, 2);
  assert.equal(result.total_members.count, 0);
  assert.equal(result.total_guests.count, 1);
});

test("unknown workspaces do not fabricate an owner or member minimum", async () => {
  const result = await analytics("missing");
  assert.equal(result.total_users.count, 0);
  assert.equal(result.total_admins.count, 0);
});
