import "./browser.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AbiCoder, id } from "ethers";
import {
  createInvitationToken,
  decodeInvitationToken,
  isInvitationTokenExpired,
} from "../../packages/services/src/dapp/invitation-tokens.ts";
import { validateInvitation, withInvitationLock } from "../../packages/services/src/dapp/invitation-policy.ts";
import {
  localDB,
  defaultDB,
  getUserWorkspaces,
  getLoggedInUserId,
  getLoggedInEmail,
  isLoggedIn,
  setLoggedInUser,
} from "../../packages/services/src/dapp/store.ts";
import { handleRoute } from "../../packages/services/src/dapp/routes.ts";
import { respondToWorkspaceInvitation } from "../../packages/services/src/dapp/workspace-invitations.ts";
import {
  joinWorkspaceOnChain,
  removeWorkspaceMemberOnChain,
  leaveWorkspaceOnChain,
  mapPlaneRoleToContractRole,
  writeWorkspaceWalletInvitation,
  fetchMemberRoleOnChain,
  invalidateVaultWalletCache,
  uploadToIPFS,
  setDirtyState,
  getIsDirtyState,
  commitWorkspaceCID,
  applyOffchainDB,
} from "../../packages/services/src/dapp/chain.ts";

const actor = "0x1111111111111111111111111111111111111111";
const owner = "0x2222222222222222222222222222222222222222";
const registry = "0x3333333333333333333333333333333333333333";
const abi = AbiCoder.defaultAbiCoder();
let sequence = 0,
  slug,
  invitation,
  snapshot,
  role,
  cid,
  sent,
  mailed,
  failSend,
  failRpc,
  failPin,
  revokeDuringSend,
  invalidRole,
  pending,
  legacyRegistry,
  registryVersion;
const initialCid = "Qm" + "a".repeat(44);
const publishedCid = "Qm" + "b".repeat(44);

