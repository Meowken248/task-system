import "./browser.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getDeploymentId, initializeDeploymentStorage, belongsToDeployment, deploymentDatabaseName } from "../../packages/services/src/dapp/deployment-storage.ts";
import { sanitizeSharedSnapshot } from "../../packages/services/src/dapp/shared-snapshot.ts";
import { readIPFSSnapshot } from "../../packages/services/src/dapp/ipfs-snapshot.ts";

function storage() {
  const data = new Map();
  return { get length() { return data.size; }, key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}
test("fresh deployment resets Plane caches and cookies without clearing SDK settings or wallet selection", () => {
  process.env.VITE_DAPP_DEPLOYMENT_ID = "fresh-fixture";
  globalThis.localStorage = storage(); globalThis.sessionStorage = storage();
  for (const target of [localStorage, sessionStorage]) {
    target.setItem("plane_dapp_local_db", '{"projects":[{"id":"old"}]}');
    target.setItem("plane_dapp_credentials", "old credentials");
    target.setItem("ipfs_old-cid", "old snapshot");
    target.setItem("last_workspace_slug", "old-team");
    target.setItem("plane_active_wallet_address", "selected-wallet");
    target.setItem("sdk_setting", "keep");
  }
  initializeDeploymentStorage();
  for (const target of [localStorage, sessionStorage]) {
    assert.equal(target.getItem("plane_dapp_local_db"), null);
    assert.equal(target.getItem("plane_dapp_credentials"), null);
    assert.equal(target.getItem("ipfs_old-cid"), null);
    assert.equal(target.getItem("plane_active_wallet_address"), "selected-wallet");
    assert.equal(target.getItem("sdk_setting"), "keep");
    assert.equal(target.getItem("plane_dapp_deployment_id"), "fresh-fixture");
  }
  localStorage.setItem("plane_dapp_local_db", "new snapshot");
  initializeDeploymentStorage();
  assert.equal(localStorage.getItem("plane_dapp_local_db"), "new snapshot", "F5 is idempotent for this deployment");
  assert.equal(deploymentDatabaseName("plane_dapp_storage_v1"), "plane_dapp_storage_v1_fresh-fixture");
  delete process.env.VITE_DAPP_DEPLOYMENT_ID;
});
test("a stale tab cannot restore an unmarked or different-deployment snapshot", async () => {
  process.env.VITE_DAPP_DEPLOYMENT_ID = "fresh-fixture";
  process.env.VITE_AUTO_COMMIT_ONCHAIN = "false";
  process.env.VITE_WORKSPACE_REGISTRY_ADDRESS = "";
  localStorage.setItem("plane_dapp_local_db", JSON.stringify({ projects: [{ id: "old" }], _deployment_id: "previous" }));
  const { localDB, loadInitialDB } = await import("../../packages/services/src/dapp/store.ts");
  assert.equal(loadInitialDB().projects.length, 0);
  assert.equal(localDB._deployment_id, "fresh-fixture");
  const { applyOffchainDB } = await import("../../packages/services/src/dapp/chain.ts");
  applyOffchainDB({ projects: [{ id: "old" }], workspaces: [] });
  assert(!localDB.projects.some((p) => p.id === "old"));
  const snapshot = sanitizeSharedSnapshot({ _deployment_id: "fresh-fixture", projects: [] });
  assert(belongsToDeployment(snapshot));
  assert(!belongsToDeployment({ _deployment_id: "previous" }));
  assert(!belongsToDeployment({ projects: [] }));
  globalThis.fetch = async (url) => Response.json(url.endsWith("/fresh") ? snapshot : { projects: [{ id: "old" }] });
  const result = await readIPFSSnapshot(["https://fixture/old", "https://fixture/fresh"]);
  assert.equal(result.data._deployment_id, "fresh-fixture");
  assert.equal(await readIPFSSnapshot(["https://fixture/old"]), null);
  delete process.env.VITE_DAPP_DEPLOYMENT_ID;
});
test("legacy configuration remains compatible and malformed deployment IDs fail before clearing", () => {
  assert.equal(getDeploymentId(), "");
  assert(belongsToDeployment({ projects: [] }));
  assert.equal(deploymentDatabaseName("plane_dapp_storage_v1"), "plane_dapp_storage_v1");
  localStorage.setItem("plane_dapp_local_db", "preserve");
  initializeDeploymentStorage();
  assert.equal(localStorage.getItem("plane_dapp_local_db"), "preserve");
  process.env.VITE_DAPP_DEPLOYMENT_ID = "../bad-id";
  assert.throws(initializeDeploymentStorage, /không hợp lệ/);
  assert.equal(localStorage.getItem("plane_dapp_local_db"), "preserve");
  delete process.env.VITE_DAPP_DEPLOYMENT_ID;
});
