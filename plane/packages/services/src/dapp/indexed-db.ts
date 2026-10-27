/**
 * DApp IndexedDB Resilience Storage Layer
 * Provides persistent offline snapshot storage that survives localStorage eviction/clearing
 * and bypasses the 5MB localStorage limit.
 */

const IDB_NAME = "plane_dapp_storage_v1";
const IDB_VERSION = 1;
const SNAPSHOT_STORE = "snapshots";
const METADATA_STORE = "metadata";

let dbInstance: IDBDatabase | null = null;
let dbOpenPromise: Promise<IDBDatabase | null> | null = null;

function isIndexedDBAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

export async function openDAppIDB(): Promise<IDBDatabase | null> {
  if (!isIndexedDBAvailable()) return null;
  if (dbInstance) return dbInstance;
  if (dbOpenPromise) return dbOpenPromise;

  const opening = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(IDB_NAME, IDB_VERSION);

      request.addEventListener("upgradeneeded", (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
          db.createObjectStore(SNAPSHOT_STORE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          db.createObjectStore(METADATA_STORE, { keyPath: "key" });
        }
      });

      request.addEventListener("success", () => {
        const openedDB = request.result;
        dbInstance = openedDB;
        openedDB.addEventListener("versionchange", () => {
          openedDB.close();
          if (dbInstance === openedDB) dbInstance = null;
        });
        openedDB.addEventListener("close", () => {
          if (dbInstance === openedDB) dbInstance = null;
        });
        resolve(openedDB);
      });

      request.addEventListener("error", (err) => {
        console.warn("[DApp IDB] Không thể mở IndexedDB:", err);
        resolve(null);
      });
    } catch (err) {
      console.warn("[DApp IDB] Lỗi khởi tạo IndexedDB:", err);
      resolve(null);
    }
  });
  dbOpenPromise = opening;
  void opening.finally(() => {
    if (dbOpenPromise === opening) dbOpenPromise = null;
  });
  return opening;
}

export async function saveSnapshotToIDB(data: Record<string, any>, cid?: string): Promise<boolean> {
  if (!isIndexedDBAvailable()) return false;
  try {
    const db = await openDAppIDB();
    if (!db) return false;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([SNAPSHOT_STORE, METADATA_STORE], "readwrite");
        const snapStore = tx.objectStore(SNAPSHOT_STORE);
        const metaStore = tx.objectStore(METADATA_STORE);

        // Save latest snapshot
        snapStore.put({
          key: "latest",
          data,
          updatedAt: Date.now(),
          cid: cid || null,
        });

        // Also save metadata
        if (cid && !cid.startsWith("bafkrei")) {
          metaStore.put({
            key: "last_valid_cid",
            value: cid,
            updatedAt: Date.now(),
          });
        }
        metaStore.put({
          key: "last_saved_at",
          value: Date.now(),
        });

        tx.addEventListener("complete", () => resolve(true));
        tx.addEventListener("error", () => resolve(false));
        tx.addEventListener("abort", () => resolve(false));
      } catch {
        resolve(false);
      }
    });
  } catch {
    return false;
  }
}

export async function loadSnapshotFromIDB(): Promise<{ data: Record<string, any> | null; cid: string | null }> {
  if (!isIndexedDBAvailable()) return { data: null, cid: null };
  try {
    const db = await openDAppIDB();
    if (!db) return { data: null, cid: null };

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([SNAPSHOT_STORE, METADATA_STORE], "readonly");
        const snapStore = tx.objectStore(SNAPSHOT_STORE);
        const metaStore = tx.objectStore(METADATA_STORE);

        let snapshotData: Record<string, any> | null = null;
        let snapshotCid: string | null = null;
        let metaCid: string | null = null;

        const snapReq = snapStore.get("latest");
        snapReq.addEventListener("success", () => {
          if (snapReq.result?.data) {
            snapshotData = snapReq.result.data;
            snapshotCid = snapReq.result.cid || null;
          }
        });

        const metaReq = metaStore.get("last_valid_cid");
        metaReq.addEventListener("success", () => {
          if (metaReq.result?.value) {
            metaCid = metaReq.result.value;
          }
        });

        tx.addEventListener("complete", () => {
          resolve({
            data: snapshotData,
            cid: metaCid || snapshotCid,
          });
        });
        tx.addEventListener("error", () => resolve({ data: null, cid: null }));
        tx.addEventListener("abort", () => resolve({ data: null, cid: null }));
      } catch {
        resolve({ data: null, cid: null });
      }
    });
  } catch {
    return { data: null, cid: null };
  }
}

export async function saveCidToIDB(cid: string): Promise<boolean> {
  if (!isIndexedDBAvailable() || !cid || cid.startsWith("bafkrei")) return false;
  try {
    const db = await openDAppIDB();
    if (!db) return false;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(METADATA_STORE, "readwrite");
        const metaStore = tx.objectStore(METADATA_STORE);
        metaStore.put({
          key: "last_valid_cid",
          value: cid,
          updatedAt: Date.now(),
        });
        tx.addEventListener("complete", () => resolve(true));
        tx.addEventListener("error", () => resolve(false));
      } catch {
        resolve(false);
      }
    });
  } catch {
    return false;
  }
}

export async function getCidFromIDB(): Promise<string | null> {
  if (!isIndexedDBAvailable()) return null;
  try {
    const db = await openDAppIDB();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(METADATA_STORE, "readonly");
        const metaStore = tx.objectStore(METADATA_STORE);
        const req = metaStore.get("last_valid_cid");
        req.addEventListener("success", () => {
          resolve(req.result?.value || null);
        });
        req.addEventListener("error", () => resolve(null));
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}
