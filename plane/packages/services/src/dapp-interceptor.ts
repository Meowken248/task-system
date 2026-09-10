import type { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from "axios";

declare const process: { env: Record<string, string | undefined> };

const PLANE_CONTRACT = "0x2CB649c0A6338f668F0ADc4AE96c1b2Dc198ed41";

// ── On-chain sync (fire-and-forget, never blocks UI) ──────────────────────
async function syncDAppRecord(collection: string, id: string, _record?: any) {
  // DISABLE generic syncDAppRecord so we don't spam the network with duplicate mock records.
  // The UI will rely purely on the specialized blockchain service (e.g. createTask)
  console.log(`[DApp Sync] Generic sync disabled for ${collection}/${id}`);
}

// ── User factory (Dynamic, zero static mock users) ────────────────────────
function createUserObject(id: string, email: string, firstName?: string, lastName?: string) {
  const cleanEmail = (email || "").trim();
  const fName = firstName || (cleanEmail ? cleanEmail.split("@")[0] : "Admin");
  const lName = lastName || "";
  const displayName = `${fName} ${lName}`.trim() || fName;
  return {
    id,
    email: cleanEmail,
    first_name: fName,
    last_name: lName,
    display_name: displayName,
    avatar_url: "",
    is_bot: false,
    is_active: true,
    is_email_verified: true,
    is_password_autoset: false,
    is_tour_completed: true,
    is_onboarded: true,
    onboarding_step: {
      workspace_join: true,
      profile_complete: true,
      workspace_create: true,
      workspace_invite: true,
    },
    mobile_number: null,
    last_workspace_id: "workspace-fiai",
    last_workspace_slug: "fiai",
    user_timezone: "Asia/Ho_Chi_Minh",
    username: cleanEmail ? cleanEmail.split("@")[0] : id,
    last_login_medium: "email",
    cover_image_url: null,
    date_joined: new Date().toISOString(),
    theme: { theme: "dark" },
  };
}

// ── Default Static Seed Data (Ensures system is ready out-of-the-box) ──
const DEFAULT_WORKSPACE = {
  id: "workspace-fiai",
  name: "FIAI",
  slug: "fiai",
  organization_size: "5-10",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_by: "user-default",
  owner: {
    id: "user-default",
    email: "user@fiai.network",
    first_name: "FIAI",
    last_name: "User",
    display_name: "FIAI User",
    avatar: "",
  },
  role: 20,
};

const defaultDB: Record<string, any> = {
  users: [],
  workspaces: [DEFAULT_WORKSPACE],
  projects: [],
  states: [],
  labels: [],
  instance: {
    id: "instance-main",
    instance_id: "instance-main",
    instance_name: "Plane Instance",
    is_setup_done: true,
    is_activated: true,
    is_telemetry_enabled: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
};

// ── Auth state (persisted in localStorage) ───────────────────────────────
function getLoggedInUserId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("plane_dapp_auth_user");
}
function getLoggedInEmail(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("plane_dapp_auth_email");
}
function isLoggedIn(): boolean {
  return !!getLoggedInUserId();
}
function setLoggedInUser(userId: string | null) {
  if (typeof window === "undefined") return;
  if (userId) {
    localStorage.setItem("plane_dapp_auth_user", userId);
  } else {
    localStorage.removeItem("plane_dapp_auth_user");
    localStorage.removeItem("plane_dapp_auth_email");
  }
}

// ── In-Memory Runtime Store with Instant Local Cache (0ms on F5) ────────
function loadInitialDB(): Record<string, any> {
  if (typeof window !== "undefined") {
    try {
      const cachedLocal = localStorage.getItem("plane_dapp_local_db");
      if (cachedLocal) {
        const parsed = JSON.parse(cachedLocal);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0) {
          const deletedSet = new Set(parsed._deleted_project_ids || []);
          parsed.projects = (parsed.projects || []).filter(
            (p: any) => p.id !== "project-fiai" && !deletedSet.has(p.id) && !deletedSet.has(p.identifier)
          );
          parsed.states = (parsed.states || []).filter(
            (s: any) => s.project !== "project-fiai" && !deletedSet.has(s.project) && !deletedSet.has(s.project_id)
          );
          if (parsed.issues) {
            parsed.issues = parsed.issues.filter(
              (i: any) => !deletedSet.has(i.project) && !deletedSet.has(i.project_id)
            );
          }
          (parsed.projects || []).forEach((p: any) => {
            if (!p.logo_props) p.logo_props = { in_use: "icon", icon: { name: "folder", color: "#3f3f46" } };
          });
          parsed.workspaces = (parsed.workspaces || []).filter((w: any) => w.slug !== "fiai-metanode");
          if (!parsed.workspaces.some((w: any) => w.slug === "fiai")) parsed.workspaces.unshift(DEFAULT_WORKSPACE);
          console.log("[DApp DB] Khởi tạo từ localStorage thành công");
          return parsed;
        }
      }
      const cachedSession = sessionStorage.getItem("plane_dapp_latest_db");
      if (cachedSession) {
        const parsed = JSON.parse(cachedSession);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0) {
          const deletedSet = new Set(parsed._deleted_project_ids || []);
          parsed.projects = (parsed.projects || []).filter(
            (p: any) => p.id !== "project-fiai" && !deletedSet.has(p.id) && !deletedSet.has(p.identifier)
          );
          parsed.states = (parsed.states || []).filter(
            (s: any) => s.project !== "project-fiai" && !deletedSet.has(s.project) && !deletedSet.has(s.project_id)
          );
          if (parsed.issues) {
            parsed.issues = parsed.issues.filter(
              (i: any) => !deletedSet.has(i.project) && !deletedSet.has(i.project_id)
            );
          }
          (parsed.projects || []).forEach((p: any) => {
            if (!p.logo_props) p.logo_props = { in_use: "icon", icon: { name: "folder", color: "#3f3f46" } };
          });
          parsed.workspaces = (parsed.workspaces || []).filter((w: any) => w.slug !== "fiai-metanode");
          if (!parsed.workspaces.some((w: any) => w.slug === "fiai")) parsed.workspaces.unshift(DEFAULT_WORKSPACE);
          console.log("[DApp DB] Khởi tạo từ sessionStorage thành công");
          return parsed;
        }
      }
    } catch (err) {
      console.warn("[DApp DB] Không thể đọc cache lúc khởi tạo:", err);
    }
  }
  return JSON.parse(JSON.stringify(defaultDB));
}

const localDB: Record<string, any> = loadInitialDB();

// Clean up legacy localStorage DB dumps, static mock sessions, and fiai-metanode cache
if (typeof window !== "undefined") {
  try {
    localStorage.removeItem("plane_dapp_db");
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("plane_dapp_db_") || key.startsWith("plane_dapp_is_dirty_"))) {
        localStorage.removeItem(key);
      }
    }
    // Clean up old static mock credentials "me" / "admin@plane.so"
    if (
      localStorage.getItem("plane_dapp_auth_user") === "me" ||
      localStorage.getItem("plane_dapp_auth_email") === "admin@plane.so"
    ) {
      localStorage.removeItem("plane_dapp_auth_user");
      localStorage.removeItem("plane_dapp_auth_email");
    }
    const latestDbStr = sessionStorage.getItem("plane_dapp_latest_db");
    if (latestDbStr && (latestDbStr.includes("admin@plane.so") || latestDbStr.includes('"Plane DApp"'))) {
      sessionStorage.removeItem("plane_dapp_latest_db");
      localStorage.removeItem("plane_dapp_local_db");
    }
    // Clean fiai-metanode from stored caches
    if (localStorage.getItem("plane_dapp_local_db")?.includes("fiai-metanode")) {
      const parsed = JSON.parse(localStorage.getItem("plane_dapp_local_db") || "{}");
      if (parsed.workspaces) {
        parsed.workspaces = parsed.workspaces.filter((w: any) => w.slug !== "fiai-metanode");
        localStorage.setItem("plane_dapp_local_db", JSON.stringify(parsed));
      }
    }
    if (sessionStorage.getItem("plane_dapp_latest_db")?.includes("fiai-metanode")) {
      const parsed = JSON.parse(sessionStorage.getItem("plane_dapp_latest_db") || "{}");
      if (parsed.workspaces) {
        parsed.workspaces = parsed.workspaces.filter((w: any) => w.slug !== "fiai-metanode");
        sessionStorage.setItem("plane_dapp_latest_db", JSON.stringify(parsed));
      }
    }
    document.cookie = "plane_dapp_sync_workspaces=; path=/; max-age=0;";
  } catch { }
}

// Safety checks
if (!localDB.users) localDB.users = [];
// Clean out any static mock users that might be cached
localDB.users = (localDB.users || []).filter((u: any) => u.id !== "me" && u.email !== "admin@plane.so");
localDB.workspaces = (localDB.workspaces || []).filter((w: any) => w.slug !== "fiai-metanode");
if (!localDB.workspaces || localDB.workspaces.length === 0) localDB.workspaces = [DEFAULT_WORKSPACE];
if (!localDB.workspaces.some((w: any) => w.slug === "fiai")) localDB.workspaces.unshift(DEFAULT_WORKSPACE);
if (!localDB.projects) localDB.projects = [];
const initDeletedSet = new Set(localDB._deleted_project_ids || []);
localDB.projects = localDB.projects.filter(
  (p: any) => p.id !== "project-fiai" && !initDeletedSet.has(p.id) && !initDeletedSet.has(p.identifier)
);
(localDB.projects || []).forEach((p: any) => {
  if (!p.logo_props) p.logo_props = { in_use: "icon", icon: { name: "folder", color: "#3f3f46" } };
});
if (!localDB.states) localDB.states = [];
localDB.states = localDB.states.filter(
  (s: any) => s.project !== "project-fiai" && !initDeletedSet.has(s.project) && !initDeletedSet.has(s.project_id)
);
if (!localDB.issues) localDB.issues = [];
localDB.issues = localDB.issues.filter(
  (i: any) => !initDeletedSet.has(i.project) && !initDeletedSet.has(i.project_id)
);
if (!localDB.issue_comments) localDB.issue_comments = [];
if (!localDB.attachments) localDB.attachments = [];
if (!localDB.instance) localDB.instance = { ...defaultDB.instance };
localDB.instance.is_setup_done = true;
if (localDB.instance.instance_name === "Plane DApp") {
  localDB.instance.instance_name = "Plane Instance";
}
if (localDB.instance.id === "dapp-instance") {
  localDB.instance.id = "instance-main";
  localDB.instance.instance_id = "instance-main";
}

export let baseCID: string = "";
export let currentUserAddress: string | null = null;

function getDBStorageKey(): string {
  return currentUserAddress || "local";
}

// ── Cross-Port & URL Sync for Workspaces ──────────────────────────────────
function syncWorkspacesToCookie() {
  if (typeof document === "undefined" || !localDB.workspaces) return;
  try {
    const compact = (localDB.workspaces || []).map((w: any) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      organization_size: w.organization_size || "5-10",
      owner: w.owner,
      role: w.role || 20,
    }));
    const val = encodeURIComponent(JSON.stringify(compact));
    document.cookie = `plane_dapp_sync_workspaces=${val}; path=/; max-age=31536000; SameSite=Lax`;
    if (isDirtyState) {
      document.cookie = "plane_dapp_sync_cid=; path=/; max-age=0; SameSite=Lax";
    } else {
      const cidToSync = lastUploadedCID || baseCID || localStorage.getItem("plane_dapp_ipfs_cid_local");
      if (cidToSync) {
        document.cookie = `plane_dapp_sync_cid=${encodeURIComponent(cidToSync)}; path=/; max-age=31536000; SameSite=Lax`;
      }
    }
  } catch { }
}

function syncCrossPortWorkspaces() {
  if (typeof window === "undefined") return;
  try {
    let hasChanges = false;
    if (!localDB.workspaces) localDB.workspaces = [DEFAULT_WORKSPACE];

    // 1. Read from shared cross-port cookies (domain localhost)
    if (typeof document !== "undefined" && document.cookie) {
      const cookies = document.cookie.split("; ");
      const wsCookie = cookies.find((row) => row.trim().startsWith("plane_dapp_sync_workspaces="));
      if (wsCookie) {
        const rawVal = wsCookie.trim().substring(wsCookie.trim().indexOf("=") + 1);
        const val = decodeURIComponent(rawVal || "");
        if (val) {
          try {
            const syncedWsList = JSON.parse(val);
            if (Array.isArray(syncedWsList)) {
              for (const sWs of syncedWsList) {
                if (sWs && sWs.slug && sWs.slug !== "fiai-metanode" && !localDB.workspaces.some((w: any) => w.slug === sWs.slug || w.id === sWs.id)) {
                  localDB.workspaces.push({
                    id: sWs.id || `workspace-${sWs.slug}`,
                    name: sWs.name || sWs.slug,
                    slug: sWs.slug,
                    organization_size: sWs.organization_size || "5-10",
                    created_at: sWs.created_at || new Date().toISOString(),
                    updated_at: sWs.updated_at || new Date().toISOString(),
                    owner: sWs.owner || {
                      id: getLoggedInUserId() || "user-default",
                      email: getLoggedInEmail() || "user@fiai.network",
                      first_name: sWs.name || sWs.slug,
                      last_name: "",
                      display_name: sWs.name || sWs.slug,
                      avatar: "",
                    },
                    role: 20,
                  });
                  hasChanges = true;
                  console.log(`[DApp DB] Auto-synced workspace from cross-port cookie: ${sWs.slug}`);
                }
              }
            }
          } catch { }
        }
      }

      const cidCookie = cookies.find((row) => row.trim().startsWith("plane_dapp_sync_cid="));
      if (cidCookie) {
        const rawCVal = cidCookie.trim().substring(cidCookie.trim().indexOf("=") + 1);
        const cVal = decodeURIComponent(rawCVal || "");
        if (cVal && !cVal.startsWith("bafkrei") && cVal !== localStorage.getItem("plane_dapp_ipfs_cid_local")) {
          localStorage.setItem("plane_dapp_ipfs_cid_local", cVal);
          fetchFromIPFS(cVal).then((ipfsDB) => {
            if (ipfsDB) {
              console.log(`[DApp DB] Auto-loaded DB from synced cookie CID: ${cVal}`);
              applyOffchainDB(ipfsDB);
            }
          }).catch(() => { });
        }
      }
    }

    // 2. Check URL search query parameters (e.g. ?ws_slug=fiai-metanode&ws_name=FIAI+METANODE&cid=...)
    const searchParams = new URLSearchParams(window.location.search);
    const wsSlug = searchParams.get("ws_slug");
    const wsName = searchParams.get("ws_name");
    const urlCid = searchParams.get("cid");
    const authUser = searchParams.get("auth_user");
    const authEmail = searchParams.get("auth_email");

    if (wsSlug) {
      const exists = localDB.workspaces.find((w: any) => w.slug === wsSlug || w.id === wsSlug);
      if (!exists) {
        const decodedName = wsName ? decodeURIComponent(wsName) : wsSlug.replace(/[-_]/g, " ").toUpperCase();
        const activeUserId = authUser || getLoggedInUserId() || "user-default";
        const activeEmail = authEmail || getLoggedInEmail() || "user@fiai.network";
        const newWs = {
          id: `workspace-${wsSlug}`,
          name: decodedName,
          slug: wsSlug,
          organization_size: "5-10",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: activeUserId,
          owner: {
            id: activeUserId,
            email: activeEmail,
            first_name: decodedName,
            last_name: "",
            display_name: decodedName,
            avatar: "",
          },
          role: 20,
        };
        localDB.workspaces.push(newWs);
        hasChanges = true;
        console.log(`[DApp DB] Auto-provisioned workspace from URL query: ${wsSlug} (${decodedName})`);
      }
    }

    if (urlCid && !urlCid.startsWith("bafkrei")) {
      const storedCid = localStorage.getItem("plane_dapp_ipfs_cid_local");
      if (storedCid !== urlCid) {
        localStorage.setItem("plane_dapp_ipfs_cid_local", urlCid);
      }
      fetchFromIPFS(urlCid).then((ipfsDB) => {
        if (ipfsDB) {
          console.log(`[DApp DB] Auto-loaded DB from URL CID: ${urlCid}`);
          applyOffchainDB(ipfsDB);
          saveDB();
        }
      }).catch(() => { });
    }

    // 3. Auto-provision from pathname if visiting /:workspaceSlug
    const pathname = window.location.pathname;
    const pathSegments = pathname.split("/").filter(Boolean);
    const firstSegment = pathSegments[0];
    const reservedPaths = [
      "assets",
      "api",
      "create-workspace",
      "invitations",
      "settings",
      "profile",
      "installations",
      "onboarding",
      "god-mode",
      "workspace-member-invitations",
      "workspace",
      "preview",
    ];
    if (firstSegment && !reservedPaths.includes(firstSegment)) {
      const exists = localDB.workspaces.find((w: any) => w.slug === firstSegment || w.id === firstSegment);
      if (!exists) {
        const formattedName = firstSegment.replace(/[-_]/g, " ").toUpperCase();
        const activeUserId = getLoggedInUserId() || "user-default";
        const activeEmail = getLoggedInEmail() || "user@fiai.network";
        localDB.workspaces.push({
          id: `workspace-${firstSegment}`,
          name: formattedName,
          slug: firstSegment,
          organization_size: "5-10",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: activeUserId,
          owner: {
            id: activeUserId,
            email: activeEmail,
            first_name: formattedName,
            last_name: "",
            display_name: formattedName,
            avatar: "",
          },
          role: 20,
        });
        hasChanges = true;
        console.log(`[DApp DB] Auto-provisioned workspace from pathname: ${firstSegment}`);
      }
    }

    if (hasChanges) {
      try {
        const snapshot = JSON.stringify(localDB);
        localStorage.setItem("plane_dapp_local_db", snapshot);
        sessionStorage.setItem("plane_dapp_latest_db", snapshot);
      } catch { }
      syncWorkspacesToCookie();
    }
  } catch (e) {
    console.warn("[DApp DB] syncCrossPortWorkspaces error:", e);
  }
}