beforeEach(() => {
  slug = `audit-${++sequence}`;
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "";
  Object.keys(localDB).forEach((key) => delete localDB[key]);
  Object.assign(localDB, structuredClone(defaultDB));
  Object.assign(process.env, {
    VITE_RPC_URL: "http://rpc.test",
    VITE_WORKSPACE_REGISTRY_ADDRESS: registry,
    VITE_PINATA_PROXY_URL: "https://pin.test",
    VITE_IPFS_GATEWAYS: "https://ipfs.test/",
    VITE_AUTO_COMMIT_ONCHAIN: "false",
    VITE_IPFS_UPLOAD_RETRY_DELAY_MS: "0",
    VITE_MAIL_PROXY_URL: "https://mail.test",
    VITE_EMAIL_SENDER_ADDRESS: "sender@example.invalid",
  });
  const user = { id: "recipient", email: "recipient@example.invalid", metanode_wallet_address: actor };
  const workspace = { id: `id-${slug}`, slug, name: "Audit workspace", owner, created_by: owner };
  invitation = {
    id: "invite",
    workspace_slug: slug,
    workspace: { ...workspace },
    email: user.email,
    wallet_address: actor,
    role: 15,
    token: createInvitationToken(),
    token_version: 2,
    token_expires_at: new Date(Date.now() + 60000).toISOString(),
    accepted: false,
    responded_at: null,
  };
  Object.assign(localDB, {
    users: [user],
    workspaces: [workspace],
    invitations: [structuredClone(invitation)],
    workspace_members: [],
    removed_members: {},
  });
  snapshot = structuredClone(localDB);
  sessionStorage.setItem("plane_dapp_auth_email", user.email);
  sessionStorage.setItem("plane_dapp_auth_user", user.id);
  sessionStorage.setItem("plane_active_wallet_address", actor);
  role = 0;
  cid = initialCid;
  sent = 0;
  mailed = 0;
  failSend = false;
  failRpc = false;
  failPin = false;
  revokeDuringSend = false;
  invalidRole = false;
  pending = { role: 0, expiresAt: 0 };
  legacyRegistry = false;
  registryVersion = 2;
  invalidateVaultWalletCache();
  window.fiaiSDK = {
    request: async (action, params) => {
      if (action === "getAllWallets") return [{ address: actor }];
      if (action === "getVaultStatus") return { isLocked: false, isInitialized: true };
      if (action.startsWith("getActiveWallet")) return { address: actor };
      if (action === "sendTransaction") {
        sent++;
        if (failSend) throw new Error("member permission failed");
        if (params.functionName === "joinWorkspace") role = 1;
        if (params.functionName === "removeMember") role = 0;
        if (params.functionName === "leaveWorkspace") {
          assert.deepEqual(params.inputArray, [{ name: "slug", type: "string", value: slug }]);
          role = 0;
        }
        if (params.functionName === "addMember")
          role = Number(params.inputArray.find((entry) => entry.name === "role").value);
        if (params.functionName === "inviteMember")
          pending = {
            role: Number(params.inputArray.find((entry) => entry.name === "role").value),
            expiresAt: Number(params.inputArray.find((entry) => entry.name === "expiresAt").value),
          };
        if (params.functionName === "revokeInvitation") pending = { role: 0, expiresAt: 0 };
        if (params.functionName === "updateWorkspaceCIDIfMatches") {
          const values = Object.fromEntries(params.inputArray.map((entry) => [entry.name, entry.value]));
          assert.equal(values.expectedOldCid, cid);
          cid = values.newCid;
        }
        if (revokeDuringSend) {
          snapshot.invitations = [];
          cid = "Qm" + "c".repeat(44);
        }
        return { txHash: "0x" + "1".repeat(64) };
      }
      throw new Error(`Unexpected wallet action ${action}`);
    },
  };
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith("https://ipfs.test/")) return Response.json(snapshot);
    if (url === "https://pin.test") {
      if (failPin) return new Response("unavailable", { status: 503 });
      snapshot = JSON.parse(options.body);
      return Response.json({ cid: publishedCid });
    }
    if (url === "https://mail.test") {
      mailed++;
      assert.equal(cid, publishedCid, "mail must follow confirmed publication");
      return Response.json({ id: "mail" });
    }
    const body = JSON.parse(options.body || "{}");
    if (body.method === "mtn_getAccountState") return Response.json({ result: { lastHash: "0x" + "2".repeat(64) } });
    if (body.method !== "eth_call") throw new Error(`Unexpected fetch ${url}`);
    if (failRpc) throw new Error("RPC unavailable");
    const data = body.params[0].data;
    if (data.startsWith(id("getWorkspace(string)").slice(0, 10)))
      return Response.json({
        result: abi.encode(["string", "address", "string", "uint256"], ["Audit workspace", owner, cid, 1]),
      });
    if (data.startsWith(id("getMemberRole(string,address)").slice(0, 10)))
      return Response.json({ result: invalidRole ? "0x" : abi.encode(["uint8"], [role]) });
    if (data === id("operator()").slice(0, 10)) return Response.json({ result: abi.encode(["address"], [owner]) });
    if (data === id("workspacePolicyVersion()").slice(0, 10))
      return Response.json({ result: legacyRegistry ? "0x" : abi.encode(["uint256"], [registryVersion]) });
    if (data.startsWith(id("getInvitation(string,address)").slice(0, 10)))
      return Response.json({ result: abi.encode(["uint8", "uint256"], [pending.role, pending.expiresAt]) });
    throw new Error(`Unexpected calldata ${data}`);
  };
});

const respond = (body = {}) =>
  respondToWorkspaceInvitation("post", slug, invitation.id, {
    accepted: true,
    token: invitation.token,
    wallet_address: actor,
    ...body,
  });

test("new tokens are opaque 256-bit values, with no role claims", () => {
  const tokens = Array.from({ length: 100 }, () => createInvitationToken());
  assert.equal(new Set(tokens).size, tokens.length);
  assert(tokens.every((token) => /^inv_[0-9a-f]{64}$/.test(token)));
  assert.equal(decodeInvitationToken(tokens[0]), null);
});
test("legacy token role and expiry are not authority", () => {
  const token =
    "inv_" + Buffer.from(JSON.stringify({ id: "invite", ws: slug, role: 20, exp: "2999-01-01" })).toString("base64url");
  const legacy = decodeInvitationToken(token);
  assert.equal(legacy.id, "invite");
  assert.equal(
    validateInvitation(invitation, { id: legacy.id, workspaceKeys: [slug], token, email: invitation.email }).code,
    "INVITATION_TOKEN_MISMATCH"
  );
});
for (const [name, expiry] of [
  ["invalid", "garbage"],
  ["boundary", new Date(100).toISOString()],
  ["expired", new Date(1).toISOString()],
]) {
  test(`expiry ${name} fails closed`, () =>
    assert.equal(isInvitationTokenExpired({ token_expires_at: expiry }, 100), true));
}
test("version 2 record missing expiry is expired", () =>
  assert.equal(isInvitationTokenExpired({ token_version: 2 }), true));
