// oxlint-disable-next-line import/no-unassigned-import -- Install isolated storage before importing DApp sources.
import "./browser.mjs";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { AbiCoder } from "ethers";
import { defaultDB, localDB, setLoggedInUser, getLoggedInUserId } from "../../packages/services/src/dapp/store.ts";
import { handleRoute } from "../../packages/services/src/dapp/routes.ts";

const walletA = "0x1111111111111111111111111111111111111111";
const walletB = "0x2222222222222222222222222222222222222222";
const root = "/api/workspaces/team/projects/p1";
const abi = AbiCoder.defaultAbiCoder();
const call = (method, suffix, body = {}) => handleRoute(method, root + suffix, body);

function reset(user = "owner") {
  localStorage.clear(); sessionStorage.clear(); document.cookie = "";
  Object.assign(process.env, { VITE_WORKSPACE_REGISTRY_ADDRESS: "", VITE_AUTO_COMMIT_ONCHAIN: "false", VITE_RPC_URL: "https://boundary.fixture" });
  globalThis.fetch = async () => { throw Error("Unexpected network in boundary regression"); };
  Object.keys(localDB).forEach((key) => delete localDB[key]);
  Object.assign(localDB, structuredClone(defaultDB), {
    users: [{ id: "owner", email: "owner@example.invalid", metanode_wallet_address: walletA }, { id: "member", email: "member@example.invalid", metanode_wallet_address: walletB }],
    workspaces: [{ id: "ws", slug: "team", created_by: "owner" }, { id: "ws-b", slug: "other", created_by: "elsewhere" }],
    workspace_members: [{ id: "wm-owner", workspace: "ws", member: "owner", role: 20 }, { id: "wm-member", workspace: "ws", member: "member", role: 15 }],
    projects: [{ id: "p1", identifier: "AA", workspace: "ws", network: 2, created_by: "owner" }, { id: "p2", identifier: "BB", workspace: "ws", network: 0, created_by: "owner" }, { id: "p-b", identifier: "AA", workspace: "ws-b", network: 2 }],
    project_members: [{ id: "pm-owner", project: "p1", member: "owner", role: 20 }, { id: "pm-member", project: "p1", member: "member", role: 15 }],
    pages: [{ id: "page", name: "Private page", workspace: "ws", project: "p1", project_id: "p1", project_ids: ["p1"], owned_by: "owner", created_by: "owner", access: 1, is_locked: false, archived_at: null, description_html: "private fixture" }],
    issues: [], cycles: [], modules: [], views: [], favorites: [],
  });
  setLoggedInUser(user);
}
beforeEach(() => reset());

function installRpc(roleForRead, switchDelay) {
  let reads = 0;
  process.env.VITE_WORKSPACE_REGISTRY_ADDRESS = "0x3333333333333333333333333333333333333333";
  sessionStorage.setItem("plane_active_wallet_address", getLoggedInUserId() === "owner" ? walletA : walletB);
  const switchActor = (remaining) => {
    if (remaining > 0) return queueMicrotask(() => switchActor(remaining - 1));
    setLoggedInUser("member"); sessionStorage.setItem("plane_active_wallet_address", walletB);
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://boundary.fixture");
    const rpc = JSON.parse(options.body);
    assert.equal(rpc.method, "eth_call", "Boundary tests must never send transactions");
    const read = ++reads;
    const role = roleForRead ? roleForRead(read) : rpc.params[0].data.toLowerCase().endsWith(walletA.slice(2)) ? 3 : 1;
    return { json: async () => {
      if (read === 1 && switchDelay !== undefined) queueMicrotask(() => switchActor(switchDelay));
      return { result: abi.encode(["uint8"], [role]) };
    } };
  };
}
const drainMicrotasks = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

for (const method of ["patch", "put"]) {
  test(`${method}: changing identity at any RPC boundary cannot mutate another owner's private page`, async () => {
    for (let delay = 0; delay <= 24; delay++) {
      reset(); installRpc(undefined, delay);
      let mutationActor = null;
      localDB.pages = new Proxy(localDB.pages, { set(target, key, value) {
        if (key === "0" && value?.description_html === "changed") mutationActor = getLoggedInUserId();
        return Reflect.set(target, key, value);
      } });
      const result = await call(method, "/pages/page/", { description_html: "changed" });
      await drainMicrotasks();
      assert.notEqual(mutationActor, "member", `Unauthorized mutation at microtask offset ${delay}`);
      if (result.status >= 400) assert.equal(localDB.pages[0].description_html, "private fixture");
      else { assert.equal(result.status, 200); assert.equal(mutationActor, "owner"); }
    }
  });
}

test("create cannot apply a prior actor's private project approval to a new actor", async () => {
  for (let delay = 0; delay <= 24; delay++) {
    reset(); installRpc(undefined, delay);
    let mutationActor = null;
    localDB.pages = new Proxy(localDB.pages, { set(target, key, value) {
      if (value?.id === "new-page") mutationActor = getLoggedInUserId();
      return Reflect.set(target, key, value);
    } });
    const result = await call("post", "/pages/", { id: "new-page", name: "New private page", access: 1, project_ids: ["p2"] });
    await drainMicrotasks();
    assert.notEqual(mutationActor, "member", `Approvals mixed between actors at microtask offset ${delay}`);
    if (result.status >= 400) assert.equal(localDB.pages.some((page) => page.id === "new-page"), false);
    else { assert.equal(result.status, 201); assert.equal(result.data.owned_by, "owner"); }
  }
});