// Immediately perform cross-port and URL workspace sync on startup
syncCrossPortWorkspaces();

// ── Auto-save to IPFS (debounced) ─────────────────────────────────────
let ipfsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastUploadedCID: string | null = null;
let lastUploadedDataHash: string | null = null;
let isUploadingIPFS = false;
let isDirtyState = false;

/** Get the data object that should be persisted */
function getDBSnapshot(): Record<string, any[]> {
  const dbToSave: Record<string, any[]> = {};
  for (const [key, value] of Object.entries(localDB)) {
    dbToSave[key] = value;
  }
  return dbToSave;
}

/** Upload current DB to IPFS (no wallet needed) */
async function uploadToIPFS(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const dbToSave = getDBSnapshot();

  // Don't upload if completely empty
  const hasData = Object.keys(dbToSave).some(key => {
    const val = dbToSave[key];
    if (Array.isArray(val)) return val.length > 0;
    if (val && typeof val === "object") return Object.keys(val).length > 0;
    return Boolean(val);
  });
  if (!hasData) {
    console.log("[DApp DB] Bỏ qua IPFS upload — chưa có dữ liệu off-chain.");
    return null;
  }

  const serialized = JSON.stringify(dbToSave);
  if (serialized === lastUploadedDataHash && lastUploadedCID && !lastUploadedCID.startsWith("bafkrei")) {
    return lastUploadedCID;
  }

  try {
    isUploadingIPFS = true;
    console.log("[DApp DB] Đang tự động upload dữ liệu off-chain lên IPFS Pinata...");
    let cid: string | null = null;
    const proxyUrl = getProxyUrl();
    if (proxyUrl) {
      try {
        const response = await fetch(proxyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: serialized,
        });
        if (response.ok) {
          const resJson = await response.json();
          cid = resJson?.cid || null;
          console.log(`[DApp DB] ✅ Upload thành công lên Pinata IPFS! CID: ${cid}`);
        } else {
          const errText = await response.text().catch(() => "");
          console.warn(`[DApp DB] Pinata proxy trả về mã lỗi ${response.status}:`, errText);
        }
      } catch (proxyErr) {
        console.warn("[DApp DB] Không thể kết nối tới Pinata proxy:", proxyErr);
      }
    } else {
      console.log("[DApp DB] IPFS proxy chưa cấu hình, dùng local fallback CID.");
    }

    // Fallback content-addressed CID if proxy is not configured
    if (!cid) {
      let hash = 0;
      for (let i = 0; i < serialized.length; i++) {
        hash = (hash << 5) - hash + serialized.charCodeAt(i);
        hash |= 0;
      }
      cid = `bafkrei${Math.abs(hash).toString(36)}${Date.now().toString(36)}`;
    }

    try {
      sessionStorage.setItem(`ipfs_${cid}`, serialized);
    } catch { }

    lastUploadedCID = cid;
    lastUploadedDataHash = serialized;
    isDirtyState = false;
    const storageKey = getDBStorageKey();
    localStorage.setItem(`plane_dapp_ipfs_cid_${storageKey}`, cid);
    console.log(`[DApp DB] ✅ Auto-save IPFS thành công: ${cid}`);
    return cid;
  } catch (err) {
    console.error("[DApp DB] IPFS upload lỗi:", err);
    return null;
  } finally {
    isUploadingIPFS = false;
  }
}

/** Schedule a debounced IPFS upload (2s after last change) */
function scheduleIPFSUpload() {
  if (ipfsDebounceTimer) clearTimeout(ipfsDebounceTimer);
  ipfsDebounceTimer = setTimeout(() => {
    void uploadToIPFS();
  }, 2000);
}

/** Get the last uploaded CID (for syncDAppDBToChain to reuse) */
export function getLastUploadedCID(): string | null {
  if (isDirtyState) return null;
  if (lastUploadedCID) return lastUploadedCID;
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`plane_dapp_ipfs_cid_${getDBStorageKey()}`);
}

/** Check if IPFS upload is in progress */
export function isIPFSUploading(): boolean {
  return isUploadingIPFS;
}

function saveDB() {
  if (typeof window === "undefined") return;
  isDirtyState = true;
  lastUploadedCID = null;
  lastUploadedDataHash = null;
  try {
    const storageKey = getDBStorageKey();
    localStorage.removeItem(`plane_dapp_ipfs_cid_${storageKey}`);
    const snapshot = JSON.stringify(localDB);
    localStorage.setItem("plane_dapp_local_db", snapshot);
    sessionStorage.setItem("plane_dapp_latest_db", snapshot);
  } catch { }
  syncWorkspacesToCookie();
  scheduleIPFSUpload();
}

/** Fetch off-chain DB from IPFS using fallback gateways */
async function fetchFromIPFS(cid: string): Promise<Record<string, any> | null> {
  if (!cid || typeof cid !== "string" || cid.trim() === "") return null;
  const cleanCid = cid.trim();

  // Check local session IPFS cache first
  try {
    const cached = sessionStorage.getItem(`ipfs_${cleanCid}`);
    if (cached) {
      const json = JSON.parse(cached);
      if (json && typeof json === "object") {
        console.log(`[DApp DB] Tải thành công từ session IPFS cache: ${cleanCid}`);
        return json;
      }
    }
  } catch { }

  const gateways = [
    `https://purple-fascinating-quelea-533.mypinata.cloud/ipfs/${cleanCid}`,
    `https://gateway.pinata.cloud/ipfs/${cleanCid}`,
    `https://cloudflare-ipfs.com/ipfs/${cleanCid}`,
    `https://ipfs.io/ipfs/${cleanCid}`,
  ];

  for (const gw of gateways) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(gw, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const json = await res.json();
        if (json && typeof json === "object") {
          console.log(`[DApp DB] Tải thành công từ IPFS gateway: ${gw}`);
          return json;
        }
      }
    } catch (err) {
      console.warn(`[DApp DB] IPFS gateway ${gw} lỗi hoặc timeout:`, err);
    }
  }
  console.error(`[DApp DB] Không thể tải dữ liệu từ bất kỳ IPFS gateway nào cho CID: ${cleanCid}`);
  return null;
}

function applyOffchainDB(ipfsDB: Record<string, any>) {
  const currentWorkspaces = [...(localDB.workspaces || [])];
  const currentIssues = [...(localDB.issues || [])];
  const currentComments = [...(localDB.issue_comments || [])];
  const currentAttachments = [...(localDB.attachments || [])];
  const mergedDeletedProjects = new Set<string>([
    ...(localDB._deleted_project_ids || []),
    ...(ipfsDB._deleted_project_ids || []),
  ]);

  for (const key in localDB) delete localDB[key];
  Object.assign(localDB, ipfsDB);

  localDB._deleted_project_ids = Array.from(mergedDeletedProjects);

  if (!localDB.users) localDB.users = [];
  localDB.users = (localDB.users || []).filter((u: any) => u.id !== "me" && u.email !== "admin@plane.so");
  if (!localDB.workspaces) localDB.workspaces = [];
  for (const w of currentWorkspaces) {
    if (w.slug !== "fiai-metanode" && !localDB.workspaces.some((existing: any) => existing.slug === w.slug || existing.id === w.id)) {
      localDB.workspaces.push(w);
    }
  }
  localDB.workspaces = localDB.workspaces.filter((w: any) => w.slug !== "fiai-metanode");
  if (localDB.workspaces.length === 0) localDB.workspaces = [DEFAULT_WORKSPACE];

  if (!localDB.projects) localDB.projects = [];
  localDB.projects = localDB.projects.filter(
    (p: any) => p.id !== "project-fiai" && !mergedDeletedProjects.has(p.id) && !mergedDeletedProjects.has(p.identifier)
  );
  (localDB.projects || []).forEach((p: any) => {
    if (!p.logo_props) p.logo_props = { in_use: "icon", icon: { name: "folder", color: "#3f3f46" } };
  });

  if (!localDB.states) localDB.states = [];
  localDB.states = localDB.states.filter(
    (s: any) => s.project !== "project-fiai" && !mergedDeletedProjects.has(s.project) && !mergedDeletedProjects.has(s.project_id)
  );

  if (!localDB.issues) localDB.issues = [];
  for (const issue of currentIssues) {
    if (
      !mergedDeletedProjects.has(issue.project) &&
      !mergedDeletedProjects.has(issue.project_id) &&
      !localDB.issues.some((i: any) => i.id === issue.id)
    ) {
      localDB.issues.push(issue);
    }
  }
  localDB.issues = localDB.issues.filter(
    (i: any) => !mergedDeletedProjects.has(i.project) && !mergedDeletedProjects.has(i.project_id)
  );

  if (localDB.labels) {
    localDB.labels = localDB.labels.filter(
      (l: any) => !mergedDeletedProjects.has(l.project) && !mergedDeletedProjects.has(l.project_id)
    );
  }
  if (localDB.cycles) {
    localDB.cycles = localDB.cycles.filter(
      (c: any) => !mergedDeletedProjects.has(c.project) && !mergedDeletedProjects.has(c.project_id)
    );
  }
  if (localDB.modules) {
    localDB.modules = localDB.modules.filter(
      (m: any) => !mergedDeletedProjects.has(m.project) && !mergedDeletedProjects.has(m.project_id)
    );
  }
  if (localDB.project_members) {
    localDB.project_members = localDB.project_members.filter(
      (pm: any) => !mergedDeletedProjects.has(pm.project) && !mergedDeletedProjects.has(pm.project_id)
    );
  }
  if (!localDB.issue_comments) localDB.issue_comments = [];
  for (const c of currentComments) {
    if (!localDB.issue_comments.some((existing: any) => existing.id === c.id)) {
      localDB.issue_comments.push(c);
    }
  }
  if (!localDB.attachments) localDB.attachments = [];
  for (const a of currentAttachments) {
    if (!localDB.attachments.some((existing: any) => existing.id === a.id)) {
      localDB.attachments.push(a);
    }
  }
  if (!localDB.instance) localDB.instance = { ...defaultDB.instance };
  localDB.instance.is_setup_done = true;
  // Migrate stale instance IDs and names
  if (localDB.instance.id === "dapp-instance") {
    localDB.instance.id = "instance-main";
    localDB.instance.instance_id = "instance-main";
  }
  if (localDB.instance.instance_name === "Plane DApp") {
    localDB.instance.instance_name = "Plane Instance";
  }
  try {
    const snapshot = JSON.stringify(localDB);
    localStorage.setItem("plane_dapp_local_db", snapshot);
    sessionStorage.setItem("plane_dapp_latest_db", snapshot);
  } catch { }
  syncWorkspacesToCookie();
}

// Hàm resolve dùng cho db-bootstrap.tsx xử lý UI conflict
export function resolveDBConflict(choice: "USE_CHAIN" | "USE_LOCAL", cid: string, ipfsDB: any) {
  if (typeof window === "undefined" || !currentUserAddress) return;

  if (choice === "USE_CHAIN") {
    // Ghi đè RAM bằng IPFS từ on-chain
    baseCID = cid;
    applyOffchainDB(ipfsDB);
    localStorage.setItem(`plane_dapp_ipfs_cid_${currentUserAddress}`, cid);
  } else if (choice === "USE_LOCAL") {
    // Giữ nguyên dữ liệu hiện tại trong RAM, upload lại lên IPFS
    baseCID = cid;
    void uploadToIPFS();
  }
}

/** Khôi phục dữ liệu từ mã CID IPFS bất kỳ */
export async function restoreFromIPFS(cid: string): Promise<boolean> {
  const cleanCid = cid.trim();
  if (!cleanCid) return false;
  console.log(`[DApp DB] Đang khôi phục dữ liệu từ IPFS CID: ${cleanCid}`);
  const ipfsDB = await fetchFromIPFS(cleanCid);
  if (ipfsDB) {
    applyOffchainDB(ipfsDB);
    saveDB();
    if (typeof window !== "undefined") {
      localStorage.setItem("plane_dapp_ipfs_cid_local", cleanCid);
      localStorage.setItem(`plane_dapp_ipfs_cid_${getDBStorageKey()}`, cleanCid);
      lastUploadedCID = cleanCid;
    }
    console.log(`[DApp DB] Khôi phục thành công từ IPFS CID: ${cleanCid}`);
    return true;
  }
  return false;
}

if (typeof window !== "undefined") {
  (window as any).restoreFromIPFS = restoreFromIPFS;
}

// ── Decentralized IPFS + Blockchain Sync ─────────────────────────────────

const GET_CID_ABI = {
  type: "function",
  name: "getCID",
  inputs: [
    { internalType: "address", name: "user", type: "address" },
    { internalType: "string", name: "key", type: "string" }
  ],
  outputs: [{ internalType: "string", name: "", type: "string" }],
  stateMutability: "view"
};

const SET_CID_IF_MATCHES_ABI = {
  type: "function",
  name: "setCIDIfMatches",
  inputs: [
    { internalType: "string", name: "key", type: "string" },
    { internalType: "string", name: "expectedOldCid", type: "string" },
    { internalType: "string", name: "newCid", type: "string" }
  ],
  outputs: [],
  stateMutability: "nonpayable"
};

function getEnvVar(name: string): string | undefined {
  if (typeof process !== "undefined" && process.env?.[name]) return process.env[name];
  if (typeof window !== "undefined" && (window as any).__env__?.[name]) return (window as any).__env__[name];
  if (typeof window !== "undefined" && (window as any)[name]) return (window as any)[name];
  return undefined;
}

const CONTRACT_ADDRESS =
  getEnvVar("VITE_REGISTRY_CONTRACT_ADDRESS") ||
  getEnvVar("NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS") ||
  "0x1eF16F9e7Faf6977f8a6d13187A9eD7981b4460B";

const WORKSPACE_REGISTRY_ADDRESS =
  getEnvVar("VITE_WORKSPACE_REGISTRY_ADDRESS") ||
  getEnvVar("NEXT_PUBLIC_WORKSPACE_REGISTRY_ADDRESS") ||
  "0xA89B781A0AA61F3bBC86410DE74a350297A5087d";

const GET_WORKSPACE_CID_ABI = {
  type: "function",
  name: "getWorkspaceCID",
  inputs: [{ internalType: "string", name: "slug", type: "string" }],
  outputs: [{ internalType: "string", name: "", type: "string" }],
  stateMutability: "view",
};

const UPDATE_WORKSPACE_CID_ABI = {
  type: "function",
  name: "updateWorkspaceCID",
  inputs: [
    { internalType: "string", name: "slug", type: "string" },
    { internalType: "string", name: "newCid", type: "string" },
  ],
  outputs: [],
  stateMutability: "nonpayable",
};

const CREATE_WORKSPACE_ABI = {
  type: "function",
  name: "createWorkspace",
  inputs: [
    { internalType: "string", name: "slug", type: "string" },
    { internalType: "string", name: "name", type: "string" },
    { internalType: "string", name: "initialCid", type: "string" },
  ],
  outputs: [],
  stateMutability: "nonpayable",
};

const ADD_MEMBER_ABI = {
  type: "function",
  name: "addMember",
  inputs: [
    { internalType: "string", name: "slug", type: "string" },
    { internalType: "address", name: "member", type: "address" },
    { internalType: "uint8", name: "role", type: "uint8" },
  ],
  outputs: [],
  stateMutability: "nonpayable",
};

const REMOVE_MEMBER_ABI = {
  type: "function",
  name: "removeMember",
  inputs: [
    { internalType: "string", name: "slug", type: "string" },
    { internalType: "address", name: "member", type: "address" },
  ],
  outputs: [],
  stateMutability: "nonpayable",
};

function extractEthAddress(input: string | undefined | null): string | null {
  if (!input) return null;
  const clean = input.trim().toLowerCase();
  if (/^0x[a-f0-9]{40}$/.test(clean)) return clean;
  const match = clean.match(/^(0x[a-f0-9]{40})(@.*)?$/);
  if (match) return match[1];
  return null;
}

function mapPlaneRoleToContractRole(planeRole: number | string | undefined): number {
  const r = Number(planeRole);
  if (r >= 20) return 2; // Admin
  if (r >= 5) return 1; // Member / Guest
  return 1;
}

function getFiaiSDK(): any {
  if (typeof window !== "undefined") {
    return (window as any).fiaiSDK || null;
  }
  return null;
}


