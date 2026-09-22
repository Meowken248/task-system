import type { DAppDatabase, DAppWorkspace } from "./types";
import { getStoredCredentials, setStoredCredential } from "./auth";

declare const process: { env: Record<string, string | undefined> };

export function getEnvVar(name: string): string | undefined {
  if (typeof process !== "undefined" && process.env?.[name]) return process.env[name];
  if (typeof window !== "undefined" && (window as any).__env__?.[name]) return (window as any).__env__[name];
  if (typeof window !== "undefined" && (window as any)[name]) return (window as any)[name];
  return undefined;
}

export function getPlaneContractAddress(): string {
  return (
    getEnvVar("VITE_CONTRACT_ADDRESS") ||
    getEnvVar("NEXT_PUBLIC_CONTRACT_ADDRESS") ||
    ""
  );
}

export const PLANE_CONTRACT = getPlaneContractAddress();

// ── Default Workspace duy nhất: FIAI ─────────────────────────────────────
export const DEFAULT_WORKSPACE: DAppWorkspace = {
  id: "workspace-fiai",
  name: "FIAI",
  slug: "fiai",
  organization_size: "5-10",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_by: "user-default",
  owner: {
    id: "user-default",
    email: "",
    first_name: "FIAI",
    last_name: "",
    display_name: "FIAI",
    avatar: "",
  },
  role: 20,
};

export const defaultDB: DAppDatabase = {
  users: [],
  workspaces: [DEFAULT_WORKSPACE],
  projects: [],
  states: [],
  labels: [],
  issues: [],
  issue_comments: [],
  issue_activities: [],
  attachments: [],
  views: [],
  cycles: [],
  modules: [],
  pages: [],
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
export function getLoggedInUserId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("plane_dapp_auth_user");
}

export function getLoggedInEmail(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("plane_dapp_auth_email");
}

export function isLoggedIn(): boolean {
  return !!getLoggedInUserId();
}

export function setLoggedInUser(userId: string | null): void {
  if (typeof window === "undefined") return;
  if (userId) {
    localStorage.setItem("plane_dapp_auth_user", userId);
  } else {
    localStorage.removeItem("plane_dapp_auth_user");
    localStorage.removeItem("plane_dapp_auth_email");
  }
}

