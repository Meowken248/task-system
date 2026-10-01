import type { DAppDatabase, DAppWorkspace } from "./types";
import { getStoredCredentials, setStoredCredential } from "./auth";

declare const process: { env: Record<string, string | undefined> };

export function getEnvVar(name: string): string | undefined {
  if (typeof process !== "undefined" && process.env?.[name]) return process.env[name];
  if (typeof import.meta !== "undefined" && (import.meta as any).env?.[name]) return (import.meta as any).env[name];
  if (typeof window !== "undefined" && (window as any).__env__?.[name]) return (window as any).__env__[name];
  if (typeof window !== "undefined" && (window as any)[name]) return (window as any)[name];
  return undefined;
}

export function getContractGas(): string {
  return getEnvVar("VITE_CONTRACT_GAS") || "3000000";
}

export function getDefaultWorkspaceSlug(): string {
  return getEnvVar("VITE_DEFAULT_WORKSPACE_SLUG") || "fiai";
}

export function getDefaultWorkspaceName(): string {
  return getEnvVar("VITE_DEFAULT_WORKSPACE_NAME") || getDefaultWorkspaceSlug().toUpperCase();
}

export function getPlaneContractAddress(): string {
  return (
    getEnvVar("VITE_CONTRACT_ADDRESS") ||
    getEnvVar("NEXT_PUBLIC_CONTRACT_ADDRESS") ||
    ""
  );
}

export const PLANE_CONTRACT = getPlaneContractAddress();

// ── Default Workspace ────────────────────────────────────────────────────
const defaultWsSlug = getDefaultWorkspaceSlug();
const defaultWsName = getDefaultWorkspaceName();

