// oxlint-disable-next-line import/no-unassigned-import -- Install browser fixtures before importing the real DApp modules.
import "./browser.mjs";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { AbiCoder, id } from "ethers";
import {
  localDB,
  defaultDB,
  setLoggedInUser,
  registerSaveHook,
  getUserWorkspaces,
  getUserProfile,
} from "../../packages/services/src/dapp/store.ts";
import { handleRoute } from "../../packages/services/src/dapp/routes.ts";
import { invalidateVaultWalletCache } from "../../packages/services/src/dapp/chain.ts";
import { discoverWalletWorkspaces } from "../../packages/services/src/dapp/workspace-wallet-members.ts";

const admin = "0x1111111111111111111111111111111111111111";
const recipient = "0x" + "2".repeat(38) + "ab";
const stranger = "0x4444444444444444444444444444444444444444";
const registry = "0x3333333333333333333333333333333333333333";
const abi = AbiCoder.defaultAbiCoder();
let sequence = 0,
  slug,
  workspace,
  snapshot,
  roles,
  writes,
  hooks,
  selected,
  failRpc,
  failSend,
  fakeSuccess,
  lostResponse,
  failIpfs,
  wrongResult,
  lastSend,
  confirmationDelayReads,
  delayedRole;
const resetLocal = (wallet = admin, profile = {}) => {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "";
  Object.keys(localDB).forEach((key) => delete localDB[key]);
  Object.assign(localDB, structuredClone(defaultDB));
  const user = {
    id: wallet === admin ? "admin-profile" : "recipient-profile",
    email: wallet === admin ? "admin@example.invalid" : "member@example.invalid",
    metanode_wallet_address: wallet,
    is_onboarded: false,
    ...profile,
  };
  localDB.users = [user];
  localDB.workspaces = wallet === admin ? [structuredClone(workspace)] : [];
  localDB.workspace_members = [];
  localDB.invitations = [];
  selected = wallet;
  sessionStorage.setItem("plane_dapp_auth_user", user.id);
  sessionStorage.setItem("plane_dapp_auth_email", user.email);
  sessionStorage.setItem("plane_active_wallet_address", wallet);
  localStorage.setItem("plane_active_wallet_address", wallet);
  invalidateVaultWalletCache();
  return user;
};

