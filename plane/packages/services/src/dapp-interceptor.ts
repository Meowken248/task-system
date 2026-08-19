import type { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from "axios";

const PLANE_CONTRACT = "0x2CB649c0A6338f668F0ADc4AE96c1b2Dc198ed41";

// ── On-chain sync (fire-and-forget, never blocks UI) ──────────────────────
async function syncDAppRecord(collection: string, id: string, record: any) {
  if (typeof window === "undefined") return;
  try {
    const { MtnContract } = await import("@metanodejs/mtn-contract");
    const contract = new MtnContract();
    contract.setConfigs({ address: PLANE_CONTRACT });
    console.log(`[DApp Sync] Syncing ${collection}/${id} to Smart Contract...`);
    await contract.sendTransaction({
      functionName: "updateDAppRecord",
      args: [collection, id, JSON.stringify(record)],
    });
    console.log(`[DApp Sync] Success!`);
  } catch (err) {
    console.error(`[DApp Sync Error]`, err);
  }
}

// ── Default mock user (shared across all seed data) ──────────────────────
const MOCK_USER = {
  id: "me",
  email: "admin@plane.so",
  first_name: "Plane",
  last_name: "Admin",
  display_name: "Plane Admin",
  avatar_url: "",
  is_bot: false,
  is_active: true,
  is_email_verified: true,
  is_password_autoset: false,
  is_tour_completed: true,
  mobile_number: null,
  last_workspace_id: "mock-workspace",
  user_timezone: "Asia/Ho_Chi_Minh",
  username: "plane_admin",
  last_login_medium: "email",
  cover_image_url: null,
  date_joined: new Date().toISOString(),
  theme: { theme: "dark" },
};

// ── Seed data (bootstraps a fresh instance) ──────────────────────────────
const defaultDB: Record<string, any[]> = {
  users: [MOCK_USER],
  workspaces: [
    {
      id: "mock-workspace",
      name: "Mock Workspace",
      slug: "mock-workspace",
      created_by: "me",
      owner: {
        id: "me",
        email: "admin@plane.so",
        first_name: "Plane",
        last_name: "Admin",
        avatar: "",
      },
    },
  ],
};

// ── Auth state (persisted in localStorage) ───────────────────────────────
function getLoggedInUserId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("plane_dapp_auth_user");
}
function isLoggedIn(): boolean {
  return !!getLoggedInUserId();
}
function setLoggedInUser(userId: string | null) {
  if (typeof window === "undefined") return;
  if (userId) localStorage.setItem("plane_dapp_auth_user", userId);
  else localStorage.removeItem("plane_dapp_auth_user");
}

// ── Persistent local store ───────────────────────────────────────────────
let parsedDB: Record<string, any[]> | null = null;
if (typeof window !== "undefined") {
  try {
    const saved = localStorage.getItem("plane_dapp_db");
    if (saved) parsedDB = JSON.parse(saved);
  } catch { /* corrupted – will reset */ }
}
const localDB: Record<string, any[]> =
  parsedDB && Object.keys(parsedDB).length > 0 ? parsedDB : { ...defaultDB };

// Safety checks for older local storage DBs missing new seed data
if (!localDB.users) localDB.users = defaultDB.users;
if (!localDB.workspaces || localDB.workspaces.length === 0) localDB.workspaces = defaultDB.workspaces;

function saveDB() {
  if (typeof window !== "undefined") {
    localStorage.setItem("plane_dapp_db", JSON.stringify(localDB));
  }
}

// ── Static responses for special endpoints ───────────────────────────────
function getInstanceInfo() {
  return {
    instance: {
      id: "dapp-instance",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      instance_name: "Plane DApp",
      whitelist_emails: null,
      instance_id: "dapp-instance",
      license_key: null,
      current_version: "1.0.0",
      latest_version: "1.0.0",
      last_checked_at: new Date().toISOString(),
      namespace: null,
      is_telemetry_enabled: false,
      is_support_required: false,
      is_activated: true,
      is_setup_done: true,
      is_signup_screen_visited: true,
      user_count: 1,
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
    },
  };
}

