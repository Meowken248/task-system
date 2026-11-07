import { persistLocalSnapshot, retryLocalPersistence, getLocalPersistenceStatus } from "../../packages/services/src/dapp/local-persistence";
import { loadSnapshotFromIDB } from "../../packages/services/src/dapp/indexed-db";
import { initializeDeploymentStorage, getDeploymentId, deploymentDatabaseName } from "../../packages/services/src/dapp/deployment-storage";
import { runExclusiveChainTx } from "../../packages/services/src/dapp/tx-gateway";
import { saveFallbackDocument } from "../../apps/web/core/helpers/page-fallback";
import * as Y from "yjs";

const browser = window as any;
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
window.fetch = async () => { throw new Error("Unexpected network in runtime fixture"); };

if (new URL(location.href).searchParams.has("child")) {
  browser.txProbe = {
    run: (label: string) => runExclusiveChainTx(label, async () => {
      (parent as any).txEvents.push(`${label}:start`);
      if (label === "first") await new Promise<void>((resolve) => { browser.releaseTx = resolve; });
      (parent as any).txEvents.push(`${label}:end`);
    }),
  };
} else {
  browser.probe = { ready: false };
  const makeFrame = async () => {
    const frame = document.createElement("iframe");
    frame.src = "/?child=1";
    const loaded = new Promise<void>((resolve) => { frame.onload = () => resolve(); });
    document.body.append(frame);
    await loaded;
    check((frame.contentWindow as any).txProbe, "Independent iframe module ready");
    return frame;
  };
  async function run() {
    const checks: string[] = [];
    localStorage.setItem("plane_dapp_local_db", JSON.stringify({ _deployment_id: "old", projects: [{ id: "old" }] }));
    sessionStorage.setItem("plane_dapp_latest_db", "old-session");
    localStorage.setItem("plane_active_wallet_address", "selected-wallet");
    localStorage.setItem("sdk_setting", "preserve-sdk");
    localStorage.setItem("plane_dapp_deployment_id", "old");
    document.cookie = "plane_dapp_sync_cid=old-cid; path=/";
    initializeDeploymentStorage();
    check(!localStorage.getItem("plane_dapp_local_db") && !sessionStorage.getItem("plane_dapp_latest_db"), "Fresh deployment drops old Plane snapshots");
    check(!document.cookie.includes("old-cid"), "Old CID cookie cleared");
    check(localStorage.getItem("plane_active_wallet_address") === "selected-wallet" && localStorage.getItem("sdk_setting") === "preserve-sdk", "Wallet selector and SDK settings preserved");
    checks.push("Fresh deployment clears Plane caches/cookies and preserves wallet/SDK settings");
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "plane_dapp_local_db") throw new DOMException("Fixture quota", "QuotaExceededError");
      return originalSet.call(this, key, value);
    };
    try {
      const persisted = await persistLocalSnapshot({ _deployment_id: getDeploymentId(), fixture: "first", issues: [{ id: "a", name: "first" }] });
      check(persisted.durable && persisted.medium === "indexedDB", "Real IDB commit acknowledges when localStorage is full");
      checks.push("Real IndexedDB commit with localStorage quota");
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args: any[]) {
        if (this.name === deploymentDatabaseName("plane_dapp_storage_v1")) throw new DOMException("Fixture failure", "InvalidStateError");
        return (transaction as any).apply(this, args);
      } as any;
      try {
        const failure = await persistLocalSnapshot({ _deployment_id: getDeploymentId(), fixture: "recovered", issues: [{ id: "a", name: "recovered" }] });
        check(!failure.durable && getLocalPersistenceStatus().state === "failed", "No false save acknowledgement");
      } finally { IDBDatabase.prototype.transaction = transaction; }
      const recovered = await retryLocalPersistence();
      check(recovered.durable && recovered.medium === "indexedDB", "Retry persists the latest input");
      checks.push("Both stores failing is visible; IDB retry recovers latest snapshot");
    } finally { Storage.prototype.setItem = originalSet; }

    browser.txEvents = [];
    const first = await makeFrame(), second = await makeFrame();
    try {
      const pendingFirst = (first.contentWindow as any).txProbe.run("first");
      // query() observes the actual browser queue; callbacks are real independent modules.
      for (let i = 0; i < 100 && !browser.txEvents.length; i++) await new Promise((resolve) => setTimeout(resolve, 10));
      check(browser.txEvents[0] === "first:start", "First lock acquired");
      const pendingSecond = (second.contentWindow as any).txProbe.run("second");
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        if ((await navigator.locks.query()).pending?.some((lock) => lock.name === "plane-chain-transactions")) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      check(waiting && browser.txEvents.length === 1, "Second iframe waits for the native origin lock");
      (first.contentWindow as any).releaseTx();
      await Promise.all([pendingFirst, pendingSecond]);
      check(browser.txEvents.join() === "first:start,first:end,second:start,second:end", "No overlapping transaction callbacks");
      checks.push("Native Web Locks serialize independent iframe transaction gateways");
    } finally { first.remove(); second.remove(); }

    const doc = new Y.Doc();
    const remote = new Y.Doc(); remote.getText("body").insert(0, "stale remote");
    let revision = 0, release: (value: ArrayBuffer) => void, saved: any, applied = false;
    const fetched = new Promise<ArrayBuffer>((resolve) => { release = resolve; });
    const editor = {
      getDocument: () => ({ binary: Y.encodeStateAsUpdate(doc), html: doc.getText("body").toString() || "<p></p>", json: { type: "doc", content: [] } }),
      setProviderDocument: (bytes: Uint8Array) => { applied = true; Y.applyUpdate(doc, bytes); },
    } as any;
    const saving = saveFallbackDocument({ editor, knownHtml: "<p></p>", hydrate: true, revision: () => revision,
      isCurrent: () => true, fetchBinary: () => fetched, fromHtml: () => { throw new Error("No HTML fallback expected"); },
      encode: (bytes) => btoa(String.fromCharCode(...bytes)), save: async (payload) => { saved = payload; } });
    doc.getText("body").insert(0, "fresh typing"); revision++;
    release!(Y.encodeStateAsUpdate(remote).buffer as ArrayBuffer);
    await saving;
    check(!applied && saved.description_html === "fresh typing", "Slow fetch cannot overwrite real Yjs edits");
    const recoveredDoc = new Y.Doc();
    Y.applyUpdate(recoveredDoc, Uint8Array.from(atob(saved.description_binary), (char) => char.charCodeAt(0)));
    check(recoveredDoc.getText("body").toString() === "fresh typing", "Saved Yjs binary contains current typing");
    doc.destroy(); remote.destroy(); recoveredDoc.destroy();
    checks.push("Real Yjs typing survives delayed binary fetch and serializes correctly");
    sessionStorage.setItem("release_fixture_reload", "1");
    return checks;
  }
  try {
    if (sessionStorage.getItem("release_fixture_reload")) {
      initializeDeploymentStorage();
      const restored = await loadSnapshotFromIDB();
      check(restored.data?.fixture === "recovered" && restored.data?.issues?.[0]?.name === "recovered", "Latest durable snapshot survives F5");
      browser.probe = { ready: true, done: true, reloaded: true, checks: ["Real IndexedDB recovery after reload"] };
    } else {
      document.querySelector("#run")!.addEventListener("click", () => {
        void run().then((checks) => { browser.probe = { ready: true, done: true, checks }; })
          .catch((error) => { browser.probe = { done: true, error: error.message }; });
      });
      browser.probe.ready = true;
    }
  } catch (error: any) { browser.probe = { done: true, error: error.message }; }
}