test("conflicting expiry fields cannot extend validity", () =>
  assert.equal(
    isInvitationTokenExpired({
      token_expires_at: new Date(Date.now() + 60000).toISOString(),
      invite_expires_at: "invalid",
    }),
    true
  ));
test("anonymous request requires the actual token", () =>
  assert.equal(
    validateInvitation(invitation, { id: "invite", workspaceKeys: [slug] }).code,
    "INVITATION_TOKEN_MISMATCH"
  ));
test("an in-app invitation can use its authenticated email", () =>
  assert.equal(validateInvitation(invitation, { id: "invite", workspaceKeys: [slug], email: invitation.email }), null));
test("record from another workspace is rejected", () =>
  assert.equal(
    validateInvitation(invitation, { id: "invite", workspaceKeys: ["other"], token: invitation.token }).status,
    404
  ));
test("wallet invitation requires the exact target wallet", () =>
  assert.equal(
    validateInvitation(
      { ...invitation, wallet_address: owner },
      { id: "invite", workspaceKeys: [slug], token: invitation.token, wallet: actor }
    ).code,
    "INVITATION_WALLET_MISMATCH"
  ));
test("invalid role cannot be accepted", () =>
  assert.equal(
    validateInvitation({ ...invitation, role: 999 }, { id: "invite", workspaceKeys: [slug], token: invitation.token })
      .code,
    "INVITATION_ROLE_INVALID"
  ));
test("queued invitation failure does not block subsequent work", async () => {
  const order = [];
  await Promise.allSettled([
    withInvitationLock("test", async () => {
      order.push(1);
      throw Error("test");
    }),
    withInvitationLock("test", async () => order.push(2)),
  ]);
  assert.deepEqual(order, [1, 2]);
});
test("GET link has no membership or acceptance side effects", async () => {
  assert.equal((await respondToWorkspaceInvitation("get", slug, "invite", {}, invitation.token)).status, 200);
  assert.equal(localDB.invitations[0].accepted, false);
  assert.equal(localDB.workspace_members.length, 0);
  assert.equal(sent, 0);
});

test("explicit sign-out cannot be undone by a still-connected wallet and preserves offline data", () => {
  localStorage.setItem("offline-fixture", "pending-edit");
  sessionStorage.setItem("ipfs_fixture", "published-cache");
  setLoggedInUser(null);
  // The Wallet Center can rediscover the active Vault wallet after signing out.
  sessionStorage.setItem("plane_active_wallet_address", actor);
  localStorage.setItem("plane_active_wallet_address", actor);
  assert.equal(getLoggedInUserId(), null);
  assert.equal(getLoggedInEmail(), null);
  assert.equal(isLoggedIn(), false);
  assert.equal(localStorage.getItem("offline-fixture"), "pending-edit");
  assert.equal(sessionStorage.getItem("ipfs_fixture"), "published-cache");
  setLoggedInUser("recipient");
  sessionStorage.setItem("plane_dapp_auth_email", invitation.email);
  assert.equal(isLoggedIn(), true);
  assert.equal(getLoggedInUserId(), "recipient");
});

test("a fresh receiver resolves the published workspace before a legacy placeholder", async () => {
  const placeholder = { id: `workspace-${slug}`, slug, name: "Legacy placeholder" };
  localDB.workspaces = [placeholder];
  snapshot.workspaces.unshift(placeholder);
  snapshot.removed_members = { [placeholder.id]: [invitation.email] };
  localDB.removed_members = structuredClone(snapshot.removed_members);
  // Earlier versions propagated the placeholder's markers to every alias.
  localDB.removed_members[slug] = [invitation.email];
  localDB.removed_members[`id-${slug}`] = [invitation.email];
  const result = await respondToWorkspaceInvitation("get", slug, "invite", {}, invitation.token);
  assert.equal(result.status, 200);
  assert.equal(result.data.workspace.id, `id-${slug}`);
  assert.equal(localDB.workspace_members.length, 0);
  assert.equal(sent, 0);
  const accepted = await respond();
  assert.equal(accepted.status, 200);
  assert.equal(localDB.workspace_members[0].workspace_id, `id-${slug}`);
  assert.equal(localDB.removed_members[slug].includes(invitation.email), false);
  assert.equal(localDB.removed_members[`id-${slug}`].includes(invitation.email), false);
  applyOffchainDB(structuredClone(snapshot));
  assert.equal(localDB.workspace_members.length, 1, "later hydration must not propagate the legacy ban again");
  assert.equal(localDB.removed_members[slug].includes(invitation.email), false);
});

