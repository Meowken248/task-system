import type { DAppDatabase, DAppWorkspace } from "./types";
import { getStoredCredentials, setStoredCredential, createUserObject } from "./auth";
import { saveSnapshotToIDB } from "./indexed-db";

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
  inbox_issues: [],
  issue_relations: [],
  issue_links: [],
  issue_reactions: [],
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

// ── Auth state (persisted in localStorage and sessionStorage) ─────────────────
export function getLoggedInUserId(): string | null {
  if (typeof window === "undefined") return null;
  const stored = sessionStorage.getItem("plane_dapp_auth_user") || localStorage.getItem("plane_dapp_auth_user");
  if (stored) return stored;
  const email = getLoggedInEmail();
  if (email) {
    const uid = `user-${email.split("@")[0]}`;
    try {
      localStorage.setItem("plane_dapp_auth_user", uid);
    } catch {}
    return uid;
  }
  const wallet = sessionStorage.getItem("plane_active_wallet_address") || localStorage.getItem("plane_active_wallet_address");
  if (wallet) {
    const clean = wallet.trim().toLowerCase();
    const uid = `user-${clean.slice(2, 10)}`;
    try {
      localStorage.setItem("plane_dapp_auth_user", uid);
    } catch {}
    return uid;
  }
  return null;
}

export function getLoggedInEmail(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("plane_dapp_auth_email") || localStorage.getItem("plane_dapp_auth_email");
}

export function isLoggedIn(): boolean {
  if (getLoggedInUserId()) return true;
  if (getLoggedInEmail()) return true;
  if (typeof window !== "undefined") {
    const activeWallet = sessionStorage.getItem("plane_active_wallet_address") || localStorage.getItem("plane_active_wallet_address");
    if (activeWallet) return true;
  }
  return false;
}