export const DEFAULT_WORKSPACE: DAppWorkspace = {
  id: `workspace-${defaultWsSlug}`,
  name: defaultWsName,
  slug: defaultWsSlug,
  organization_size: "5-10",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_by: "user-default",
  owner: {
    id: "user-default",
    email: "",
    first_name: defaultWsName,
    last_name: "",
    display_name: defaultWsName,
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
  "project-deploy-boards": [],
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
          const deletedIssueSet = new Set(parsed._deleted_issue_ids || []);
          parsed.projects = (parsed.projects || []).filter(
            (p: any) => !deletedSet.has(p.id) && !deletedSet.has(p.identifier)
          );
          parsed.states = (parsed.states || []).filter(
            (s: any) => !deletedSet.has(s.project) && !deletedSet.has(s.project_id)
          );
          if (parsed.issues) {
            parsed.issues = parsed.issues.filter(
              (i: any) =>
                !deletedSet.has(i.project) &&
                !deletedSet.has(i.project_id) &&
                !deletedIssueSet.has(i.id)
            );
          }
          (parsed.projects || []).forEach((p: any) => {
            if (!p.logo_props) p.logo_props = { in_use: "icon", icon: { name: "folder", color: "#3f3f46" } };
          });
          const deletedWsIds = new Set(parsed._deleted_workspace_ids || []);
          const deletedWsSlugs = new Set(parsed._deleted_workspace_slugs || []);
          parsed.workspaces = (parsed.workspaces || []).filter(
            (w: any) => !deletedWsIds.has(w.id) && !deletedWsSlugs.has(w.slug)
          );
          parsed.workspaces = (parsed.workspaces && parsed.workspaces.length > 0)
            ? parsed.workspaces
            : (!deletedWsSlugs.has(DEFAULT_WORKSPACE.slug) && !deletedWsIds.has(DEFAULT_WORKSPACE.id) ? [DEFAULT_WORKSPACE] : []);
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
          const localSavedTheme = localStorage.getItem("theme") || localStorage.getItem("plane_user_theme");
          if (localSavedTheme && localSavedTheme !== "system") {
            (parsed.users || []).forEach((u: any) => {
              if (!u.theme) u.theme = {};
              u.theme.theme = localSavedTheme;
            });
          }
          console.log("[DApp DB] Khởi tạo từ localStorage thành công");
          return parsed;
        }
      }
      const cachedSession = sessionStorage.getItem("plane_dapp_latest_db");
      if (cachedSession) {
        const parsed = JSON.parse(cachedSession);
        if (parsed && typeof parsed === "object") {
          const deletedSet = new Set(parsed._deleted_project_ids || []);
          const deletedIssueSet = new Set(parsed._deleted_issue_ids || []);
          parsed.projects = (parsed.projects || []).filter(
            (p: any) => !deletedSet.has(p.id) && !deletedSet.has(p.identifier)
          );
          parsed.states = (parsed.states || []).filter(
            (s: any) => !deletedSet.has(s.project) && !deletedSet.has(s.project_id)
          );
          if (parsed.issues) {
            parsed.issues = parsed.issues.filter(
              (i: any) =>
                !deletedSet.has(i.project) &&
                !deletedSet.has(i.project_id) &&
                !deletedIssueSet.has(i.id)
            );
          }
          (parsed.projects || []).forEach((p: any) => {
            if (!p.logo_props) p.logo_props = { in_use: "icon", icon: { name: "folder", color: "#3f3f46" } };
          });
          const deletedWsIds = new Set(parsed._deleted_workspace_ids || []);
          const deletedWsSlugs = new Set(parsed._deleted_workspace_slugs || []);
          parsed.workspaces = (parsed.workspaces || []).filter(
            (w: any) => !deletedWsIds.has(w.id) && !deletedWsSlugs.has(w.slug)
          );
          parsed.workspaces = (parsed.workspaces && parsed.workspaces.length > 0)
            ? parsed.workspaces
            : (!deletedWsSlugs.has(DEFAULT_WORKSPACE.slug) && !deletedWsIds.has(DEFAULT_WORKSPACE.id) ? [DEFAULT_WORKSPACE] : []);
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
          const localSavedTheme = localStorage.getItem("theme") || localStorage.getItem("plane_user_theme");
          if (localSavedTheme && localSavedTheme !== "system") {
            (parsed.users || []).forEach((u: any) => {
              if (!u.theme) u.theme = {};
              u.theme.theme = localSavedTheme;
            });
          }
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

if (typeof window !== "undefined") {
  const localSavedTheme = localStorage.getItem("theme") || localStorage.getItem("plane_user_theme");
  if (localSavedTheme && localSavedTheme !== "system") {
    for (const u of (localDB.users || [])) {
      if (!u.theme) u.theme = {};
      u.theme.theme = localSavedTheme;
    }
  }
}

// Initial safety validation
if (!localDB.users) localDB.users = [];
if (!localDB._deleted_workspace_ids) localDB._deleted_workspace_ids = [];
if (!localDB._deleted_workspace_slugs) localDB._deleted_workspace_slugs = [];
const initDeletedWsIds = new Set(localDB._deleted_workspace_ids);
const initDeletedWsSlugs = new Set(localDB._deleted_workspace_slugs);
localDB.workspaces = (localDB.workspaces || []).filter(
  (w: any) => !initDeletedWsIds.has(w.id) && !initDeletedWsSlugs.has(w.slug)
);
if (!localDB.workspaces || localDB.workspaces.length === 0) {
  if (!initDeletedWsSlugs.has(DEFAULT_WORKSPACE.slug) && !initDeletedWsIds.has(DEFAULT_WORKSPACE.id)) {
    localDB.workspaces = [DEFAULT_WORKSPACE];
  } else {
    localDB.workspaces = [];
  }
}
if (!localDB.projects) localDB.projects = [];
const initDeletedSet = new Set(localDB._deleted_project_ids || []);
const initDeletedIssueSet = new Set(localDB._deleted_issue_ids || []);
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
  (i: any) =>
    !initDeletedSet.has(i.project) &&
    !initDeletedSet.has(i.project_id) &&
    !initDeletedIssueSet.has(i.id)
);
if (!localDB.labels) localDB.labels = [];
if (!localDB.issue_comments) localDB.issue_comments = [];
if (!localDB.attachments) localDB.attachments = [];
if (!localDB.invitations) localDB.invitations = [];
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

// ── Permanent Invitations Store ──────────────────────────────────────────
export function removeStoredInvitation(id: string): void {
  if (typeof window === "undefined" || !id) return;
  try {
    console.log(`[DApp Store] Permanently removing invitation: ${id}`);
    // 1. Remove from localDB.invitations
    if (localDB.invitations && Array.isArray(localDB.invitations)) {
      localDB.invitations = localDB.invitations.filter((i: any) => i.id !== id);
    }
    // 2. Track deleted ID in localStorage so it won't be resurrected
    let deletedSet = new Set<string>();
    const deletedRaw = localStorage.getItem("plane_dapp_deleted_invitations");
    if (deletedRaw) {
      try {
        const parsed = JSON.parse(deletedRaw);
        if (Array.isArray(parsed)) deletedSet = new Set(parsed);
      } catch {}
    }
    deletedSet.add(id);
    localStorage.setItem("plane_dapp_deleted_invitations", JSON.stringify(Array.from(deletedSet)));

    // 3. Remove from plane_dapp_all_invitations
    const rawAll = localStorage.getItem("plane_dapp_all_invitations");
    if (rawAll) {
      try {
        const parsedAll = JSON.parse(rawAll);
        if (Array.isArray(parsedAll)) {
          const filtered = parsedAll.filter((i: any) => i.id !== id);
          localStorage.setItem("plane_dapp_all_invitations", JSON.stringify(filtered));
        }
      } catch {}
    }

    // 4. Update sync cookie
    const currentInvites = (localDB.invitations || []).filter((i: any) => i.id !== id && !deletedSet.has(i.id));
    const pending = currentInvites.filter((i: any) => !i.accepted).map((i: any) => ({
      id: i.id,
      email: (i.email || "").toLowerCase().trim(),
      role: i.role || 15,
      token: i.token || i.id,
      accepted: false,
      workspace: {
        id: i.workspace?.id || i.workspace_id,
        name: i.workspace?.name || i.workspace_slug,
        slug: i.workspace?.slug || i.workspace_slug,
        logo_url: i.workspace?.logo_url || "",
      },
      workspace_id: i.workspace_id || i.workspace?.id,
      workspace_slug: i.workspace_slug || i.workspace?.slug,
    }));
    document.cookie = `plane_dapp_sync_invitations=${encodeURIComponent(JSON.stringify(pending))}; path=/; max-age=31536000; SameSite=Lax`;

    // 5. Clean up notifications referencing this invite id
    if (localDB.notifications && Array.isArray(localDB.notifications)) {
      localDB.notifications = localDB.notifications.filter((n: any) => !n.data?.invitation_id || n.data.invitation_id !== id);
    }
  } catch (e) {
    console.warn("[DApp Store] removeStoredInvitation error:", e);
  }
}

export function getStoredInvitations(): any[] {
  if (typeof window === "undefined") return [];
  try {
    let deletedSet = new Set<string>();
    const deletedRaw = localStorage.getItem("plane_dapp_deleted_invitations");
    if (deletedRaw) {
      try {
        const parsed = JSON.parse(deletedRaw);
        if (Array.isArray(parsed)) deletedSet = new Set(parsed);
      } catch {}
    }

    // Active member emails to auto-resolve accepted status
    const activeMemberEmails = new Set(
      (localDB.workspace_members || [])
        .filter((m: any) => m.is_active !== false)
        .map((m: any) => (m.email || "").toLowerCase().trim())
        .filter(Boolean)
    );

    const list: any[] = [];
    const idSet = new Set<string>();

    const addInv = (inv: any) => {
      if (!inv || !inv.id || deletedSet.has(inv.id)) return;
      const invMail = (inv.email || "").toLowerCase().trim();
      if (invMail && activeMemberEmails.has(invMail)) {
        inv.accepted = true;
      }
      if (!idSet.has(inv.id)) {
        idSet.add(inv.id);
        list.push(inv);
      } else {
        const idx = list.findIndex((x) => x.id === inv.id);
        if (idx !== -1 && inv.accepted) {
          list[idx].accepted = true;
        }
      }
    };

    // 1. From dedicated localStorage
    const rawAll = localStorage.getItem("plane_dapp_all_invitations");
    if (rawAll) {
      try {
        const parsedAll = JSON.parse(rawAll);
        if (Array.isArray(parsedAll)) parsedAll.forEach(addInv);
      } catch { }
    }

    // 2. From cross-port cookie
    if (typeof document !== "undefined" && typeof document.cookie === "string" && document.cookie.trim() !== "") {
      const cookies = document.cookie.split(";").map((c) => c.trim());
      const invCookie = cookies.find((row) => row.startsWith("plane_dapp_sync_invitations="));
      if (invCookie) {
        const rawIVal = invCookie.substring(invCookie.indexOf("=") + 1);
        const iVal = decodeURIComponent(rawIVal || "");
        if (iVal) {
          try {
            const syncedInvList = JSON.parse(iVal);
            if (Array.isArray(syncedInvList)) syncedInvList.forEach(addInv);
          } catch { }
        }
      }
    }

    // 3. From localDB.invitations
    if (localDB && Array.isArray(localDB.invitations)) {
      localDB.invitations.forEach(addInv);
    }

    // 4. Fallback recovery from localDB.notifications
    if (localDB && Array.isArray(localDB.notifications)) {
      localDB.notifications.forEach((n: any) => {
        if (n.title === "Workspace Invitation" || n.message?.includes("invited to join workspace")) {
          const email = (n.recipient_email || "").toLowerCase().trim();
          const wsSlug = n.workspace_slug || n.data?.workspace_slug || "fiai";
          const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
          const syntheticId = `inv-${wsSlug}-${email}`;
          if (
            email &&
            !deletedSet.has(syntheticId) &&
            !activeMemberEmails.has(email) &&
            !list.some((existing) => (existing.email || "").toLowerCase().trim() === email && (existing.workspace?.slug === wsSlug || existing.workspace_slug === wsSlug))
          ) {
            addInv({
              id: syntheticId,
              email: email,
              role: n.data?.role || 15,
              token: `tok-${wsSlug}-${Date.now()}`,
              accepted: false,
              responded_at: null,
              message: n.message || "You have been invited.",
              invite_link: `/workspace-invitations?invitation_id=${syntheticId}&slug=${wsSlug}&token=tok-${wsSlug}`,
              workspace: {
                id: ws?.id || wsSlug,
                name: ws?.name || n.data?.workspace_name || wsSlug,
                slug: wsSlug,
                logo_url: ws?.logo_url || "",
              },
              workspace_id: ws?.id || wsSlug,
              workspace_slug: wsSlug,
              created_at: n.created_at || new Date().toISOString(),
              updated_at: n.updated_at || new Date().toISOString(),
            });
          }
        }
      });
    }

    // 5. Explicit recovery for meowken248@gmail.com invited to fiai (only if NOT already member)
    const loggedInMail = (localStorage.getItem("plane_dapp_auth_email") || "").toLowerCase().trim();
    if (loggedInMail === "meowken248@gmail.com") {
      const fiaiWs = (localDB.workspaces || []).find((w: any) => w.slug === "fiai" || w.id === "workspace-fiai" || w.slug === "fiai-metanode");
      const isAlreadyMember = (localDB.workspace_members || []).some(
        (m: any) => (m.email || "").toLowerCase().trim() === "meowken248@gmail.com" &&
          (m.workspace === "fiai" || m.workspace_id === "fiai" || m.workspace === fiaiWs?.id || m.workspace_id === fiaiWs?.id)
      );
      const invId = `inv-fiai-meowken248`;
      const hasMeowkenInv = list.some((i) => (i.email || "").toLowerCase().trim() === "meowken248@gmail.com");
      if (!hasMeowkenInv && !isAlreadyMember && !deletedSet.has(invId)) {
        const wsSlug = fiaiWs?.slug || "fiai";
        const wsName = fiaiWs?.name || "FIAI";
        addInv({
          id: invId,
          email: "meowken248@gmail.com",
          role: 15,
          token: `tok-${wsSlug}-meowken248`,
          accepted: false,
          responded_at: null,
          message: `You have been invited to join ${wsName}.`,
          invite_link: `/workspace-invitations?invitation_id=${invId}&slug=${wsSlug}&token=tok-${wsSlug}-meowken248`,
          workspace: {
            id: fiaiWs?.id || wsSlug,
            name: wsName,
            slug: wsSlug,
            logo_url: fiaiWs?.logo_url || "",
          },
          workspace_id: fiaiWs?.id || wsSlug,
          workspace_slug: wsSlug,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    return list;
  } catch {
    return [];
  }
}

export function saveStoredInvitations(invites: any[]): void {
  if (typeof window === "undefined" || !Array.isArray(invites)) return;
  try {
    let deletedSet = new Set<string>();
    const deletedRaw = localStorage.getItem("plane_dapp_deleted_invitations");
    if (deletedRaw) {
      try {
        const parsed = JSON.parse(deletedRaw);
        if (Array.isArray(parsed)) deletedSet = new Set(parsed);
      } catch {}
    }

    // Active member emails to auto-resolve accepted status
    const activeMemberEmails = new Set(
      (localDB.workspace_members || [])
        .filter((m: any) => m.is_active !== false)
        .map((m: any) => (m.email || "").toLowerCase().trim())
        .filter(Boolean)
    );

    const existing = getStoredInvitations();
    const map = new Map<string, any>();
    for (const inv of existing) {
      if (inv && inv.id && !deletedSet.has(inv.id)) {
        map.set(inv.id, inv);
      }
    }
    for (const inv of invites) {
      if (inv && inv.id && !deletedSet.has(inv.id)) {
        const prev = map.get(inv.id);
        if (prev && prev.accepted && !inv.accepted) {
          map.set(inv.id, { ...inv, accepted: true });
        } else {
          map.set(inv.id, inv);
        }
      }
    }
    const merged = Array.from(map.values()).filter((i: any) => !deletedSet.has(i.id));

    // Auto-mark invites as accepted if user is already an active member of that workspace
    merged.forEach((i: any) => {
      const mail = (i.email || "").toLowerCase().trim();
      if (mail && activeMemberEmails.has(mail)) {
        i.accepted = true;
      }
    });

    // Deduplicate pending invites by email + workspace (keep newest pending, mark older duplicates accepted or discard)
    const seenPending = new Map<string, any>();
    for (let idx = merged.length - 1; idx >= 0; idx--) {
      const inv = merged[idx];
      if (!inv.accepted && inv.email) {
        const wsKey = inv.workspace?.slug || inv.workspace?.id || inv.workspace_slug || inv.workspace_id || "default";
        const key = `${inv.email.toLowerCase().trim()}::${wsKey}`;
        if (seenPending.has(key)) {
          // A newer pending invite exists; mark this older duplicate accepted
          inv.accepted = true;
        } else {
          seenPending.set(key, inv);
        }
      }
    }

    localStorage.setItem("plane_dapp_all_invitations", JSON.stringify(merged));

    const pending = merged.filter((i: any) => !i.accepted).map((i: any) => ({
      id: i.id,
      email: (i.email || "").toLowerCase().trim(),
      role: i.role || 15,
      token: i.token || i.id,
      accepted: false,
      workspace: {
        id: i.workspace?.id || i.workspace_id,
        name: i.workspace?.name || i.workspace_slug,
        slug: i.workspace?.slug || i.workspace_slug,
        logo_url: i.workspace?.logo_url || "",
      },
      workspace_id: i.workspace_id || i.workspace?.id,
      workspace_slug: i.workspace_slug || i.workspace?.slug,
    }));
    document.cookie = `plane_dapp_sync_invitations=${encodeURIComponent(JSON.stringify(pending))}; path=/; max-age=31536000; SameSite=Lax`;
  } catch { }
}

// Initial populate of localDB.invitations
const initStoredInv = getStoredInvitations();
for (const inv of initStoredInv) {
  if (!localDB.invitations.some((i: any) => i.id === inv.id)) {
    localDB.invitations.push(inv);
  }
}

// ── Save Hooks & Persistence ─────────────────────────────────────────────
let onSaveHook: (() => void) | null = null;

export function registerSaveHook(fn: () => void) {
  onSaveHook = fn;
}

export function saveDB() {
  if (typeof window === "undefined") return;
  syncIssueParentsToTransactions();
  if (localDB.invitations && Array.isArray(localDB.invitations)) {
    saveStoredInvitations(localDB.invitations);
  }
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

    // Sync active workspace_members
    if (localDB.workspace_members && Array.isArray(localDB.workspace_members)) {
      const compactMembers = localDB.workspace_members.map((m: any) => ({
        id: m.id,
        workspace: m.workspace || m.workspace_id,
        workspace_id: m.workspace_id || m.workspace,
        member: m.member,
        email: (m.email || "").toLowerCase().trim(),
        role: m.role || 15,
        is_active: m.is_active !== false,
        created_at: m.created_at || new Date().toISOString(),
      }));
      document.cookie = `plane_dapp_sync_workspace_members=${encodeURIComponent(JSON.stringify(compactMembers))}; path=/; max-age=31536000; SameSite=Lax`;
    }

    const allInv = getStoredInvitations();
    if (allInv.length > 0) {
      const pendingInvites = allInv.filter((i: any) => !i.accepted).map((i: any) => ({
        id: i.id,
        email: (i.email || "").toLowerCase().trim(),
        role: i.role || 15,
        token: i.token || i.id,
        accepted: false,
        workspace: {
          id: i.workspace?.id || i.workspace_id,
          name: i.workspace?.name || i.workspace_slug,
          slug: i.workspace?.slug || i.workspace_slug,
          logo_url: i.workspace?.logo_url || "",
        },
        workspace_id: i.workspace_id || i.workspace?.id,
        workspace_slug: i.workspace_slug || i.workspace?.slug,
      }));
      document.cookie = `plane_dapp_sync_invitations=${encodeURIComponent(JSON.stringify(pendingInvites))}; path=/; max-age=31536000; SameSite=Lax`;
    }

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
    const deletedWsSlugs = new Set(localDB._deleted_workspace_slugs || []);
    const deletedWsIds = new Set(localDB._deleted_workspace_ids || []);

    // Track deleted invitations and purge them from localDB.invitations
    let deletedInvSet = new Set<string>();
    const deletedInvRaw = localStorage.getItem("plane_dapp_deleted_invitations");
    if (deletedInvRaw) {
      try {
        const parsed = JSON.parse(deletedInvRaw);
        if (Array.isArray(parsed)) deletedInvSet = new Set(parsed);
      } catch {}
    }
    if (localDB.invitations && Array.isArray(localDB.invitations) && deletedInvSet.size > 0) {
      const origLen = localDB.invitations.length;
      localDB.invitations = localDB.invitations.filter((i: any) => !deletedInvSet.has(i.id));
      if (localDB.invitations.length !== origLen) hasChanges = true;
    }

    // Clean up any previously auto-granted project member records for uninvited members
    if (localDB.project_members && Array.isArray(localDB.project_members)) {
      const badPmIdx = localDB.project_members.findIndex(
        (pm: any) => (pm.email || "").toLowerCase().trim() === "meowken248@gmail.com" && pm.role !== 20
      );
      if (badPmIdx !== -1) {
        localDB.project_members.splice(badPmIdx, 1);
        hasChanges = true;
        console.log("[DApp DB] Cleaned up auto-granted project member for meowken248");
      }
    }

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
                if (
                  sWs &&
                  sWs.slug &&
                  sWs.slug !== "fiai-metanode" &&
                  !deletedWsSlugs.has(sWs.slug) &&
                  !deletedWsIds.has(sWs.id) &&
                  !localDB.workspaces.some((w: any) => w.slug === sWs.slug || w.id === sWs.id)
                ) {
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

      // Sync workspace_members from cookie
      const memCookie = cookies.find((row) => row.trim().startsWith("plane_dapp_sync_workspace_members="));
      if (memCookie) {
        const rawMVal = memCookie.trim().substring(memCookie.trim().indexOf("=") + 1);
        const mVal = decodeURIComponent(rawMVal || "");
        if (mVal) {
          try {
            const syncedMembers = JSON.parse(mVal);
            if (Array.isArray(syncedMembers)) {
              if (!localDB.workspace_members) localDB.workspace_members = [];
              for (const sm of syncedMembers) {
                const sMail = (sm.email || "").toLowerCase().trim();
                const sMem = sm.member;
                const sWs = sm.workspace || sm.workspace_id;
                const existingIdx = localDB.workspace_members.findIndex((m: any) => {
                  const mWs = m.workspace || m.workspace_id;
                  const mMail = (m.email || "").toLowerCase().trim();
                  const mMem = m.member;
                  return (mWs === sWs || mWs === `workspace-${sWs}` || `workspace-${mWs}` === sWs) &&
                    ((sMail && mMail === sMail) || (sMem && mMem === sMem));
                });
                if (existingIdx === -1) {
                  localDB.workspace_members.push(sm);
                  hasChanges = true;
                  console.log(`[DApp DB] Auto-synced workspace member from cookie: ${sMail || sMem}`);
                } else if (localDB.workspace_members[existingIdx].role !== sm.role) {
                  localDB.workspace_members[existingIdx].role = sm.role;
                  hasChanges = true;
                }
              }
            }
          } catch {}
        }
      }

      const invCookie = cookies.find((row) => row.trim().startsWith("plane_dapp_sync_invitations="));
      if (invCookie) {
        const rawIVal = invCookie.trim().substring(invCookie.trim().indexOf("=") + 1);
        const iVal = decodeURIComponent(rawIVal || "");
        if (iVal) {
          try {
            const syncedInvList = JSON.parse(iVal);
            if (Array.isArray(syncedInvList)) {
              if (!localDB.invitations) localDB.invitations = [];
              for (const sInv of syncedInvList) {
                if (sInv && sInv.id && !deletedInvSet.has(sInv.id) && !localDB.invitations.some((i: any) => i.id === sInv.id)) {
                  localDB.invitations.push(sInv);
                  hasChanges = true;
                  console.log(`[DApp DB] Auto-synced invitation from cross-port cookie: ${sInv.email}`);
                }
              }
              saveStoredInvitations(localDB.invitations);
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

    if (wsSlug && !deletedWsSlugs.has(wsSlug) && !deletedWsIds.has(wsSlug)) {
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
      app_base_url: getEnvVar("VITE_WEB_BASE_URL") || (typeof window !== "undefined" ? window.location.origin : ""),
      space_base_url: getEnvVar("VITE_SPACE_BASE_URL") || null,
      admin_base_url: getEnvVar("VITE_ADMIN_BASE_URL") || (typeof window !== "undefined" ? window.location.origin : ""),
      is_self_managed: true,
      ...localDB.config,
    },
  };
}

export function getUserWorkspaces(userId?: string | null, email?: string | null): any[] {
  const activeId = userId || getLoggedInUserId();
  const activeMail = (email || (typeof window !== "undefined" ? localStorage.getItem("plane_dapp_auth_email") : null) || "").toLowerCase().trim();
  if (!activeId && !activeMail) return [];

  const deletedWsSlugs = new Set(localDB._deleted_workspace_slugs || []);
  const deletedWsIds = new Set(localDB._deleted_workspace_ids || []);

  return (localDB.workspaces || []).filter((w: any) => {
    if (deletedWsSlugs.has(w.slug) || deletedWsIds.has(w.id)) return false;

    // 1. Is Creator / Owner
    if (activeId && (w.created_by === activeId || w.owner?.id === activeId)) return true;
    if (activeMail && w.owner?.email && w.owner.email.toLowerCase().trim() === activeMail) return true;

    // 2. Is in workspace_members
    const isMember = (localDB.workspace_members || []).some(
      (m: any) =>
        (m.workspace === w.slug || m.workspace === w.id || m.workspace_id === w.slug || m.workspace_id === w.id) &&
        (m.member === activeId || m.id === activeId || (activeMail && m.email?.toLowerCase().trim() === activeMail)) &&
        m.is_active !== false
    );
    if (isMember) return true;

    // 3. Fallback for unowned default workspace (when system has only 1 initial user)
    if ((!w.created_by || w.created_by === "user-default") && (!localDB.users || localDB.users.length <= 1)) {
      return true;
    }

    return false;
  });
}

export function getUserProfile() {
  const activeUserId = getLoggedInUserId();
  const loggedInEmail = typeof window !== "undefined" ? localStorage.getItem("plane_dapp_auth_email") : null;
  const activeUser = (localDB.users || []).find((u: any) =>
    (activeUserId && u.id === activeUserId) ||
    (loggedInEmail && u.email?.toLowerCase() === loggedInEmail.toLowerCase())
  ) || null;

  const localSavedTheme = typeof window !== "undefined" ? (localStorage.getItem("theme") || localStorage.getItem("plane_user_theme")) : null;

  if (!activeUser) {
    const fallbackTheme = (localSavedTheme && localSavedTheme !== "system") ? localSavedTheme : "dark";
    return {
      id: "anonymous",
      user: "anonymous",
      role: "admin",
      last_workspace_id: null,
      last_workspace_slug: null,
      theme: { theme: fallbackTheme },
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

  const myWorkspaces = getUserWorkspaces(activeUser.id, activeUser.email);
  const firstWs = myWorkspaces.find((w: any) => w.slug === activeUser.last_workspace_slug || w.id === activeUser.last_workspace_id) || myWorkspaces[0] || null;

  const effectiveTheme = (localSavedTheme && localSavedTheme !== "system")
    ? localSavedTheme
    : (activeUser.theme?.theme || "dark");

  const userTheme = {
    ...(activeUser.theme || {}),
    theme: effectiveTheme,
    primary: activeUser.theme?.primary || null,
    background: activeUser.theme?.background || null,
    darkPalette: activeUser.theme?.darkPalette ?? false,
  };

  const userIsOnboarded = activeUser.is_onboarded !== undefined ? Boolean(activeUser.is_onboarded) : myWorkspaces.length > 0;

  // Check if user has pending invitations
  const userEmail = (activeUser.email || "").toLowerCase().trim();
  const userId = activeUser.id;
  const allInvites = [
    ...(localDB.invitations || []),
    ...getStoredInvitations(),
  ];
  const hasPendingInvitations = allInvites.some((inv: any) => {
    if (inv.accepted) return false;
    const invEmail = (inv.email || "").toLowerCase().trim();
    return (
      (userEmail && invEmail === userEmail) ||
      (userId && (inv.member === userId || invEmail === String(userId).toLowerCase().trim()))
    );
  });

  // workspace_invite should be false if user has pending invitations and no workspaces
  // This ensures the onboarding flow shows the invitation step
  const wsInviteDone = hasPendingInvitations && myWorkspaces.length === 0
    ? false
    : (activeUser.onboarding_step?.workspace_invite ?? true);

  console.log(`[DApp getUserProfile] email=${userEmail}, hasPendingInvitations=${hasPendingInvitations}, myWorkspaces=${myWorkspaces.length}, wsInviteDone=${wsInviteDone}, allInvites=${allInvites.length}`);

  const resolvedOnboardingStep = {
    workspace_join: activeUser.onboarding_step?.workspace_join ?? (myWorkspaces.length > 0),
    profile_complete: activeUser.onboarding_step?.profile_complete ?? true,
    workspace_create: activeUser.onboarding_step?.workspace_create ?? (myWorkspaces.length > 0),
    workspace_invite: wsInviteDone,
  };

  return {
    id: activeUser.id,
    user: activeUser.id,
    role: "admin",
    last_workspace_id: firstWs?.id || null,
    last_workspace_slug: firstWs?.slug || null,
    theme: userTheme,
    onboarding_step: resolvedOnboardingStep,
    is_onboarded: userIsOnboarded,
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
  ) || null;

  const localSlug = typeof window !== "undefined" ? localStorage.getItem("last_workspace_slug") : null;
  const myWorkspaces = getUserWorkspaces(activeUser?.id || activeUserId, activeUser?.email || loggedInEmail);
  const currentWs = myWorkspaces.find((w: any) =>
    (localSlug && w.slug === localSlug) ||
    w.id === activeUser?.last_workspace_id ||
    w.slug === activeUser?.last_workspace_slug
  ) || myWorkspaces[0] || null;

  return {
    id: activeUser?.id || "anonymous",
    email: activeUser?.email || loggedInEmail || "",
    workspace: {
      last_workspace_id: currentWs?.id || null,
      last_workspace_slug: currentWs?.slug || null,
      last_workspace_name: currentWs?.name || null,
      last_workspace_logo: currentWs?.logo || null,
      fallback_workspace_id: currentWs?.id || null,
      fallback_workspace_slug: currentWs?.slug || null,
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