const DEFAULT_PROXY_URL = "https://plane-ipfs-proxy.anh2482006.workers.dev";
const PLACEHOLDER_PATTERNS = ["your-worker", "your-subdomain", "your-domain", "example.com"];

/** Returns a valid proxy URL, or null if unconfigured/placeholder */
function getProxyUrl(): string | null {
  const envUrl = getEnvVar("VITE_PINATA_PROXY_URL");
  const url = envUrl || DEFAULT_PROXY_URL;
  if (PLACEHOLDER_PATTERNS.some(p => url.includes(p))) return null;
  return url;
}

// ── Direct RPC (bypass Bridge iframe for read-only calls) ──────────────
const GET_CID_SELECTOR = "0xfa3e97e7"; // keccak256("getCID(address,string)")[0:4]
const GET_WORKSPACE_CID_SELECTOR = "0xdf48cfdc"; // keccak256("getWorkspaceCID(string)")[0:4]
const GET_USER_WORKSPACES_SELECTOR = "0xd7d19c4e"; // keccak256("getUserWorkspaces(address)")[0:4]
const GET_WORKSPACE_SELECTOR = "0x1cd7381a"; // keccak256("getWorkspace(string)")[0:4]

function getRpcUrl(): string {
  return getEnvVar("VITE_RPC_URL") || "https://rpc-proxy-sequoia.iqnb.com:8446";
}

function padHex(hex: string, bytes: number): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return clean.padStart(bytes * 2, "0");
}

function utf8ToHex(str: string): string {
  return Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** ABI-encode getCID(address, string) calldata without external libs */
function abiEncodeGetCID(userAddress: string, key: string): string {
  // address param (left-padded to 32 bytes)
  const addressHex = padHex(userAddress, 32);
  // string is dynamic → offset pointer at position 1 = 0x40 (64)
  const offsetHex = padHex("40", 32);
  // string length
  const keyBytes = utf8ToHex(key);
  const keyLen = key.length;
  const keyLenHex = padHex(keyLen.toString(16), 32);
  // string data (right-padded to 32-byte boundary)
  const keyDataHex = keyBytes.padEnd(Math.ceil(keyBytes.length / 64) * 64, "0");
  return GET_CID_SELECTOR + addressHex + offsetHex + keyLenHex + keyDataHex;
}

/** ABI-encode getWorkspaceCID(string) calldata without external libs */
function abiEncodeGetWorkspaceCID(slug: string): string {
  const offsetHex = padHex("20", 32);
  const slugBytes = utf8ToHex(slug);
  const slugLenHex = padHex(slug.length.toString(16), 32);
  const slugDataHex = slugBytes.padEnd(Math.ceil(slugBytes.length / 64) * 64, "0");
  return GET_WORKSPACE_CID_SELECTOR + offsetHex + slugLenHex + slugDataHex;
}

/** ABI-encode getUserWorkspaces(address) calldata */
function abiEncodeGetUserWorkspaces(userAddress: string): string {
  const addressHex = padHex(userAddress, 32);
  return GET_USER_WORKSPACES_SELECTOR + addressHex;
}

/** ABI-encode getWorkspace(string) calldata */
function abiEncodeGetWorkspace(slug: string): string {
  const offsetHex = padHex("20", 32);
  const slugBytes = utf8ToHex(slug);
  const slugLenHex = padHex(slug.length.toString(16), 32);
  const slugDataHex = slugBytes.padEnd(Math.ceil(slugBytes.length / 64) * 64, "0");
  return GET_WORKSPACE_SELECTOR + offsetHex + slugLenHex + slugDataHex;
}

/** Decode ABI-encoded string return value from eth_call hex result */
function decodeAbiString(hexResult: string): string {
  if (!hexResult || hexResult === "0x" || hexResult.length < 130) return "";
  const data = hexResult.startsWith("0x") ? hexResult.slice(2) : hexResult;
  // Skip offset (first 32 bytes) → read length (next 32 bytes) → read string data
  const length = parseInt(data.slice(64, 128), 16);
  if (length === 0) return "";
  const strHex = data.slice(128, 128 + length * 2);
  const bytes = new Uint8Array(strHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  return new TextDecoder().decode(bytes);
}

/** Decode ABI-encoded string[] return value from eth_call hex result */
function decodeAbiStringArray(hexResult: string): string[] {
  if (!hexResult || hexResult === "0x" || hexResult.length < 130) return [];
  const data = hexResult.startsWith("0x") ? hexResult.slice(2) : hexResult;
  try {
    const arrayOffset = parseInt(data.slice(0, 64), 16) * 2;
    const count = parseInt(data.slice(arrayOffset, arrayOffset + 64), 16);
    if (isNaN(count) || count <= 0 || count > 100) return [];
    const result: string[] = [];
    for (let i = 0; i < count; i++) {
      const elemOffset = parseInt(data.slice(arrayOffset + 64 + i * 64, arrayOffset + 64 + (i + 1) * 64), 16) * 2;
      const strStart = arrayOffset + 64 + elemOffset;
      const strLen = parseInt(data.slice(strStart, strStart + 64), 16);
      if (isNaN(strLen) || strLen < 0 || strLen > 500) continue;
      const strHex = data.slice(strStart + 64, strStart + 64 + strLen * 2);
      const bytes = new Uint8Array(strHex.match(/.{2}/g)?.map((b) => parseInt(b, 16)) || []);
      result.push(new TextDecoder().decode(bytes));
    }
    return result;
  } catch (err) {
    console.warn("[DApp DB] decodeAbiStringArray error:", err);
    return [];
  }
}

/** Decode ABI-encoded getWorkspace result: (string name, address owner, string ipfsCID, uint256 updatedAt) */
function decodeAbiWorkspace(hexResult: string): { name: string; owner: string; ipfsCID: string; updatedAt: number } | null {
  if (!hexResult || hexResult === "0x" || hexResult.length < 256) return null;
  const data = hexResult.startsWith("0x") ? hexResult.slice(2) : hexResult;
  try {
    const nameOffset = parseInt(data.slice(0, 64), 16) * 2;
    const owner = "0x" + data.slice(64 + 24, 128);
    const cidOffset = parseInt(data.slice(128, 192), 16) * 2;
    const updatedAt = parseInt(data.slice(192, 256), 16);

    const nameLen = parseInt(data.slice(nameOffset, nameOffset + 64), 16);
    const nameHex = data.slice(nameOffset + 64, nameOffset + 64 + nameLen * 2);
    const nameBytes = new Uint8Array(nameHex.match(/.{2}/g)?.map((b) => parseInt(b, 16)) || []);
    const name = new TextDecoder().decode(nameBytes);

    const cidLen = parseInt(data.slice(cidOffset, cidOffset + 64), 16);
    const cidHex = data.slice(cidOffset + 64, cidOffset + 64 + cidLen * 2);
    const cidBytes = new Uint8Array(cidHex.match(/.{2}/g)?.map((b) => parseInt(b, 16)) || []);
    const ipfsCID = new TextDecoder().decode(cidBytes);

    return { name, owner, ipfsCID, updatedAt };
  } catch (err) {
    console.warn("[DApp DB] decodeAbiWorkspace error:", err);
    return null;
  }
}

/** Call a read-only contract function directly via JSON-RPC eth_call */
async function directRpcRead(contractAddr: string, calldata: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(getRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: contractAddr, data: calldata }, "latest"],
      }),
      signal: controller.signal,
    });
    const json = await response.json();
    if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
    return json.result || "0x";
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Wallet address helpers ─────────────────────────────────────────────

/** Read wallet address from localStorage (stored by metanode-wallet.service) */
function getStoredWalletAddress(): string | null {
  if (typeof window === "undefined") return null;
  // Try the module-level cached address first
  if (currentUserAddress) return currentUserAddress;
  // Scan localStorage for a previously saved wallet-keyed DB
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("plane_dapp_db_0x")) {
        const addr = key.replace("plane_dapp_db_", "");
        if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return addr;
      }
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("plane:metanode-wallet:")) {
        const addr = localStorage.getItem(key)?.trim() || "";
        if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return addr;
      }
    }
  } catch { /* localStorage access can throw in sandboxed iframes */ }
  return null;
}

async function getWalletAddress() {
  const isMock = getEnvVar("VITE_MOCK_FIAI") === "true";
  if (isMock) {
    return "0xMockUserAddress1234567890abcdef12345678";
  }

  // Try localStorage first (instant, no Bridge needed)
  const stored = getStoredWalletAddress();
  if (stored) {
    console.log(`[DApp DB] Wallet từ localStorage: ${stored}`);
    return stored;
  }

  // No wallet in localStorage → return null (don't block page load with Bridge)
  console.log(`[DApp DB] Chưa có wallet trong localStorage. Cần kết nối ví trước.`);
  return null;
}

/** Get wallet via Bridge iframe — only used for write operations (Sync to Chain) */
async function getWalletAddressViaBridge() {
  const isMock = getEnvVar("VITE_MOCK_FIAI") === "true";
  if (isMock) {
    return "0xMockUserAddress1234567890abcdef12345678";
  }

  // 1. Try localStorage first
  const stored = getStoredWalletAddress();
  if (stored) return stored;

  // 2. Fallback: connect through Bridge (slow, requires iframe)
  console.log(`[DApp DB] Đang kết nối ví qua Bridge...`);
  const { getActiveWallet } = await import("@metanodejs/system-core");
  const timeoutMs = 20000;
  const timeoutTask = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Không thể kết nối với ví MetaNode (quá ${timeoutMs / 1000} giây). Lỗi mạng hoặc Bridge không phản hồi.`));
    }, timeoutMs);
  });

  const wallet = await Promise.race([getActiveWallet(), timeoutTask]);
  console.log(`[DApp DB] Kết nối ví thành công:`, wallet);

  // Ép đóng popup vì system-core đôi khi không tự đóng
  if (typeof document !== "undefined") {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  }

  return (wallet as any)?.address || null;
}

async function _initDAppDB() {
  if (typeof window === "undefined") return { status: "OK" };
  const activeWallet = await getWalletAddress().catch(() => null);

  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const urlCid = urlParams?.get("cid");

  if (!activeWallet) {
    console.log(`[DApp DB] Chưa có ví. Sử dụng dữ liệu off-chain trong bộ nhớ RAM.`);
    const localCid = urlCid || localStorage.getItem(`plane_dapp_ipfs_cid_${getDBStorageKey()}`) || localStorage.getItem("plane_dapp_ipfs_cid_local");
    if (localCid) {
      const ipfsDB = await fetchFromIPFS(localCid);
      if (ipfsDB) {
        applyOffchainDB(ipfsDB);
        lastUploadedCID = localCid;
      } else {
        try {
          const latest = sessionStorage.getItem("plane_dapp_latest_db");
          if (latest) {
            applyOffchainDB(JSON.parse(latest));
          }
        } catch { }
      }
    } else {
      try {
        const latest = sessionStorage.getItem("plane_dapp_latest_db");
        if (latest) {
          applyOffchainDB(JSON.parse(latest));
        }
      } catch { }
    }

    if (!lastUploadedCID || lastUploadedCID.startsWith("bafkrei")) {
      scheduleIPFSUpload();
    }

    return { status: "OK" };
  }

  if (currentUserAddress && activeWallet.toLowerCase() !== currentUserAddress.toLowerCase()) {
    for (const key in localDB) delete localDB[key];
    Object.assign(localDB, JSON.parse(JSON.stringify(defaultDB)));
  }
  currentUserAddress = activeWallet;

  try {
    const isMock = getEnvVar("VITE_MOCK_FIAI") === "true";
    if (isMock) {
      console.log(`[DApp DB] MOCK MODE: Bỏ qua đọc từ contract.`);
      return { status: "OK" };
    }

    // ── Direct RPC call: getCID(address, "plane_dapp_db") ──────────────
    console.log(`[DApp DB] Đọc CID trực tiếp từ RPC (${getRpcUrl()})...`);
    const calldata = abiEncodeGetCID(currentUserAddress as string, "plane_dapp_db");
    const rawResult = await directRpcRead(CONTRACT_ADDRESS, calldata, 15000);
    const onChainUserCid = decodeAbiString(rawResult);
    console.log(`[DApp DB] User CID từ contract:`, onChainUserCid || "(trống)");

    // ── Check PlaneWorkspaceRegistry if available ──────────────
    let onChainWorkspaceCid = "";
    if (WORKSPACE_REGISTRY_ADDRESS) {
      try {
        console.log(`[DApp DB] Đang truy vấn danh sách Workspaces của ví ${currentUserAddress} từ PlaneWorkspaceRegistry (${WORKSPACE_REGISTRY_ADDRESS})...`);
        const userWsCalldata = abiEncodeGetUserWorkspaces(currentUserAddress as string);
        const userWsRaw = await directRpcRead(WORKSPACE_REGISTRY_ADDRESS, userWsCalldata, 10000);
        const userWsSlugs = decodeAbiStringArray(userWsRaw);
        console.log(`[DApp DB] Workspaces tìm thấy trên chain cho ví:`, userWsSlugs);

        if (!localDB.workspaces) localDB.workspaces = [];

        // Luôn kiểm tra workspace "fiai" nếu userWsSlugs rỗng để đảm bảo tính liên tục
        const slugsToCheck = Array.from(new Set([...userWsSlugs, "fiai"]));

        for (const slug of slugsToCheck) {
          try {
            const wsInfoCalldata = abiEncodeGetWorkspace(slug);
            const wsInfoRaw = await directRpcRead(WORKSPACE_REGISTRY_ADDRESS, wsInfoCalldata, 8000);
            const wsInfo = decodeAbiWorkspace(wsInfoRaw);
            if (wsInfo && wsInfo.name) {
              const existingIdx = localDB.workspaces.findIndex((w: any) => w.slug === slug);
              if (existingIdx > -1) {
                localDB.workspaces[existingIdx].name = wsInfo.name;
                localDB.workspaces[existingIdx].owner = wsInfo.owner;
              } else {
                localDB.workspaces.push({
                  id: slug,
                  name: wsInfo.name,
                  slug: slug,
                  owner: wsInfo.owner,
                  created_at: new Date().toISOString(),
                  updated_at: new Date(wsInfo.updatedAt * 1000).toISOString(),
                });
              }

              if (wsInfo.ipfsCID && !onChainWorkspaceCid) {
                onChainWorkspaceCid = wsInfo.ipfsCID;
                console.log(`[DApp DB] Sử dụng IPFS CID từ workspace "${slug}":`, onChainWorkspaceCid);
              }
            }
          } catch { }
        }

        syncWorkspacesToCookie();
      } catch (wsErr) {
        console.warn(`[DApp DB] Không thể đọc danh sách Workspaces từ PlaneWorkspaceRegistry:`, wsErr);
      }
    }

    const onChainCid = onChainWorkspaceCid || onChainUserCid;

    baseCID = onChainCid || "";

    const cachedIpfsCid = localStorage.getItem(`plane_dapp_ipfs_cid_${currentUserAddress}`);
    const targetCID = cachedIpfsCid || onChainCid;

    if (targetCID && targetCID !== "") {
      console.log(`[DApp DB] Đang tải dữ liệu off-chain từ IPFS (CID: ${targetCID})...`);
      const ipfsDB = await fetchFromIPFS(targetCID);
      if (ipfsDB) {
        if (onChainCid && cachedIpfsCid && onChainCid !== cachedIpfsCid) {
          console.warn(`[DApp DB] Phát hiện xung đột CID: On-chain (${onChainCid}) vs IPFS (${cachedIpfsCid})`);
          return { status: "CONFLICT", cid: onChainCid, ipfsDB };
        }
        applyOffchainDB(ipfsDB);
        lastUploadedCID = targetCID;
        return { status: "OK" };
      }
    }

    return { status: "OK" };
  } catch (err) {
    console.error("Failed to load DApp DB from chain / IPFS:", err);
    return { status: "OK" };
  }
}

export async function initDAppDB() {
  const timeoutMs = 20000;
  console.log(`[DApp DB] Bắt đầu init, tự động ngắt sau ${timeoutMs}ms...`);

  const timeoutTask = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Quá thời gian kết nối (${timeoutMs / 1000} giây). Lỗi mạng, SSL, hoặc Bridge không phản hồi.`));
    }, timeoutMs);
  });

  return Promise.race([_initDAppDB(), timeoutTask])
    .then(res => {
      console.log(`[DApp DB] Init thành công:`, res);
      return res;
    })
    .catch(err => {
      console.error(`[DApp DB] Init thất bại hoặc quá timeout:`, err);
      throw err;
    });
}