test("legacy invitation removal is still enforced for its actual workspace", async () => {
  const placeholder = { id: `workspace-${slug}`, slug, name: "Legacy workspace" };
  snapshot.workspaces.unshift(placeholder);
  snapshot.invitations[0].workspace = placeholder;
  snapshot.invitations[0].workspace_id = placeholder.id;
  snapshot.removed_members = { [placeholder.id]: [invitation.email] };
  const result = await respondToWorkspaceInvitation("get", slug, "invite", {}, invitation.token);
  assert.equal(result.status, 410);
  assert.equal(result.data.code, "MEMBER_REMOVED");
  assert.equal(sent, 0);
});

test("published re-invitation supersedes stale email bans but not exact id or token revocations", async () => {
  localDB._deleted_invitation_ids = [invitation.email, `ws:${slug}|email:${invitation.email}`];
  assert.equal((await respondToWorkspaceInvitation("get", slug, "invite", {}, invitation.token)).status, 200);
  assert.equal((await respond()).status, 200);
  assert.equal(getUserWorkspaces("recipient", invitation.email).length, 1);
  localDB._deleted_invitation_ids.push(invitation.id);
  assert.equal((await respondToWorkspaceInvitation("get", slug, "invite", {}, invitation.token)).status, 410);
  localDB._deleted_invitation_ids = [invitation.token];
  assert.equal((await respondToWorkspaceInvitation("get", slug, "invite", {}, invitation.token)).status, 410);
});

test("a published email ban still revokes the invitation", async () => {
  snapshot._deleted_invitation_ids = [`ws:${slug}|email:${invitation.email}`];
  assert.equal((await respond()).status, 410);
  assert.equal(sent, 0);
});

test("a missing source without a cached invitation is unavailable, not an expired link", async () => {
  failRpc = true;
  localDB.invitations = [];
  const result = await respondToWorkspaceInvitation("get", slug, "invite", {}, invitation.token);
  assert.equal(result.status, 503);
  assert.equal(result.data.code, "INVITATION_SOURCE_UNAVAILABLE");
});

test("anonymous email-only link exposes pending wallet approval without granting membership", async () => {
  delete snapshot.invitations[0].wallet_address;
  sessionStorage.clear();
  const result = await respondToWorkspaceInvitation("get", slug, "invite", {}, invitation.token);
  assert.equal(result.status, 200);
  assert.equal(result.data.wallet_approval_required, true);
  assert.equal(result.data.source_verified, true);
  assert.equal(result.data.accepted, false);
  assert.equal(result.data.token, undefined);
  assert.equal(sent, 0);
});

test("first admin wallet approval preserves the email link and waits for publication", async () => {
  role = 3;
  delete localDB.invitations[0].wallet_address;
  localDB.invitations[0].wallet_approval_required = true;
  const originalToken = invitation.token;
  const result = await handleRoute("patch", `/api/workspaces/${slug}/invitations/invite/`, { wallet_address: actor });
  assert.equal(result.status, 200);
  assert.equal(result.data.token, originalToken);
  assert.equal(result.data.wallet_approval_required, false);
  assert.equal(result.data.wallet_address, actor);
  assert.equal(snapshot.invitations[0].token, originalToken);
  assert.equal(pending.role, 1);
  assert.equal(cid, publishedCid);
  assert.equal(mailed, 0);
  assert.equal(localDB.workspace_members.length, 0);
  role = 0;
  assert.equal((await respond()).status, 200);
});

test("failed first approval stays pending and retry keeps the original token", async () => {
  role = 3;
  legacyRegistry = true;
  delete localDB.invitations[0].wallet_address;
  localDB.invitations[0].wallet_approval_required = true;
  const update = () => handleRoute("patch", `/api/workspaces/${slug}/invitations/invite/`, { wallet_address: actor });
  assert.equal((await update()).status, 503);
  assert.equal(localDB.invitations[0].token, invitation.token);
  legacyRegistry = false;
  assert.equal((await update()).status, 200);
  assert.equal(localDB.invitations[0].token, invitation.token);
  assert.equal(mailed, 0);
});

