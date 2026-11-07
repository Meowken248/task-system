import { saveSnapshotToIDB } from "./indexed-db";

export type LocalPersistenceState = "idle" | "saving" | "saved" | "failed";
export type LocalPersistenceResult = { revision: number; durable: boolean; medium: "localStorage" | "indexedDB" | null };
export type LocalPersistenceStatus = LocalPersistenceResult & { state: LocalPersistenceState; error: string | null };
let revision = 0;
let latest: { snapshot: string; cid?: string } | undefined;
let status: LocalPersistenceStatus = { revision: 0, durable: false, medium: null, state: "idle", error: null };
let idbQueue: Promise<unknown> = Promise.resolve();
let pending: Promise<LocalPersistenceResult> = Promise.resolve({ revision: 0, durable: false, medium: null });

export function getLocalPersistenceStatus(): LocalPersistenceStatus { return { ...status }; }

/** Full localStorage or a completed IndexedDB transaction is durable; sessionStorage is not. */
export function persistLocalSnapshot(data: Record<string, any>, cid?: string): Promise<LocalPersistenceResult> {
  const currentRevision = ++revision;
  let snapshot: string;
  try { snapshot = JSON.stringify(data); }
  catch {
    status = { revision, durable: false, medium: null, state: "failed", error: "Không đóng gói được dữ liệu để lưu trên thiết bị." };
    pending = Promise.resolve({ revision, durable: false, medium: null });
    return pending;
  }
  latest = { snapshot, cid };
  let fullLocalSave = false;
  try {
    localStorage.setItem("plane_dapp_local_db", snapshot);
    fullLocalSave = true;
  } catch {
    // Legacy bootstrap metadata is useful, but cannot acknowledge the full edit.
    try {
      const { users, workspaces, workspace_members, projects, invitations, states, labels, removed_members, _email_wallet_map, instance } = data;
      localStorage.setItem("plane_dapp_local_db", JSON.stringify({ users, workspaces, workspace_members, projects, invitations, states, labels, removed_members, _email_wallet_map, instance }));
    } catch { /* IndexedDB may still succeed. */ }
  }
  try { sessionStorage.setItem("plane_dapp_latest_db", snapshot); } catch { /* Session recovery is best effort. */ }
  // Serialize immutable snapshots so a slow older transaction cannot overwrite a newer edit.
  const indexedSave = idbQueue.then(() => saveSnapshotToIDB(JSON.parse(snapshot), cid)).catch(() => false);
  idbQueue = indexedSave;
  const finish = (durable: boolean, medium: LocalPersistenceResult["medium"]): LocalPersistenceResult => {
    const result = { revision: currentRevision, durable, medium };
    if (currentRevision === revision) {
      status = { ...result, state: durable ? "saved" : "failed", error: durable ? null : "Chưa lưu được dữ liệu trên thiết bị. Dữ liệu vẫn ở trong phiên này; hãy thử lưu lại." };
    }
    return result;
  };
  status = { revision, durable: fullLocalSave, medium: fullLocalSave ? "localStorage" : null, state: fullLocalSave ? "saved" : "saving", error: null };
  pending = fullLocalSave ? Promise.resolve(finish(true, "localStorage")) : indexedSave.then((saved) => finish(saved, saved ? "indexedDB" : null));
  return pending;
}

/** Wait for the latest revision, including saves scheduled while an older revision was awaited. */
export async function flushLocalPersistence(): Promise<LocalPersistenceResult> {
  let observed: Promise<LocalPersistenceResult>;
  let result: LocalPersistenceResult;
  do { observed = pending; result = await observed; } while (observed !== pending);
  return result;
}

export function retryLocalPersistence(): Promise<LocalPersistenceResult> {
  return latest ? persistLocalSnapshot(JSON.parse(latest.snapshot), latest.cid) : flushLocalPersistence();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (status.state !== "saving" && status.state !== "failed") return;
    event.preventDefault();
    event.returnValue = "";
  });
}