export async function syncDAppDBToChain(forcedWallet?: string) {
  const activeWallet = forcedWallet || getStoredWalletAddress();
  if (!activeWallet) throw new Error("Chưa kết nối ví. Vui lòng kết nối ví từ giao diện.");
  if (currentUserAddress && activeWallet.toLowerCase() !== currentUserAddress.toLowerCase()) {
    throw new Error("Tài khoản ví đã thay đổi. Vui lòng tải lại trang để nạp dữ liệu của ví mới.");
  }
  currentUserAddress = activeWallet;

  // Upload IPFS — reuse auto-saved CID if available and not dirty, otherwise upload now
  let cid = isDirtyState ? null : getLastUploadedCID();
  if (!cid) {
    if (ipfsDebounceTimer) {
      clearTimeout(ipfsDebounceTimer);
      ipfsDebounceTimer = null;
    }
    console.log("[DApp DB] Dữ liệu có thay đổi (isDirtyState) hoặc chưa có CID, bắt buộc upload IPFS mới...");
    cid = await uploadToIPFS();
  }
  if (!cid) throw new Error("Không thể upload dữ liệu lên IPFS.");

  const bridge = typeof window !== "undefined" ? (window as any).fiaiSDK : null;
  if (!bridge) throw new Error("FiaiSDK is not available.");

  // Khởi tạo active wallet trong SDK để tránh popup chọn ví (bị lỗi treo) của Bridge
  try {
    const sysCore = await import("@metanodejs/system-core") as any;
    const { getWallets, setWalletActiveDApp } = sysCore;
    const wallets = await getWallets().catch(() => []);
    const walletObj = wallets.find((w: any) => {
      const addr = w.address || w.Address || "";
      return addr.toLowerCase() === currentUserAddress?.toLowerCase();
    });
    if (walletObj) {
      await setWalletActiveDApp(walletObj);
      await bridge.request("setActiveWalletDapp", { ...walletObj, domain: window.location.hostname }).catch(() => null);
    }
  } catch (err) {
    console.warn("[DApp DB] Không thể set active wallet cho SDK:", err);
  }

  const send = () =>
    bridge!.request("sendTransaction", {
      from: currentUserAddress as string,
      to: CONTRACT_ADDRESS,
      abiData: [SET_CID_IF_MATCHES_ABI],
      functionName: "setCIDIfMatches",
      feeType: "sc",
      amount: "0",
      value: "0",
      gas: "3000000",
      type: "transaction",
      inputArray: [
        { ...SET_CID_IF_MATCHES_ABI.inputs[0], value: "plane_dapp_db" },
        { ...SET_CID_IF_MATCHES_ABI.inputs[1], value: baseCID },
        { ...SET_CID_IF_MATCHES_ABI.inputs[2], value: cid }
      ],
      isReadOnly: false,
      bundleId: "",
    });

  const sendWithWalletRecovery = async (): Promise<unknown> => {
    try {
      return await send();
    } catch (error: any) {
      console.log(JSON.stringify(error, null, 2)); // Giữ lại log cho dev test

      const errStr = [
        error?.message,
        error?.toString?.(),
        error?.reason,
        error?.data?.message,
        (() => { try { return JSON.stringify(error); } catch { return ""; } })()
      ].filter(Boolean).join(" | ");

      if (errStr.includes("CID_CONFLICT")) {
        throw new Error("LỖI XUNG ĐỘT: Dữ liệu đã thay đổi ở nơi khác từ lúc bạn mở trang. Tải lại để lấy bản mới nhất trước khi lưu tiếp, nếu không thay đổi của bạn sẽ bị mất khi ghi đè.");
      }
      throw error;
    }
  };

  await sendWithWalletRecovery();

  // Đồng bộ lên PlaneWorkspaceRegistry cho workspace chung nếu có
  if (WORKSPACE_REGISTRY_ADDRESS && bridge) {
    try {
      const activeUserId = getLoggedInUserId();
      const activeUser = (localDB.users || []).find((u: any) => u.id === activeUserId);
      const activeSlug =
        (typeof window !== "undefined" ? localStorage.getItem("last_workspace_slug") : null) ||
        activeUser?.last_workspace_slug ||
        localDB.workspaces?.[0]?.slug ||
        "fiai";
      const targetWs = (localDB.workspaces || []).find((w: any) => w.slug === activeSlug) || localDB.workspaces?.[0];
      const targetSlug = targetWs?.slug || activeSlug || "fiai";
      const targetName = targetWs?.name || "Plane Workspace";

      await bridge.request("sendTransaction", {
        from: currentUserAddress as string,
        to: WORKSPACE_REGISTRY_ADDRESS,
        abiData: [UPDATE_WORKSPACE_CID_ABI],
        functionName: "updateWorkspaceCID",
        feeType: "sc",
        amount: "0",
        value: "0",
        gas: "3000000",
        type: "transaction",
        inputArray: [
          { name: "slug", type: "string", value: targetSlug },
          { name: "newCid", type: "string", value: cid },
        ],
        isReadOnly: false,
        bundleId: "",
      }).catch(async () => {
        return bridge.request("sendTransaction", {
          from: currentUserAddress as string,
          to: WORKSPACE_REGISTRY_ADDRESS,
          abiData: [CREATE_WORKSPACE_ABI],
          functionName: "createWorkspace",
          feeType: "sc",
          amount: "0",
          value: "0",
          gas: "3000000",
          type: "transaction",
          inputArray: [
            { name: "slug", type: "string", value: targetSlug },
            { name: "name", type: "string", value: targetName },
            { name: "initialCid", type: "string", value: cid },
          ],
          isReadOnly: false,
          bundleId: "",
        });
      });
      console.log(`[DApp DB] ✅ Đã cập nhật CID lên PlaneWorkspaceRegistry cho slug "${targetSlug}" (${WORKSPACE_REGISTRY_ADDRESS})`);
    } catch (wsErr) {
      console.warn("[DApp DB] Cập nhật PlaneWorkspaceRegistry bỏ qua:", wsErr);
    }
  }

  // Xóa cờ is_dirty CHỈ SAU KHI transaction confirm thành công
  baseCID = cid;
  isDirtyState = false;

  return cid;
}

function getInstanceInfo() {
  const inst = localDB.instance || {};
  const hasUsers = Boolean(localDB.users && localDB.users.length > 0);
  const firstUser = localDB.users?.[0];
  let instanceName = inst.instance_name;
  if (!instanceName || instanceName === "Plane DApp") {
    instanceName = hasUsers && firstUser?.first_name ? `${firstUser.first_name}'s Instance` : "Plane Instance";
  }
  const instanceId = inst.instance_id && inst.instance_id !== "dapp-instance" ? inst.instance_id : (inst.id && inst.id !== "dapp-instance" ? inst.id : "instance-main");
  return {
    instance: {
      ...inst,
      id: instanceId,
      instance_id: instanceId,
      instance_name: instanceName,
      created_at: inst.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      whitelist_emails: inst.whitelist_emails || null,
      license_key: null,
      current_version: "1.0.0",
      latest_version: "1.0.0",
      last_checked_at: new Date().toISOString(),
      namespace: null,
      is_telemetry_enabled: inst.is_telemetry_enabled ?? false,
      is_support_required: false,
      is_activated: true,
      is_setup_done: inst.is_setup_done !== undefined ? inst.is_setup_done : hasUsers,
      is_signup_screen_visited: true,
      user_count: (localDB.users || []).length,
      is_verified: true,
      created_by: null,
      updated_by: null,
      workspaces_exist: Boolean(localDB.workspaces && localDB.workspaces.length > 0),
    },
    config: {
      enable_signup: true,
      is_workspace_creation_disabled: false,
      is_google_enabled: false,
      is_github_enabled: false,
      is_gitlab_enabled: false,
      is_gitea_enabled: false,
      is_magic_login_enabled: false,
      is_email_password_enabled: true,
      github_app_name: null,
      slack_client_id: null,
      posthog_api_key: null,
      posthog_host: null,
      has_unsplash_configured: false,
      has_llm_configured: false,
      file_size_limit: 5242880,
      is_smtp_configured: false,
      app_base_url: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
      space_base_url: null,
      admin_base_url: typeof window !== "undefined" ? window.location.origin : "http://localhost:3001",
      is_self_managed: true,
      ...(localDB.config || {}),
    },
  };
}

function getUserProfile() {
  const activeUserId = getLoggedInUserId();
  const loggedInEmail = typeof window !== "undefined" ? localStorage.getItem("plane_dapp_auth_email") : null;
  const activeUser = (localDB.users || []).find((u: any) =>
    (activeUserId && u.id === activeUserId) ||
    (loggedInEmail && u.email?.toLowerCase() === loggedInEmail.toLowerCase())
  ) || localDB.users?.[0] || null;

  if (!activeUser) {
    return {
      id: "anonymous",
      user: "anonymous",
      role: "admin",
      last_workspace_id: "workspace-fiai",
      last_workspace_slug: "fiai",
      theme: { theme: "dark" },
      onboarding_step: { workspace_join: true, profile_complete: true, workspace_create: true, workspace_invite: true },
      is_onboarded: true,
      is_tour_completed: true,
      use_case: null,
      billing_address_country: null,
      billing_address: null,
      has_billing_address: false,
      has_marketing_email_consent: false,
      language: "en",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      start_of_the_week: 1,
    };
  }

  const userWorkspaces = localDB.workspaces || [];
  const firstWs = userWorkspaces[0] || null;

  return {
    id: activeUser.id,
    user: activeUser.id,
    role: "admin",
    last_workspace_id: activeUser.last_workspace_id || firstWs?.id || "workspace-fiai",
    last_workspace_slug: activeUser.last_workspace_slug || firstWs?.slug || "fiai",
    theme: activeUser.theme || { theme: "dark", primary: null, background: null, darkPalette: false },
    onboarding_step: {
      workspace_join: true,
      profile_complete: true,
      workspace_create: true,
      workspace_invite: true,
    },
    is_onboarded: true,
    is_tour_completed: true,
    use_case: null,
    billing_address_country: null,
    billing_address: null,
    has_billing_address: false,
    has_marketing_email_consent: false,
    language: "en",
    created_at: activeUser.date_joined || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    start_of_the_week: 1,
  };
}

function getUserSettings() {
  const activeUserId = getLoggedInUserId();
  const loggedInEmail = typeof window !== "undefined" ? localStorage.getItem("plane_dapp_auth_email") : null;
  const activeUser = (localDB.users || []).find((u: any) =>
    (activeUserId && u.id === activeUserId) ||
    (loggedInEmail && u.email?.toLowerCase() === loggedInEmail.toLowerCase())
  ) || localDB.users?.[0] || null;

  const localSlug = typeof window !== "undefined" ? localStorage.getItem("last_workspace_slug") : null;
  const userWorkspaces = (localDB.workspaces && localDB.workspaces.length > 0) ? localDB.workspaces : [DEFAULT_WORKSPACE];
  const currentWs = userWorkspaces.find((w: any) =>
    (localSlug && w.slug === localSlug) ||
    w.id === activeUser?.last_workspace_id ||
    w.slug === activeUser?.last_workspace_slug ||
    (loggedInEmail && w.owner?.email?.toLowerCase() === loggedInEmail.toLowerCase())
  ) || userWorkspaces[0] || DEFAULT_WORKSPACE;

  return {
    id: activeUser?.id || "anonymous",
    email: activeUser?.email || loggedInEmail || "",
    workspace: {
      last_workspace_id: currentWs?.id || "workspace-fiai",
      last_workspace_slug: currentWs?.slug || "fiai",
      last_workspace_name: currentWs?.name || "FIAI",
      last_workspace_logo: currentWs?.logo || null,
      fallback_workspace_id: currentWs?.id || "workspace-fiai",
      fallback_workspace_slug: currentWs?.slug || "fiai",
      invites: 0,
    },
  };
}

// ── Safe data parser (handles string, object, FormData) ──────────────────
function parseData(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && !(raw instanceof FormData)) return raw;
  return {};
}

// ── Route matcher ────────────────────────────────────────────────────────
type RouteResult = { data: any; status: number };

