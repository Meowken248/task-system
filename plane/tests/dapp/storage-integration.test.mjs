import "./browser.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { localDB, defaultDB } from "../../packages/services/src/dapp/store.ts";
import {
  uploadToIPFS,
  setDirtyState,
  getIsDirtyState,
  syncDAppDBToChain,
  invalidateVaultWalletCache,
} from "../../packages/services/src/dapp/chain.ts";
const actor = "0x1111111111111111111111111111111111111111";
const cid = "Qm" + "b".repeat(44);
const previous = "Qm" + "a".repeat(44);
let sequence = 0,
  calls,
  sends;
const tick = () => new Promise((resolve) => setImmediate(resolve));
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "";
  calls = 0;
  sends = 0;
  Object.keys(localDB).forEach((key) => delete localDB[key]);
  Object.assign(localDB, structuredClone(defaultDB), {
    projects: [{ id: "project-" + ++sequence }],
    issues: [],
    users: [{ id: "actor", email: "actor@example.invalid", metanode_wallet_address: actor }],
  });
  sessionStorage.setItem("plane_dapp_auth_user", "actor");
  sessionStorage.setItem("plane_dapp_auth_email", "actor@example.invalid");
  sessionStorage.setItem("plane_active_wallet_address", actor);
  localStorage.setItem("last_workspace_slug", `storage-test-${sequence}`);
  Object.assign(process.env, {
    VITE_PINATA_PROXY_URL: "https://storage.test/",
    VITE_AUTO_COMMIT_ONCHAIN: "false",
    VITE_IPFS_UPLOAD_RETRY_DELAY_MS: "0",
  });
  invalidateVaultWalletCache();
  setDirtyState(true);
  window.fiaiSDK = {
    request: async (action) => {
      if (action === "getAllWallets") return [{ address: actor }];
      if (action === "getVaultStatus") return { isLocked: false, isInitialized: true };
      if (action.startsWith("getActiveWallet")) return { address: actor };
      sends++;
      throw Error("Unexpected signing call");
    },
  };
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ cid });
  };
});
test("identical simultaneous background and manual uploads share one request", async () => {
  let finish;
  globalThis.fetch = () => {
    calls++;
    return new Promise((resolve) => {
      finish = () => resolve(Response.json({ cid }));
    });
  };
  const first = uploadToIPFS();
  const second = uploadToIPFS(true);
  await tick();
  assert.equal(calls, 1);
  finish();
  assert.deepEqual(await Promise.all([first, second]), [cid, cid]);
  assert.equal(getIsDirtyState(), false);
});
test("storage failures keep the old pointer, dirty marker and a local checkpoint", async () => {
  localStorage.setItem("plane_dapp_ipfs_cid_local", previous);
  globalThis.fetch = async () => {
    calls++;
    return new Response("busy", { status: 503 });
  };
  assert.equal(await uploadToIPFS(true), null);
  assert.equal(calls, 2);
  assert.equal(localStorage.getItem("plane_dapp_ipfs_cid_local"), previous);
  assert.equal(localStorage.getItem("plane_dapp_dirty"), "true");
  assert.equal(JSON.parse(localStorage.getItem("plane_dapp_local_db")).projects.length, 1);
  assert.equal(sends, 0);
});
test("a failed shared upload does not poison the next attempt", async () => {
  globalThis.fetch = async () => new Response("busy", { status: 503 });
  assert.equal(await uploadToIPFS(true), null);
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ cid });
  };
  assert.equal(await uploadToIPFS(true), cid);
  assert.equal(calls, 1);
});

test("background failure has a cooldown while an explicit retry can recover immediately", async () => {
  globalThis.fetch = async () => new Response("busy", { status: 503 });
  assert.equal(await uploadToIPFS(true), null);
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ cid });
  };
  assert.equal(await uploadToIPFS(), null);
  assert.equal(calls, 0);
  assert.equal(await uploadToIPFS(true), cid);
  assert.equal(calls, 1);
});

test("queued background edits respect cooldown after an earlier upload fails", async () => {
  let finish;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? new Promise((resolve) => {
          finish = () => resolve(new Response("busy", { status: 503 }));
        })
      : new Response("busy", { status: 503 });
  };
  const first = uploadToIPFS();
  await tick();
  localDB.issues.push({ id: "queued-background-edit" });
  const queued = uploadToIPFS();
  finish();
  assert.deepEqual(await Promise.all([first, queued]), [null, null]);
  assert.equal(calls, 2);
});