test("wallet replacement rotates the link and a member cannot approve a wallet", async () => {
  role = 1;
  const url = `/api/workspaces/${slug}/invitations/invite/`;
  const body = { wallet_address: "0x4444444444444444444444444444444444444444" };
  assert.equal((await handleRoute("patch", url, body)).status, 403);
  assert.equal(sent, 0);
  role = 3;
  const result = await handleRoute("patch", url, body);
  assert.equal(result.status, 200);
  assert.notEqual(result.data.token, invitation.token);
});
test("bulk and single acceptance reject a different email", async () => {
  sessionStorage.setItem("plane_dapp_auth_email", "wrong@example.invalid");
  localDB.users.push({ id: "wrong", email: "wrong@example.invalid" });
  const single = await respond();
  const bulk = await handleRoute("post", "/api/users/me/workspaces/invitations/", {
    invitations: ["invite"],
    wallet_address: actor,
  });
  assert.equal(single.status, 403);
  assert.equal(bulk.status, 403);
  assert.equal(sent, 0);
  assert.equal(localDB.workspace_members.length, 0);
});
test("expired invitation remains unaccepted", async () => {
  snapshot.invitations[0].token_expires_at = "invalid";
  assert.equal((await respond()).status, 410);
  assert.equal(sent, 0);
  assert.equal(localDB.invitations[0].accepted, false);
});
test("missing authoritative record cannot be invented from a forged token", async () => {
  snapshot.invitations = [];
  const forged =
    "inv_" +
    Buffer.from(JSON.stringify({ id: "invite", ws: slug, email: invitation.email, role: 20 })).toString("base64url");
  assert.equal((await respond({ token: forged })).status, 404);
  assert.equal(sent, 0);
});
test("RPC failure never falls back to cached acceptance", async () => {
  failRpc = true;
  assert.equal((await respond()).status, 503);
  assert.equal(localDB.invitations[0].accepted, false);
  assert.equal(sent, 0);
});
test("revocation tombstone prevents acceptance", async () => {
  snapshot._deleted_invitation_ids = ["invite"];
  assert.equal((await respond()).status, 410);
  assert.equal(sent, 0);
});
test("member removal under workspace id is enforced", async () => {
  snapshot.removed_members = { [`id-${slug}`]: [invitation.email] };
  assert.equal((await respond()).status, 410);
  assert.equal(sent, 0);
});
test("error message containing member is not treated as success", async () => {
  failSend = true;
  await assert.rejects(joinWorkspaceOnChain(slug, actor), /member permission failed/);
  assert.equal(sent, 1);
  assert.equal(localDB.workspace_members.length, 0);
});
test("failed join preserves invitation and membership", async () => {
  failSend = true;
  assert.equal((await respond()).status, 503);
  assert.equal(sent, 1);
  assert.equal(localDB.invitations[0].accepted, false);
  assert.equal(localDB.workspace_members.length, 0);
});
test("invalid RPC role is unknown rather than Role.None", async () => {
  invalidRole = true;
  assert.equal(await fetchMemberRoleOnChain(slug, actor), -1);
  await assert.rejects(joinWorkspaceOnChain(slug, actor));
  assert.equal(sent, 0);
});
test("success creates a member only after on-chain verification", async () => {
  const result = await respond();
  assert.equal(result.status, 200);
  assert.equal(sent, 1);
  assert.equal(localDB.workspace_members.length, 1);
  assert.equal(localDB.workspace_members[0].verified_on_chain, true);
  assert.equal(localDB.workspace_members[0].wallet_address, actor);
  assert.equal(localDB.invitations[0].accepted, true);
});
test("concurrent acceptance is idempotent", async () => {
  const results = await Promise.all([respond(), respond()]);
  assert(results.every((result) => result.status === 200));
  assert.equal(sent, 1);
  assert.equal(localDB.workspace_members.length, 1);
});
test("revocation while wallet prompt is open does not grant local membership", async () => {
  revokeDuringSend = true;
  assert.equal((await respond()).status, 410);
  assert.equal(localDB.workspace_members.length, 0);
  assert.equal(localDB.invitations[0].accepted, false);
});
test("pending invitations do not grant workspace access", () =>
  assert.equal(getUserWorkspaces("recipient", invitation.email).length, 0));