// ── In-Memory Runtime Store with Instant Local Cache (0ms on F5) ────────
export function loadInitialDB(): Record<string, any> {
  if (typeof window !== "undefined") {
    try {
      const cachedLocal = localStorage.getItem("plane_dapp_local_db");
      if (cachedLocal) {
        const parsed = JSON.parse(cachedLocal);
        if (parsed && typeof parsed === "object") {
          const deletedSet = new Set(parsed._deleted_project_ids || []);
          parsed.projects = (parsed.projects || []).filter(
            (p: any) => !deletedSet.has(p.id) && !deletedSet.has(p.identifier)
          );
          parsed.states = (parsed.states || []).filter(
            (s: any) => !deletedSet.has(s.project) && !deletedSet.has(s.project_id)
          );
          if (parsed.issues) {
            parsed.issues = parsed.issues.filter(
              (i: any) => !deletedSet.has(i.project) && !deletedSet.has(i.project_id)
            );
          }
          (parsed.projects || []).forEach((p: any) => {
            if (!p.logo_props) p.logo_props = { in_use: "icon", icon: { name: "folder", color: "#3f3f46" } };
          });
          parsed.workspaces = (parsed.workspaces && parsed.workspaces.length > 0) ? parsed.workspaces : [DEFAULT_WORKSPACE];
          const creds = getStoredCredentials();
          (parsed.users || []).forEach((u: any) => {
            const emailKey = u?.email?.toLowerCase().trim();
            if (emailKey) {
              if (creds[emailKey]) {
                u.password_hash = creds[emailKey];
              } else if (u.password_hash) {
                setStoredCredential(emailKey, u.password_hash);
              }
            }
          });
          console.log("[DApp DB] Khởi tạo từ localStorage thành công");
          return parsed;
        }
      }
      const cachedSession = sessionStorage.getItem("plane_dapp_latest_db");
      if (cachedSession) {
        const parsed = JSON.parse(cachedSession);
        if (parsed && typeof parsed === "object") {
          const deletedSet = new Set(parsed._deleted_project_ids || []);
          parsed.projects = (parsed.projects || []).filter(
            (p: any) => !deletedSet.has(p.id) && !deletedSet.has(p.identifier)
          );
          parsed.states = (parsed.states || []).filter(
            (s: any) => !deletedSet.has(s.project) && !deletedSet.has(s.project_id)
          );
          if (parsed.issues) {
            parsed.issues = parsed.issues.filter(
              (i: any) => !deletedSet.has(i.project) && !deletedSet.has(i.project_id)
            );
          }
          (parsed.projects || []).forEach((p: any) => {
            if (!p.logo_props) p.logo_props = { in_use: "icon", icon: { name: "folder", color: "#3f3f46" } };
          });
          parsed.workspaces = (parsed.workspaces && parsed.workspaces.length > 0) ? parsed.workspaces : [DEFAULT_WORKSPACE];
          const creds = getStoredCredentials();
          (parsed.users || []).forEach((u: any) => {
            const emailKey = u?.email?.toLowerCase().trim();
            if (emailKey) {
              if (creds[emailKey]) {
                u.password_hash = creds[emailKey];
              } else if (u.password_hash) {
                setStoredCredential(emailKey, u.password_hash);
              }
            }
          });
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

export const localDB: Record<string, any> = loadInitialDB();

// Initial safety validation
if (!localDB.users) localDB.users = [];
if (!localDB.workspaces || localDB.workspaces.length === 0) localDB.workspaces = [DEFAULT_WORKSPACE];
if (!localDB.projects) localDB.projects = [];
const initDeletedSet = new Set(localDB._deleted_project_ids || []);
localDB.projects = localDB.projects.filter(
  (p: any) => !initDeletedSet.has(p.id) && !initDeletedSet.has(p.identifier)
);
(localDB.projects || []).forEach((p: any) => {
  if (!p.logo_props) p.logo_props = { in_use: "icon", icon: { name: "folder", color: "#3f3f46" } };
});
if (!localDB.states) localDB.states = [];
localDB.states = localDB.states.filter(
  (s: any) => !initDeletedSet.has(s.project) && !initDeletedSet.has(s.project_id)
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

export function syncIssueParentsToTransactions() {
  if (localDB.issues && localDB["blockchain-transactions"]) {
    const issueParentMap = new Map<string, string>();
    localDB.issues.forEach((i: any) => {
      const parent = i.parent_id || i.parent;
      if (parent) issueParentMap.set(i.id, parent);
    });
    localDB["blockchain-transactions"].forEach((tx: any) => {
      if (tx.event_type === "create_task" && tx.issue_id && issueParentMap.has(tx.issue_id)) {
        tx.parent_issue_id = issueParentMap.get(tx.issue_id);
      }
    });
  }
}
syncIssueParentsToTransactions();

// ── Save Hooks & Persistence ─────────────────────────────────────────────
let onSaveHook: (() => void) | null = null;

export function registerSaveHook(fn: () => void) {
  onSaveHook = fn;
}

export function saveDB() {
  if (typeof window === "undefined") return;
  syncIssueParentsToTransactions();
  try {
    const snapshot = JSON.stringify(localDB);
    localStorage.setItem("plane_dapp_local_db", snapshot);
    sessionStorage.setItem("plane_dapp_latest_db", snapshot);
  } catch { }
  syncWorkspacesToCookie();
  if (onSaveHook) {
    onSaveHook();
  }
}

export function getDBSnapshot(): Record<string, any> {
  const dbToSave: Record<string, any> = {};
  const creds = getStoredCredentials();
  (localDB.users || []).forEach((u: any) => {
    const emailKey = u?.email?.toLowerCase().trim();
    if (emailKey && !u.password_hash && creds[emailKey]) {
      u.password_hash = creds[emailKey];
    }
  });
  for (const [key, value] of Object.entries(localDB)) {
    dbToSave[key] = value;
  }
  dbToSave.credentials = creds;
  return dbToSave;
}

// ── Cross-Port & Cookie Sync for Workspaces ──────────────────────────────
export function syncWorkspacesToCookie(cid?: string | null) {
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
    
    const cidToSync = cid || (typeof localStorage !== "undefined" ? localStorage.getItem("plane_dapp_ipfs_cid_local") || localStorage.getItem("plane_dapp_ipfs_cid_last_valid") : null);
    if (cidToSync && !cidToSync.startsWith("bafkrei")) {
      document.cookie = `plane_dapp_sync_cid=${encodeURIComponent(cidToSync)}; path=/; max-age=31536000; SameSite=Lax`;
    }
  } catch { }
}

export function syncCrossPortWorkspaces(onNewCIDDetected?: (cid: string) => void) {
  if (typeof window === "undefined") return;
  try {
    let hasChanges = false;
    if (!localDB.workspaces) localDB.workspaces = [];

    // 1. Read from shared cross-port cookies (domain localhost)
    if (typeof document !== "undefined" && typeof document.cookie === "string" && document.cookie.trim() !== "") {
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
                      email: getLoggedInEmail() || "",
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
          if (onNewCIDDetected) {
            onNewCIDDetected(cVal);
          }
        }
      }
    }

    // 2. Check URL search query parameters
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
        const activeEmail = authEmail || getLoggedInEmail() || "";
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
      if (onNewCIDDetected) {
        onNewCIDDetected(urlCid);
      }
    }

    // 3. Auto-provision from pathname if visiting /:workspaceSlug
    const pathname = window.location.pathname;
    const firstSegment = pathname.split("/").find(Boolean);
    const reservedPaths = [
      "assets", "api", "create-workspace", "invitations", "settings",
      "profile", "installations", "onboarding", "god-mode",
      "workspace-member-invitations", "workspace", "preview",
    ];
    if (firstSegment && !reservedPaths.includes(firstSegment)) {
      const exists = localDB.workspaces.find((w: any) => w.slug === firstSegment || w.id === firstSegment);
      if (!exists) {
        const formattedName = firstSegment.replace(/[-_]/g, " ").toUpperCase();
        const activeUserId = getLoggedInUserId() || "user-default";
        const activeEmail = getLoggedInEmail() || "";
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
        console.log(`[DApp DB] Auto-provisioned workspace from pathname: ${firstSegment} (${formattedName})`);
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

// ── Instance & User Helpers ──────────────────────────────────────────────
export function getInstanceInfo() {
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
      is_setup_done: true,
      is_signup_screen_visited: true,
      user_count: (localDB.users || []).length,
      is_verified: true,
      created_by: null,
      updated_by: null,
      workspaces_exist: true,
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
      ...localDB.config,
    },
  };
}

export function getUserProfile() {
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
      last_workspace_id: null,
      last_workspace_slug: null,
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

  const userWorkspaces = (localDB.workspaces && localDB.workspaces.length > 0) ? localDB.workspaces : [DEFAULT_WORKSPACE];
  const firstWs = userWorkspaces[0] || DEFAULT_WORKSPACE;

  return {
    id: activeUser.id,
    user: activeUser.id,
    role: "admin",
    last_workspace_id: activeUser.last_workspace_id || firstWs.id,
    last_workspace_slug: activeUser.last_workspace_slug || firstWs.slug,
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

export function getUserSettings() {
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
      last_workspace_id: currentWs?.id || DEFAULT_WORKSPACE.id,
      last_workspace_slug: currentWs?.slug || DEFAULT_WORKSPACE.slug,
      last_workspace_name: currentWs?.name || DEFAULT_WORKSPACE.name,
      last_workspace_logo: currentWs?.logo || null,
      fallback_workspace_id: currentWs?.id || DEFAULT_WORKSPACE.id,
      fallback_workspace_slug: currentWs?.slug || DEFAULT_WORKSPACE.slug,
      invites: 0,
    },
  };
}

export function parseData(raw: any): Record<string, any> {
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
