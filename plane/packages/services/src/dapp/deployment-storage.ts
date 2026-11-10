declare const process: { env: Record<string, string | undefined> };

/** Optional epoch for an explicitly fresh deployment; legacy deployments keep their storage. */
export function getDeploymentId(): string {
  const id = (typeof process !== "undefined" ? process.env?.VITE_DAPP_DEPLOYMENT_ID : undefined) ||
    (import.meta as any).env?.VITE_DAPP_DEPLOYMENT_ID ||
    (typeof window !== "undefined" ? (window as any).__env__?.VITE_DAPP_DEPLOYMENT_ID : "") || "";
  if (id && !/^[a-zA-Z0-9_-]{1,96}$/.test(id)) throw new Error("VITE_DAPP_DEPLOYMENT_ID không hợp lệ.");
  return id;
}
export function belongsToDeployment(snapshot: Record<string, any>): boolean {
  const id = getDeploymentId();
  return !id || snapshot?._deployment_id === id;
}
export function deploymentDatabaseName(base: string): string {
  const id = getDeploymentId();
  return id ? `${base}_${id}` : base;
}

/** A fresh epoch clears Plane state only, never the shared SDK Vault/OPFS or wallet selector. */
export function initializeDeploymentStorage(): void {
  const id = getDeploymentId();
  if (!id || typeof window === "undefined") return;
  let changed = false;
  for (const storage of [localStorage, sessionStorage]) {
    if (storage.getItem("plane_dapp_deployment_id") === id) continue;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => !!key);
    for (const key of keys) {
      if (key.startsWith("plane_dapp_") || key.startsWith("ipfs_") || ["last_workspace_slug", "last_workspace_id"].includes(key))
        storage.removeItem(key);
    }
    storage.setItem("plane_dapp_deployment_id", id);
    changed = true;
  }
  if (changed && typeof document !== "undefined") {
    for (const entry of document.cookie.split(";")) {
      const key = entry.trim().split("=")[0];
      if (!key.startsWith("plane_dapp_") && !["last_workspace_slug", "last_workspace_id"].includes(key)) continue;
      for (const cookiePath of ["/", "/plane", "/plane/"])
        document.cookie = `${key}=; path=${cookiePath}; max-age=0; SameSite=Lax`;
    }
  }
}