function handleRoute(method: string, url: string, body: Record<string, any>): RouteResult {
  console.log(`[Dapp interceptor] INTERCEPTED ${method.toUpperCase()} ${url}`);
  syncCrossPortWorkspaces();
  const activeUserId = getLoggedInUserId();
  const loggedInEmail = typeof window !== "undefined" ? localStorage.getItem("plane_dapp_auth_email") : null;
  let activeUser = (localDB.users || []).find((u: any) =>
    (activeUserId && u.id === activeUserId) ||
    (loggedInEmail && u.email?.toLowerCase() === loggedInEmail.toLowerCase())
  );
  if (!activeUser && activeUserId && loggedInEmail) {
    activeUser = createUserObject(activeUserId, loggedInEmail);
    if (!localDB.users) localDB.users = [];
    localDB.users.push(activeUser);
    saveDB();
  }

  // ── Workspace Slug Check (used by web:3000 and god-mode:3001) ───────
  if (url.includes("/api/workspace-slug-check") || url.includes("/api/instances/workspace-slug-check")) {
    const qsMatch = url.match(/[?&]slug=([^&]+)/);
    const slug = qsMatch ? decodeURIComponent(qsMatch[1]) : "";
    const exists = (localDB.workspaces || []).some((w: any) => w.slug?.toLowerCase() === slug.toLowerCase());
    return ok({ status: !exists });
  }

  // ── Auth endpoints ──────────────────────────────────────────────────
  if (url.includes("/auth/get-csrf-token")) return ok({ csrf_token: "dapp-csrf-token" });

  if (url.includes("/auth/email-check")) {
    const email = (body?.email || "").trim().toLowerCase();
    const existing = (localDB.users || []).some((u: any) => (u.email || "").toLowerCase() === email);
    return ok({ existing, is_password_autoset: false, status: "CREDENTIAL" });
  }

  if (url.includes("/auth/sign-in") || url.includes("/auth/sign-up") || url.includes("/auth/magic-sign-in")) {
    const email = (body?.email || loggedInEmail || "").trim();
    let user = (localDB.users || []).find((u: any) => u.email?.toLowerCase() === email.toLowerCase());

    if (!user && email) {
      user = createUserObject(`user-${Date.now()}`, email, body?.first_name, body?.last_name);
      if (!localDB.users) localDB.users = [];
      localDB.users.push(user);
      saveDB();
    }

    if (user) {
      setLoggedInUser(user.id);
      if (typeof window !== "undefined") localStorage.setItem("plane_dapp_auth_email", user.email);
      return ok({ ...user, access_token: "dapp-token", refresh_token: "dapp-refresh" });
    }
    return { data: { error: "User not found" }, status: 404 };
  }

  if (url.includes("/auth/forgot-password") || url.includes("/auth/set-password")) return ok({ message: "success" });

  if (url.includes("/auth/sign-out")) {
    setLoggedInUser(null);
    if (typeof window !== "undefined") localStorage.removeItem("plane_dapp_auth_email");
    return ok({ message: "success" });
  }

  // ── Instance ────────────────────────────────────────────────────────
  // ── Instance ────────────────────────────────────────────────────────
  if (url.match(/\/api\/instances\/?$/) || url.match(/\/api\/instances\/\?/)) {
    if (method === "patch" || method === "put" || method === "post") {
      if (!localDB.instance) localDB.instance = {};
      Object.assign(localDB.instance, body);
      saveDB();
    }
    return ok(getInstanceInfo());
  }

  if (url.includes("/api/instances/configurations")) return ok([]);

  if (url.includes("/api/instances/workspaces") && method === "get")
    return ok({ results: localDB.workspaces || [], next_cursor: null, prev_cursor: null, total_count: (localDB.workspaces || []).length });

  // ── Admin Auth & Management Endpoints ────────────────────────────────
  if (url.includes("/api/instances/admins/sign-out")) {
    setLoggedInUser(null);
    if (typeof window !== "undefined") localStorage.removeItem("plane_dapp_auth_email");
    return ok({ message: "success" });
  }

  if (url.includes("/api/instances/admins/sign-in")) {
    const email = (body?.email || loggedInEmail || "").trim();
    let user = (localDB.users || []).find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
    if (!user && email) {
      user = createUserObject(`admin-${Date.now()}`, email, body?.first_name, body?.last_name);
      if (!localDB.users) localDB.users = [];
      localDB.users.push(user);
      saveDB();
    }
    if (user) {
      setLoggedInUser(user.id);
      if (typeof window !== "undefined") localStorage.setItem("plane_dapp_auth_email", user.email);
      return ok(user);
    }
    return { data: { error: "User not found" }, status: 404 };
  }

  if (url.includes("/api/instances/admins/sign-up")) {
    const email = (body?.email || loggedInEmail || "").trim();
    let user = (localDB.users || []).find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
    if (user) {
      user.first_name = body?.first_name || user.first_name;
      user.last_name = body?.last_name || user.last_name;
      user.display_name = `${user.first_name} ${user.last_name}`.trim();
    } else {
      user = createUserObject(`admin-${Date.now()}`, email, body?.first_name, body?.last_name);
      if (!localDB.users) localDB.users = [];
      localDB.users.push(user);
    }
    const companyName = body?.company_name || body?.company || body?.instance_name;
    if (companyName) {
      if (!localDB.instance) localDB.instance = {};
      localDB.instance.instance_name = companyName;
    }
    if (!localDB.instance) localDB.instance = {};
    if (!localDB.instance.id || localDB.instance.id === "dapp-instance") {
      localDB.instance.id = `instance-${Date.now().toString(36)}`;
      localDB.instance.instance_id = localDB.instance.id;
    }
    localDB.instance.is_setup_done = true;
    saveDB();
    setLoggedInUser(user.id);
    if (typeof window !== "undefined") localStorage.setItem("plane_dapp_auth_email", user.email);
    return ok(user);
  }

  if (url.includes("/api/instances/admins/me")) {
    if (!isLoggedIn() || !activeUser) {
      return { data: { error: "not authenticated" }, status: 401 };
    }
    if (method === "patch" || method === "put" || method === "post") {
      Object.assign(activeUser, body);
      saveDB();
    }
    return ok(activeUser);
  }

  if (url.match(/\/api\/instances\/admins\/?$/) || url.match(/\/api\/instances\/admins\/\?/)) {
    let users = (localDB.users || []).filter((u: any) => u.id !== "me" && u.email !== "admin@plane.so");
    if (users.length === 0 && (loggedInEmail || activeUserId)) {
      const fallbackUser = createUserObject(activeUserId || `admin-${Date.now().toString(36)}`, loggedInEmail || "");
      users = [fallbackUser];
    }
    const adminList = users.map((u: any) => ({
      id: `admin-${u.id}`,
      instance: localDB.instance?.instance_id || "instance-main",
      role: "admin",
      user: u.id,
      user_detail: {
        id: u.id,
        first_name: u.first_name || "",
        last_name: u.last_name || "",
        email: u.email || loggedInEmail || "",
        display_name: u.display_name || u.email || loggedInEmail || "",
        avatar_url: u.avatar_url || "",
      },
      created_at: u.date_joined || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    return ok(adminList);
  }

  // ── Workspace Creation (both web /api/workspaces/ and admin /api/instances/workspaces/) ──
  if (
    (url.match(/\/api\/workspaces\/?$/) || url.match(/\/api\/instances\/workspaces\/?$/)) &&
    method === "post"
  ) {
    const wsId = body.id || crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11);
    const slug = body.slug || body.name?.toLowerCase().replace(/[^a-z0-9_-]/g, "-") || `ws-${Date.now()}`;
    const newWorkspace = {
      id: wsId,
      name: body.name || "My Workspace",
      slug: slug,
      organization_size: body.organization_size || "1-10",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: activeUser?.id || "admin",
      owner: {
        id: activeUser?.id || "admin",
        email: activeUser?.email || loggedInEmail || "",
        first_name: activeUser?.first_name || "Admin",
        last_name: activeUser?.last_name || "",
        avatar: activeUser?.avatar_url || "",
      },
      role: 20,
      ...body,
    };

    if (!localDB.workspaces) localDB.workspaces = [];
    const existingIdx = localDB.workspaces.findIndex((w: any) => w.id === wsId || w.slug === slug);
    if (existingIdx >= 0) {
      localDB.workspaces[existingIdx] = { ...localDB.workspaces[existingIdx], ...newWorkspace };
    } else {
      localDB.workspaces.push(newWorkspace);
    }

    if (!localDB.workspace_members) localDB.workspace_members = [];
    localDB.workspace_members.push({
      id: `ws-member-${Date.now()}`,
      workspace: wsId,
      workspace_id: wsId,
      member: activeUser?.id || "me",
      role: 20,
      is_active: true,
      created_at: new Date().toISOString(),
    });

    if (activeUser) {
      activeUser.last_workspace_id = wsId;
      activeUser.last_workspace_slug = slug;
      activeUser.is_onboarded = true;
      if (!activeUser.onboarding_step) activeUser.onboarding_step = {};
      activeUser.onboarding_step.workspace_create = true;
      activeUser.onboarding_step.profile_complete = true;
      activeUser.onboarding_step.workspace_join = true;
    }

    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("last_workspace_slug", slug);
        document.cookie = `last_workspace_slug=${slug}; path=/; max-age=31536000; SameSite=Lax`;
        document.cookie = `plane_dapp_sync_workspaces=${encodeURIComponent(JSON.stringify(localDB.workspaces))}; path=/; max-age=31536000; SameSite=Lax`;
      } catch (e) {
        console.warn("[DApp Workspace] Không thể lưu cookies:", e);
      }
    }

    // GỌI SMART CONTRACT: PlaneWorkspaceRegistry.createWorkspace
    const bridge = getFiaiSDK();
    if (WORKSPACE_REGISTRY_ADDRESS && bridge && currentUserAddress) {
      const initialCid = baseCID || "QmInitial";
      bridge
        .request("sendTransaction", {
          from: currentUserAddress,
          to: WORKSPACE_REGISTRY_ADDRESS,
          abiData: [CREATE_WORKSPACE_ABI],
          functionName: "createWorkspace",
          feeType: "sc",
          amount: "0",
          value: "0",
          gas: "3000000",
          type: "transaction",
          inputArray: [
            { name: "slug", type: "string", value: slug },
            { name: "name", type: "string", value: newWorkspace.name },
            { name: "initialCid", type: "string", value: initialCid },
          ],
          isReadOnly: false,
          bundleId: "",
        })
        .then(() => {
          console.log(`[DApp Workspace] ✅ Đã tạo workspace ${slug} on-chain trên PlaneWorkspaceRegistry`);
          return true;
        })
        .catch((err: any) => {
          console.warn(`[DApp Workspace] createWorkspace on-chain thất bại (có thể đã tồn tại):`, err);
        });
    }

    saveDB();
    return { data: newWorkspace, status: 201 };
  }

  if (url.match(/\/api\/users\/me/)) {
    if (!isLoggedIn()) return { data: { error: "not authenticated" }, status: 401 };

    if (url.includes("/api/users/me/profile")) {
      if (method === "patch" || method === "put" || method === "post") {
        Object.assign(activeUser, body);
        saveDB();
      }
      return ok(getUserProfile());
    }

    if (url.includes("/api/users/me/settings")) {
      if ((method === "patch" || method === "put" || method === "post") && body?.workspace) {
        if (body.workspace.last_workspace_slug && activeUser) {
          activeUser.last_workspace_slug = body.workspace.last_workspace_slug;
          if (typeof window !== "undefined") {
            localStorage.setItem("last_workspace_slug", body.workspace.last_workspace_slug);
            document.cookie = `last_workspace_slug=${body.workspace.last_workspace_slug}; path=/; max-age=31536000; SameSite=Lax`;
          }
        }
        if (body.workspace.last_workspace_id && activeUser) {
          activeUser.last_workspace_id = body.workspace.last_workspace_id;
        }
        saveDB();
      }
      return ok(getUserSettings());
    }

    if (url.includes("/api/users/me/instance-admin")) return ok({ is_instance_admin: true });

    if (url.includes("/api/users/me/accounts")) return ok([]);

    if (url.includes("/api/users/me/notification-preferences")) return ok({});

    if (url.includes("/project-roles")) return ok({}); // return empty object for project roles

    if (url.includes("/api/users/me/workspaces") && !url.includes("/project-roles") && !url.includes("/invitations")) {
      syncCrossPortWorkspaces();
      const workspaces = localDB.workspaces || [];
      return ok(workspaces.map((ws: any) => ({ ...ws, role: 20 })));
    }

    if (url.includes("/api/users/me/workspaces/invitations") || url.includes("/api/users/me/invitations")) {
      return ok([]);
    }

    if (method === "patch" || method === "put" || method === "post") {
      Object.assign(activeUser, body);
      saveDB();
    }
    return ok(activeUser);
  }

  // ── Projects & Workspace Members ────────────────────────────────────
  if (method === "get" && url.match(/\/api\/workspaces\/[^/]+\/workspace-members\/me\/?/)) {
    const wsSlug = url.match(/\/api\/workspaces\/([^/]+)\/workspace-members\/me\/?/)?.[1] || "";
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
    return ok({
      id: "ws-member-me",
      member: activeUser?.id || "me",
      role: 20, // Admin role
      workspace: ws?.id || wsSlug,
      is_active: true,
      created_at: new Date().toISOString(),
    });
  }

  if (url.match(/\/api\/workspaces\/[^/]+\/members\/?(?:\?.*)?$/)) {
    const wsSlug = url.match(/\/api\/workspaces\/([^/]+)\/members\/?/)?.[1] || "";
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);

    if (method === "get") {
      const membersList: any[] = [
        {
          id: "ws-member-me",
          member: activeUser || { id: "anonymous", email: "", first_name: "User", last_name: "", display_name: "User" },
          role: 20,
          workspace: ws?.id || wsSlug,
          is_active: true,
          created_at: new Date().toISOString(),
        },
      ];

      const additionalMembers = (localDB.workspace_members || []).filter(
        (m: any) =>
          (m.workspace === wsSlug || m.workspace === ws?.id || m.workspace_id === wsSlug || m.workspace_id === ws?.id) &&
          m.id !== "ws-member-me" &&
          m.member !== (activeUser?.id || "me")
      );

      additionalMembers.forEach((wm: any) => {
        const user = (localDB.users || []).find(
          (u: any) => u.id === wm.member || u.email === wm.member || u.username === wm.member
        );
        const memberKey = String(wm.member || wm.email || wm.id || "");
        const isEth = memberKey.startsWith("0x");
        const shortAddr = isEth ? `${memberKey.slice(0, 6)}...${memberKey.slice(-4)}` : "Member";
        membersList.push({
          id: wm.id,
          member: user || {
            id: wm.member || wm.id,
            email: wm.email || (isEth ? `${memberKey}@fiai.network` : memberKey),
            first_name: wm.first_name || shortAddr,
            last_name: wm.last_name || "",
            display_name: wm.display_name || shortAddr,
            avatar_url: "",
            is_active: true,
          },
          role: wm.role || 15,
          workspace: ws?.id || wsSlug,
          is_active: wm.is_active !== false,
          created_at: wm.created_at || new Date().toISOString(),
        });
      });

      return ok(membersList);
    }
  }

  // ── Workspace Member Detail (DELETE, PATCH) ─────────────────────────
  const wsMemberDetailMatch = url.match(/\/api\/workspaces\/([^/]+)\/members\/([^/]+)\/?(?:\?.*)?$/);
  if (wsMemberDetailMatch) {
    const wsSlug = wsMemberDetailMatch[1];
    const memberId = wsMemberDetailMatch[2];

    if (method === "delete") {
      const target = (localDB.workspace_members || []).find((m: any) => m.id === memberId || m.member === memberId);
      if (localDB.workspace_members) {
        localDB.workspace_members = localDB.workspace_members.filter(
          (m: any) => m.id !== memberId && m.member !== memberId
        );
        saveDB();
      }

      const memberAddr = extractEthAddress(target?.address || target?.member || target?.email);
      const bridge = getFiaiSDK();
      if (memberAddr && WORKSPACE_REGISTRY_ADDRESS && bridge && currentUserAddress) {
        bridge
          .request("sendTransaction", {
            from: currentUserAddress,
            to: WORKSPACE_REGISTRY_ADDRESS,
            abiData: [REMOVE_MEMBER_ABI],
            functionName: "removeMember",
            feeType: "sc",
            amount: "0",
            value: "0",
            gas: "2000000",
            type: "transaction",
            inputArray: [
              { name: "slug", type: "string", value: wsSlug },
              { name: "member", type: "address", value: memberAddr },
            ],
            isReadOnly: false,
            bundleId: "",
          })
          .then(() => {
            console.log(`[DApp Interceptor] ✅ Đã xóa thành viên ${memberAddr} khỏi ${wsSlug} on-chain`);
            return true;
          })
          .catch((err: any) => {
            console.warn(`[DApp Interceptor] removeMember on-chain thất bại:`, err);
          });
      }

      return ok({ message: "Member removed" });
    }

    if (method === "patch" || method === "put") {
      let updatedMember: any = null;
      if (localDB.workspace_members) {
        const idx = localDB.workspace_members.findIndex((m: any) => m.id === memberId || m.member === memberId);
        if (idx >= 0) {
          localDB.workspace_members[idx] = { ...localDB.workspace_members[idx], ...body };
          updatedMember = localDB.workspace_members[idx];
          saveDB();
        }
      }

      if (updatedMember && body.role !== undefined) {
        const memberAddr = extractEthAddress(updatedMember.address || updatedMember.member || updatedMember.email);
        const bridge = getFiaiSDK();
        if (memberAddr && WORKSPACE_REGISTRY_ADDRESS && bridge && currentUserAddress) {
          const contractRole = mapPlaneRoleToContractRole(body.role);
          bridge
            .request("sendTransaction", {
              from: currentUserAddress,
              to: WORKSPACE_REGISTRY_ADDRESS,
              abiData: [ADD_MEMBER_ABI],
              functionName: "addMember",
              feeType: "sc",
              amount: "0",
              value: "0",
              gas: "2000000",
              type: "transaction",
              inputArray: [
                { name: "slug", type: "string", value: wsSlug },
                { name: "member", type: "address", value: memberAddr },
                { name: "role", type: "uint8", value: String(contractRole) },
              ],
              isReadOnly: false,
              bundleId: "",
            })
            .catch((err: any) => {
              console.warn(`[DApp Interceptor] Cập nhật role on-chain thất bại:`, err);
            });
        }
      }

      return ok(updatedMember || { id: memberId, ...body });
    }
  }

  if (
    method === "get" &&
    (url.match(/\/api\/workspaces\/[^/]+\/projects\/?(?:\?.*)?$/) || url.includes("/projects/details"))
  ) {
    const deletedSet = new Set(localDB._deleted_project_ids || []);
    const projects = (localDB.projects || [])
      .filter((p: any) => !deletedSet.has(p.id) && !deletedSet.has(p.identifier))
      .map((p: any) => {
        // Calculate next_work_item_sequence from actual issues
        const projectIssues = (localDB.issues || []).filter((i: any) => i.project === p.id || i.project_id === p.id);
        const maxSeq = projectIssues.reduce((max: number, i: any) => Math.max(max, i.sequence_id || 0), 0);
        return {
          ...p,
          next_work_item_sequence: maxSeq + 1,
        };
      });
    return ok(projects);
  }

  // ── Project Detail (GET, PATCH, DELETE) ──────────────────────────────
  const projectDetailMatch = url.match(/\/api\/workspaces\/[^/]+\/projects\/([^/]+)\/?(?:\?.*)?$/);
  if (projectDetailMatch) {
    const projectId = projectDetailMatch[1];
    if (projectId !== "details" && projectId !== "project-identifiers" && projectId !== "search") {
      const deletedSet = new Set(localDB._deleted_project_ids || []);
      const projectIdx = (localDB.projects || []).findIndex(
        (p: any) => p.id === projectId || p.identifier === projectId
      );
      if (projectIdx > -1 && !deletedSet.has(localDB.projects[projectIdx].id)) {
        if (method === "get") {
          return ok(localDB.projects[projectIdx]);
        }
        if (method === "patch" || method === "put") {
          localDB.projects[projectIdx] = {
            ...localDB.projects[projectIdx],
            ...body,
            updated_at: new Date().toISOString(),
          };
          saveDB();
          syncDAppRecord("projects", projectId, localDB.projects[projectIdx]);
          return ok(localDB.projects[projectIdx]);
        }
        if (method === "delete") {
          const targetProj = localDB.projects[projectIdx];
          const targetId = targetProj?.id || projectId;

          if (!localDB._deleted_project_ids) localDB._deleted_project_ids = [];
          if (!localDB._deleted_project_ids.includes(targetId)) {
            localDB._deleted_project_ids.push(targetId);
          }
          if (targetProj?.identifier && !localDB._deleted_project_ids.includes(targetProj.identifier)) {
            const otherUsingSameIdentifier = (localDB.projects || []).some(
              (p: any) => p.id !== targetId && p.identifier === targetProj.identifier
            );
            if (!otherUsingSameIdentifier) {
              localDB._deleted_project_ids.push(targetProj.identifier);
            }
          }

          const currentDeleted = new Set(localDB._deleted_project_ids);
          localDB.projects = (localDB.projects || []).filter(
            (p: any) => p.id !== targetId && !currentDeleted.has(p.id)
          );

          if (localDB.issues) {
            localDB.issues = localDB.issues.filter(
              (i: any) => i.project !== targetId && i.project_id !== targetId
            );
          }
          if (localDB.states) {
            localDB.states = localDB.states.filter(
              (s: any) => s.project !== targetId && s.project_id !== targetId
            );
          }
          if (localDB.labels) {
            localDB.labels = localDB.labels.filter(
              (l: any) => l.project !== targetId && l.project_id !== targetId
            );
          }
          if (localDB.cycles) {
            localDB.cycles = localDB.cycles.filter(
              (c: any) => c.project !== targetId && c.project_id !== targetId
            );
          }
          if (localDB.modules) {
            localDB.modules = localDB.modules.filter(
              (m: any) => m.project !== targetId && m.project_id !== targetId
            );
          }
          if (localDB.project_members) {
            localDB.project_members = localDB.project_members.filter(
              (pm: any) => pm.project !== targetId && pm.project_id !== targetId
            );
          }

          saveDB();
          return ok({});
        }
      } else if (method === "get") {
        return { data: { error: "Project not found" }, status: 404 };
      }
    }
  }

  // ── Project Members ──────────────────────────────────────────────────
  if (method === "get" && url.match(/\/api\/workspaces\/[^/]+\/projects\/[^/]+\/project-members\/me\/?/)) {
    return ok({
      id: "mock-proj-member-me",
      member: activeUser?.id,
      role: 20, // Admin role
    });
  }

  if (method === "get" && url.match(/\/api\/workspaces\/[^/]+\/projects\/[^/]+\/members\/?(?:\?.*)?$/)) {
    return ok([
      {
        id: "mock-proj-member-me",
        member: activeUser?.id,
        role: 20,
      },
    ]);
  }

  // ── Project Archive / Restore ────────────────────────────────────────
  const archiveMatch = url.match(/\/api\/workspaces\/[^/]+\/projects\/([^/]+)\/archive\/?$/);
  if (archiveMatch) {
    const projectId = archiveMatch[1];
    const project = localDB.projects?.find((p: any) => p.id === projectId);
    if (project) {
      if (method === "post") {
        project.archived_at = new Date().toISOString();
      } else if (method === "delete") {
        project.archived_at = null;
      }
      saveDB();
      syncDAppRecord("projects", projectId, project);
      return ok(project);
    }
    console.log("404 for URL:", url, "method:", method);
    return { data: null, status: 404 };
  }

  // ── Recent Visits & Favorites ────────────────────────────────────────
  if (method === "get" && url.match(/\/api\/workspaces\/[^/]+\/recent-visits\/?(?:\?.*)?$/)) {
    return ok(localDB["recent-visits"] || []);
  }

  if (method === "get" && url.match(/\/api\/workspaces\/[^/]+\/user-favorites\/?(?:\?.*)?$/)) {
    return ok(localDB.favorites || []);
  }

  // Assets v2 bulk status update
  if (url.match(/\/api\/assets\/v2\/.*\/bulk\/?/) && method === "post") {
    return ok({ success: true, asset_ids: body?.asset_ids || [] });
  }

  // Assets v2
  if (url.match(/\/api\/assets\/v2\//) && method === "post") {
    const assetId = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const issueMatch = url.match(/\/(issues|work-items|epics)\/([^\/]+)\/attachments/);
    const issueId = issueMatch ? issueMatch[2] : null;
    if (issueId) {
      if (!localDB["attachments"]) localDB["attachments"] = [];
      localDB["attachments"].push({
        id: assetId,
        asset_id: assetId,
        issue: issueId,
        is_uploaded: false,
        attributes: { name: body?.name || "mock_file.png", size: body?.size || 1024 }
      });
      saveDB();
    }
    return ok({
      asset_id: assetId,
      asset_url: `mock_asset_url_${assetId}`,
      upload_data: {
        url: "mock_upload_url",
        fields: {
          "Content-Type": "image/jpeg",
          key: "mock_key",
          "x-amz-algorithm": "mock_algo",
          "x-amz-credential": "mock_cred",
          "x-amz-date": "mock_date",
          policy: "mock_policy",
          "x-amz-signature": "mock_sig",
        },
      },
    });
  }

  if (url.match(/\/api\/assets\/v2\//) && method === "patch") {
    const assetMatch = url.match(/\/attachments\/([^/]+)\/?/); const assetId = assetMatch ? assetMatch[1] : null; const attachment = (localDB["attachments"] || []).find((a: any) => a.id === assetId || a.asset_id === assetId); if (attachment) { attachment.is_uploaded = true; saveDB(); return ok(attachment); } return ok({ success: true });
  }

  // ── Issue sub-resource endpoints ─────────────────────────────────────
  // subscribe
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/subscribe\/?(?:\?.*)?$/)) {
    if (method === "get") return ok({ subscribed: false });
    if (method === "post") return ok({ subscribed: true });
    if (method === "delete") return ok({ subscribed: false });
  }

  // history / activity — serves both activities and comments depending on activity_type query param
  const historyMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/history\/?(?:\?.*)?$/);
  if (historyMatch && method === "get") {
    const issueId = historyMatch[2];
    // Parse activity_type from query string
    const qsMatch = url.match(/[?&]activity_type=([^&]+)/);
    const activityType = qsMatch ? decodeURIComponent(qsMatch[1]) : null;

    if (activityType === "issue-comment" || activityType === "epic-comment") {
      // Return comments for this issue, formatted as the store expects (TIssueComment)
      const comments = (localDB.comments || []).filter((c: any) => c.issue === issueId || c.issue_id === issueId);
      const issue = (localDB.issues || []).find((i: any) => i.id === issueId);
      const enrichedComments = comments.map((c: any) => ({
        id: c.id,
        issue: issueId,
        issue_detail: issue ? { id: issue.id, name: issue.name, sequence_id: issue.sequence_id } : null,
        comment_html: c.comment_html || c.body || "",
        comment_stripped: c.comment_stripped || "",
        comment_json: c.comment_json || null,
        actor: c.actor || "me",
        actor_detail: c.actor_detail || {
          id: "me",
          first_name: "Plane",
          last_name: "Admin",
          is_bot: false,
          display_name: "Plane Admin",
          avatar: "",
        },
        created_at: c.created_at,
        updated_at: c.updated_at || c.created_at,
        edited_at: c.edited_at || null,
        comment_reactions: c.comment_reactions || [],
        is_member: true,
        external_source: c.external_source || null,
        workspace: c.workspace || issue?.workspace,
        project: c.project || issue?.project,
        project_id: c.project_id || c.project || issue?.project,
        workspace_id: c.workspace_id || c.workspace || issue?.workspace,
        access: c.access || "INTERNAL",
      }));
      return ok(enrichedComments);
    }

    // Default: return activity history (issue-property type)
    const history = (localDB.history || []).filter((h: any) => h.issue === issueId || h.issue_id === issueId);
    return ok(history);
  }

  // comments
  const commentMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/comments\/?(?:\?.*)?$/);
  if (commentMatch) {
    const issueId = commentMatch[2];
    if (method === "get") {
      const comments = (localDB.comments || []).filter((c: any) => c.issue === issueId || c.issue_id === issueId);
      const issue = localDB.issues?.find((i: any) => i.id === issueId);
      const enrichedComments = comments.map((c: any) => ({
        ...c,
        issue_id: issueId,
        project_id: c.project_id || c.project || issue?.project,
        workspace_id: c.workspace_id || c.workspace || issue?.workspace,
        actor: c.actor || "me",
        actor_detail: { id: "me", first_name: "Plane", last_name: "Admin", is_bot: false, display_name: "Plane Admin" },
      }));
      return ok(enrichedComments);
    }
    if (method === "post") {
      const issue = localDB.issues?.find((i: any) => i.id === issueId);
      const urlWsMatch = url.match(/\/api\/workspaces\/([^/]+)\//);
      const urlProjMatch = url.match(/\/projects\/([^/]+)\//);
      const wsSlug = urlWsMatch ? urlWsMatch[1] : issue?.workspace || localDB.workspaces?.[0]?.slug || "";
      const projId = urlProjMatch ? urlProjMatch[1] : issue?.project || "mock-project";

      const newComment = {
        id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
        issue: issueId,
        issue_id: issueId,
        project_id: projId,
        workspace_id: wsSlug,
        project: projId,
        workspace: wsSlug,
        actor: "me",
        actor_detail: {
          id: "me",
          first_name: "Plane",
          last_name: "Admin",
          is_bot: false,
          display_name: "Plane Admin",
          avatar: "",
        },
        access: "EXTERNAL",
        reaction_groups: {},
        created_by: "me",
        updated_by: "me",
        comment_html: "",
        comment_json: {},
        comment_stripped: "",
        ...body,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (!localDB.comments) localDB.comments = [];
      localDB.comments.push(newComment);
      saveDB();
      return ok(newComment);
    }
    if (method === "delete") {
      if (localDB.comments) {
        const commentIdMatch = url.match(/\/comments\/([^/]+)\/?(?:\?.*)?$/);
        if (commentIdMatch) {
          const commentId = commentIdMatch[1];
          localDB.comments = localDB.comments.filter((c: any) => c.id !== commentId);
          saveDB();
        }
      }
      return ok({});
    }
  }

  // reactions
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/reactions\/?(?:\?.*)?$/)) {
    if (method === "get") return ok([]);
    if (method === "post") return ok({ id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11), ...body });
    if (method === "delete") return ok({});
  }

  // sub-issues
  const subIssuesMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/sub-issues\/?(?:\?.*)?$/);
  if (subIssuesMatch) {
    if (method === "get") {
      const parentId = subIssuesMatch[2];
      const subIssues = (localDB.issues || []).filter((i: any) => i.parent_id === parentId || i.parent === parentId);

      const enrichedSubIssues = subIssues.map((item: any) => {
        const children = (localDB.issues || []).filter((i: any) => i.parent_id === item.id || i.parent === item.id);
        const stateDetail = item.state_detail || (localDB.states || []).find((s: any) => s.id === (item.state_id || item.state));
        const projectDetail = item.project_detail || (localDB.projects || []).find((p: any) => p.id === (item.project_id || item.project));
        return {
          ...item,
          state_detail: stateDetail,
          project_detail: projectDetail,
          sub_issues_count: children.length
        };
      });
      return ok({ sub_issues: enrichedSubIssues, state_distribution: {} });
    }
    if (method === "post") {
      const parentId = subIssuesMatch[2];
      const subIssueIds = body.sub_issue_ids || [];

      let updatedSubIssues: any[] = [];
      if (localDB.issues) {
        localDB.issues = localDB.issues.map((i: any) => {
          if (subIssueIds.includes(i.id)) {
            const updated = { ...i, parent_id: parentId, parent: parentId };
            updatedSubIssues.push(updated);
            return updated;
          }
          return i;
        });

        const parentIdx = localDB.issues.findIndex((i: any) => i.id === parentId);
        if (parentIdx > -1) {
          localDB.issues[parentIdx].sub_issues_count = (localDB.issues[parentIdx].sub_issues_count || 0) + updatedSubIssues.length;
        }
        saveDB();
      }

      return ok({ sub_issues: updatedSubIssues, state_distribution: {} });
    }
  }

  // issue-relation
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/issue-relation\/?(?:\?.*)?$/)) {
    if (method === "get") return ok({});
    if (method === "post") return ok({ ...body });
  }

  // links
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/links\/?(?:\?.*)?$/)) {
    if (method === "get") return ok([]);
    if (method === "post") return ok({ id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11), ...body });
  }

  // attachments
  const attachmentsMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/attachments\/?(?:\?.*)?$/);
  if (attachmentsMatch) {
    const issueId = attachmentsMatch[2];
    if (method === "get") {
      const attachments = (localDB["attachments"] || []).filter((a: any) => a.issue === issueId || a.issue_id === issueId);
      return ok(attachments);
    }
  }

  // description-versions
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/description-versions\/?(?:\?.*)?$/)) {
    return ok([]);
  }

  // modules endpoint for an issue
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/modules\/?(?:\?.*)?$/)) {
    if (method === "get") return ok([]);
    if (method === "post") return ok({ ...body });
  }


  // search-issues endpoint — delegate to handleCRUD
  if (url.includes("/search-issues") || url.includes("search-issues")) {
    return handleCRUD(method, url, body);
  }
  // ── Generic CRUD ────────────────────────────────────────────────────
  return handleCRUD(method, url, body);
}

