import "./browser.mjs";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { AbiCoder, id } from "ethers";
import { listWorkspaceMembers } from "../../packages/services/src/dapp/workspace-members.ts";
import { localDB, defaultDB, getWorkspaceMemberCount } from "../../packages/services/src/dapp/store.ts";
import { handleRoute } from "../../packages/services/src/dapp/routes.ts";
import { setDirtyState, getIsDirtyState } from "../../packages/services/src/dapp/chain.ts";

const ownerWallet = "0x1111111111111111111111111111111111111111";
const adminWallet = "0x2222222222222222222222222222222222222222";
let db;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "";
  Object.keys(localDB).forEach((key) => delete localDB[key]);
  Object.assign(localDB, structuredClone(defaultDB));
  const user = {
    id: "owner",
    email: "owner@example.invalid",
    first_name: "Owner",
    display_name: "Owner",
    metanode_wallet_address: ownerWallet,
  };
  db = {
    ...structuredClone(defaultDB),
    users: [user],
    workspaces: [{ id: "uuid-workspace", slug: "audit", created_by: user.id, owner: user }],
    workspace_members: [
      {
        id: "owner-membership",
        workspace: "uuid-workspace",
        member: user.id,
        email: user.email,
        role: 20,
        is_active: true,
      },
      {
        id: "owner-wallet-legacy",
        workspace: "workspace-audit",
        member: "user-old-owner",
        wallet_address: ownerWallet,
        role: 15,
        is_active: true,
        verified_on_chain: true,
      },
      {
        id: "owner-wallet-uuid",
        workspace: "uuid-workspace",
        member: "user-old-owner",
        wallet_address: ownerWallet,
        role: 15,
        is_active: true,
        verified_on_chain: true,
      },
      {
        id: "admin-legacy",
        workspace: "workspace-audit",
        member: "user-old-admin",
        wallet_address: adminWallet,
        role: 20,
        is_active: true,
        verified_on_chain: true,
      },
      {
        id: "admin-uuid",
        workspace: "uuid-workspace",
        member: "user-old-admin",
        wallet_address: adminWallet,
        role: 20,
        is_active: true,
        verified_on_chain: true,
      },
    ],
    invitations: [{ id: "old-accepted", workspace: "audit", email: "invited@example.invalid", accepted: true }],
    removed_members: {},
  };
  process.env.VITE_ONCHAIN_MEMBERSHIP_SYNC = "false";
  Object.assign(localDB, db);
  sessionStorage.setItem("plane_dapp_auth_user", user.id);
  sessionStorage.setItem("plane_dapp_auth_email", user.email);
});