export function setLoggedInUser(userId: string | null): void {
  if (typeof window === "undefined") return;
  if (userId) {
    sessionStorage.setItem("plane_dapp_auth_user", userId);
    localStorage.setItem("plane_dapp_auth_user", userId);
  } else {
    sessionStorage.removeItem("plane_dapp_auth_user");
    localStorage.removeItem("plane_dapp_auth_user");
    sessionStorage.removeItem("plane_dapp_auth_email");
    localStorage.removeItem("plane_dapp_auth_email");
    sessionStorage.removeItem("plane_active_wallet_address");
    localStorage.removeItem("plane_active_wallet_address");
    sessionStorage.removeItem("last_workspace_slug");
    localStorage.removeItem("last_workspace_slug");
    sessionStorage.removeItem("last_workspace_id");
    localStorage.removeItem("last_workspace_id");
    try {
      document.cookie = "last_workspace_slug=; path=/; max-age=0; SameSite=Lax";
    } catch {}
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
          const rawRemoved = localStorage.getItem("plane_dapp_removed_members");
          if (rawRemoved) {
            try {
              const parsedRm = JSON.parse(rawRemoved);
              if (parsedRm && typeof parsedRm === "object") {
                if (!parsed.removed_members) parsed.removed_members = {};
                Object.keys(parsedRm).forEach((ws) => {
                  if (!parsed.removed_members[ws]) parsed.removed_members[ws] = [];
                  (parsedRm[ws] || []).forEach((id: string) => {
                    const cleanId = String(id).toLowerCase().trim();
                    if (!parsed.removed_members[ws].includes(cleanId)) {
                      parsed.removed_members[ws].push(cleanId);
                    }
                  });
                });
              }
            } catch {}
          }
          if (parsed.removed_members && typeof parsed.removed_members === "object") {
            Object.keys(parsed.removed_members).forEach((ws) => {
              // Unban any user who has an active invitation or is an active workspace member
              const unbannedSet = new Set<string>();
              (parsed.invitations || []).forEach((inv: any) => {
                const invWs = inv.workspace?.slug || inv.workspace_slug || inv.workspace?.id || inv.workspace;
                if (!invWs || invWs === ws) {
                  if (inv.email) unbannedSet.add(inv.email.toLowerCase().trim());
                  if (inv.wallet_address) unbannedSet.add(inv.wallet_address.toLowerCase().trim());
                }
              });
              (parsed.workspace_members || []).forEach((m: any) => {
                const mWs = m.workspace || m.workspace_id;
                if ((!mWs || mWs === ws) && m.is_active !== false) {
                  if (m.email) unbannedSet.add(m.email.toLowerCase().trim());
                  if (m.wallet_address) unbannedSet.add(m.wallet_address.toLowerCase().trim());
                  if (typeof m.member === "string" && m.member.startsWith("0x")) unbannedSet.add(m.member.toLowerCase().trim());
                }
              });

              if (unbannedSet.size > 0) {
                parsed.removed_members[ws] = (parsed.removed_members[ws] || []).filter(
                  (item: string) => !unbannedSet.has(String(item).toLowerCase().trim())
                );
              }

              const rList = (parsed.removed_members[ws] || []).map((x: string) => String(x).toLowerCase().trim());
              const rSet = new Set(rList);
              if (parsed.workspace_members && Array.isArray(parsed.workspace_members)) {
                parsed.workspace_members = parsed.workspace_members.filter((m: any) => {
                  const mWs = m.workspace === ws || m.workspace_id === ws;
                  if (!mWs) return true;
                  const mMail = (m.email || "").toLowerCase().trim();
                  const mMem = String(m.member || "").toLowerCase().trim();
                  const mId = String(m.id || "").toLowerCase().trim();
                  const mWall = (m.wallet_address || "").toLowerCase().trim();
                  return !rSet.has(mMail) && !rSet.has(mMem) && !rSet.has(mId) && !rSet.has(mWall);
                });
              }
              if (parsed.invitations && Array.isArray(parsed.invitations)) {
                parsed.invitations = parsed.invitations.filter((i: any) => {
                  const iWs = i.workspace?.slug || i.workspace_slug || i.workspace?.id || i.workspace;
                  if (iWs && iWs !== ws) return true;
                  const iMail = (i.email || "").toLowerCase().trim();
                  const iId = String(i.id || "").toLowerCase().trim();
                  const iWall = (i.wallet_address || "").toLowerCase().trim();
                  return !rSet.has(iMail) && !rSet.has(iId) && !rSet.has(iWall);
                });
              }
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
if (!localDB.project_members) localDB.project_members = [];
if (!localDB.labels) localDB.labels = [];
if (!localDB.issue_comments) localDB.issue_comments = [];
if (!localDB.attachments) localDB.attachments = [];
if (!localDB.invitations) localDB.invitations = [];
if (!localDB.issue_relations) localDB.issue_relations = [];
if (!localDB.issue_links) localDB.issue_links = [];
if (!localDB.issue_reactions) localDB.issue_reactions = [];
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
    const issueMap = new Map<string, any>();
    localDB.issues.forEach((i: any) => {
      issueMap.set(i.id, i);
    });
    localDB["blockchain-transactions"].forEach((tx: any) => {
      if (tx.issue_id && issueMap.has(tx.issue_id)) {
        const issue = issueMap.get(tx.issue_id);
        if (issue) {
          if (!tx.project) tx.project = issue.project || issue.project_id;
          if (!tx.project_id) tx.project_id = issue.project_id || issue.project;
          if (!tx.issue_name) tx.issue_name = issue.name;
          if (!tx.workspace) tx.workspace = issue.workspace || issue.workspace_id;
          const parent = issue.parent_id || issue.parent;
          if (parent) {
            tx.parent_issue_id = parent;
          }
        }
      }
    });
  }
}
syncIssueParentsToTransactions();

// ── Permanent Invitations Store ──────────────────────────────────────────
export function removeStoredInvitation(id: string, email?: string): void {
  if (typeof window === "undefined" || (!id && !email)) return;
  try {
    const cleanMail = (email || "").toLowerCase().trim();
    console.log(`[DApp Store] Permanently removing invitation: id=${id}, email=${cleanMail}`);
    // 1. Remove from localDB.invitations
    if (localDB.invitations && Array.isArray(localDB.invitations)) {
      localDB.invitations = localDB.invitations.filter((i: any) => {
        if (id && i.id === id) return false;
        if (cleanMail && (i.email || "").toLowerCase().trim() === cleanMail) return false;
        return true;
      });
    }
    // 2. Track deleted ID & email in localStorage and localDB so it won't be resurrected
    let deletedSet = new Set<string>();
    const deletedRaw = localStorage.getItem("plane_dapp_deleted_invitations");
    if (deletedRaw) {
      try {
        const parsed = JSON.parse(deletedRaw);
        if (Array.isArray(parsed)) deletedSet = new Set(parsed);
      } catch {}
    }
    if (!localDB._deleted_invitation_ids) localDB._deleted_invitation_ids = [];
    if (id) {
      deletedSet.add(id);
      if (!localDB._deleted_invitation_ids.includes(id)) {
        localDB._deleted_invitation_ids.push(id);
      }
    }
    if (cleanMail) {
      (localDB.workspaces || []).forEach((w: any) => {
        const s = w.slug || w.id;
        if (s) {
          deletedSet.add(`inv-${s}-${cleanMail}`);
          if (!localDB._deleted_invitation_ids.includes(`inv-${s}-${cleanMail}`)) {
            localDB._deleted_invitation_ids.push(`inv-${s}-${cleanMail}`);
          }
        }
      });
    }
    localStorage.setItem("plane_dapp_deleted_invitations", JSON.stringify(Array.from(deletedSet)));

    // 3. Remove from plane_dapp_all_invitations
    const rawAll = localStorage.getItem("plane_dapp_all_invitations");
    if (rawAll) {
      try {
        const parsedAll = JSON.parse(rawAll);
        if (Array.isArray(parsedAll)) {
          const filtered = parsedAll.filter((i: any) => {
            if (id && i.id === id) return false;
            if (cleanMail && (i.email || "").toLowerCase().trim() === cleanMail) return false;
            return true;
          });
          localStorage.setItem("plane_dapp_all_invitations", JSON.stringify(filtered));
        }
      } catch {}
    }

    // 4. Update sync cookie
    const currentInvites = (localDB.invitations || []).filter((i: any) => (
      (!id || i.id !== id) &&
      (!cleanMail || (i.email || "").toLowerCase().trim() !== cleanMail) &&
      !deletedSet.has(i.id)
    ));
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

    // 5. Clean up notifications referencing this invite id or email
    if (localDB.notifications && Array.isArray(localDB.notifications)) {
      localDB.notifications = localDB.notifications.filter((n: any) => {
        if (id && n.data?.invitation_id === id) return false;
        if (cleanMail && (n.recipient_email || n.recipient || "").toLowerCase().trim() === cleanMail) return false;
        return true;
      });
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
    if (localDB._deleted_invitation_ids && Array.isArray(localDB._deleted_invitation_ids)) {
      localDB._deleted_invitation_ids.forEach((d: string) => deletedSet.add(d));
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

    const isMemberMatch = (targetMail: string) => {
      if (!targetMail) return false;
      const cleanTarget = targetMail.toLowerCase().trim();
      if (activeMemberEmails.has(cleanTarget)) return true;
      const targetPrefix = cleanTarget.split("@")[0];
      for (const actMail of Array.from(activeMemberEmails)) {
        const actPrefix = String(actMail).split("@")[0];
        if (
          (actPrefix.length >= 6 && targetPrefix.startsWith(actPrefix)) ||
          (targetPrefix.length >= 6 && actPrefix.startsWith(targetPrefix))
        ) {
          return true;
        }
      }
      return false;
    };

    const addInv = (inv: any) => {
      if (!inv || !inv.id || deletedSet.has(inv.id) || (inv.token && deletedSet.has(inv.token))) return;
      const invMail = (inv.email || "").toLowerCase().trim();
      const hasSignedToken = Boolean(inv.token && String(inv.token).startsWith("inv_"));
      const invWs = inv.workspace?.slug || inv.workspace_slug || inv.workspace?.id || inv.workspace;
      if (invWs && localDB.removed_members?.[invWs] && !hasSignedToken) {
        const isRemoved = localDB.removed_members[invWs].some(
          (r: string) => r.toLowerCase().trim() === invMail || r.toLowerCase().trim() === inv.id
        );
        if (isRemoved) return;
      }
      if (invMail && isMemberMatch(invMail)) {
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
          const isRemovedUser = (localDB.removed_members?.[wsSlug] || []).some(
            (r: string) => r.toLowerCase().trim() === email
          );
          const nInvId = n.data?.invitation_id || "";
          if (
            email &&
            !isRemovedUser &&
            !deletedSet.has(syntheticId) &&
            !deletedSet.has(email) &&
            (!nInvId || !deletedSet.has(nInvId)) &&
            !isMemberMatch(email) &&
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

    const filteredList = list.filter((inv: any) => {
      if (deletedSet.has(inv.id) || (inv.token && deletedSet.has(inv.token))) return false;
      const invMail = (inv.email || "").toLowerCase().trim();
      const hasSignedToken = Boolean(inv.token && String(inv.token).startsWith("inv_"));
      const invWs = inv.workspace?.slug || inv.workspace_slug || inv.workspace?.id || inv.workspace;
      if (invWs && localDB.removed_members?.[invWs] && !hasSignedToken) {
        const isRemoved = localDB.removed_members[invWs].some((r: string) => r.toLowerCase().trim() === invMail);
        if (isRemoved) return false;
      }
      return true;
    });

    return filteredList;
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
    if (localDB._deleted_invitation_ids && Array.isArray(localDB._deleted_invitation_ids)) {
      localDB._deleted_invitation_ids.forEach((d: string) => deletedSet.add(d));
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

    const isMemberMatch = (targetMail: string) => {
      if (!targetMail) return false;
      const cleanTarget = targetMail.toLowerCase().trim();
      if (activeMemberEmails.has(cleanTarget)) return true;
      const targetPrefix = cleanTarget.split("@")[0];
      for (const actMail of Array.from(activeMemberEmails)) {
        const actPrefix = String(actMail).split("@")[0];
        if (
          (actPrefix.length >= 6 && targetPrefix.startsWith(actPrefix)) ||
          (targetPrefix.length >= 6 && actPrefix.startsWith(targetPrefix))
        ) {
          return true;
        }
      }
      return false;
    };

    // Auto-mark invites as accepted if user is already an active member of that workspace
    merged.forEach((i: any) => {
      const mail = (i.email || "").toLowerCase().trim();
      if (mail && isMemberMatch(mail)) {
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
    if (localDB.removed_members) {
      localStorage.setItem("plane_dapp_removed_members", JSON.stringify(localDB.removed_members));
    }
  } catch (err) {
    console.warn("[DApp Store] localStorage.setItem failed (possibly quota exceeded):", err);
  }
  try {
    const curCid = (typeof localStorage !== "undefined" ? localStorage.getItem("plane_dapp_ipfs_cid_local") : null);
    void saveSnapshotToIDB(localDB, curCid || undefined);
  } catch { }
  syncWorkspacesToCookie();
  try {
    const isSpaceViewer = typeof window !== "undefined" && (
      window.location.port === "3002" ||
      window.location.pathname.startsWith("/spaces") ||
      window.location.pathname.startsWith("/issues/")
    );
    if (!isSpaceViewer) {
      const curCid = (typeof localStorage !== "undefined" ? localStorage.getItem("plane_dapp_ipfs_cid_local") : null);
      dappSyncChannel?.postMessage({
        type: "SYNC_STATE",
        cid: curCid,
        members: localDB.workspace_members || [],
        invitations: localDB.invitations || [],
        removed_members: localDB.removed_members || {},
      });
    }
  } catch { }
  if (onSaveHook) {
    onSaveHook();
  }
}

export const dappSyncChannel = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
  ? new BroadcastChannel("plane_dapp_sync_channel")
  : null;

if (dappSyncChannel) {
  dappSyncChannel.onmessage = (event) => {
    try {
      const { type, cid, members, invitations, removed_members } = event.data || {};
      if (type === "SYNC_STATE") {
        let updated = false;
        if (removed_members && typeof removed_members === "object") {
          if (!localDB.removed_members) localDB.removed_members = {};
          Object.keys(removed_members).forEach((ws) => {
            if (!localDB.removed_members[ws]) localDB.removed_members[ws] = [];
            (removed_members[ws] || []).forEach((id: string) => {
              const cleanId = String(id).toLowerCase().trim();
              if (!localDB.removed_members[ws].includes(cleanId)) {
                localDB.removed_members[ws].push(cleanId);
                updated = true;
              }
            });
          });
          localStorage.setItem("plane_dapp_removed_members", JSON.stringify(localDB.removed_members));
        }

        if (members && Array.isArray(members)) {
          if (!localDB.workspace_members) localDB.workspace_members = [];
          for (const m of members) {
            const mMail = (m.email || "").toLowerCase().trim();
            const mMem = String(m.member || "").toLowerCase().trim();
            const mId = String(m.id || "").toLowerCase().trim();
            const mWall = (m.wallet_address || "").toLowerCase().trim();
            const mWs = m.workspace || m.workspace_id;
            const wsRemoved = (localDB.removed_members?.[mWs] || []).map((x: string) => String(x).toLowerCase().trim());
            const isRemoved = wsRemoved.some((r: string) => r === mMail || r === mMem || r === mId || r === mWall);
            if (isRemoved) {
              if (m.is_active !== false && m.verified_on_chain) {
                // Member was re-added/confirmed on-chain -> un-stale from removed_members
                if (localDB.removed_members?.[mWs]) {
                  localDB.removed_members[mWs] = localDB.removed_members[mWs].filter((r: string) => {
                    const cleanR = r.toLowerCase().trim();
                    return cleanR !== mMail && cleanR !== mMem && cleanR !== mId && cleanR !== mWall;
                  });
                  localStorage.setItem("plane_dapp_removed_members", JSON.stringify(localDB.removed_members));
                }
              } else {
                continue;
              }
            }

            const existingIdx = localDB.workspace_members.findIndex(
              (x: any) => (mMail && (x.email || "").toLowerCase().trim() === mMail) || (m.member && x.member === m.member)
            );
            if (existingIdx === -1) {
              localDB.workspace_members.push(m);
              updated = true;
            } else if (localDB.workspace_members[existingIdx].role !== m.role) {
              localDB.workspace_members[existingIdx].role = m.role;
              updated = true;
            }
          }
        }
        if (invitations && Array.isArray(invitations)) {
          if (!localDB.invitations) localDB.invitations = [];
          for (const inv of invitations) {
            const invMail = (inv.email || "").toLowerCase().trim();
            const invWs = inv.workspace?.slug || inv.workspace_slug || inv.workspace?.id || inv.workspace;
            // Active invitation un-stales email from removed_members
            if (invWs && localDB.removed_members?.[invWs] && invMail) {
              localDB.removed_members[invWs] = localDB.removed_members[invWs].filter(
                (r: string) => r.toLowerCase().trim() !== invMail && r.toLowerCase().trim() !== inv.id
              );
              localStorage.setItem("plane_dapp_removed_members", JSON.stringify(localDB.removed_members));
            }

            const existingIdx = localDB.invitations.findIndex((x: any) => x.id === inv.id);
            if (existingIdx === -1) {
              localDB.invitations.push(inv);
              updated = true;
            } else if (inv.accepted && !localDB.invitations[existingIdx].accepted) {
              localDB.invitations[existingIdx].accepted = true;
              updated = true;
            }
          }
          saveStoredInvitations(localDB.invitations);
        }
        if (cid && !cid.startsWith("bafkrei") && cid !== localStorage.getItem("plane_dapp_ipfs_cid_local")) {
          if (typeof window !== "undefined" && (window as any).__isDAppDirty) {
            console.log("[DApp DB] Đang có thay đổi chưa lưu tại local, bỏ qua BroadcastChannel CID sync.");
          } else {
            localStorage.setItem("plane_dapp_ipfs_cid_local", cid);
            localStorage.setItem("plane_dapp_ipfs_cid_last_valid", cid);
            if (typeof window !== "undefined" && (window as any).restoreFromIPFS) {
              void (window as any).restoreFromIPFS(cid);
            }
          }
        }
        if (updated) {
          const snapshot = JSON.stringify(localDB);
          localStorage.setItem("plane_dapp_local_db", snapshot);
          sessionStorage.setItem("plane_dapp_latest_db", snapshot);
          if (typeof window !== "undefined") {
            try {
              window.dispatchEvent(new CustomEvent("plane_dapp_members_synced", { detail: event.data }));
            } catch { }
          }
        }
      } else if (type === "MEMBER_REMOVED") {
        const { workspaceSlug, removedIdentifiers, payload } = event.data || {};
        const ws = workspaceSlug || payload?.workspace_slug;
        const idList = removedIdentifiers || [payload?.email, payload?.member_id, payload?.member_address, payload?.user_id].filter(Boolean);
        if (ws && Array.isArray(idList) && idList.length > 0) {
          if (!localDB.removed_members) localDB.removed_members = {};
          if (!localDB.removed_members[ws]) localDB.removed_members[ws] = [];
          for (const rid of idList) {
            const cleanRid = String(rid).toLowerCase().trim();
            if (!localDB.removed_members[ws].includes(cleanRid)) {
              localDB.removed_members[ws].push(cleanRid);
            }
          }
          localStorage.setItem("plane_dapp_removed_members", JSON.stringify(localDB.removed_members));
          const ridSet = new Set(idList.map((x: string) => String(x).toLowerCase().trim()));
          if (localDB.workspace_members) {
            localDB.workspace_members = localDB.workspace_members.filter((m: any) => {
              const mMail = (m.email || "").toLowerCase().trim();
              const mMem = String(m.member || "").toLowerCase().trim();
              const mId = String(m.id || "").toLowerCase().trim();
              const mWall = (m.wallet_address || "").toLowerCase().trim();
              return !ridSet.has(mMail) && !ridSet.has(mMem) && !ridSet.has(mId) && !ridSet.has(mWall);
            });
          }
          for (const rid of idList) {
            removeStoredInvitation(String(rid), String(rid));
          }
          const snapshot = JSON.stringify(localDB);
          localStorage.setItem("plane_dapp_local_db", snapshot);
          sessionStorage.setItem("plane_dapp_latest_db", snapshot);

          // Check if current browser tab belongs to the removed member and kick out in real-time
          if (typeof window !== "undefined") {
            const activeUid = (getLoggedInUserId() || "").toLowerCase().trim();
            const activeMail = (getLoggedInEmail() || "").toLowerCase().trim();
            const activeWallet = (
              sessionStorage.getItem("plane_active_wallet_address") ||
              localStorage.getItem("plane_active_wallet_address") ||
              ""
            ).toLowerCase().trim();

            const curUser = (localDB.users || []).find((u: any) =>
              (activeUid && String(u.id).toLowerCase().trim() === activeUid) ||
              (activeMail && (u.email || "").toLowerCase().trim() === activeMail)
            );
            const curUserEth = (curUser?.metanode_wallet_address || curUser?.wallet_address || "").toLowerCase().trim();
            const curUserMail = (curUser?.email || "").toLowerCase().trim();

            const isCurrentRemoved =
              (activeUid && ridSet.has(activeUid)) ||
              (activeMail && ridSet.has(activeMail)) ||
              (curUserMail && ridSet.has(curUserMail)) ||
              (activeWallet && ridSet.has(activeWallet)) ||
              (curUserEth && ridSet.has(curUserEth));

            if (isCurrentRemoved) {
              console.warn(`[DApp DB] Current session (${activeMail || activeUid || activeWallet}) was removed from workspace "${ws}". Triggering real-time kick-out.`);
              window.dispatchEvent(
                new CustomEvent("plane_member_kicked_out", {
                  detail: { workspaceSlug: ws, reason: "removed" },
                })
              );

              const currentPath = window.location.pathname;
              if (
                currentPath.includes(`/${ws}/`) ||
                currentPath === `/${ws}` ||
                currentPath.startsWith(`/${ws}`)
              ) {
                setTimeout(() => {
                  window.location.href = "/";
                }, 300);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn("[DApp DB] BroadcastChannel message error:", err);
    }
  };
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
        wallet_address: m.wallet_address || (typeof m.member === "string" && m.member.startsWith("0x") ? m.member : undefined),
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

      const acceptedIds = allInv.filter((i: any) => i.accepted).map((i: any) => i.id);
      if (acceptedIds.length > 0) {
        document.cookie = `plane_dapp_sync_accepted_invitations=${encodeURIComponent(JSON.stringify(acceptedIds))}; path=/; max-age=31536000; SameSite=Lax`;
      }
    }

    const isSpaceViewer = typeof window !== "undefined" && (
      window.location.port === "3002" ||
      window.location.pathname.startsWith("/spaces") ||
      window.location.pathname.startsWith("/issues/")
    );
    if (!isSpaceViewer) {
      const cidToSync = cid || (typeof localStorage !== "undefined" ? localStorage.getItem("plane_dapp_ipfs_cid_local") || localStorage.getItem("plane_dapp_ipfs_cid_last_valid") : null);
      if (cidToSync && !cidToSync.startsWith("bafkrei")) {
        document.cookie = `plane_dapp_sync_cid=${encodeURIComponent(cidToSync)}; path=/; max-age=31536000; SameSite=Lax`;
      }
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
                } else {
                  if (localDB.workspace_members[existingIdx].role !== sm.role) {
                    localDB.workspace_members[existingIdx].role = sm.role;
                    hasChanges = true;
                  }
                  if (sm.wallet_address && !localDB.workspace_members[existingIdx].wallet_address) {
                    localDB.workspace_members[existingIdx].wallet_address = sm.wallet_address;
                    hasChanges = true;
                  }
                }
              }
            }
          } catch {}
        }
      }

      const accCookie = cookies.find((row) => row.trim().startsWith("plane_dapp_sync_accepted_invitations="));
      if (accCookie) {
        const rawAVal = accCookie.trim().substring(accCookie.trim().indexOf("=") + 1);
        const aVal = decodeURIComponent(rawAVal || "");
        if (aVal) {
          try {
            const accIds = JSON.parse(aVal);
            if (Array.isArray(accIds) && localDB.invitations) {
              const accSet = new Set(accIds);
              for (const inv of localDB.invitations) {
                if (accSet.has(inv.id) && !inv.accepted) {
                  inv.accepted = true;
                  hasChanges = true;
                }
              }
            }
          } catch { }
        }
      }

      // Auto-resolve invitations for active workspace members (including typo/alias invites)
      if (localDB.workspace_members && localDB.invitations) {
        const activeMails = new Set(
          localDB.workspace_members
            .filter((m: any) => m.is_active !== false)
            .map((m: any) => (m.email || "").toLowerCase().trim())
            .filter(Boolean)
        );
        for (const inv of localDB.invitations) {
          const invMail = (inv.email || "").toLowerCase().trim();
          if (invMail && (activeMails.has(invMail) || (activeMails.has("meowken248@gmail.com") && invMail.startsWith("meowken248")))) {
            if (!inv.accepted) {
              inv.accepted = true;
              hasChanges = true;
            }
          }
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
          if (typeof window !== "undefined" && (window as any).__isDAppDirty) {
            console.log("[DApp DB] Đang có thay đổi chưa lưu tại local, bỏ qua đồng bộ từ cookie.");
          } else {
            localStorage.setItem("plane_dapp_ipfs_cid_local", cVal);
            localStorage.setItem("plane_dapp_ipfs_cid_last_valid", cVal);
            if (onNewCIDDetected) {
              onNewCIDDetected(cVal);
            } else if (typeof window !== "undefined" && (window as any).restoreFromIPFS) {
              void (window as any).restoreFromIPFS(cVal);
            }
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
  const activeMail = (email || getLoggedInEmail() || "").toLowerCase().trim();
  const activeWallet = (
    typeof window !== "undefined"
      ? (sessionStorage.getItem("plane_active_wallet_address") || localStorage.getItem("plane_active_wallet_address"))
      : null
  )?.toLowerCase().trim();
  if (!activeId && !activeMail && !activeWallet) return [];

  const deletedWsSlugs = new Set(localDB._deleted_workspace_slugs || []);
  const deletedWsIds = new Set(localDB._deleted_workspace_ids || []);

  return (localDB.workspaces || []).filter((w: any) => {
    if (deletedWsSlugs.has(w.slug) || deletedWsIds.has(w.id)) return false;

    // 1. Is Creator / Owner
    if (activeId && (w.created_by === activeId || w.owner?.id === activeId)) return true;
    if (activeMail && w.owner?.email && w.owner.email.toLowerCase().trim() === activeMail) return true;

    // 2. Is in workspace_members
    const isMember = (localDB.workspace_members || []).some(
      (m: any) => {
        const matchWs = (m.workspace === w.slug || m.workspace === w.id || m.workspace_id === w.slug || m.workspace_id === w.id);
        if (!matchWs) return false;
        if (m.is_active === false) return false;
        if (activeId && (m.member === activeId || m.id === activeId)) return true;
        if (activeMail && m.email && m.email.toLowerCase().trim() === activeMail) return true;
        if (activeWallet) {
          const mWall = (m.wallet_address || (typeof m.member === "string" && m.member.startsWith("0x") ? m.member : "")).toLowerCase().trim();
          if (mWall && mWall === activeWallet) return true;
        }
        return false;
      }
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
  const loggedInEmail = getLoggedInEmail();
  const activeWallet = typeof window !== "undefined"
    ? (sessionStorage.getItem("plane_active_wallet_address") || localStorage.getItem("plane_active_wallet_address"))?.toLowerCase().trim()
    : null;

  let activeUser: any = null;
  if (activeUserId || loggedInEmail) {
    activeUser = (localDB.users || []).find((u: any) =>
      (activeUserId && u.id === activeUserId) ||
      (loggedInEmail && u.email?.toLowerCase().trim() === loggedInEmail.toLowerCase().trim())
    ) || null;
  }
  if (!activeUser && activeWallet) {
    activeUser = (localDB.users || []).find((u: any) =>
      u.metanode_wallet_address?.toLowerCase() === activeWallet ||
      u.wallet_address?.toLowerCase() === activeWallet ||
      u.id?.toLowerCase() === activeWallet
    ) || null;
  }

  const localSavedTheme = typeof window !== "undefined" ? (localStorage.getItem("theme") || localStorage.getItem("plane_user_theme")) : null;

  if (!activeUser) {
    if (loggedInEmail || activeWallet) {
      const email = loggedInEmail || (activeWallet ? `${activeWallet}@fiai.network` : "user@plane.local");
      const namePart = email.split("@")[0];
      const newUser = createUserObject(activeUserId || activeWallet || `user-${namePart}`, email);
      if (activeWallet) (newUser as any).metanode_wallet_address = activeWallet;
      if (!localDB.users) localDB.users = [];
      localDB.users.push(newUser);
      saveDB();
      activeUser = newUser;
    }
  }

  if (!activeUser) {
    const fallbackTheme = (localSavedTheme && localSavedTheme !== "system") ? localSavedTheme : "dark";
    return {
      id: "anonymous",
      user: "anonymous",
      email: loggedInEmail || "",
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

  const userEmail = (activeUser.email || "").toLowerCase().trim();
  const userId = activeUser.id;
  const allInvites = [
    ...(localDB.invitations || []),
    ...getStoredInvitations(),
  ];

  // Check if user is a member of any workspace or has accepted invitations
  const memberWs = (localDB.workspace_members || []).find((m: any) =>
    (m.email && m.email.toLowerCase().trim() === userEmail) ||
    (m.member && (m.member === userId || m.member === activeUser.metanode_wallet_address?.toLowerCase())) ||
    (activeWallet && (m.wallet_address?.toLowerCase() === activeWallet || (typeof m.member === "string" && m.member.toLowerCase() === activeWallet)))
  );
  const acceptedInv = allInvites.find((inv: any) =>
    inv.accepted &&
    ((userEmail && (inv.email || "").toLowerCase().trim() === userEmail) ||
     (userId && (inv.member === userId || (inv.email || "").toLowerCase().trim() === String(userId).toLowerCase().trim())) ||
     (activeWallet && (inv.wallet_address || "").toLowerCase() === activeWallet))
  );

  const myWorkspaces = getUserWorkspaces(activeUser.id, activeUser.email);
  const firstWs = myWorkspaces.find((w: any) => w.slug === activeUser.last_workspace_slug || w.id === activeUser.last_workspace_id) || myWorkspaces[0] || null;
  const isMemberOrInvited = myWorkspaces.length > 0 || Boolean(memberWs) || Boolean(acceptedInv);

  const fallbackWsSlug = activeUser.last_workspace_slug || firstWs?.slug || memberWs?.workspace || memberWs?.workspace_id || acceptedInv?.workspace?.slug || acceptedInv?.workspace_slug || null;
  const fallbackWsId = activeUser.last_workspace_id || firstWs?.id || memberWs?.workspace_id || memberWs?.workspace || acceptedInv?.workspace?.id || null;

  if (isMemberOrInvited) {
    activeUser.is_onboarded = true;
    if (fallbackWsSlug && !activeUser.last_workspace_slug) {
      activeUser.last_workspace_slug = fallbackWsSlug;
      activeUser.last_workspace_id = fallbackWsId;
    }
  }

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

  const userIsOnboarded = activeUser.is_onboarded !== undefined ? Boolean(activeUser.is_onboarded) : isMemberOrInvited;

  const myWsKeys = new Set(myWorkspaces.map((w: any) => w.slug || w.id));
  const hasPendingInvitations = allInvites.some((inv: any) => {
    if (inv.accepted) return false;
    const invWs = inv.workspace?.slug || inv.workspace_slug || inv.workspace?.id || inv.workspace;
    if (invWs && myWsKeys.has(invWs)) return false;
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

  console.log(`[DApp getUserProfile] email=${userEmail}, isMemberOrInvited=${isMemberOrInvited}, hasPendingInvitations=${hasPendingInvitations}, myWorkspaces=${myWorkspaces.length}, wsInviteDone=${wsInviteDone}, allInvites=${allInvites.length}`);

  const resolvedOnboardingStep = {
    workspace_join: activeUser.onboarding_step?.workspace_join ?? isMemberOrInvited,
    profile_complete: activeUser.onboarding_step?.profile_complete ?? true,
    workspace_create: activeUser.onboarding_step?.workspace_create ?? isMemberOrInvited,
    workspace_invite: wsInviteDone || isMemberOrInvited,
  };

  return {
    id: activeUser.id,
    user: activeUser.id,
    role: "admin",
    last_workspace_id: firstWs?.id || fallbackWsId || null,
    last_workspace_slug: firstWs?.slug || fallbackWsSlug || null,
    theme: userTheme,
    onboarding_step: resolvedOnboardingStep,
    is_onboarded: isMemberOrInvited ? true : userIsOnboarded,
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
  const activeWallet = typeof window !== "undefined"
    ? (sessionStorage.getItem("plane_active_wallet_address") || localStorage.getItem("plane_active_wallet_address"))?.toLowerCase().trim()
    : null;
  const activeUser = (localDB.users || []).find((u: any) =>
    (activeUserId && u.id === activeUserId) ||
    (loggedInEmail && u.email?.toLowerCase() === loggedInEmail.toLowerCase()) ||
    (activeWallet && (u.metanode_wallet_address?.toLowerCase() === activeWallet || u.id?.toLowerCase() === activeWallet))
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
