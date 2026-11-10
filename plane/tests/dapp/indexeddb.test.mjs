import { test } from "node:test";
import assert from "node:assert/strict";

let sequence = 0;
class Database extends EventTarget {
  stores = new Map();
  closed = false;
  abortWrites = false;
  objectStoreNames = { contains: (name) => this.stores.has(name) };
  createObjectStore(name) {
    this.stores.set(name, new Map());
  }
  close() {
    this.closed = true;
  }
  transaction(_names, mode) {
    if (this.closed) throw new Error("Database is closed");
    const transaction = new EventTarget();
    transaction.objectStore = (name) => ({
      put: (value) => this.stores.get(name).set(value.key, structuredClone(value)),
      get: (key) => {
        const request = new EventTarget();
        request.result = this.stores.get(name).get(key);
        queueMicrotask(() => request.dispatchEvent(new Event("success")));
        return request;
      },
    });
    queueMicrotask(() =>
      queueMicrotask(() =>
        transaction.dispatchEvent(new Event(mode === "readwrite" && this.abortWrites ? "abort" : "complete"))
      )
    );
    return transaction;
  }
}

async function fixture() {
  const factory = {
    calls: 0,
    fail: false,
    open() {
      this.calls++;
      const request = new EventTarget();
      request.result = new Database();
      queueMicrotask(() => {
        if (factory.fail) request.dispatchEvent(new Event("error"));
        else {
          request.dispatchEvent(new Event("upgradeneeded"));
          request.dispatchEvent(new Event("success"));
        }
      });
      return request;
    },
  };
  globalThis.window = { indexedDB: factory };
  globalThis.indexedDB = factory;
  return { factory, module: await import(`../../packages/services/src/dapp/indexed-db.ts?test=${++sequence}`) };
}

test("concurrent IndexedDB opens share one request", async () => {
  const { factory, module } = await fixture();
  const databases = await Promise.all([module.openDAppIDB(), module.openDAppIDB()]);
  assert.equal(factory.calls, 1);
  assert.equal(databases[0], databases[1]);
  assert(databases[0].objectStoreNames.contains("snapshots"));
});
test("a failed IndexedDB open can be retried", async () => {
  const { factory, module } = await fixture();
  factory.fail = true;
  assert.equal(await module.openDAppIDB(), null);
  factory.fail = false;
  assert(await module.openDAppIDB());
  assert.equal(factory.calls, 2);
});
test("version change closes the old connection and allows reopening", async () => {
  const { factory, module } = await fixture();
  const old = await module.openDAppIDB();
  old.dispatchEvent(new Event("versionchange"));
  const reopened = await module.openDAppIDB();
  assert(old.closed);
  assert.notEqual(reopened, old);
  assert.equal(factory.calls, 2);
});
test("snapshot save and load wait for completed transactions", async () => {
  const { module } = await fixture();
  const data = { issues: [{ id: "fixture-issue" }] };
  assert.equal(await module.saveSnapshotToIDB(data, "fixture-cid"), true);
  assert.deepEqual(await module.loadSnapshotFromIDB(), { data, cid: "fixture-cid" });
});
test("an aborted snapshot transaction is not reported as saved", async () => {
  const { module } = await fixture();
  const db = await module.openDAppIDB();
  db.abortWrites = true;
  assert.equal(await module.saveSnapshotToIDB({ issues: [] }, "fixture-cid"), false);
});

test("a newer CID pointer cannot relabel an older mutable local checkpoint", async () => {
  const { module } = await fixture();
  const data = { invitations: [] };
  await module.saveSnapshotToIDB(data, "old-checkpoint-cid");
  await module.saveCidToIDB("new-published-cid");
  assert.deepEqual(await module.loadSnapshotFromIDB(), { data, cid: "old-checkpoint-cid" });
  assert.equal(await module.getCidFromIDB(), "new-published-cid");
});