test("stable owner can create linked pages and update content, and failed requests release the ID", async () => {
  installRpc(() => 3);
  assert.equal((await call("post", "/pages/", { id: "retry-page", project_ids: ["missing"] })).status, 400);
  const created = await call("post", "/pages/", { id: "retry-page", access: 1, project_ids: ["p2"] });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.project_ids, ["p1", "p2"]);
  assert.equal((await call("patch", "/pages/page/", { description_html: "owner edit" })).status, 200);
  assert.equal(localDB.pages[0].description_html, "owner edit");
});

test("Page Favorites also keep one identity across permission awaits", async () => {
  for (let delay = 0; delay <= 24; delay++) {
    reset(); installRpc(undefined, delay);
    let mutationActor = null;
    localDB.favorites = new Proxy(localDB.favorites, { set(target, key, value) {
      if (value?.entity_identifier === "page") mutationActor = getLoggedInUserId();
      return Reflect.set(target, key, value);
    } });
    const result = await call("post", "/favorite-pages/page/");
    await drainMicrotasks();
    assert.notEqual(mutationActor, "member", `Favorite created for the prior actor at offset ${delay}`);
    if (result.status < 400) assert.equal(result.status, 200);
  }
});

test("a reordered snapshot cannot redirect an authorized update to another private Page", async () => {
  installRpc(() => 3);
  localDB.pages.push({ ...structuredClone(localDB.pages[0]), id: "other-page", owned_by: "member", created_by: "member", description_html: "other private content" });
  const readRpc = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async (...args) => {
    const response = await readRpc(...args);
    if (++reads === 2) localDB.pages.reverse();
    return response;
  };
  const result = await call("patch", "/pages/page/", { description_html: "correct target" });
  assert.equal(result.status, 200);
  assert.equal(localDB.pages.find((p) => p.id === "page").description_html, "correct target");
  assert.equal(localDB.pages.find((p) => p.id === "other-page").description_html, "other private content");
});

test("move re-evaluates source management after the destination observes a workspace downgrade", async () => {
  reset("member"); localDB.projects.find((p) => p.id === "p2").network = 2;
  installRpc((read) => read < 3 ? 3 : 1);
  const before = JSON.stringify(localDB.pages);
  const result = await call("post", "/pages/page/move/", { new_project_id: "p2" });
  assert.equal(result.status, 403);
  assert.equal(JSON.stringify(localDB.pages), before);
});

test("create rechecks all linked projects against the latest workspace role", async () => {
  reset("member");
  localDB.projects.find((p) => p.id === "p1").network = 0;
  localDB.projects.find((p) => p.id === "p2").network = 2;
  localDB.project_members = [];
  installRpc((read) => read === 1 ? 3 : 1);
  const result = await call("post", "/pages/", { id: "revoked-source", project_ids: ["p2"] });
  assert.equal(result.status, 403);
  assert.equal(localDB.pages.some((p) => p.id === "revoked-source"), false);
});

test("stable Admin and a legitimate project Admin can move without private content leaking", async () => {
  for (const workspaceRole of [3, 1]) {
    reset("member");
    localDB.projects.find((p) => p.id === "p2").network = 2;
    if (workspaceRole === 1) localDB.project_members.find((m) => m.member === "member").role = 20;
    installRpc(() => workspaceRole);
    const result = await call("post", "/pages/page/move/", { new_project_id: "p2" });
    assert.equal(result.status, 200);
    assert.equal(localDB.pages[0].project, "p2");
    assert.equal(result.data.description_html, undefined);
  }
});

test("Search rejects every conflicting workspace field while preserving canonical and legacy matches", async () => {
  reset("member");
  localDB.projects.reverse(); // Foreign colliding identifier must not affect resolution.
  const scopes = [
    { workspace_id: "ws", workspace: "ws-b" },
    { workspace_id: "ws-b", workspace: "team" },
    { workspace_id: "ws", workspace_slug: "other" },
    { workspace: "team", workspace_slug: "other" },
  ];
  localDB.issues = scopes.map((scope, index) => ({ id: `bad-${index}`, name: "Needle bad", project: "AA", sequence_id: index + 1, ...scope }));
  localDB.issues.push({ id: "canonical", name: "Needle valid", project: "p1", workspace: "team", workspace_id: "ws", workspace_slug: "team", sequence_id: 10 });
  localDB.issues.push({ id: "legacy", name: "Needle legacy", project: "AA", workspace: "ws", sequence_id: 11 });
  for (const path of ["/api/workspaces/team/search/?search=Needle&workspace_search=true", "/api/workspaces/team/entity-search/?query_type=issue&query=Needle&count=50", root + "/search-issues/?search=Needle&workspace_search=true"]) {
    const result = await handleRoute("get", path, {});
    assert.equal(result.status, 200);
    const items = result.data.results?.issue || result.data.issue || result.data;
    assert.deepEqual(items.map((item) => item.id).sort(), ["canonical", "legacy"]);
    assert(items.every((item) => item.project_id === "p1"));
  }
});

test("global Search also excludes contradictory Cycle, Module, View and Page scopes", async () => {
  reset("member");
  for (const collection of ["cycles", "modules", "views", "pages"]) {
    localDB[collection] = [{ id: collection + "-bad", name: "Needle invalid", project: "p1", project_ids: ["p1"], workspace_id: "ws", workspace: "ws-b", access: collection === "views" ? 1 : 0 }];
  }
  const result = await handleRoute("get", "/api/workspaces/team/search/?search=Needle&workspace_search=true", {});
  assert.equal(result.status, 200);
  for (const key of ["cycle", "module", "issue_view", "page"]) assert.deepEqual(result.data.results[key], []);
});