function getUserProfile() {
  return {
    id: "me",
    user: "me",
    role: "admin",
    last_workspace_id: "mock-workspace",
    theme: { theme: "dark", primary: null, background: null, darkPalette: false },
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

function getUserSettings() {
  return {
    id: "me",
    email: "admin@plane.so",
    workspace: {
      last_workspace_id: "mock-workspace",
      last_workspace_slug: "mock-workspace",
      last_workspace_name: "Mock Workspace",
      last_workspace_logo: null,
      fallback_workspace_id: "mock-workspace",
      fallback_workspace_slug: "mock-workspace",
      invites: 0,
    },
  };
}

// ── Safe data parser (handles string, object, FormData) ──────────────────
function parseData(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  if (typeof raw === "object" && !(raw instanceof FormData)) return raw;
  return {};
}

// ── Route matcher ────────────────────────────────────────────────────────
type RouteResult = { data: any; status: number };

function handleRoute(method: string, url: string, body: Record<string, any>): RouteResult {
  // ── Auth endpoints ──────────────────────────────────────────────────
  if (url.includes("/auth/get-csrf-token"))
    return ok({ csrf_token: "dapp-csrf-token" });

  if (url.includes("/auth/email-check"))
    return ok({ existing: true, is_password_autoset: false, status: "CREDENTIAL" });

  if (url.includes("/auth/sign-in") || url.includes("/auth/sign-up") || url.includes("/auth/magic-sign-in")) {
    let email = body?.email || "admin@plane.so";
    let user = localDB.users.find(u => u.email === email);
    
    if (!user) {
      // Create a new user based on MOCK_USER but with new email and ID
      user = { 
        ...MOCK_USER, 
        id: `user-${Date.now()}`, 
        email, 
        first_name: email.split('@')[0], 
        last_name: "", 
        display_name: email.split('@')[0]
      };
      localDB.users.push(user);
      saveDB();
    }
    
    setLoggedInUser(user.id);
    return ok({ ...user, access_token: "dapp-token", refresh_token: "dapp-refresh" });
  }

  if (url.includes("/auth/forgot-password") || url.includes("/auth/set-password"))
    return ok({ message: "success" });

  if (url.includes("/auth/sign-out")) {
    setLoggedInUser(null);
    return ok({ message: "success" });
  }

  // ── Instance ────────────────────────────────────────────────────────
  if (url.match(/\/api\/instances\/?$/) || url.match(/\/api\/instances\/\?/))
    return ok(getInstanceInfo());

  if (url.includes("/api/instances/configurations"))
    return ok([]);

  if (url.includes("/api/instances/workspaces"))
    return ok({ results: localDB.workspaces || [], next_cursor: null, prev_cursor: null });

  if (url.includes("/api/instances/admins"))
    return ok([MOCK_USER]);

  if (url.match(/\/api\/users\/me/)) {
    const activeUserId = getLoggedInUserId();
    const activeUser = localDB.users.find(u => u.id === activeUserId) || MOCK_USER;

    if (!isLoggedIn()) return { data: { error: "not authenticated" }, status: 401 };

    if (url.includes("/api/users/me/profile")) {
      if (method === "patch" || method === "put" || method === "post") {
        Object.assign(activeUser, body);
        saveDB();
      }
      return ok({
        ...activeUser,
        workspace: { fallback_workspace_id: "mock-workspace", fallback_workspace_slug: "mock-workspace", invites: 0 }
      });
    }

    if (url.includes("/api/users/me/settings"))
      return ok(getUserSettings());

    if (url.includes("/api/users/me/instance-admin"))
      return ok({ is_instance_admin: true });

    if (url.includes("/api/users/me/accounts"))
      return ok([]);

    if (url.includes("/api/users/me/notification-preferences"))
      return ok({});

    if (url.includes("/project-roles"))
      return ok({}); // return empty object for project roles

    if (url.includes("/api/users/me/workspaces") && !url.includes("/project-roles"))
      return ok(localDB.workspaces || []);

    if (method === "patch" || method === "put" || method === "post") {
        Object.assign(activeUser, body);
        saveDB();
    }
    return ok(activeUser);
  }

  // ── Projects & Workspace Members ────────────────────────────────────
  if (url.match(/\/api\/workspaces\/[^/]+\/workspace-members\/me\/?/)) {
    return ok({
      id: "mock-member-me",
      member: "mock-user-id",
      role: 20, // Admin role
      workspace: { id: "mock-workspace-id" },
    });
  }

  if (url.match(/\/api\/workspaces\/[^/]+\/projects\/?(?:\?.*)?$/) || url.includes("/projects/details")) {
    return ok(localDB.projects || []);
  }

  // ── Recent Visits & Favorites ────────────────────────────────────────
  if (url.match(/\/api\/workspaces\/[^/]+\/recent-visits\/?(?:\?.*)?$/)) {
    return ok(localDB["recent-visits"] || []);
  }

  if (url.match(/\/api\/workspaces\/[^/]+\/favorites\/?(?:\?.*)?$/)) {
    return ok(localDB.favorites || []);
  }

  // ── Generic CRUD ────────────────────────────────────────────────────
  return handleCRUD(method, url, body);
}

// ── Generic CRUD handler ─────────────────────────────────────────────────
function handleCRUD(method: string, url: string, body: Record<string, any>): RouteResult {
  const { collection, id, isPaginated } = parseApiUrl(url);

  if (!localDB[collection]) localDB[collection] = [];

  if (method === "get") {
    if (id) {
      const item = localDB[collection].find((r) => r.id === id || r.slug === id);
      return item ? ok(item) : { data: null, status: 404 };
    }
    const list = localDB[collection];
    return ok(isPaginated ? { results: list, next_cursor: null, prev_cursor: null } : list);
  }

  if (method === "post") {
    const newRecord: any = {
      id: body.id || crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...body,
    };
    if (collection === "workspaces" && !newRecord.slug) newRecord.slug = newRecord.name?.toLowerCase().replace(/\s+/g, "-");
    if (collection === "workspaces" && !newRecord.owner) {
      newRecord.owner = { id: "me", email: "admin@plane.so", first_name: "Plane", last_name: "Admin", avatar: "" };
      newRecord.created_by = "me";
    }
    localDB[collection].push(newRecord);
    saveDB();
    syncDAppRecord(collection, newRecord.id, newRecord);
    return { data: newRecord, status: 201 };
  }

  if (method === "patch" || method === "put") {
    const idx = localDB[collection].findIndex((r) => r.id === id || r.slug === id);
    if (idx > -1) {
      localDB[collection][idx] = { ...localDB[collection][idx], ...body, updated_at: new Date().toISOString() };
      saveDB();
      syncDAppRecord(collection, id!, localDB[collection][idx]);
      return ok(localDB[collection][idx]);
    }
    return { data: null, status: 404 };
  }

  if (method === "delete") {
    localDB[collection] = localDB[collection].filter((r) => r.id !== id);
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
  const clean = url.split("?")[0];

  // workspace sub-resources: /api/workspaces/:slug/<resource>/:id
  const subResource = clean.match(/\/api\/workspaces\/[^/]+\/([^/]+)\/?$/);
  if (subResource) return { collection: subResource[1], id: null, isPaginated: true };

  const subResourceId = clean.match(/\/api\/workspaces\/[^/]+\/([^/]+)\/([^/]+)\/?$/);
  if (subResourceId) return { collection: subResourceId[1], id: subResourceId[2], isPaginated: false };

  // project sub-resources: /api/workspaces/:slug/projects/:id/<resource>/:id
  const projSub = clean.match(/\/api\/workspaces\/[^/]+\/projects\/[^/]+\/([^/]+)\/?$/);
  if (projSub) return { collection: projSub[1], id: null, isPaginated: true };

  const projSubId = clean.match(/\/api\/workspaces\/[^/]+\/projects\/[^/]+\/([^/]+)\/([^/]+)\/?$/);
  if (projSubId) return { collection: projSubId[1], id: projSubId[2], isPaginated: false };

  // top-level: /api/<collection>/:id
  const topId = clean.match(/\/api\/([^/]+)\/([^/]+)\/?$/);
  if (topId) return { collection: topId[1], id: topId[2], isPaginated: false };

  const top = clean.match(/\/api\/([^/]+)\/?$/);
  if (top) return { collection: top[1], id: null, isPaginated: true };

  return { collection: "general", id: null, isPaginated: false };
}

// ── Public: install interceptor on an Axios instance ─────────────────────
export function setupDAppInterceptor(axiosInstance: AxiosInstance) {
  axiosInstance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    config.adapter = async (adapterConfig) => {
      const url = adapterConfig.url || "";
      const method = (adapterConfig.method || "get").toLowerCase();
      const body = parseData(adapterConfig.data);

      const { data, status } = handleRoute(method, url, body);

      return {
        data,
        status,
        statusText: status < 400 ? "OK" : "Error",
        headers: {},
        config: adapterConfig,
        request: {},
      } as AxiosResponse;
    };
    return config;
  });
}