test("reading workspace list cannot accept invitations", async () => {
  await handleRoute("get", "/api/users/me/workspaces/", {});
  assert.equal(localDB.invitations[0].accepted, false);
  assert.equal(localDB.workspace_members.length, 0);
});
test("non-admin cannot create invitations", async () => {
  role = 1;
  const result = await handleRoute("post", `/api/workspaces/${slug}/invitations/`, {
    emails: [{ email: "new@example.invalid", role: 20 }],
  });
  assert.equal(result.status, 403);
  assert.equal(sent, 0);
  assert.equal(mailed, 0);
});
test("publication failure sends no invitation email and no fake CID", async () => {
  role = 3;
  failPin = true;
  const result = await handleRoute("post", `/api/workspaces/${slug}/invitations/`, {
    emails: [{ email: "new@example.invalid", role: 15 }],
  });
  assert.equal(result.status, 503);
  assert.equal(mailed, 0);
  assert.equal(sent, 0);
  assert.equal(cid, initialCid);
});
test("mail is sent only after the invitation record is published", async () => {
  role = 3;
  const result = await handleRoute("post", `/api/workspaces/${slug}/invitations/`, {
    emails: [{ email: "new@example.invalid", role: 15 }],
  });
  assert.equal(result.status, 200);
  assert.equal(mailed, 1);
  assert.equal(sent, 1);
  assert.equal(
    snapshot.invitations.some((entry) => entry.email === "new@example.invalid"),
    true
  );
});
test("IPFS failure preserves the last remote pointer", async () => {
  failPin = true;
  localStorage.setItem("plane_dapp_ipfs_cid_local", initialCid);
  setDirtyState(true);
  assert.equal(await uploadToIPFS(true), null);
  assert.equal(localStorage.getItem("plane_dapp_ipfs_cid_local"), initialCid);
  assert.equal(getIsDirtyState(), true);
});
test("CID conflict does not overwrite another device", async () => {
  localStorage.setItem(`plane_dapp_onchain_cid_${slug}`, "older-base");
  assert.equal(await commitWorkspaceCID(slug, publishedCid), false);
  assert.equal(sent, 0);
  assert.equal(cid, initialCid);
});
test("already-applied CID is verified without sending again", async () => {
  assert.equal(await commitWorkspaceCID(slug, initialCid), true);
  assert.equal(sent, 0);
});