beforeEach(() => {
  slug = `wallet-test-${++sequence}`;
  workspace = {
    id: `uuid-${slug}`,
    slug,
    name: "Wallet team",
    owner: admin,
    created_by: admin,
    created_at: "2026-10-29T00:00:00.000Z",
    role: 20,
  };
  roles = new Map([[admin, 3]]);
  snapshot = {
    users: [{ id: "admin-profile", email: "admin@example.invalid", metanode_wallet_address: admin }],
    workspaces: [structuredClone(workspace)],
    workspace_members: [],
    invitations: [],
    projects: [
      { id: "public-project", name: "Shared project", workspace: workspace.id, network: 2 },
      { id: "private-project", name: "Private project", workspace: workspace.id, network: 0 },
    ],
  };
  writes = 0;
  hooks = 0;
  failRpc = false;
  failSend = false;
  fakeSuccess = false;
  lostResponse = false;
  failIpfs = false;
  wrongResult = false;
  lastSend = null;
  confirmationDelayReads = 0;
  delayedRole = null;
  Object.assign(process.env, {
    VITE_RPC_URL: "https://rpc.fixture",
    VITE_WORKSPACE_REGISTRY_ADDRESS: registry,
    VITE_PINATA_PROXY_URL: "https://pin.fixture",
    VITE_IPFS_GATEWAYS: "https://ipfs.fixture/",
    VITE_AUTO_COMMIT_ONCHAIN: "false",
  });
  resetLocal();
  registerSaveHook(() => {
    hooks++;
  });
  window.fiaiSDK = {
    request: async (action, params) => {
      if (action === "getAllWallets") return [{ address: selected }];
      if (action === "getVaultStatus") return { isLocked: false, isInitialized: true };
      if (action.startsWith("getActiveWallet")) return { address: selected };
      if (action === "sendTransaction") {
        writes++;
        assert.equal(params.functionName, "addMember", "no join/invite/CID transaction is needed");
        assert.equal(params.from, admin, "the admin signs, not the recipient");
        lastSend = { from: params.from, functionName: params.functionName, inputs: structuredClone(params.inputArray) };
        if (failSend) throw new Error("fixture-wallet-rejected");
        const values = Object.fromEntries(params.inputArray.map((input) => [input.name, input.value]));
        if (!fakeSuccess) {
          const desired = wrongResult ? 2 : Number(values.role);
          if (confirmationDelayReads) delayedRole = { wallet: values.member.toLowerCase(), role: desired };
          else roles.set(values.member.toLowerCase(), desired);
        }
        if (lostResponse) throw new Error("fixture-response-lost-after-broadcast");
        return { txHash: "0x" + "1".repeat(64) };
      }
      throw new Error("Unexpected SDK action: " + action);
    },
  };
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith("https://ipfs.fixture/")) {
      if (failIpfs) return new Response("offline", { status: 503 });
      return Response.json(snapshot);
    }
    assert.equal(url, "https://rpc.fixture", "no mail or IPFS upload is allowed during provisioning");
    const request = JSON.parse(options.body);
    if (request.method === "mtn_getAccountState") return Response.json({ result: { lastHash: "0x" + "7".repeat(64) } });
    assert.equal(request.method, "eth_call");
    if (failRpc) throw new Error("fixture-rpc-offline");
    const data = request.params[0].data;
    const args = data.slice(10);
    const selector = (signature) => id(signature).slice(0, 10);
    let result;
    if (data.startsWith(selector("getWorkspace(string)")))
      result = abi.encode(
        ["string", "address", "string", "uint256"],
        [workspace.name, admin, "Qm" + "c".repeat(44), 1]
      );
    else if (data.startsWith(selector("getMemberRole(string,address)"))) {
      const [, wallet] = abi.decode(["string", "address"], "0x" + args);
      if (delayedRole?.wallet === wallet.toLowerCase()) {
        if (confirmationDelayReads) confirmationDelayReads--;
        else roles.set(delayedRole.wallet, delayedRole.role);
      }
      result = abi.encode(["uint8"], [roles.get(wallet.toLowerCase()) || 0]);
    } else if (data.startsWith(selector("getUserWorkspaces(address)"))) {
      const [wallet] = abi.decode(["address"], "0x" + args);
      result = abi.encode(["string[]"], [(roles.get(wallet.toLowerCase()) || 0) > 0 ? [slug] : []]);
    } else if (data.startsWith(selector("getWorkspaceMembers(string)")))
      result = abi.encode(["address[]"], [[...roles].filter(([, role]) => role > 0).map(([wallet]) => wallet)]);
    else if (data === selector("operator()"))
      result = abi.encode(["address"], ["0x5555555555555555555555555555555555555555"]);
    else if (data === selector("workspacePolicyVersion()")) result = abi.encode(["uint256"], [2]);
    else if (data.startsWith(selector("getInvitation(string,address)")))
      result = abi.encode(["uint8", "uint256"], [0, 0]);
    else throw new Error("Unexpected fixture selector: " + data.slice(0, 10));
    return Response.json({ result });
  };
});
const add = (body = {}) =>
  handleRoute("post", `/api/workspaces/${slug}/members/`, { wallet_address: recipient, role: 15, ...body });

test("a default local workspace does not onboard a fresh wallet before its chain grant", async () => {
  resetLocal(recipient);
  localDB.workspaces = [{ id: "workspace-fiai", slug: "fiai", created_by: "user-default", role: 20 }];
  assert.deepEqual(getUserWorkspaces(), []);
  assert.equal(getUserProfile().is_onboarded, false);
  const before = await handleRoute("get", "/api/users/me/workspaces/");
  assert.deepEqual(before.data, []);
  roles.set(recipient, 1);
  // Discovery retries on the next polling interval, not by mutating a local role.
  localDB.workspaces = [...localDB.workspaces];
  const after = await handleRoute("get", "/api/users/me/workspaces/");
  assert.equal(after.data[0].slug, slug);
  assert.equal(getUserProfile().is_onboarded, true);
  assert.equal(writes, 0);
});

test("a slow workspace discovery remains single-flight after the cache interval", async () => {
  resetLocal(recipient);
  const read = globalThis.fetch;
  const clock = Date.now;
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  let reads = 0;
  globalThis.fetch = async (...args) => {
    reads++;
    await barrier;
    return read(...args);
  };
  try {
    const first = discoverWalletWorkspaces(recipient);
    Date.now = () => clock() + 20000;
    const second = discoverWalletWorkspaces(recipient);
    assert.strictEqual(second, first);
    assert.equal(reads, 1);
    release();
    assert.equal((await first).available, true);
    assert.equal(writes, 0);
  } finally {
    release();
    Date.now = clock;
    globalThis.fetch = read;
  }
});

