/**
 * Persistent IndexedDB storage for DApp file attachments and assets.
 * Operates on database "plane_attachment_storage", store "files".
 * Compatible with @plane/utils saveAttachmentToStorage/getAttachmentFromStorage.
 */

const DB_NAME = "plane_attachment_storage";
const STORE_NAME = "files";
const DB_VERSION = 1;

export interface StoredAttachment {
  key: string;
  name: string;
  base64: string;
  type?: string;
  size?: number;
  savedAt?: number;
}

function isIndexedDBAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      return reject(new Error("IndexedDB not available"));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves a file attachment to IndexedDB with sessionStorage fallback.
 */
export async function saveAttachment(
  key: string,
  data: { name: string; base64: string; type?: string; size?: number }
): Promise<void> {
  if (!key || !data?.base64) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put({ key, ...data, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try {
      if (typeof window !== "undefined" && window.sessionStorage && data.base64.length < 2_000_000) {
        sessionStorage.setItem(`plane_att_${key}`, JSON.stringify(data));
      }
    } catch {
      // Ignore quota errors
    }
  }
}

/**
 * Retrieves a file attachment from IndexedDB with sessionStorage fallback.
 */
export async function getAttachment(
  key: string
): Promise<StoredAttachment | null> {
  if (!key) return null;
  try {
    const db = await openDB();
    const result = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (result && result.base64) return result;
  } catch {
    // fallback
  }

  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const item = sessionStorage.getItem(`plane_att_${key}`);
      return item ? JSON.parse(item) : null;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Deletes a file attachment from IndexedDB and sessionStorage.
 */
export async function deleteAttachment(key: string): Promise<void> {
  if (!key) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // fallback
  }

  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      sessionStorage.removeItem(`plane_att_${key}`);
    }
  } catch {
    // ignore
  }
}