test("an unbound email invitation requires administrator wallet approval", async () => {
  delete snapshot.invitations[0].wallet_address;
  const result = await respond();
  assert.equal(result.status, 409);
  assert.equal(result.data.code, "WALLET_APPROVAL_REQUIRED");
  assert.equal(sent, 0);
});
test("unverified legacy auto-memberships do not grant workspace access", () => {
  localDB.workspace_members = [
    { workspace: slug, member: "recipient", email: invitation.email, role: 20, verified_on_chain: false },
  ];
  assert.equal(getUserWorkspaces("recipient", invitation.email).length, 0);
});
test("issuing a wallet-bound invitation does not add an active member", async () => {
  role = 3;
  const result = await handleRoute("post", `/api/workspaces/${slug}/invitations/`, {
    emails: [
      { email: "bound@example.invalid", role: 20, wallet_address: "0x4444444444444444444444444444444444444444" },
    ],
  });
  assert.equal(result.status, 200);
  assert.equal(pending.role, 2);
  assert.equal(sent, 2);
  assert.equal(mailed, 1);
  assert.equal(localDB.workspace_members.length, 0);
});
test("legacy registry cannot silently fall back to directly granting membership", async () => {
  role = 3;
  legacyRegistry = true;
  const result = await handleRoute("post", `/api/workspaces/${slug}/invitations/`, {
    emails: [
      { email: "bound@example.invalid", role: 20, wallet_address: "0x4444444444444444444444444444444444444444" },
    ],
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.chain_failures.length, 1);
  assert.equal(mailed, 0);
  assert.equal(pending.role, 0);
});
test("failed role change does not mutate the member", async () => {
  role = 3;
  failSend = true;
  localDB.workspace_members = [{ id: "member", workspace: slug, member: "recipient", wallet_address: actor, role: 15 }];
  const result = await handleRoute("patch", `/api/workspaces/${slug}/members/member/`, { role: 20 });
  assert.equal(result.status, 503);
  assert.equal(localDB.workspace_members[0].role, 15);
});
test("role update is scoped to its workspace", async () => {
  role = 3;
  localDB.workspace_members = [
    { id: "member", workspace: "another-workspace", member: "recipient", wallet_address: actor, role: 15 },
  ];
  const result = await handleRoute("patch", `/api/workspaces/${slug}/members/member/`, { role: 20 });
  assert.equal(result.status, 404);
  assert.equal(sent, 0);
  assert.equal(localDB.workspace_members[0].role, 15);
});
test("invitation update refuses arbitrary acceptance and identity fields", async () => {
  role = 3;
  const result = await handleRoute("patch", `/api/workspaces/${slug}/invitations/invite/`, {
    accepted: true,
    email: "attacker@example.invalid",
  });
  assert.equal(result.status, 400);
  assert.equal(localDB.invitations[0].accepted, false);
  assert.equal(sent, 0);
});
test("rejecting an invitation never creates a membership", async () => {
  const result = await respond({ accepted: false });
  assert.equal(result.status, 200);
  assert.equal(localDB.invitations[0].status, "rejected");
  assert.equal(localDB.workspace_members.length, 0);
  assert.equal(sent, 0);
});

test("reopening a confirmed link derives acceptance from contract without writing", async () => {
  role = 1;
  const result = await respondToWorkspaceInvitation("get", slug, "invite", {}, invitation.token);
  assert.equal(result.status, 200);
  assert.equal(result.data.accepted, true);
  assert.equal(sent, 0);
  assert.equal(localDB.invitations[0].accepted, false);
});
test("local rejection remains effective until a different token is issued", async () => {
  await respond({ accepted: false });
  const result = await respond();
  assert.equal(result.status, 410);
  assert.equal(sent, 0);
});
test("concurrent invitation creation serializes publication and token rotation", async () => {
  role = 3;
  const create = () =>
    handleRoute("post", `/api/workspaces/${slug}/invitations/`, {
      emails: [{ email: "new@example.invalid", role: 15 }],
    });
  const results = await Promise.all([create(), create()]);
  assert(results.every((result) => result.status === 200));
  assert.equal(localDB.invitations.filter((entry) => entry.email === "new@example.invalid").length, 1);
  assert.equal(mailed, 2);
});
test("reinviting a tombstoned record uses a new id and preserves the old revocation", async () => {
  role = 3;
  localDB._deleted_invitation_ids = ["invite"];
  localStorage.setItem("plane_dapp_deleted_invitations", JSON.stringify(["invite"]));
  const result = await handleRoute("post", `/api/workspaces/${slug}/invitations/`, {
    emails: [{ email: invitation.email, role: 15 }],
  });
  assert.equal(result.status, 200);
  assert.notEqual(result.data.invitations[0].id, "invite");
  assert(localDB._deleted_invitation_ids.includes("invite"));
});

const seedMemberForLeave = () => {
  role = 1;
  registryVersion = 3;
  localDB.workspace_members = [
    {
      id: "membership",
      member: "recipient",
      email: invitation.email,
      wallet_address: actor,
      workspace: `id-${slug}`,
      workspace_id: `id-${slug}`,
      role: 15,
      is_active: true,
    },
  ];
};

test("an ordinary member can leave through the actual UI route without admin permissions", async () => {
  seedMemberForLeave();
  const result = await handleRoute("post", `/api/workspaces/${slug}/members/leave/`, {});
  assert.equal(result.status, 200);
  assert.equal(result.data.chain_confirmed, true);
  assert.equal(role, 0);
  assert.equal(sent, 1);
  assert.equal(localDB.workspace_members.length, 0);
  assert.equal(mailed, 0);
});

test("the workspace-members leave alias uses the same confirmed self-leave path", async () => {
  seedMemberForLeave();
  const result = await handleRoute("post", `/api/workspaces/${slug}/workspace-members/leave/`, {});
  assert.equal(result.status, 200);
  assert.equal(role, 0);
  assert.equal(sent, 1);
});

test("a failed leave transaction preserves the membership and reports failure", async () => {
  seedMemberForLeave();
  failSend = true;
  const before = structuredClone(localDB.workspace_members);
  const result = await handleRoute("post", `/api/workspaces/${slug}/members/leave/`, {});
  assert.equal(result.status, 503);
  assert.equal(result.data.code, "LEAVE_UNCONFIRMED");
  assert.equal(role, 1);
  assert.deepEqual(localDB.workspace_members, before);
});

test("RPC failure during leave cannot erase local membership", async () => {
  seedMemberForLeave();
  failRpc = true;
  const before = structuredClone(localDB.workspace_members);
  const result = await handleRoute("post", `/api/workspaces/${slug}/workspace-members/leave/`, {});
  assert.equal(result.status, 503);
  assert.equal(sent, 0);
  assert.deepEqual(localDB.workspace_members, before);
});

test("legacy contracts cannot report self-leave success while the wallet still has rights", async () => {
  seedMemberForLeave();
  registryVersion = 2;
  const result = await handleRoute("post", `/api/workspaces/${slug}/members/leave/`, {});
  assert.equal(result.status, 409);
  assert.equal(result.data.code, "CONTRACT_UPGRADE_REQUIRED");
  assert.equal(sent, 0);
  assert.equal(localDB.workspace_members.length, 1);
});

test("the owner must transfer ownership before leaving", async () => {
  seedMemberForLeave();
  role = 3;
  const result = await handleRoute("post", `/api/workspaces/${slug}/members/leave/`, {});
  assert.equal(result.status, 403);
  assert.equal(result.data.code, "OWNER_CANNOT_LEAVE");
  assert.equal(sent, 0);
  assert.equal(localDB.workspace_members.length, 1);
});

test("leave recovery needs no second transaction once the chain already shows no role", async () => {
  seedMemberForLeave();
  role = 0;
  assert.equal(await leaveWorkspaceOnChain(slug, actor), true);
  const result = await handleRoute("post", `/api/workspaces/${slug}/members/leave/`, {});
  assert.equal(result.status, 200);
  assert.equal(sent, 0);
  assert.equal(localDB.workspace_members.length, 0);
});

test("self-leave does not hide another wallet that happens to share cached profile fields", async () => {
  seedMemberForLeave();
  localDB.workspace_members.push({ ...localDB.workspace_members[0], id: "different-wallet", wallet_address: owner });
  const result = await handleRoute("post", `/api/workspaces/${slug}/members/leave/`, {});
  assert.equal(result.status, 200);
  assert.deepEqual(
    localDB.workspace_members.map((member) => member.wallet_address),
    [owner]
  );
});

test("simultaneous self-leave requests share one transaction", async () => {
  seedMemberForLeave();
  const results = await Promise.all([
    handleRoute("post", `/api/workspaces/${slug}/members/leave/`, {}),
    handleRoute("post", `/api/workspaces/${slug}/workspace-members/leave/`, {}),
  ]);
  assert(results.every((result) => result.status === 200));
  assert.equal(sent, 1);
});

test("self-leave for a missing workspace cannot delete unscoped membership records", async () => {
  seedMemberForLeave();
  localDB.workspace_members.push({ id: "unscoped", member: "recipient", email: invitation.email });
  const before = structuredClone(localDB.workspace_members);
  const result = await handleRoute("post", "/api/workspaces/missing-workspace/members/leave/", {});
  assert.equal(result.status, 404);
  assert.equal(sent, 0);
  assert.deepEqual(localDB.workspace_members, before);
});

test("self-leave requires login even when the Vault contains a wallet", async () => {
  seedMemberForLeave();
  setLoggedInUser(null);
  const result = await handleRoute("post", `/api/workspaces/${slug}/members/leave/`, {});
  assert.equal(result.status, 401);
  assert.equal(sent, 0);
  assert.equal(localDB.workspace_members.length, 1);
});

test("role mapping accepts only exact Admin and Member roles", () => {
  assert.equal(mapPlaneRoleToContractRole(15), 1);
  assert.equal(mapPlaneRoleToContractRole("20"), 2);
  for (const value of [undefined, "", 0, 1, 5, 10, 16, 21, 30, -1, "owner", NaN])
    assert.throws(() => mapPlaneRoleToContractRole(value), /Admin.*Member/);
});

test("unsupported invitation roles cannot create local records or send mail", async () => {
  role = 3;
  for (const unsupported of [5, 10, 21]) {
    const before = structuredClone(localDB.invitations);
    const result = await handleRoute("post", `/api/workspaces/${slug}/invitations/`, {
      emails: [{ email: "guest@example.invalid", role: unsupported }],
    });
    assert.equal(result.status, 400);
    assert.deepEqual(localDB.invitations, before);
  }
  assert.equal(sent, 0);
  assert.equal(mailed, 0);
});

test("role updates reject unsupported target roles before changing a member", async () => {
  seedMemberForLeave();
  role = 3;
  const before = structuredClone(localDB.workspace_members);
  const result = await handleRoute("patch", `/api/workspaces/${slug}/members/membership/`, { role: 5 });
  assert.equal(result.status, 400);
  assert.equal(result.data.code, "UNSUPPORTED_ROLE");
  assert.deepEqual(localDB.workspace_members, before);
  assert.equal(sent, 0);
});

test("legacy Guest invitations can still be revoked without mapping Guest to Member", async () => {
  role = 3;
  pending = { role: 1, expiresAt: Math.floor(Date.now() / 1000) + 1000 };
  assert.equal(await writeWorkspaceWalletInvitation(slug, actor, 5, 1, actor, true), true);
  assert.equal(pending.role, 0);
  assert.equal(sent, 1);
});