test("manual retry upgrades an already queued background upload", async () => {
  let finish;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1)
      return new Promise((resolve) => {
        finish = () => resolve(new Response("busy", { status: 503 }));
      });
    return calls === 2 ? new Response("busy", { status: 503 }) : Response.json({ cid });
  };
  const first = uploadToIPFS();
  await tick();
  localDB.issues.push({ id: "manual-newer-edit" });
  const background = uploadToIPFS();
  const manual = uploadToIPFS(true);
  finish();
  assert.deepEqual(await Promise.all([first, background, manual]), [null, cid, cid]);
  assert.equal(calls, 3);
});

test("queued upload captures the latest edits instead of overwriting them with its older request", async () => {
  let finish;
  let secondBody;
  const olderCID = "Qm" + "c".repeat(44);
  globalThis.fetch = async (_url, options) => {
    calls++;
    if (calls === 1)
      return new Promise((resolve) => {
        finish = () => resolve(Response.json({ cid: olderCID }));
      });
    secondBody = JSON.parse(options.body);
    return Response.json({ cid });
  };
  const first = uploadToIPFS();
  await tick();
  localDB.issues.push({ id: "edit-before-queue" });
  const queued = uploadToIPFS();
  localDB.issues.push({ id: "edit-after-queue" });
  localStorage.setItem("plane_dapp_local_db", JSON.stringify(localDB));
  setDirtyState(true);
  finish();
  assert.deepEqual(await Promise.all([first, queued]), [olderCID, cid]);
  assert.equal(calls, 2);
  assert.deepEqual(
    secondBody.issues.map((issue) => issue.id),
    ["edit-before-queue", "edit-after-queue"]
  );
  assert.equal(JSON.parse(localStorage.getItem("plane_dapp_local_db")).issues.length, 2);
  assert.equal(getIsDirtyState(), false);
});

test("reusing a verified identical snapshot clears a redundant dirty marker without another POST", async () => {
  assert.equal(await uploadToIPFS(true), cid);
  setDirtyState(true);
  assert.equal(await uploadToIPFS(true), cid);
  assert.equal(calls, 1);
  assert.equal(getIsDirtyState(), false);
});
test("edits made during upload remain dirty and are not overwritten in local storage", async () => {
  let finish;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      finish = () => resolve(Response.json({ cid }));
    });
  const task = uploadToIPFS(true);
  await tick();
  localDB.issues.push({ id: "newer-edit" });
  localStorage.setItem("plane_dapp_local_db", JSON.stringify(localDB));
  setDirtyState(true);
  finish();
  assert.equal(await task, cid);
  assert.equal(getIsDirtyState(), true);
  assert.equal(JSON.parse(localStorage.getItem("plane_dapp_local_db")).issues[0].id, "newer-edit");
});
test("changing wallet while upload is pending does not update its CID pointer", async () => {
  let finish;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      finish = () => resolve(Response.json({ cid }));
    });
  localStorage.setItem("plane_dapp_ipfs_cid_local", previous);
  const task = uploadToIPFS(true);
  await tick();
  sessionStorage.setItem("plane_active_wallet_address", "0x2222222222222222222222222222222222222222");
  finish();
  assert.equal(await task, null);
  assert.equal(localStorage.getItem("plane_dapp_ipfs_cid_local"), previous);
  assert.equal(getIsDirtyState(), true);
});
test("no upload starts if both durable browser stores are unavailable", async () => {
  const set = localStorage.setItem;
  localStorage.setItem = () => {
    throw Error("quota");
  };
  try {
    assert.equal(await uploadToIPFS(true), null);
    assert.equal(calls, 0);
  } finally {
    localStorage.setItem = set;
  }
});
test("manual Sync preserves structured storage errors and sends no transaction", async () => {
  globalThis.fetch = async () => {
    calls++;
    return new Response("forbidden", { status: 403 });
  };
  await assert.rejects(syncDAppDBToChain(actor), { code: "CONFIGURATION" });
  assert.equal(calls, 1);
  assert.equal(sends, 0);
});
test("duplicate manual Sync calls share a failure and release their lock afterwards", async () => {
  localDB.projects = [];
  const one = syncDAppDBToChain(actor);
  const two = syncDAppDBToChain(actor);
  assert.equal(one, two);
  const result = await Promise.allSettled([one, two]);
  assert(result.every((entry) => entry.status === "rejected"));
  const three = syncDAppDBToChain(actor);
  assert.notEqual(three, one);
  await assert.rejects(three);
  assert.equal(sends, 0);
});

test("a blocked IndexedDB open does not stall upload when the localStorage checkpoint succeeded", async () => {
  const factory = { open: () => new EventTarget() };
  window.indexedDB = factory;
  globalThis.indexedDB = factory;
  try {
    assert.equal(await uploadToIPFS(true), cid);
    assert.equal(calls, 1);
  } finally {
    delete window.indexedDB;
    delete globalThis.indexedDB;
  }
});