test("admin provisions a wallet in one transaction with no email, pending invite or publication", async () => {
  const result = await add();
  assert.equal(result.status, 200);
  assert.equal(result.data.chain_confirmed, true);
  assert.equal(result.data.member.wallet_address, recipient);
  assert.equal(result.data.member.member.email, "");
  assert.equal(result.data.role, 15);
  assert.equal(writes, 1);
  assert.equal(hooks, 0, "cache-only persistence must not schedule another signing transaction");
  assert.equal(lastSend.from, admin);
  assert.equal(roles.get(recipient), 1);
  assert.equal(localDB.invitations.length, 0);
  assert.equal(localDB.workspaces[0].total_members, 2);
});
test("invalid inputs and unsupported roles cannot create cache rows or transactions", async () => {
  await Promise.all(
    [
      { wallet_address: "not-a-wallet" },
      { wallet_address: "0x" + "0".repeat(40) },
      { role: 5 },
      { role: 10 },
      { email: "claimed@example.invalid" },
      { admin_wallet: recipient },
    ].map(async (body) => {
      assert.equal((await add(body)).status, 400);
    })
  );
  assert.equal(writes, 0);
  assert.equal(localDB.workspace_members.length, 0);
});
test("ordinary members cannot add another wallet by claiming an Admin role in local cache", async () => {
  roles.set(admin, 1);
  assert.equal((await add()).status, 403);
  assert.equal(writes, 0);
  assert.equal(localDB.workspace_members.length, 0);
});
test("a signed-out account cannot provision a member even if the Vault has a wallet", async () => {
  setLoggedInUser(null);
  assert.equal((await add()).status, 401);
  assert.equal(writes, 0);
});
test("missing SDK does not grant a local-only membership", async () => {
  window.fiaiSDK = null;
  assert((await add()).status >= 400);
  assert.equal(writes, 0);
  assert.equal(localDB.workspace_members.length, 0);
});
test("RPC failure stops before signing and preserves local member data", async () => {
  failRpc = true;
  const before = structuredClone(localDB.workspace_members);
  assert.equal((await add()).status, 503);
  assert.deepEqual(localDB.workspace_members, before);
  assert.equal(writes, 0);
});
test("wallet rejection reports failure without adding a member", async () => {
  failSend = true;
  assert.equal((await add()).status, 503);
  assert.equal(localDB.workspace_members.length, 0);
});
test("a transaction hash alone is not membership confirmation", async () => {
  fakeSuccess = true;
  assert.equal((await add()).status, 409);
  assert.equal(localDB.workspace_members.length, 0);
});
test("an unexpected resulting role is not reported as the requested grant", async () => {
  wrongResult = true;
  assert.equal((await add()).status, 409);
  assert.equal(localDB.workspace_members.length, 0);
});
test("a lost send response is reconciled from confirmed role without another signature", async () => {
  lostResponse = true;
  assert.equal((await add()).status, 200);
  assert.equal(writes, 1);
  assert.equal((await add()).status, 200);
  assert.equal(writes, 1);
});
test("an already active wallet keeps its role and does not need a transaction", async () => {
  roles.set(recipient, 2);
  const result = await add();
  assert.equal(result.status, 200);
  assert.equal(result.data.already_member, true);
  assert.equal(result.data.role, 20);
  assert.equal(writes, 0);
  assert.equal(roles.get(recipient), 2);
});
test("concurrent duplicate additions use one grant and one member row", async () => {
  const result = await Promise.all([add(), add()]);
  assert(result.every((entry) => entry.status === 200));
  assert.equal(writes, 1);
  assert.equal(localDB.workspace_members.length, 1);
});
test("wallet casing cannot create a second identity", async () => {
  await add();
  const result = await add({ wallet_address: recipient.toUpperCase().replace("0X", "0x") });
  assert.equal(result.status, 200);
  assert.equal(writes, 1);
  assert.equal(localDB.workspace_members.length, 1);
});
test("direct provisioning completes an old wallet-bound Pending record without mail", async () => {
  localDB.invitations = [
    { id: "pending", wallet_address: recipient, workspace_slug: slug, accepted: false },
    { id: "unrelated", email: "other@example.invalid", workspace_slug: slug, accepted: false },
  ];
  await add();
  assert.equal(localDB.invitations[0].accepted, true);
  assert.equal(localDB.invitations[1].accepted, false);
});
test("verified provisioning clears only the target's removal markers in this workspace", async () => {
  localDB.removed_members = { [slug]: [recipient, stranger], [workspace.id]: [recipient], elsewhere: [recipient] };
  await add();
  assert.deepEqual(localDB.removed_members[slug], [stranger]);
  assert.deepEqual(localDB.removed_members[workspace.id], []);
  assert.deepEqual(localDB.removed_members.elsewhere, [recipient]);
});
test("a confirmed grant does not depend on IPFS availability", async () => {
  failIpfs = true;
  assert.equal((await add()).status, 200);
  assert.equal(roles.get(recipient), 1);
});
test("re-adding a removed wallet restores the existing row after a new confirmed grant", async () => {
  localDB.workspace_members = [
    {
      id: "old-member",
      workspace: workspace.id,
      member: recipient,
      wallet_address: recipient,
      role: 15,
      is_active: false,
    },
  ];
  await add();
  assert.equal(localDB.workspace_members.length, 1);
  assert.equal(localDB.workspace_members[0].id, "old-member");
  assert.equal(localDB.workspace_members[0].is_active, true);
});
test("a wallet switch during preflight cannot send a transaction from the replacement wallet", async () => {
  selected = recipient;
  invalidateVaultWalletCache();
  assert.equal((await add()).status, 409);
  assert.equal(writes, 0);
});
test("a recipient with only a private local account discovers the grant without an invitation or signature", async () => {
  await add();
  resetLocal(recipient);
  const response = await handleRoute("get", "/api/users/me/workspaces/", {});
  assert.equal(response.status, 200);
  assert.equal(response.data.length, 1);
  assert.equal(response.data[0].id, workspace.id);
  assert.equal(response.data[0].role, 15);
  assert.equal(writes, 1);
  assert.equal(localDB.invitations.length, 0);
  assert.equal(getUserWorkspaces().length, 1);
  assert.equal(localDB.users.find((user) => user.id === "recipient-profile").is_onboarded, true);
});
test("first profile fetch recognizes a pre-existing grant before onboarding chooses a workspace", async () => {
  roles.set(recipient, 1);
  resetLocal(recipient);
  const profile = await handleRoute("get", "/api/users/me/", {});
  assert.equal(profile.status, 200);
  assert.equal(profile.data.is_onboarded, true);
  assert.equal(profile.data.last_workspace_slug, slug);
  assert.equal(writes, 0);
});
test("fresh-recipient discovery hydrates public project data without exposing private projects as an Admin", async () => {
  roles.set(recipient, 1);
  resetLocal(recipient);
  await handleRoute("get", "/api/users/me/workspaces/", {});
  const projects = await handleRoute("get", `/api/workspaces/${slug}/projects/details/`, {});
  assert.equal(projects.status, 200);
  assert.deepEqual(
    projects.data.map((project) => project.id),
    ["public-project"]
  );
  const me = await handleRoute("get", `/api/workspaces/${slug}/workspace-members/me/`, {});
  assert.equal(me.status, 200);
  assert.equal(me.data.role, 15);
  assert.equal(writes, 0);
});
test("discovery preserves an unrelated local draft and local credentials", async () => {
  roles.set(recipient, 1);
  resetLocal(recipient);
  localDB.projects = [{ id: "draft", workspace: "another-workspace", name: "Local draft" }];
  localStorage.setItem("plane_dapp_credentials", JSON.stringify({ "member@example.invalid": "local-only-hash" }));
  snapshot.credentials = { "injected@example.invalid": "remote-hash" };
  await handleRoute("get", "/api/users/me/workspaces/", {});
  assert(localDB.projects.some((project) => project.id === "draft"));
  assert.deepEqual(JSON.parse(localStorage.getItem("plane_dapp_credentials")), {
    "member@example.invalid": "local-only-hash",
  });
});
test("a forged cached Admin/email claim cannot make an ungranted wallet appear in the workspace list", async () => {
  resetLocal(stranger, { email: "admin@example.invalid" });
  localDB.workspaces = [structuredClone(workspace)];
  localDB.workspace_members = [
    {
      id: "forged",
      workspace: workspace.id,
      member: "recipient-profile",
      email: "admin@example.invalid",
      wallet_address: stranger,
      role: 20,
      verified_on_chain: true,
    },
  ];
  const result = await handleRoute("get", "/api/users/me/workspaces/", {});
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, []);
  assert.equal(writes, 0);
});

