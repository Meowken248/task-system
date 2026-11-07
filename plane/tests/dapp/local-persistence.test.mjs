import "./browser.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultDB, localDB, setLoggedInUser, saveDB } from "../../packages/services/src/dapp/store.ts";
import { handleRoute } from "../../packages/services/src/dapp/routes.ts";
import { flushLocalPersistence, getLocalPersistenceStatus, retryLocalPersistence } from "../../packages/services/src/dapp/local-persistence.ts";

test("a successful API mutation requires a full durable snapshot, not RAM/session-only fallback", async () => {
  Object.keys(localDB).forEach((key) => delete localDB[key]);
  Object.assign(localDB, structuredClone(defaultDB), {
    users: [{ id: "owner", email: "owner@example.invalid" }],
    workspaces: [{ id: "ws", slug: "team", created_by: "owner" }],
    workspace_members: [{ id: "wm", workspace: "ws", member: "owner", role: 20 }],
    projects: [{ id: "p1", identifier: "AA", workspace: "ws", network: 2, created_by: "owner" }],
    pages: [],
  });
  process.env.VITE_WORKSPACE_REGISTRY_ADDRESS = "";
  process.env.VITE_AUTO_COMMIT_ONCHAIN = "false";
  setLoggedInUser("owner");
  const write = localStorage.setItem;
  localStorage.setItem = () => { throw new DOMException("Quota", "QuotaExceededError"); };
  try {
    const response = await handleRoute("post", "/api/workspaces/team/projects/p1/pages/", { name: "Unsaved draft" });
    assert.equal(response.status, 503);
    assert.equal(response.data.code, "LOCAL_PERSISTENCE_FAILED");
    assert.equal(localDB.pages.length, 1, "Do not erase the user's unsaved work");
    assert.equal(getLocalPersistenceStatus().state, "failed");
    assert.equal((await flushLocalPersistence()).durable, false);
  } finally { localStorage.setItem = write; }
  const retried = await retryLocalPersistence();
  assert.equal(retried.durable, true);
  assert.equal(getLocalPersistenceStatus().state, "saved");
  assert.equal(JSON.parse(localStorage.getItem("plane_dapp_local_db")).pages[0].name, "Unsaved draft");
});

test("full localStorage snapshots acknowledge success even without IndexedDB", async () => {
  localDB.pages = [{ id: "durable-page", name: "Saved" }];
  const result = await saveDB({ localOnly: true });
  assert.equal(result.durable, true);
  assert.equal(JSON.parse(localStorage.getItem("plane_dapp_local_db")).pages[0].name, "Saved");
});