test("owner profile plus duplicate wallet/UUID rows count as two identities, not three", () => {
  const result = listWorkspaceMembers(db, "audit");
  assert.equal(result.length, 2);
  assert.deepEqual(new Set(result.map((row) => row.wallet_address)), new Set([ownerWallet, adminWallet]));
  assert.equal(result.find((row) => row.wallet_address === ownerWallet).member.id, "owner");
});
test("count and members API return the same canonical identities", async () => {
  assert.equal(getWorkspaceMemberCount("audit", "uuid-workspace"), 2);
  const result = await handleRoute("get", "/api/workspaces/audit/members/", {});
  assert.equal(result.status, 200);
  assert.equal(result.data.length, 2);
  assert.equal(getWorkspaceMemberCount("audit", "uuid-workspace"), result.data.length);
  assert.equal(new Set(result.data.map((row) => row.member.id)).size, 2);
});
test("wallet-only admins stay visible with their role read from the contract", async () => {
  process.env.VITE_ONCHAIN_MEMBERSHIP_SYNC = "true";
  process.env.VITE_RPC_URL = "http://rpc.test";
  process.env.VITE_WORKSPACE_REGISTRY_ADDRESS = "0x3333333333333333333333333333333333333333";
  const abi = AbiCoder.defaultAbiCoder();
  let writes = 0;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.method !== "eth_call") {
      writes++;
      throw new Error("Read must not send a transaction");
    }
    const data = request.params[0].data;
    if (data.startsWith(id("getWorkspaceMembers(string)").slice(0, 10)))
      return Response.json({ result: abi.encode(["address[]"], [[ownerWallet, adminWallet]]) });
    if (data.startsWith(id("getWorkspace(string)").slice(0, 10)))
      return Response.json({
        result: abi.encode(["string", "address", "string", "uint256"], ["Audit", ownerWallet, "", 1]),
      });
    if (data.startsWith(id("getMemberRole(string,address)").slice(0, 10))) {
      const [, wallet] = abi.decode(["string", "address"], "0x" + data.slice(10));
      return Response.json({ result: abi.encode(["uint8"], [wallet.toLowerCase() === ownerWallet ? 3 : 2]) });
    }
    throw new Error("Unexpected RPC read");
  };
  const result = await handleRoute("get", "/api/workspaces/audit/members/", {});
  assert.equal(result.status, 200);
  assert.equal(result.data.length, 2);
  assert.equal(result.data.find((row) => row.wallet_address === adminWallet).role, 20);
  assert.equal(writes, 0);
  setDirtyState(false);
  const snapshot = JSON.stringify(localDB);
  const repeated = await handleRoute("get", "/api/workspaces/audit/members/", {});
  assert.equal(repeated.data.length, 2);
  assert.equal(JSON.stringify(localDB), snapshot);
  assert.equal(getIsDirtyState(), false, "an unchanged membership read must not schedule another upload");
});
test("an accepted invitation never creates an extra member", () => {
  db.workspace_members = [];
  assert.equal(listWorkspaceMembers(db, "audit").length, 1);
});
test("removed wallets are excluded across workspace slug, UUID and legacy aliases", () => {
  db.removed_members = { audit: [adminWallet.toUpperCase()] };
  assert.equal(listWorkspaceMembers(db, "audit").length, 1);
});
for (const [name, fields] of [
  ["inactive", { is_active: false }],
  ["unconfirmed", { verified_on_chain: false }],
  ["pending", { chain_sync_pending: true }],
  ["no-role", { role: 0 }],
]) {
  test(`${name} membership rows are not counted`, () => {
    db.workspace_members = db.workspace_members.map((row) =>
      row.wallet_address === adminWallet ? { ...row, ...fields } : row
    );
    assert.equal(listWorkspaceMembers(db, "audit").length, 1);
  });
}
test("wallet-only members are represented with a stable full address and no invented email", () => {
  const result = listWorkspaceMembers(db, "audit").find((row) => row.wallet_address === adminWallet);
  assert.equal(result.member.id, adminWallet);
  assert.equal(result.member.email, "");
  assert.equal(result.role, 20);
  assert(result.member.display_name.includes("…"));
});
test("members in another workspace are never included", () => {
  db.workspace_members.push({ id: "other", workspace: "different", member: "other-user", role: 15 });
  assert.equal(listWorkspaceMembers(db, "audit").length, 2);
  assert.equal(listWorkspaceMembers(db, "missing").length, 0);
});
test("legacy placeholder owners do not create a fabricated minimum of one member", () => {
  db.workspaces = [{ id: "workspace-empty", slug: "empty", created_by: "user-default", owner: { id: "user-default" } }];
  db.workspace_members = [];
  assert.equal(listWorkspaceMembers(db, "empty").length, 0);
});
test("projection does not mutate source records or invitation acceptance", () => {
  const before = structuredClone(db);
  listWorkspaceMembers(db, "audit");
  assert.deepEqual(db, before);
});
test("a conflicting wallet cannot take the owner profile by reusing its user id", () => {
  db.workspace_members.push({
    id: "conflicting",
    workspace: "uuid-workspace",
    member: "owner",
    wallet_address: adminWallet,
    role: 15,
  });
  const result = listWorkspaceMembers(db, "audit");
  assert.equal(result.length, 2);
  assert.equal(result.find((row) => row.wallet_address === adminWallet).member.id, adminWallet);
});
test("bots do not contribute to the human member count", () => {
  db.users.push({ id: "bot", email: "bot@example.invalid", is_bot: true });
  db.workspace_members.push({ id: "bot-row", workspace: "uuid-workspace", member: "bot", role: 15 });
  assert.equal(listWorkspaceMembers(db, "audit").length, 2);
});

test("a fresh contract role wins over a duplicate cached Admin role", () => {
  const current = db.workspace_members.find((row) => row.wallet_address === adminWallet);
  current.on_chain_role = 1;
  current.role = 15;
  assert.equal(listWorkspaceMembers(db, "audit").find((row) => row.wallet_address === adminWallet).role, 15);
});
