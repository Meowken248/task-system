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
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    const failed = (error: unknown) => {
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(
      () => failed(new Error("Không mở được kho tệp trên thiết bị. Hãy đóng tab Plane cũ rồi thử lại.")),
      8000
    );
    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    });
    request.addEventListener("success", () => {
      if (settled) {
        request.result.close?.();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(request.result);
    });
    request.addEventListener("error", () => failed(request.error));
    request.addEventListener("blocked", () =>
      failed(new Error("Kho tệp đang bị một tab khác khóa. Hãy đóng tab cũ rồi thử lại."))
    );
  });
}

/**
 * A successful upload requires a durable IndexedDB transaction. Session storage
 * is read only for legacy recovery; it cannot establish a successful new save.
 */
export async function saveAttachment(
  key: string,
  data: { name: string; base64: string; type?: string; size?: number }
): Promise<void> {
  if (!key || !data?.base64) throw new Error("Tệp không có nội dung để lưu.");
  const db = await openDB();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      timer = setTimeout(() => {
        reject(new Error("Lưu tệp quá thời gian. Chưa xác nhận upload."));
        try {
          tx.abort();
        } catch {
          /* Transaction already ended. */
        }
      }, 8000);
      const store = tx.objectStore(STORE_NAME);
      store.put({ ...data, key, savedAt: Date.now() });
      tx.addEventListener("complete", () => resolve());
      tx.addEventListener("error", () => reject(tx.error));
      tx.addEventListener("abort", () => reject(tx.error || new Error("Lưu tệp đã bị hủy. Chưa hoàn tất upload.")));
    });
  } finally {
    if (timer) clearTimeout(timer);
    db.close?.();
  }
}

/**
 * Retrieves a file attachment from IndexedDB with sessionStorage fallback.
 */
export async function getAttachment(key: string): Promise<StoredAttachment | null> {
  if (!key) return null;
  try {
    const db = await openDB();
    const result = await new Promise<StoredAttachment | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.addEventListener("success", () => resolve(req.result || null));
      req.addEventListener("error", () => reject(req.error));
      tx.addEventListener("abort", () => reject(tx.error));
    }).finally(() => db.close?.());
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
      tx.addEventListener("complete", () => resolve());
      tx.addEventListener("error", () => reject(tx.error));
      tx.addEventListener("abort", () => reject(tx.error));
    }).finally(() => db.close?.());
  } catch (error) {
    if (isIndexedDBAvailable()) throw error;
  }

  try {
    if (typeof window !== "undefined" && window.sessionStorage) sessionStorage.removeItem(`plane_att_${key}`);
  } catch {
    // ignore
  }
}