// ── Generic CRUD handler ─────────────────────────────────────────────────
function handleCRUD(method: string, url: string, body: Record<string, any>): RouteResult {
  let { collection, id, isPaginated } = parseApiUrl(url);
  console.log(
    `[DApp CRUD] ${method.toUpperCase()} collection=${collection}, id=${id}, isPaginated=${isPaginated}, url=${url}`
  );

  // Handle search-issues directly — return ISearchIssueResponse[] format
  if (collection === "search-issues" && method === "get") {
    const urlObj = new URL(url, "http://localhost");
    const searchTerm = (urlObj.searchParams.get("search") || "").toLowerCase();
    const workspaceSearch = urlObj.searchParams.get("workspace_search") === "true";

    let list = [...(localDB.issues || [])];
    console.log(`[DApp CRUD] search-issues: total issues in DB = ${list.length}`);

    // Filter by project if not workspace-level search
    if (!workspaceSearch) {
      const projMatch = url.match(/\/projects\/([^/]+)\//);
      if (projMatch) {
        const projId = projMatch[1];
        list = list.filter((item: any) => item.project === projId || item.project_id === projId);
        console.log(`[DApp CRUD] search-issues: after project filter for ${projId} = ${list.length}`);
      }
    }

    // Filter by search term
    if (searchTerm) {
      list = list.filter((item: any) => (item.name || "").toLowerCase().includes(searchTerm));
    }

    // Map to ISearchIssueResponse format
    const results = list.map((item: any) => {
      const stateDetail =
        item.state_detail || (localDB.states || []).find((s: any) => s.id === (item.state_id || item.state));
      const projectDetail =
        item.project_detail || (localDB.projects || []).find((p: any) => p.id === (item.project_id || item.project));
      return {
        id: item.id,
        name: item.name || "",
        project_id: item.project_id || item.project,
        project__identifier: projectDetail?.identifier || "PROJ",
        project__name: projectDetail?.name || "Project",
        sequence_id: item.sequence_id || 0,
        start_date: item.start_date || null,
        state__color: stateDetail?.color || "#a3a3a3",
        state__group: stateDetail?.group || "backlog",
        state__name: stateDetail?.name || "Backlog",
        workspace__slug: item.workspace || localDB.workspaces?.[0]?.slug || "fiai",
        type_id: item.type_id || item.type || null,
      };
    });

    console.log(`[DApp CRUD] search-issues returning ${results.length} results`);
    return ok(results);
  }

  // Alias work-items / issues-detail / work-items-detail to issues
  if (
    collection === "work-items" ||
    collection === "issues-detail" ||
    collection === "work-items-detail" ||
    collection === "search-issues"
  ) {
    collection = "issues";
  }

  // Sub-resource collections that don't have persistent storage — return empty stubs
  const subResourceCollections = [
    "history",
    "comments",
    "reactions",
    "sub-issues",
    "issue-relation",
    "links",
    "subscriptions",
    "description-versions",
    "archive",
  ];
  if (subResourceCollections.includes(collection) && !localDB[collection]?.length) {
    if (method === "get") {
      return ok([]);
    }
  }

  if (collection === "advance-analytics" && method === "get") {
    const issues = localDB.issues || [];
    const states = localDB.states || [];
    const projectIdMatch = url.match(/\/projects\/([^/]+)/);
    const projectId = projectIdMatch ? projectIdMatch[1] : null;

    let filteredIssues = issues;
    if (projectId) {
      filteredIssues = issues.filter((i: any) => i.project_id === projectId || i.project === projectId);
    }

    let started = 0;
    let backlog = 0;
    let unstarted = 0;
    let completed = 0;

    filteredIssues.forEach((issue: any) => {
      const stateId = issue.state_id || issue.state;
      const state = states.find((s: any) => s.id === stateId);
      if (state) {
        if (state.group === "started") started++;
        else if (state.group === "backlog") backlog++;
        else if (state.group === "unstarted") unstarted++;
        else if (state.group === "completed" || state.group === "done") completed++;
      }
    });

    return ok({
      total_work_items: { count: filteredIssues.length },
      started_work_items: { count: started },
      backlog_work_items: { count: backlog },
      un_started_work_items: { count: unstarted },
      completed_work_items: { count: completed }
    });
  }

  if (collection === "advance-analytics-stats" && method === "get") {
    const isPeekView = url.includes("/projects/");
    const projectIdMatch = url.match(/\/projects\/([^/]+)/);
    const projectId = projectIdMatch ? projectIdMatch[1] : null;

    const issues = localDB.issues || [];
    const states = localDB.states || [];
    const users = localDB.users || [];
    const projects = localDB.projects || [];

    let filteredIssues = issues;
    if (isPeekView && projectId) {
      filteredIssues = issues.filter((i: any) => i.project_id === projectId || i.project === projectId);
    }

    if (isPeekView) {
      // Group by assignee
      const assigneeMap: Record<string, any> = {};

      filteredIssues.forEach((issue: any) => {
        let assignees = issue.assignee_ids || issue.assignees || [];
        if (!Array.isArray(assignees)) assignees = [assignees];
        if (assignees.length === 0) assignees = ["unassigned"];

        assignees.forEach((assigneeId: string) => {
          if (!assigneeMap[assigneeId]) {
            let displayName = "Unassigned";
            let avatarUrl = "";
            if (assigneeId !== "unassigned") {
              const user = users.find((u: any) => u.id === assigneeId);
              if (user) {
                displayName = user.display_name || user.first_name || user.name || "User";
                avatarUrl = user.avatar || user.avatar_url || "";
              }
            } else {
              displayName = null as any; // Table displays 'Unassigned' if null
            }
            assigneeMap[assigneeId] = {
              display_name: displayName,
              avatar_url: avatarUrl,
              backlog_work_items: 0,
              started_work_items: 0,
              un_started_work_items: 0,
              completed_work_items: 0,
              cancelled_work_items: 0
            };
          }

          const stateId = issue.state_id || issue.state;
          const state = states.find((s: any) => s.id === stateId);
          if (state) {
            if (state.group === "started") assigneeMap[assigneeId].started_work_items++;
            else if (state.group === "backlog") assigneeMap[assigneeId].backlog_work_items++;
            else if (state.group === "unstarted") assigneeMap[assigneeId].un_started_work_items++;
            else if (state.group === "completed" || state.group === "done") assigneeMap[assigneeId].completed_work_items++;
            else if (state.group === "cancelled") assigneeMap[assigneeId].cancelled_work_items++;
          }
        });
      });

      return ok(Object.values(assigneeMap));
    } else {
      // Group by project
      const projectMap: Record<string, any> = {};
      filteredIssues.forEach((issue: any) => {
        const pid = issue.project_id || issue.project || "unassigned";
        if (!projectMap[pid]) {
          let projectName = "Unknown Project";
          if (pid !== "unassigned") {
            const proj = projects.find((p: any) => p.id === pid);
            if (proj) projectName = proj.name;
          }
          projectMap[pid] = {
            project__name: projectName,
            backlog_work_items: 0,
            started_work_items: 0,
            un_started_work_items: 0,
            completed_work_items: 0,
            cancelled_work_items: 0
          };
        }

        const stateId = issue.state_id || issue.state;
        const state = states.find((s: any) => s.id === stateId);
        if (state) {
          if (state.group === "started") projectMap[pid].started_work_items++;
          else if (state.group === "backlog") projectMap[pid].backlog_work_items++;
          else if (state.group === "unstarted") projectMap[pid].un_started_work_items++;
          else if (state.group === "completed" || state.group === "done") projectMap[pid].completed_work_items++;
          else if (state.group === "cancelled") projectMap[pid].cancelled_work_items++;
        }
      });

      return ok(Object.values(projectMap));
    }
  }

  if (collection === "advance-analytics-charts" && method === "get") {
    const params = new URLSearchParams(url.split("?")[1] || "");
    const type = params.get("type") || "work-items";
    const xAxis = params.get("x_axis");

    const issues = localDB.issues || [];
    const states = localDB.states || [];
    const users = localDB.users || [];

    const projectIdMatch = url.match(/\/projects\/([^/]+)/);
    const projectId = projectIdMatch ? projectIdMatch[1] : null;

    let filteredIssues = issues;
    if (projectId) {
      filteredIssues = issues.filter((i: any) => i.project_id === projectId || i.project === projectId);
    }

    if (type === "work-items") {
      // Created vs Resolved grouped by date
      const dateMap: Record<string, any> = {};

      filteredIssues.forEach((issue: any) => {
        if (issue.created_at) {
          const createdDate = issue.created_at.split("T")[0];
          if (!dateMap[createdDate]) dateMap[createdDate] = { created_issues: 0, completed_issues: 0 };
          dateMap[createdDate].created_issues++;
        }

        const stateId = issue.state_id || issue.state;
        const state = states.find((s: any) => s.id === stateId);
        if (state && (state.group === "completed" || state.group === "done")) {
          const completedDate = (issue.completed_at || issue.updated_at || issue.created_at).split("T")[0];
          if (!dateMap[completedDate]) dateMap[completedDate] = { created_issues: 0, completed_issues: 0 };
          dateMap[completedDate].completed_issues++;
        }
      });

      const mockData = Object.keys(dateMap).sort().map(dateStr => {
        return {
          key: dateStr,
          name: dateStr,
          count: dateMap[dateStr].created_issues + dateMap[dateStr].completed_issues,
          created_issues: dateMap[dateStr].created_issues,
          completed_issues: dateMap[dateStr].completed_issues
        };
      });

      const schema = { created_issues: "Created", completed_issues: "Completed", count: "Count" };
      return ok({ data: mockData, schema });

    } else {
      // Group by x_axis dynamically
      let mockDataMap: Record<string, any> = {};
      let schema: Record<string, string> = { count: "Count" };

      filteredIssues.forEach((issue: any) => {
        let key = "unknown";
        let name = "Unknown";

        if (xAxis === "priority") {
          key = issue.priority || "none";
          name = (key === "none") ? "None" : key;
        } else if (xAxis === "state_id" || xAxis === "state__group") {
          const stateId = issue.state_id || issue.state;
          const state = states.find((s: any) => s.id === stateId);
          if (state) {
            key = xAxis === "state__group" ? state.group : state.name;
            name = state.name;
          }
        } else if (xAxis === "assignees__id") {
          let assignees = issue.assignee_ids || issue.assignees || [];
          if (!Array.isArray(assignees)) assignees = [assignees];
          if (assignees.length === 0) assignees = ["unassigned"];

          if (assignees.length > 0) {
            key = assignees[0];
            if (key === "unassigned") {
              name = "Unassigned";
            } else {
              const user = users.find((u: any) => u.id === key);
              name = user ? (user.display_name || user.first_name || user.name || "User") : key;
            }
          }
        } else if (xAxis === "labels__id") {
          const labels = Array.isArray(issue.labels) ? issue.labels : (issue.label_ids || []);
          if (labels.length > 0) {
            key = labels[0];
            name = "Label " + key; // Simplified for mock
          } else {
            key = "none";
            name = "None";
          }
        }

        if (!mockDataMap[key]) {
          mockDataMap[key] = { key, name, count: 0 };
        }
        mockDataMap[key].count++;

        // Also populate the key in the schema
        if (!schema[key]) {
          schema[key] = name;
        }
        if (mockDataMap[key][key] === undefined) {
          mockDataMap[key][key] = 0;
        }
        mockDataMap[key][key]++;
      });

      return ok({ data: Object.values(mockDataMap), schema });
    }
  }
  if (collection === "user-properties" && method === "get") {
    return ok({
      display_filters: { layout: "list" },
      display_properties: {
        assignee: true,
        attachment_count: true,
        created_on: true,
        due_date: true,
        estimate: true,
        key: true,
        labels: true,
        link: true,
        priority: true,
        start_date: true,
        state: true,
        sub_issue_count: true,
        updated_on: true,
      },
    });
  }

  if (!localDB[collection]) localDB[collection] = [];

  // Auto-fix missing sequence_id and project_detail for existing issues
  if (collection === "issues") {
    let saveNeeded = false;
    const projectSeqMap: Record<string, number> = {};

    // First pass: find max sequence_id for each project
    localDB.issues.forEach((issue: any) => {
      if (issue.project && issue.sequence_id) {
        projectSeqMap[issue.project] = Math.max(projectSeqMap[issue.project] || 0, issue.sequence_id);
      }
    });

    // Second pass: backfill missing data
    localDB.issues.forEach((issue: any) => {
      if (issue.project && (!issue.sequence_id || !issue.project_detail)) {
        if (!issue.sequence_id) {
          projectSeqMap[issue.project] = (projectSeqMap[issue.project] || 0) + 1;
          issue.sequence_id = projectSeqMap[issue.project];
        }
        if (!issue.project_detail) {
          const project = (localDB.projects || []).find((p: any) => p.id === issue.project);
          if (project) issue.project_detail = project;
        }
        saveNeeded = true;
      }
    });

    if (saveNeeded) saveDB();
  }

  if (method === "get") {
    if (id) {
      let item = localDB[collection].find((r: any) => r.id === id || r.slug === id);

      // Fallback: If id is a number (sequenceId), try finding by project id or identifier
      if (!item && collection === "issues") {
        const projMatch = url.match(/\/projects\/([^/]+)\//);
        console.log(`[DApp Interceptor] Searching for sequence ID ${id}, projMatch:`, projMatch?.[1]);
        if (projMatch) {
          const projOrIdentifier = projMatch[1];
          const seqId = parseInt(id, 10);
          console.log(`[DApp Interceptor] Project: ${projOrIdentifier}, seqId: ${seqId}`);
          if (!isNaN(seqId)) {
            item = localDB.issues.find((r: any) => {
              const match =
                (r.project === projOrIdentifier || r.project_detail?.identifier === projOrIdentifier) &&
                r.sequence_id === seqId;
              return match;
            });
            console.log(`[DApp Interceptor] Fallback seqId result:`, item ? `FOUND ${item.id}` : "NOT FOUND");
          } else if (id === "undefined") {
            item = localDB.issues.find(
              (r: any) => r.project === projOrIdentifier || r.project_detail?.identifier === projOrIdentifier
            );
          }
        }
      }

      // Older fallback for retrieveWithIdentifier (e.g., FIAI-1 or FIAI-undefined)
      if (!item && collection === "issues" && id.includes("-")) {
        const [projIdentifier, seqIdStr] = id.split("-");
        const seqId = parseInt(seqIdStr, 10);
        if (!isNaN(seqId)) {
          item = localDB.issues.find(
            (r: any) => r.project_detail?.identifier === projIdentifier && r.sequence_id === seqId
          );
        } else if (seqIdStr === "undefined") {
          // Special fallback if UI still requests undefined
          item = localDB.issues.find((r: any) => r.project_detail?.identifier === projIdentifier);
        }
      }

      if (!item) {
        if (collection === "workspaces" && id) {
          const formattedName = id.replace(/[-_]/g, " ").toUpperCase();
          item = {
            id: `workspace-${id}`,
            name: formattedName,
            slug: id,
            organization_size: "5-10",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            created_by: getLoggedInUserId() || "user-default",
            owner: {
              id: getLoggedInUserId() || "user-default",
              email: getLoggedInEmail() || "user@fiai.network",
              first_name: formattedName,
              last_name: "",
              display_name: formattedName,
              avatar: "",
            },
            role: 20,
          };
          if (!localDB.workspaces) localDB.workspaces = [];
          localDB.workspaces.push(item);
          saveDB();
          return ok(item);
        }
        return { data: null, status: 404 };
      }
      // Enrich issue/work-item data with defaults expected by the detail store
      if (collection === "issues") {
        const stateDetail =
          item.state_detail || (localDB.states || []).find((s: any) => s.id === (item.state_id || item.state));
        const projectDetail =
          item.project_detail || (localDB.projects || []).find((p: any) => p.id === (item.project_id || item.project));
        return ok({
          is_subscribed: false,
          issue_reactions: [],
          issue_link: [],
          issue_attachments: [],
          parent: null,
          ...item,
          project_id: item.project_id || item.project,
          workspace_id: item.workspace_id || item.workspace || item.project_detail?.workspace || "mock-workspace",
          state_id: item.state_id || item.state,
          parent_id: item.parent_id || item.parent,
          cycle_id: item.cycle_id || item.cycle,
          type_id: item.type_id || item.type,
          assignees: item.assignees || item.assignee_ids || [],
          assignee_ids: item.assignee_ids || item.assignees || [],
          labels: item.labels || item.label_ids || [],
          label_ids: item.label_ids || item.labels || [],
          state_detail: stateDetail,
          project_detail: projectDetail,
        });
      }
      return ok(item);
    }
    let list = localDB[collection] || [];

    // History endpoint should also return comments
    if (collection === "history") {
      const commentsList = localDB["comments"] || [];
      list = [...list, ...commentsList];
    }

    // Auto-seed states for a project if none exist
    if (collection === "states" && url.includes("/projects/")) {
      const projId = id || url.match(/\/projects\/([^/]+)\//)?.[1];
      if (projId) {
        const projStates = list.filter((s: any) => s.project === projId);
        if (projStates.length === 0) {
          const match = url.match(/\/api\/workspaces\/([^/]+)\//);
          const wsSlug = match ? match[1] : "unknown";
          let wsId = wsSlug;
          if (localDB.workspaces) {
            const ws = localDB.workspaces.find((w: any) => w.slug === wsSlug);
            if (ws) wsId = ws.id;
          }

          const defaultStates = [
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Backlog",
              group: "backlog",
              project: projId,
              workspace: wsId,
              sequence: 15000,
              color: "#a3a3a3",
              default: true,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Unstarted",
              group: "unstarted",
              project: projId,
              workspace: wsId,
              sequence: 25000,
              color: "#3f3f46",
              default: false,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Started",
              group: "started",
              project: projId,
              workspace: wsId,
              sequence: 35000,
              color: "#f59e0b",
              default: false,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Completed",
              group: "completed",
              project: projId,
              workspace: wsId,
              sequence: 45000,
              color: "#16a34a",
              default: false,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Cancelled",
              group: "cancelled",
              project: projId,
              workspace: wsId,
              sequence: 55000,
              color: "#ef4444",
              default: false,
            },
          ];
          list.push(...defaultStates);
          (localDB as any)["states"] = list;
          saveDB();
        }
      }
    }

    // Generic _id suffix mapping for all items to satisfy frontend MobX stores
    list = list.map((item: any) => {
      if (!item || typeof item !== "object") return item;
      const res = { ...item };
      if (res.project && !res.project_id) res.project_id = res.project;
      if (res.workspace && !res.workspace_id) res.workspace_id = res.workspace;
      return res;
    });

    // Filter collections by project ID if the URL is scoped to a project
    if (url.includes("/projects/")) {
      const match = url.match(/\/projects\/([^/]+)\//);
      if (match) {
        const projId = match[1];
        if (
          ["issues", "states", "labels", "project-members", "project-roles", "cycles", "modules"].includes(collection)
        ) {
          list = list.filter((item: any) => item.project === projId || item.project_id === projId);
        }
      }
    }

    // Filter sub-resources by issue ID
    if (["comments", "history", "issue_reactions"].includes(collection) && id) {
      list = list.filter((item: any) => item.issue === id || item.issue_id === id);
    }

    if (collection === "invitations") {
      // Fix corrupted old records that have `emails: [{ email, role }]` instead of top-level properties
      list = list.map((item: any) => {
        if (!item.email && item.emails && Array.isArray(item.emails) && item.emails.length > 0) {
          return {
            ...item,
            email: item.emails[0].email,
            role: item.emails[0].role,
          };
        }
        return item;
      });
      list = list.filter((item: any) => !!item.email);
      console.log(`[DApp Interceptor] Returning invitations:`, JSON.stringify(list));
    }

    // Enrich issues with project_id, workspace_id, and other _id fields (required by UI)
    if (collection === "issues") {
      list = list.map((item: any) => {
        const stateDetail =
          item.state_detail || (localDB.states || []).find((s: any) => s.id === (item.state_id || item.state));
        const projectDetail =
          item.project_detail || (localDB.projects || []).find((p: any) => p.id === (item.project_id || item.project));

        const children = (localDB.issues || []).filter((i: any) => i.parent_id === item.id || i.parent === item.id);

        return {
          ...item,
          project_id: item.project_id || item.project,
          workspace_id: item.workspace_id || item.workspace || item.project_detail?.workspace || localDB.workspaces?.[0]?.slug || "",
          state_id: item.state_id || item.state,
          parent_id: item.parent_id || item.parent,
          cycle_id: item.cycle_id || item.cycle,
          type_id: item.type_id || item.type,
          assignees: item.assignees || item.assignee_ids || [],
          assignee_ids: item.assignee_ids || item.assignees || [],
          labels: item.labels || item.label_ids || [],
          label_ids: item.label_ids || item.labels || [],
          state_detail: stateDetail,
          project_detail: projectDetail,
          sub_issues_count: children.length,
        };
      });

      // Always exclude issues that have a parent_id from the top-level list when fetching multiple issues
      // But don't exclude them for search-issues so that existing sub-issues can be found
      if (!id && !url.includes("search-issues")) {
        list = list.filter((item: any) => !item.parent_id && !item.parent);
      }
    }

    // Enrich states with project_id and workspace_id
    if (collection === "states") {
      list = list.map((item: any) => ({
        ...item,
        project_id: item.project_id || item.project,
        workspace_id: item.workspace_id || item.workspace || localDB.workspaces?.[0]?.slug || "",
      }));
      console.log(
        `[DApp CRUD] States returning ${list.length} items:`,
        JSON.stringify(list.map((s: any) => ({ id: s.id, name: s.name, project_id: s.project_id })))
      );
    }

    const urlObj = new URL(url, "http://localhost");
    const groupBy = urlObj.searchParams.get("group_by");

    if (groupBy) {
      const groupedResults: Record<string, any> = {};

      // Initialize groups if it's states
      if (groupBy === "state" && collection === "issues") {
        const projId = id || url.match(/\/projects\/([^/]+)\//)?.[1];
        const states = (localDB.states || []).filter((s: any) => s.project === projId);
        states.forEach((s: any) => {
          groupedResults[s.id] = { results: [], total_results: 0 };
        });
      }

      list.forEach((item: any) => {
        const groupKey = item[groupBy] || "None";
        if (!groupedResults[groupKey]) {
          groupedResults[groupKey] = { results: [], total_results: 0 };
        }
        groupedResults[groupKey].results.push(item);
        groupedResults[groupKey].total_results++;
      });
      return ok({
        results: groupedResults,
        grouped_by: groupBy,
        next_cursor: null,
        prev_cursor: null,
        next_page_results: false,
        prev_page_results: false,
        total_count: list.length,
        count: list.length,
        total_pages: 1,
        total_results: list.length,
      });
    }

    if (isPaginated) {
      return ok({
        results: list,
        next_cursor: null,
        prev_cursor: null,
        next_page_results: false,
        prev_page_results: false,
        total_count: list.length,
        count: list.length,
        total_pages: 1,
        total_results: list.length,
        extra_stats: null,
      });
    }
    return ok(list);
  }

  if (method === "post") {
    console.log("[DApp Interceptor] POST", collection, body);
    if (collection === "invitations" && body.emails && Array.isArray(body.emails)) {
      const match = url.match(/\/api\/workspaces\/([^/]+)\//);
      const wsSlug = match ? match[1] : (localDB.workspaces?.[0]?.slug || "fiai");
      const currentWs = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);

      const newInvites = body.emails.map((e: any) => ({
        id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        email: e.email,
        role: e.role,
        accepted: false,
        message: "You have been invited.",
        workspace: {
          id: currentWs?.id || wsSlug,
          name: currentWs?.name || "Workspace",
          slug: wsSlug,
          logo_url: "",
        },
      }));

      if (!localDB[collection]) localDB[collection] = [];
      localDB[collection].push(...newInvites);

      // Xử lý từng invitee: ghi nhận vào workspace_members và kích hoạt addMember on-chain nếu có địa chỉ ví
      if (!localDB.workspace_members) localDB.workspace_members = [];

      for (const e of body.emails) {
        const memberAddress = extractEthAddress(e.email);
        const memberKey = memberAddress || e.email;
        const existingIdx = localDB.workspace_members.findIndex(
          (m: any) =>
            (m.workspace === wsSlug || m.workspace_id === wsSlug || m.workspace === currentWs?.id) &&
            (m.member?.toLowerCase() === memberKey.toLowerCase() || m.email?.toLowerCase() === e.email.toLowerCase())
        );
        const memberRecord = {
          id: `ws-member-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          workspace: wsSlug,
          workspace_id: wsSlug,
          member: memberKey,
          email: e.email,
          role: e.role || 15,
          is_active: true,
          created_at: new Date().toISOString(),
        };

        if (existingIdx >= 0) {
          localDB.workspace_members[existingIdx] = { ...localDB.workspace_members[existingIdx], ...memberRecord };
        } else {
          localDB.workspace_members.push(memberRecord);
        }

        // Gọi smart contract PlaneWorkspaceRegistry.addMember
        const bridge = getFiaiSDK();
        if (memberAddress && WORKSPACE_REGISTRY_ADDRESS && bridge && currentUserAddress) {
          const contractRole = mapPlaneRoleToContractRole(e.role);
          bridge
            .request("sendTransaction", {
              from: currentUserAddress,
              to: WORKSPACE_REGISTRY_ADDRESS,
              abiData: [ADD_MEMBER_ABI],
              functionName: "addMember",
              feeType: "sc",
              amount: "0",
              value: "0",
              gas: "3000000",
              type: "transaction",
              inputArray: [
                { name: "slug", type: "string", value: wsSlug },
                { name: "member", type: "address", value: memberAddress },
                { name: "role", type: "uint8", value: String(contractRole) },
              ],
              isReadOnly: false,
              bundleId: "",
            })
            .then(() => {
              console.log(`[DApp Interceptor] ✅ Đã thêm thành viên on-chain: ${memberAddress} vào workspace: ${wsSlug}`);
              return true;
            })
            .catch((err: any) => {
              console.warn(`[DApp Interceptor] addMember on-chain thất bại:`, err);
            });
        }
      }

      saveDB();
      newInvites.forEach((inv) => syncDAppRecord(collection, inv.id, inv));
      return ok({ message: "Invitations sent successfully" });
    }

    const newRecord: any = {
      id: body.id || crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...body,
    };
    const activeUserId = getLoggedInUserId();
    const activeUser = localDB.users?.find((u: any) => u.id === activeUserId);

    if (collection === "blockchain-transactions") {
      newRecord.recorded_at = new Date().toISOString();
      if (newRecord.event_type === "assign_task" && !newRecord.assignee_name && newRecord.assignee_id) {
        const u = localDB.users?.find((u: any) => u.id === newRecord.assignee_id);
        newRecord.assignee_name = u?.display_name || u?.first_name || newRecord.assignee_id;
      }
      if (
        (newRecord.event_type === "daily_report" || newRecord.event_type === "task_content") &&
        !newRecord.reporter_name
      ) {
        newRecord.reporter_id = activeUserId;
        newRecord.reporter_name = activeUser?.display_name || activeUser?.first_name || activeUserId;
      }
    }
    if (collection === "workspaces" && !newRecord.slug)
      newRecord.slug = newRecord.name?.toLowerCase().replace(/\s+/g, "-");
    if (collection === "workspaces" && !newRecord.owner) {
      newRecord.owner = {
        id: activeUser?.id || "user-1",
        email: activeUser?.email || "",
        first_name: activeUser?.first_name || "User",
        last_name: activeUser?.last_name || "",
        avatar: activeUser?.avatar_url || "",
      };
      newRecord.created_by = activeUser?.id || "user-1";
    }
    if (collection === "projects") {
      if (localDB._deleted_project_ids && Array.isArray(localDB._deleted_project_ids)) {
        localDB._deleted_project_ids = localDB._deleted_project_ids.filter(
          (dId: string) => dId !== newRecord.id && dId !== newRecord.identifier
        );
      }
      const match = url.match(/\/api\/workspaces\/([^/]+)\//);
      if (match) {
        const wsSlug = match[1];
        const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug);
        if (ws) {
          newRecord.workspace = ws.id;
          newRecord.workspace_detail = ws;
        }
      }
      newRecord.member_role = 20;

      // Seed default states for the new project
      if (!localDB["states"]) localDB["states"] = [];
      const defaultStates = [
        {
          id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          name: "Backlog",
          group: "backlog",
          project: newRecord.id,
          workspace: newRecord.workspace,
          sequence: 15000,
          color: "#a3a3a3",
          default: true,
        },
        {
          id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          name: "Unstarted",
          group: "unstarted",
          project: newRecord.id,
          workspace: newRecord.workspace,
          sequence: 25000,
          color: "#3f3f46",
          default: false,
        },
        {
          id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          name: "Started",
          group: "started",
          project: newRecord.id,
          workspace: newRecord.workspace,
          sequence: 35000,
          color: "#f59e0b",
          default: false,
        },
        {
          id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          name: "Completed",
          group: "completed",
          project: newRecord.id,
          workspace: newRecord.workspace,
          sequence: 45000,
          color: "#16a34a",
          default: false,
        },
        {
          id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          name: "Cancelled",
          group: "cancelled",
          project: newRecord.id,
          workspace: newRecord.workspace,
          sequence: 55000,
          color: "#ef4444",
          default: false,
        },
      ];
      localDB["states"].push(...defaultStates);
    }
    if (collection === "issues") {
      // Find the project ID from the URL: /api/workspaces/.../projects/:projectId/issues/
      const match = url.match(/\/projects\/([^/]+)\//);
      if (match) {
        const projId = match[1];
        newRecord.project = projId;
        const project = (localDB.projects || []).find((p: any) => p.id === projId);
        if (project) {
          newRecord.project_detail = project;
        }

        // Auto-increment sequence_id for the project
        const projectIssues = (localDB.issues || []).filter((i: any) => i.project === projId);
        const maxSeq = projectIssues.reduce((max: number, issue: any) => Math.max(max, issue.sequence_id || 0), 0);
        newRecord.sequence_id = maxSeq + 1;
      }
    }

    localDB[collection].push(newRecord);

    // If this is an issue and it has a parent, update the parent's sub_issues_count
    if (collection === "issues" && newRecord.parent_id) {
      const parentIdx = localDB[collection].findIndex((i: any) => i.id === newRecord.parent_id);
      if (parentIdx > -1) {
        localDB[collection][parentIdx].sub_issues_count = (localDB[collection][parentIdx].sub_issues_count || 0) + 1;
        // Broadcast the parent update if needed, though for mock DB just saving is enough for next fetch
      }
    }

    saveDB();
    syncDAppRecord(collection, newRecord.id, newRecord);

    let returnedRecord = { ...newRecord };

    // Generic mapping for all records
    if (returnedRecord.project && !returnedRecord.project_id) returnedRecord.project_id = returnedRecord.project;
    if (returnedRecord.workspace && !returnedRecord.workspace_id)
      returnedRecord.workspace_id = returnedRecord.workspace;

    if (collection === "issues") {
      const stateDetail =
        returnedRecord.state_detail ||
        (localDB.states || []).find((s: any) => s.id === (returnedRecord.state_id || returnedRecord.state));
      const projectDetail =
        returnedRecord.project_detail ||
        (localDB.projects || []).find((p: any) => p.id === (returnedRecord.project_id || returnedRecord.project));
      returnedRecord = {
        ...returnedRecord,
        project_id: returnedRecord.project_id || returnedRecord.project,
        workspace_id:
          returnedRecord.workspace_id ||
          returnedRecord.workspace ||
          returnedRecord.project_detail?.workspace ||
          localDB.workspaces?.[0]?.slug ||
          "",
        state_id: returnedRecord.state_id || returnedRecord.state,
        parent_id: returnedRecord.parent_id || returnedRecord.parent,
        cycle_id: returnedRecord.cycle_id || returnedRecord.cycle,
        type_id: returnedRecord.type_id || returnedRecord.type,
        assignees: returnedRecord.assignees || returnedRecord.assignee_ids || [],
        assignee_ids: returnedRecord.assignee_ids || returnedRecord.assignees || [],
        labels: returnedRecord.labels || returnedRecord.label_ids || [],
        label_ids: returnedRecord.label_ids || returnedRecord.labels || [],
        state_detail: stateDetail,
        project_detail: projectDetail,
      };
    }

    if (["comments", "history", "issue_reactions"].includes(collection) && id) {
      newRecord.issue = id;
      newRecord.issue_id = id;
    }

    return { data: returnedRecord, status: 201 };
  }

  if (method === "patch" || method === "put") {
    const idx = localDB[collection].findIndex((r: any) => r.id === id || r.slug === id);
    if (idx > -1) {
      localDB[collection][idx] = { ...localDB[collection][idx], ...body, updated_at: new Date().toISOString() };
      saveDB();
      syncDAppRecord(collection, id!, localDB[collection][idx]);

      let returnedRecord = { ...localDB[collection][idx] };
      if (collection === "issues") {
        returnedRecord = {
          ...returnedRecord,
          project_id: returnedRecord.project_id || returnedRecord.project,
          workspace_id:
            returnedRecord.workspace_id ||
            returnedRecord.workspace ||
            returnedRecord.project_detail?.workspace ||
            localDB.workspaces?.[0]?.slug ||
            "",
          state_id: returnedRecord.state_id || returnedRecord.state,
          parent_id: returnedRecord.parent_id || returnedRecord.parent,
          cycle_id: returnedRecord.cycle_id || returnedRecord.cycle,
          type_id: returnedRecord.type_id || returnedRecord.type,
        };
      }

      // Generic mapping for all other records
      if (returnedRecord.project && !returnedRecord.project_id) returnedRecord.project_id = returnedRecord.project;
      if (returnedRecord.workspace && !returnedRecord.workspace_id)
        returnedRecord.workspace_id = returnedRecord.workspace;

      return ok(returnedRecord);
    }
    console.log("404 for URL:", url, "method:", method);
    return { data: null, status: 404 };
  }

  if (method === "delete") {
    if (collection === "projects" && id) {
      const targetProj = (localDB.projects || []).find((p: any) => p.id === id || p.identifier === id);
      const targetId = targetProj?.id || id;

      if (!localDB._deleted_project_ids) localDB._deleted_project_ids = [];
      if (!localDB._deleted_project_ids.includes(targetId)) {
        localDB._deleted_project_ids.push(targetId);
      }
      if (targetProj?.identifier && !localDB._deleted_project_ids.includes(targetProj.identifier)) {
        const otherUsingSameIdentifier = (localDB.projects || []).some(
          (p: any) => p.id !== targetId && p.identifier === targetProj.identifier
        );
        if (!otherUsingSameIdentifier) {
          localDB._deleted_project_ids.push(targetProj.identifier);
        }
      }

      const deletedSet = new Set(localDB._deleted_project_ids);
      localDB.projects = (localDB.projects || []).filter(
        (p: any) => p.id !== targetId && !deletedSet.has(p.id)
      );

      if (localDB.issues) {
        localDB.issues = localDB.issues.filter((i: any) => i.project !== targetId && i.project_id !== targetId);
      }
      if (localDB.states) {
        localDB.states = localDB.states.filter((s: any) => s.project !== targetId && s.project_id !== targetId);
      }
      if (localDB.labels) {
        localDB.labels = localDB.labels.filter((l: any) => l.project !== targetId && l.project_id !== targetId);
      }
      if (localDB.cycles) {
        localDB.cycles = localDB.cycles.filter((c: any) => c.project !== targetId && c.project_id !== targetId);
      }
      if (localDB.modules) {
        localDB.modules = localDB.modules.filter((m: any) => m.project !== targetId && m.project_id !== targetId);
      }
      if (localDB.project_members) {
        localDB.project_members = localDB.project_members.filter((pm: any) => pm.project !== targetId && pm.project_id !== targetId);
      }
    } else {
      localDB[collection] = (localDB[collection] || []).filter((r: any) => r.id !== id);
    }
    saveDB();
    return ok({});
  }

  return ok(null);
}

function ok(data: any): RouteResult {
  return { data, status: 200 };
}

// ── URL → collection parser ──────────────────────────────────────────────
function parseApiUrl(url: string): { collection: string; id: string | null; isPaginated: boolean } {
  const clean = url.split("?")[0].replace(/\/+$/, ""); // strip query and trailing slash
  const segments = clean.split("/").filter(Boolean); // e.g. ["api","workspaces","ws","projects","p","issues","id","history"]

  // Must start with "api"
  const apiIdx = segments.indexOf("api");
  if (apiIdx === -1) return { collection: "general", id: null, isPaginated: false };

  const rest = segments.slice(apiIdx + 1); // everything after "api"

  // Special cases: direct workspace or project routes
  if (rest.length === 2 && rest[0] === "workspaces") {
    return { collection: "workspaces", id: rest[1], isPaginated: false };
  }
  if (rest.length === 4 && rest[0] === "workspaces" && rest[2] === "projects") {
    return { collection: "projects", id: rest[3], isPaginated: false };
  }

  // Skip known structural prefixes to find the meaningful resource segments
  // Pattern: workspaces/:slug/projects/:pid/[v2/]<resource>[/:id[/<sub-resource>[/:subId]]]
  let i = 0;

  // skip "workspaces/:slug"
  if (rest[i] === "workspaces" && rest[i + 1]) i += 2;
  // skip "projects/:pid" only if there are deeper sub-resource segments
  if (rest[i] === "projects" && rest[i + 1] && rest.length > i + 2) i += 2;
  // skip "v2" prefix
  if (rest[i] === "v2") i += 1;

  const resourceSegments = rest.slice(i); // e.g. ["issues","id","history"] or ["issues"] or ["issues","id"]

  if (resourceSegments.length === 0) {
    return { collection: "general", id: null, isPaginated: false };
  }

  if (resourceSegments.length === 1) {
    // /api/.../issues/
    const unpaginated = [
      "members",
      "invitations",
      "states",
      "labels",
      "project-roles",
      "workspace-members",
      "project-members",
      "projects",
      "workspaces",
      "cycles",
      "modules",
      "views",
      "pages",
      "project-identifiers",
      "project-stats",
      "blockchain-transactions",
      "search-issues",
    ];
    const collection = resourceSegments[0];
    return { collection, id: null, isPaginated: !unpaginated.includes(collection) };
  }

  if (resourceSegments.length === 2) {
    const [resource, idOrSub] = resourceSegments;
    // Special case: "list" is not an id but a sub-endpoint
    if (idOrSub === "list") {
      return { collection: resource, id: null, isPaginated: true };
    }
    // /api/.../issues/:id
    return { collection: resource, id: idOrSub, isPaginated: false };
  }

  if (resourceSegments.length === 3) {
    // /api/.../issues/:id/history  or /api/.../issues/:id/comments
    const [_parentResource, parentId, subResource] = resourceSegments;
    const unpaginatedSub = ["comments", "history", "issue_reactions"];
    // Return the sub-resource as collection, with the parent id for context
    return { collection: subResource, id: parentId, isPaginated: !unpaginatedSub.includes(subResource) };
  }

  if (resourceSegments.length >= 4) {
    // /api/.../issues/:id/comments/:commentId
    const subResource = resourceSegments[2];
    const subId = resourceSegments[3];
    return { collection: subResource, id: subId, isPaginated: false };
  }

  return { collection: "general", id: null, isPaginated: false };
}

// ── Public: install interceptor on an Axios instance ─────────────────────
export function setupDAppInterceptor(axiosInstance: AxiosInstance) {
  axiosInstance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    config.adapter = async (adapterConfig) => {
      let url = adapterConfig.url || "";
      const method = (adapterConfig.method || "get").toLowerCase();
      const body = parseData(adapterConfig.data);

      // Serialize params into URL so route handlers can read query params
      if (adapterConfig.params && typeof adapterConfig.params === "object") {
        const qs = Object.entries(adapterConfig.params)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&");
        if (qs) {
          url += (url.indexOf("?") === -1 ? "?" : "&") + qs;
        }
      }

      const { data, status } = handleRoute(method, url, body);

      if (status >= 400) {
        const error: any = new Error(`Request failed with status code ${status}`);
        error.name = "AxiosError";
        error.code = status === 401 ? "ERR_BAD_REQUEST" : "ERR_BAD_RESPONSE";
        error.status = status;
        error.response = {
          data,
          status,
          statusText: "Error",
          headers: {},
          config: adapterConfig,
          request: {},
        };
        throw error;
      }

      return {
        data,
        status,
        statusText: "OK",
        headers: {},
        config: adapterConfig,
        request: {},
      } as AxiosResponse;
    };
    return config;
  });
}