test("IPFS outage keeps confirmed workspace access visible and recovers without another signature", async () => {
  roles.set(recipient, 1);
  resetLocal(recipient);
  failIpfs = true;
  let result = await handleRoute("get", "/api/users/me/workspaces/", {});
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].is_snapshot_available, false);
  failIpfs = false;
  result = await handleRoute("get", "/api/users/me/workspaces/", {});
  assert.equal(result.data[0].is_snapshot_available, true);
  assert(localDB.projects.some((project) => project.id === "public-project"));
  assert.equal(writes, 0);
});

test("snapshot owner/role flags cannot upgrade a confirmed Member in the workspace response", async () => {
  roles.set(recipient, 1);
  resetLocal(recipient);
  snapshot.workspaces[0].created_by = "recipient-profile";
  snapshot.workspaces[0].role = 20;
  const result = await handleRoute("get", "/api/users/me/workspaces/", {});
  assert.equal(result.data[0].role, 15);
  assert.equal(localDB.workspaces.find((item) => item.slug === slug).created_by, admin);
});

test("an uncertain grant is checked again without sending another transaction", async () => {
  fakeSuccess = true;
  const first = await add();
  assert.equal(first.data.code, "MEMBERSHIP_PENDING");
  assert.equal((await add()).data.code, "MEMBERSHIP_PENDING");
  assert.equal(writes, 1);
  roles.set(recipient, 1);
  assert.equal((await add()).status, 200);
  assert.equal(writes, 1);
});
test("a recovery marker left by a previous page prevents blind rebroadcast", async () => {
  localStorage.setItem(
    `plane_wallet_member_pending:${process.env.VITE_RPC_URL}:${registry}:${slug}:${recipient}`,
    "pending"
  );
  assert.equal((await add()).data.code, "MEMBERSHIP_PENDING");
  assert.equal(writes, 0);
});
test("a delayed chain confirmation is polled rather than broadcasting twice", async () => {
  confirmationDelayReads = 1;
  assert.equal((await add()).status, 200);
  assert.equal(writes, 1);
});
test("resending an uncertain operation requires an explicit review choice", async () => {
  fakeSuccess = true;
  assert.equal((await add()).data.code, "MEMBERSHIP_PENDING");
  fakeSuccess = false;
  assert.equal((await add({ retry_after_review: true })).status, 200);
  assert.equal(writes, 2);
});
test("blocked local recovery storage stops the operation before signing", async () => {
  const localSet = localStorage.setItem;
  const sessionSet = sessionStorage.setItem;
  localStorage.setItem = sessionStorage.setItem = () => {
    throw new Error("fixture-storage-full");
  };
  try {
    assert.equal((await add()).status, 503);
    assert.equal(writes, 0);
    assert.equal(localDB.workspace_members.length, 0);
  } finally {
    localStorage.setItem = localSet;
    sessionStorage.setItem = sessionSet;
  }
});
test("the same wallet in another workspace is not modified by this grant", async () => {
  localDB.workspace_members = [
    { id: "other-team", workspace: "other-workspace", member: recipient, wallet_address: recipient, role: 20 },
  ];
  const original = structuredClone(localDB.workspace_members[0]);
  await add();
  assert.deepEqual(
    localDB.workspace_members.find((member) => member.id === "other-team"),
    original
  );
  assert.equal(localDB.workspace_members.length, 2);
  assert.equal(localDB.workspaces[0].total_members, 2);
});
test("a cached Admin membership of another wallet cannot upgrade the currently selected Member wallet", async () => {
  roles.set(recipient, 1);
  resetLocal(recipient, { metanode_wallet_address: admin });
  localDB.workspaces = [structuredClone(workspace)];
  localDB.workspace_members = [
    {
      id: "other-wallet-admin",
      workspace: workspace.id,
      member: "recipient-profile",
      email: "member@example.invalid",
      wallet_address: admin,
      role: 20,
      verified_on_chain: true,
    },
  ];
  await handleRoute("get", "/api/users/me/workspaces/", {});
  const me = await handleRoute("get", `/api/workspaces/${slug}/workspace-members/me/`, {});
  assert.equal(me.data.role, 15);
  const permissions = await handleRoute("get", `/api/users/me/workspaces/${slug}/project-roles/`, {});
  assert.equal(permissions.data["public-project"], 15);
  const projects = await handleRoute("get", `/api/workspaces/${slug}/projects/details/`, {});
  assert.deepEqual(
    projects.data.map((project) => project.id),
    ["public-project"]
  );
});
