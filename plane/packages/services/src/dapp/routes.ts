import { handleFileAssetRoute } from "./file-assets";
import { requireWorkspaceAccess, requireIssueAccess, resourceProject, ResourceAccessError } from "./resource-access";
import type { RouteResult } from "./types";
import { hashPassword, getStoredCredentials, setStoredCredential, createUserObject, generateAndStoreOtp, verifyOtpCode, clearOtpCode } from "./auth";
import {
  localDB,
  saveDB,
  getContractGas,
  getDefaultWorkspaceSlug,
  getLoggedInUserId,
  getLoggedInEmail,
  isLoggedIn,
  setLoggedInUser,
  syncCrossPortWorkspaces,
  getInstanceInfo,
  getUserProfile,
  getUserSettings,
  getUserWorkspaces,
  getStoredInvitations,
  saveStoredInvitations,
  removeStoredInvitation,
  readInvitationTombstones,
  isInvitationDeleted,
  makeInvitationTombstoneKey,
  getInvitationWorkspaceKeys,
  dappSyncChannel,
  getEnvVar,
  getWorkspaceMemberCount,
} from "./store";
import {
  uploadToIPFS,
  fetchFromIPFS,
  applyOffchainDB,
  directRpcRead,
  decodeAbiWorkspace,
  abiEncodeGetWorkspace,
  baseCID,
  currentUserAddress,
  getStoredWalletAddress,
  getFiaiSDK,
  getWorkspaceRegistryAddress,
  WORKSPACE_REGISTRY_ADDRESS,
  CREATE_WORKSPACE_ABI,
  extractEthAddress,
  syncDAppRecord,
  getLastUploadedCID,
  removeWorkspaceMemberOnChain,
  leaveWorkspaceOnChain,
  MembershipOperationError,
  scheduleWorkspaceCIDCommit,
  fetchWorkspaceMembersOnChain,
  fetchMemberRoleOnChain,
  assertVaultSigningAddress,
  canManageWorkspaceOnChain,
  setWorkspaceMemberRoleOnChain,
  commitWorkspaceCID,
  writeWorkspaceWalletInvitation,
} from "./chain";
import { sendWorkspaceInviteEmail, sendOtpEmail } from "./mail";
import {
  findNonProjectAssignees as findNonProjectAssigneesPure,
  describeInvalidAssignees,
} from "./assignee-validation";
import {
  INVITE_TOKEN_TTL_MS as INVITE_TOKEN_TTL_MS_SOURCE,
  createInvitationToken,
  decodeInvitationToken,
  isInvitationTokenExpired,
  type InvitationTokenClaims,
} from "./invitation-tokens";

import { respondToWorkspaceInvitation, findLocalWorkspace } from "./workspace-invitations";
import { invitationLink, withInvitationLock } from "./invitation-policy";
import { listWorkspaceMembers } from "./workspace-members";
import { addWorkspaceWalletMember, discoverWalletWorkspaces, cacheVerifiedWalletMember } from "./workspace-wallet-members";
import { deleteAttachment } from "../file/attachment-storage";
export { readWorkspaceSnapshotFromChain, recoverInvitationFromChainSnapshot, findLocalWorkspace, buildWorkspaceFromChainSnapshot, upsertWorkspaceMemberRecord } from "./workspace-invitations";
const escapeCsv = (val: any): string => {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
};

const describeRelatedIssue = (relatedIssue: any) =>
  relatedIssue?.project_detail?.identifier && relatedIssue?.sequence_id
    ? `${relatedIssue.project_detail.identifier}-${relatedIssue.sequence_id}`
    : relatedIssue?.name || "";

export { ok, parseApiUrl };

/** Re-exported for legacy callers — see `./invitation-tokens`. */
export const INVITE_TOKEN_TTL_MS = INVITE_TOKEN_TTL_MS_SOURCE;

/** Legacy helper (claims-shaped payload → token). Prefer `createInvitationToken`. */
export function encodeInviteToken(data: any): string {
  try {
    return createInvitationToken({
      id: String(data?.id ?? ""),
      workspaceSlug: String(data?.ws ?? data?.workspaceSlug ?? ""),
      email: data?.email,
      role: typeof data?.role === "number" ? data.role : null,
      wallet: data?.wallet,
      expiresAt: data?.exp ?? null,
    });
  } catch {
    return "";
  }
}

/** Decode the claims of an invitation link token (`null` for legacy opaque tokens). */
export function decodeInviteToken(token: string): InvitationTokenClaims | null {
  return decodeInvitationToken(token);
}

export function isInviteTokenExpired(inv: any): boolean {
  return isInvitationTokenExpired(inv);
}

let lastLoadedPublicCid: string | null = null;
const activeExportBlobUrls = new Map<string, string>();

export { getWorkspaceMemberCount };

export function getWorkspaceRemovedSet(slugOrId: string | undefined | null): Set<string> {
  const set = new Set<string>();
  if (!slugOrId) return set;
  const cleanKey = String(slugOrId).toLowerCase().trim();
  const ws = (localDB.workspaces || []).find(
    (w: any) =>
      (w.slug && String(w.slug).toLowerCase().trim() === cleanKey) ||
      (w.id && String(w.id).toLowerCase().trim() === cleanKey)
  );
  const keys = Array.from(
    new Set([cleanKey, ws?.slug ? String(ws.slug).toLowerCase().trim() : null, ws?.id ? String(ws.id).toLowerCase().trim() : null].filter(Boolean))
  ) as string[];
  for (const k of keys) {
    const list = localDB.removed_members?.[k] || [];
    if (Array.isArray(list)) {
      list.forEach((item: string) => {
        if (item) set.add(String(item).toLowerCase().trim());
      });
    }
  }
  return set;
}

export function addWorkspaceRemovedIdentifiers(slugOrId: string | undefined | null, identifiers: string[]): void {
  if (!slugOrId || !identifiers || identifiers.length === 0) return;
  const cleanKey = String(slugOrId).toLowerCase().trim();
  const ws = (localDB.workspaces || []).find(
    (w: any) =>
      (w.slug && String(w.slug).toLowerCase().trim() === cleanKey) ||
      (w.id && String(w.id).toLowerCase().trim() === cleanKey)
  );
  const keys = Array.from(
    new Set([cleanKey, ws?.slug ? String(ws.slug).toLowerCase().trim() : null, ws?.id ? String(ws.id).toLowerCase().trim() : null].filter(Boolean))
  ) as string[];
  if (!localDB.removed_members) localDB.removed_members = {};
  for (const k of keys) {
    if (!localDB.removed_members[k]) localDB.removed_members[k] = [];
    identifiers.forEach((ident) => {
      const cleanIdent = String(ident).toLowerCase().trim();
      if (cleanIdent && !localDB.removed_members[k].includes(cleanIdent)) {
        localDB.removed_members[k].push(cleanIdent);
      }
    });
  }
  try {
    localStorage.setItem("plane_dapp_removed_members", JSON.stringify(localDB.removed_members));
  } catch { }
}


// ── Work item assignee validation (D-B) ────────────────────────────────
// The pure rules live in `./assignee-validation`; these wrappers bind them to
// the local database.
export function findNonProjectAssignees(
  projectId: string | undefined | null,
  assigneeIds: any[],
  alreadyAssigned: any[] = []
): string[] {
  return findNonProjectAssigneesPure(projectId, assigneeIds, alreadyAssigned, {
    projects: localDB.projects,
    projectMembers: localDB.project_members,
    users: localDB.users,
  });
}

export function buildAssigneeValidationError(projectId: string, invalidIds: string[]) {
  const labels = describeInvalidAssignees(invalidIds, { users: localDB.users });
  return {
    error: `Chưa thể gán công việc: ${labels.join(", ")} chưa thuộc dự án này. Vui lòng thêm vào dự án trước khi giao việc.`,
    code: "ASSIGNEE_NOT_IN_PROJECT",
    project: projectId,
    invalid_assignees: invalidIds,
  };
}

// ── Work item activity helpers ────────────────────────────────────────
// Every mutation of a work item records an entry in `localDB.issue_activities`.
// That single collection feeds both `/issues/:id/history/` (activity tab) and
// `/users/me/activities/` (home widgets), mirroring the real Plane API.
const getIssueActivities = (): any[] => {
  if (!Array.isArray(localDB.issue_activities)) localDB.issue_activities = [];
  return localDB.issue_activities;
};

const getActivityActorDetail = () => {
  const users = localDB.users || [];
  const loggedInId = getLoggedInUserId();
  const normalizedEmail = (getLoggedInEmail() || "").toLowerCase().trim();
  const actor =
    (normalizedEmail
      ? users.find((user: any) => (user.email || "").toLowerCase().trim() === normalizedEmail)
      : null) ||
    users.find((user: any) => user.id === loggedInId) ||
    users[0];
  const firstName = actor?.first_name || "";
  const lastName = actor?.last_name || "";
  return {
    id: actor?.id || loggedInId || "user-default",
    first_name: firstName,
    last_name: lastName,
    avatar_url: actor?.avatar_url || actor?.avatar || "",
    is_bot: false,
    display_name:
      actor?.display_name || [firstName, lastName].filter(Boolean).join(" ") || actor?.email || "Plane",
  };
};

const getActivityWorkspaceDetail = (issue: any) => {
  const project =
    issue?.project_detail ||
    (localDB.projects || []).find((item: any) => item.id === (issue?.project_id || issue?.project));
  const wsKey =
    issue?.workspace_id ||
    issue?.workspace ||
    project?.workspace_id ||
    project?.workspace ||
    issue?.project_detail?.workspace_id ||
    issue?.project_detail?.workspace;
  const ws = (localDB.workspaces || []).find((item: any) => item.id === wsKey || item.slug === wsKey);
  return { id: ws?.id || wsKey || "", slug: ws?.slug || "", name: ws?.name || "" };
};

const getActivityProjectDetail = (issue: any) => {
  const project =
    issue?.project_detail ||
    (localDB.projects || []).find((p: any) => p.id === (issue?.project_id || issue?.project));
  return {
    id: project?.id || issue?.project_id || issue?.project || "",
    identifier: project?.identifier || "",
    name: project?.name || "",
    cover_image: project?.cover_image || "",
    description: project?.description ?? null,
    emoji: project?.emoji ?? null,
    icon_prop: project?.icon_prop ?? null,
  };
};

const formatActivityValue = (value: any): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && typeof value.name === "string") return value.name;
  return "";
};

const createIssueActivity = (
  issue: any,
  field: string | null,
  oldValue: any,
  newValue: any,
  verb: "created" | "updated" | "deleted" = "updated",
  identifiers: { oldIdentifier?: string | null; newIdentifier?: string | null } = {}
) => {
  if (!issue?.id) return null;
  const actorDetail = getActivityActorDetail();
  const timestamp = new Date().toISOString();
  const activity = {
    id: crypto.randomUUID?.() || `activity-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    workspace: issue?.workspace_id || issue?.workspace || "",
    workspace_detail: getActivityWorkspaceDetail(issue),
    project: issue?.project_id || issue?.project || "",
    project_detail: getActivityProjectDetail(issue),
    issue: issue.id,
    issue_detail: {
      id: issue.id,
      sequence_id: issue.sequence_id,
      sort_order: issue.sort_order,
      name: issue.name,
      description_html: issue.description_html || "<p></p>",
      priority: issue.priority ?? "none",
      start_date: issue.start_date ?? null,
      target_date: issue.target_date ?? null,
      is_draft: Boolean(issue.is_draft),
    },
    actor: actorDetail.id,
    actor_detail: actorDetail,
    created_at: timestamp,
    updated_at: timestamp,
    created_by: actorDetail.id,
    updated_by: actorDetail.id,
    attachments: [],
    verb,
    field,
    old_value: formatActivityValue(oldValue),
    new_value: formatActivityValue(newValue),
    comment: null,
    old_identifier: identifiers.oldIdentifier ?? null,
    new_identifier: identifiers.newIdentifier ?? null,
    epoch: Date.parse(timestamp),
    issue_comment: null,
    source_data: { source: "IN_APP", extra: {} },
  };
  getIssueActivities().push(activity);
  return activity;
};

const toIdArray = (value: any): string[] =>
  Array.isArray(value)
    ? value.filter((item: any) => item !== null && item !== undefined && item !== "").map(String)
    : [];

const resolveAssigneeName = (assigneeId: string): string => {
  const user = (localDB.users || []).find((u: any) => u.id === assigneeId);
  if (user) {
    return (
      user.display_name || [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email || assigneeId
    );
  }
  const member = (localDB.workspace_members || []).find(
    (m: any) => m.member === assigneeId || m.id === assigneeId || m.email === assigneeId
  );
  if (member) {
    return (
      member.display_name ||
      [member.first_name, member.last_name].filter(Boolean).join(" ") ||
      member.email ||
      assigneeId
    );
  }
  return assigneeId;
};

const resolveLabelName = (labelId: string): string => {
  const label = (localDB.labels || []).find((l: any) => l.id === labelId);
  return label?.name || labelId;
};

const resolveStateName = (stateId: string): string => {
  if (!stateId) return "";
  const state = (localDB.states || []).find((s: any) => s.id === stateId);
  return state?.name || stateId;
};

/**
 * Compares the previous and the updated version of a work item and records one
 * activity entry per changed property, following the exact `field` / `old_value`
 * / `new_value` conventions the activity UI components consume.
 */
const recordIssueUpdateActivities = (previous: any, next: any) => {
  if (!previous || !next) return;

  const previousStateId = previous.state_id || previous.state || "";
  const nextStateId = next.state_id || next.state || "";
  if (nextStateId && nextStateId !== previousStateId) {
    createIssueActivity(next, "state", resolveStateName(previousStateId), resolveStateName(nextStateId));
  }

  if (next.priority && next.priority !== previous.priority) {
    createIssueActivity(next, "priority", previous.priority, next.priority);
  }

  if (typeof next.name === "string" && next.name !== previous.name) {
    createIssueActivity(next, "name", previous.name, next.name);
  }

  if (typeof next.description_html === "string" && next.description_html !== previous.description_html) {
    createIssueActivity(next, "description", previous.description_html, next.description_html);
  }

  if (next.start_date !== previous.start_date) {
    createIssueActivity(next, "start_date", previous.start_date, next.start_date);
  }

  if (next.target_date !== previous.target_date) {
    createIssueActivity(next, "target_date", previous.target_date, next.target_date);
  }

  const previousAssignees = toIdArray(previous.assignee_ids);
  const nextAssignees = toIdArray(next.assignee_ids);
  nextAssignees
    .filter((assigneeId) => !previousAssignees.includes(assigneeId))
    .forEach((assigneeId) =>
      createIssueActivity(next, "assignees", "", resolveAssigneeName(assigneeId), "updated", {
        newIdentifier: assigneeId,
      })
    );
  previousAssignees
    .filter((assigneeId) => !nextAssignees.includes(assigneeId))
    .forEach((assigneeId) =>
      createIssueActivity(next, "assignees", resolveAssigneeName(assigneeId), "", "updated", {
        oldIdentifier: assigneeId,
      })
    );

  const previousLabels = toIdArray(previous.label_ids);
  const nextLabels = toIdArray(next.label_ids);
  nextLabels
    .filter((labelId) => !previousLabels.includes(labelId))
    .forEach((labelId) =>
      createIssueActivity(next, "labels", "", resolveLabelName(labelId), "updated", { newIdentifier: labelId })
    );
  previousLabels
    .filter((labelId) => !nextLabels.includes(labelId))
    .forEach((labelId) =>
      createIssueActivity(next, "labels", resolveLabelName(labelId), "", "updated", { oldIdentifier: labelId })
    );
};

/**
 * Resolves a work item from the URL scope, supporting both UUIDs and
 * `<PROJECT_IDENTIFIER>-<sequence_id>` style identifiers.
 */
const findIssueByRouteParam = (issueParam: string, projectParam?: string | null) => {
  if (!issueParam) return undefined;
  const issues = localDB.issues || [];
  const directMatch = issues.find((issue: any) => issue.id === issueParam);
  if (directMatch) return directMatch;

  const project = projectParam
    ? (localDB.projects || []).find(
      (p: any) =>
        p.id === projectParam || (p.identifier && p.identifier.toLowerCase() === projectParam.toLowerCase())
    )
    : undefined;
  const projectKeys = new Set([projectParam, project?.id, project?.identifier].filter(Boolean) as string[]);

  const sequenceMatch = issues.find(
    (issue: any) =>
      String(issue.sequence_id) === String(issueParam) &&
      (projectKeys.size === 0 ||
        projectKeys.has(issue.project) ||
        projectKeys.has(issue.project_id) ||
        projectKeys.has(issue.project_detail?.identifier))
  );
  if (sequenceMatch) return sequenceMatch;

  if (issueParam.includes("-")) {
    const [identifier, sequence] = issueParam.split("-");
    const parsedSequence = Number.parseInt(sequence, 10);
    if (identifier && !Number.isNaN(parsedSequence)) {
      return issues.find(
        (issue: any) =>
          issue.project_detail?.identifier?.toLowerCase() === identifier.toLowerCase() &&
          Number(issue.sequence_id) === parsedSequence
      );
    }
  }

  return undefined;
};

/**
 * Builds the paginated envelope expected by `BaseIssuesStore.processIssueResponse`.
 * An array `results` means "ungrouped"; an object keyed by group id means "grouped".
 */
const buildIssueResponseEnvelope = (issues: any[], groupBy?: string | null) => {
  const totalCount = issues.length;
  const baseEnvelope = {
    count: totalCount,
    next_cursor: `${issues.length}:0:0`,
    prev_cursor: `${issues.length}:0:0`,
    next_page_results: false,
    prev_page_results: false,
    total_pages: 1,
    total_count: totalCount,
    extra_stats: null,
  };

  if (!groupBy) {
    return { ...baseEnvelope, grouped_by: null, sub_grouped_by: null, results: issues };
  }

  const groupedResults: Record<string, { results: any[]; total_results: number }> = {};
  issues.forEach((issue: any) => {
    let groupKeys: string[] = [];
    switch (groupBy) {
      case "state":
        groupKeys = [issue.state_id || issue.state || "none"];
        break;
      case "priority":
        groupKeys = [issue.priority || "none"];
        break;
      case "cycle":
        groupKeys = [issue.cycle_id || issue.cycle || "none"];
        break;
      case "module":
        groupKeys = toIdArray(issue.module_ids);
        break;
      case "labels":
        groupKeys = toIdArray(issue.label_ids);
        break;
      case "assignees":
        groupKeys = toIdArray(issue.assignee_ids);
        break;
      case "created_by":
        groupKeys = [issue.created_by || "none"];
        break;
      default:
        groupKeys = [];
    }
    if (groupKeys.length === 0) groupKeys = ["none"];
    groupKeys.forEach((groupKey) => {
      if (!groupedResults[groupKey]) groupedResults[groupKey] = { results: [], total_results: 0 };
      groupedResults[groupKey].results.push(issue);
      groupedResults[groupKey].total_results += 1;
    });
  });

  return { ...baseEnvelope, grouped_by: groupBy, sub_grouped_by: null, results: groupedResults };
};

/** Matches a comma separated query filter (e.g. `priority=high,urgent`). */
const matchesCsvFilter = (rawValues: any, filterValue: string | null): boolean => {
  if (!filterValue) return true;
  const expected = filterValue
    .split(",")
    .map((value) => decodeURIComponent(value).trim().toLowerCase())
    .filter(Boolean);
  if (expected.length === 0) return true;
  const actualValues = new Set((Array.isArray(rawValues) ? rawValues : [rawValues])
    .filter((value: any) => value !== null && value !== undefined)
    .map((value) => String(value).toLowerCase().trim()));
  return expected.some((value) => actualValues.has(value));
};

/**
 * Kiểm tra nhanh một dự án có thật trong bản dữ liệu của không gian làm việc trên chain hay không.
 *
 * Dùng cho trường hợp **mở link chia sẻ** mà bản dữ liệu trên máy chưa có dự án: cần phân biệt
 * "dự án không tồn tại" (404) với "dự án có thật nhưng mình chưa được cấp quyền / chưa đồng bộ"
 * (403) — nếu trả 404, người dùng tưởng dự án đã bị xoá (lỗi BA-21).
 *
 * Chỉ chạy ở nhánh không tìm thấy dự án trong dữ liệu cục bộ nên không ảnh hưởng luồng bình thường.
 */
async function projectExistsInWorkspaceSnapshot(wsSlug: string, projectId: string): Promise<boolean> {
  if (!wsSlug || !projectId) return false;
  const registry = getWorkspaceRegistryAddress();
  if (!registry) return false;
  try {
    const workspaceInfo = await directRpcRead(registry, abiEncodeGetWorkspace(wsSlug), 4000);
    const cid = decodeAbiWorkspace(workspaceInfo)?.ipfsCID?.trim();
    if (!cid) return false;
    const snapshot = await fetchFromIPFS(cid);
    const projects: any[] = Array.isArray(snapshot?.projects) ? snapshot.projects : [];
    const target = projectId.toLowerCase();
    return projects.some(
      (project: any) =>
        String(project?.id ?? "").toLowerCase() === target ||
        String(project?.identifier ?? "").toLowerCase() === target
    );
  } catch (error) {
    console.warn("[DApp Routes] Không đọc được dữ liệu không gian làm việc trên chain để kiểm tra quyền:", error);
    return false;
  }
}

export async function handleRoute(method: string, url: string, body: Record<string, any>): Promise<RouteResult> {
  const management = url.match(/\/api\/workspaces\/([^/?#]+)\/(?:invitations|members)(?:\/|\?|$)/);
  if (management && !/\/join\/?(?:\?|$)/.test(url) && ["post", "put", "patch", "delete"].includes(method)) {
    return withInvitationLock(`management:${management[1]}`, () => handleRouteUnlocked(method, url, body));
  }
  return handleRouteUnlocked(method, url, body);
}

async function handleRouteUnlocked(
  method: string, url: string, body: Record<string, any>, preserveInvitationId?: string
): Promise<RouteResult> {
  console.log(`[Dapp interceptor] INTERCEPTED ${method.toUpperCase()} ${url}`);
  syncCrossPortWorkspaces();
  const routeSessionUserId = getLoggedInUserId();
  const loggedInEmail = typeof window !== "undefined"
    ? (sessionStorage.getItem("plane_dapp_auth_email") || localStorage.getItem("plane_dapp_auth_email"))
    : null;
  const routeSessionWallet = typeof window !== "undefined"
    ? (sessionStorage.getItem("plane_active_wallet_address") || localStorage.getItem("plane_active_wallet_address"))?.toLowerCase().trim()
    : null;
  let routeSessionUser: any = null;
  if (loggedInEmail) {
    routeSessionUser = (localDB.users || []).find((u: any) =>
      u.email?.toLowerCase().trim() === loggedInEmail.toLowerCase().trim()
    );
  }
  if (!routeSessionUser && routeSessionUserId) {
    routeSessionUser = (localDB.users || []).find((u: any) => u.id === routeSessionUserId);
  }
  if (!routeSessionUser && (currentUserAddress || routeSessionWallet)) {
    const targetWallet = (currentUserAddress || routeSessionWallet || "").toLowerCase().trim();
    if (targetWallet) {
      routeSessionUser = (localDB.users || []).find((u: any) =>
        u.id?.toLowerCase() === targetWallet ||
        u.metanode_wallet_address?.toLowerCase() === targetWallet ||
        u.wallet_address?.toLowerCase() === targetWallet ||
        u.email?.toLowerCase().startsWith(targetWallet) ||
        u.username?.toLowerCase() === targetWallet
      );
    }
  }
  if (!routeSessionUser && routeSessionUserId && loggedInEmail) {
    routeSessionUser = createUserObject(routeSessionUserId, loggedInEmail);
    if (!localDB.users) localDB.users = [];
    localDB.users.push(routeSessionUser);
    saveDB();
  }
  if (!routeSessionUser && (localDB.users || []).length === 1 && !loggedInEmail && !currentUserAddress && !routeSessionWallet) {
    routeSessionUser = localDB.users[0];
  }

  // Workspace management is authorised by the signing wallet's contract role,
  // never an email, a local role, or a role supplied in the request body.
  const managementRoute = url.match(/\/api\/workspaces\/([^/?#]+)\/(?:invitations|members)(?:\/|\?|$)/);
  const selfLeaveRequest = method === "post" && /\/api\/workspaces\/[^/?#]+\/(?:workspace-members|members)\/leave\/?(?:\?.*)?$/.test(url);
  if (managementRoute && !selfLeaveRequest && !/\/join\/?(?:\?|$)/.test(url) && ["post", "put", "patch", "delete"].includes(method)) {
    if (!getLoggedInUserId()) return { status: 401, data: { code: "AUTH_REQUIRED", error: "Vui lòng đăng nhập." } };
    try {
      const requested = getStoredWalletAddress() || currentUserAddress;
      const signer = await assertVaultSigningAddress(requested);
      if (requested && signer.toLowerCase() !== requested.toLowerCase()) return { status: 409, data: { code: "SIGNING_WALLET_CHANGED", error: "Ví ký đã thay đổi. Hãy chọn lại ví rồi thực hiện lại." } };
      if (!await canManageWorkspaceOnChain(decodeURIComponent(managementRoute[1]), signer)) return { status: 403, data: { code: "NOT_AUTHORIZED", error: "Chỉ quản trị viên của không gian làm việc mới được thực hiện thao tác này." } };
    } catch (error) {
      return { status: 503, data: { code: "PERMISSION_UNAVAILABLE", error: error instanceof Error ? error.message : "Chưa kiểm tra được quyền quản trị. Hãy thử lại sau." } };
    }
  }


  const addWalletMemberRoute = url.match(/\/api\/workspaces\/([^/?#]+)\/members\/?(?:\?.*)?$/);
  if (addWalletMemberRoute && method === "post") return addWorkspaceWalletMember(decodeURIComponent(addWalletMemberRoute[1]), body);

  // Validate destructive requests before touching records, cascades or tombstones.
  const destructiveRoute = url.split("?")[0].match(/^\/api\/workspaces\/([^/]+)(?:\/projects\/([^/]+))?\/?$/);
  if (method === "delete" && destructiveRoute) {
    try {
      const access = await requireWorkspaceAccess(decodeURIComponent(destructiveRoute[1]), true);
      if (destructiveRoute[2]) resourceProject(access.workspace, decodeURIComponent(destructiveRoute[2]));
    } catch (error) {
      if (!(error instanceof ResourceAccessError)) throw error;
      return { status: error.status, data: { code: error.code, error: error.message } };
    }
  }

  // ── Workspace Membership Route Guard (block removed members from workspace APIs) ──
  const wsGuardMatch = url.match(/\/api\/workspaces\/([^/?#]+)/);
  if (
    wsGuardMatch &&
    !selfLeaveRequest &&
    !url.includes("/workspace-slug-check") &&
    !url.includes("/invitations") &&
    !url.includes("/workspace-members/me")
  ) {
    const targetWsSlug = wsGuardMatch[1];
    const removedSet = getWorkspaceRemovedSet(targetWsSlug);
    if (removedSet.size > 0) {
      const activeMail = (loggedInEmail || routeSessionUser?.email || "").toLowerCase().trim();
      const activeId = String(routeSessionUserId || routeSessionUser?.id || "").toLowerCase().trim();
      const activeWallet = (
        (routeSessionUser as any)?.metanode_wallet_address ||
        (routeSessionUser as any)?.wallet_address ||
        (typeof window !== "undefined"
          ? (sessionStorage.getItem("plane_active_wallet_address") || localStorage.getItem("plane_active_wallet_address"))
          : null) ||
        currentUserAddress ||
        getStoredWalletAddress() ||
        ""
      ).toLowerCase().trim();

      const isRemoved =
        (activeMail && removedSet.has(activeMail)) ||
        (activeId && removedSet.has(activeId)) ||
        (activeWallet && removedSet.has(activeWallet));

      const ws = (localDB.workspaces || []).find((w: any) => w.slug === targetWsSlug || w.id === targetWsSlug);
      const isOwner =
        ws &&
        ((ws.created_by && (ws.created_by === activeId || (activeMail && ws.created_by === activeMail))) ||
          (ws.owner && (ws.owner.id === activeId || (activeMail && ws.owner.email?.toLowerCase() === activeMail))) ||
          (activeWallet && (ws.created_by?.toLowerCase() === activeWallet || ws.owner?.id?.toLowerCase() === activeWallet)));

      if (isRemoved && !isOwner) {
        console.warn(`[DApp Routes] Blocked request for removed member (${activeMail || activeId || activeWallet}) on workspace "${targetWsSlug}": ${url}`);
        return { data: { error: "You have been removed from this workspace" }, status: 403 };
      }
    }
  }

  // ── Workspace Slug Check (used by web:3000 and god-mode:3001) ───────
  if (url.includes("/api/workspace-slug-check") || url.includes("/api/instances/workspace-slug-check")) {
    const qsMatch = url.match(/[?&]slug=([^&]+)/);
    const slug = qsMatch ? decodeURIComponent(qsMatch[1]) : "";
    const exists = (localDB.workspaces || []).some((w: any) => w.slug?.toLowerCase() === slug.toLowerCase());
    return ok({ status: !exists });
  }

  // ── Workspace Sidebar Preferences ─────────────────────────────────
  if (url.includes("/sidebar-preferences")) {
    const slugMatch = url.match(/\/workspaces\/([^/]+)\/sidebar-preferences/);
    const slug = slugMatch ? slugMatch[1] : "";
    if (!localDB.sidebarPreferences) localDB.sidebarPreferences = {};
    const defaultPrefs: Record<string, any> = {
      views: { key: "views", is_pinned: true, sort_order: 1 },
      analytics: { key: "analytics", is_pinned: true, sort_order: 2 },
      archives: { key: "archives", is_pinned: true, sort_order: 3 },
    };
    if (method.toUpperCase() === "GET") {
      return ok(localDB.sidebarPreferences[slug] || defaultPrefs);
    }
    if (method.toUpperCase() === "PATCH") {
      if (!localDB.sidebarPreferences[slug]) {
        localDB.sidebarPreferences[slug] = { ...defaultPrefs };
      }
      if (Array.isArray(body)) {
        body.forEach((item: any) => {
          if (item && item.key) {
            localDB.sidebarPreferences[slug][item.key] = item;
          }
        });
      } else if (body && typeof body === "object") {
        Object.assign(localDB.sidebarPreferences[slug], body);
      }
      saveDB();
      return ok(localDB.sidebarPreferences[slug]);
    }
    return ok(defaultPrefs);
  }

  // ── Workspace Analytics Endpoints ─────────────────────────────────
  if (url.includes("/advance-analytics-charts")) {
    const slugMatch = url.match(/\/workspaces\/([^/?]+)/);
    const slug = slugMatch ? slugMatch[1] : "";
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === slug || w.id === slug);
    const wsKeys = new Set([slug, ws?.id, ws?.slug].filter(Boolean));
    const wsProjects = (localDB.projects || []).filter((p: any) => wsKeys.has(p.workspace) || wsKeys.has(p.workspace_id));
    const wsProjectIds = new Set(wsProjects.map((p: any) => p.id));
    const wsIssues = (localDB.issues || []).filter((i: any) => wsProjectIds.has(i.project || i.project_id) && !(localDB._deleted_issue_ids || []).includes(i.id) && !i.is_draft);

    const typeMatch = url.match(/[?&]type=([^&]+)/);
    const chartType = typeMatch ? decodeURIComponent(typeMatch[1]) : "projects";

    if (chartType === "projects") {
      const chartData = wsProjects.map((p: any) => {
        const count = wsIssues.filter((i: any) => (i.project || i.project_id) === p.id).length;
        return {
          key: p.id,
          name: p.name || "Untitled Project",
          count,
        };
      });
      return ok(chartData);
    }

    if (chartType === "work-items") {
      const createdMap: Record<string, number> = {};
      const resolvedMap: Record<string, number> = {};
      wsIssues.forEach((i: any) => {
        const cDate = (i.created_at || i.created_on || "").split("T")[0];
        if (cDate) createdMap[cDate] = (createdMap[cDate] || 0) + 1;
        if (i.completed_at) {
          const rDate = i.completed_at.split("T")[0];
          if (rDate) resolvedMap[rDate] = (resolvedMap[rDate] || 0) + 1;
        }
      });
      const allDates = Array.from(new Set([...Object.keys(createdMap), ...Object.keys(resolvedMap)])).toSorted();
      const data = allDates.map((date) => ({
        key: date,
        name: date,
        count: (createdMap[date] || 0) + (resolvedMap[date] || 0),
        created: createdMap[date] || 0,
        resolved: resolvedMap[date] || 0,
      }));
      return ok({
        schema: { created: "Created", resolved: "Resolved" },
        data,
      });
    }

    // custom-work-items
    const priorityCounts: Record<string, number> = { urgent: 0, high: 0, medium: 0, low: 0, none: 0 };
    wsIssues.forEach((i: any) => {
      const prio = (i.priority || "none").toLowerCase();
      if (prio in priorityCounts) priorityCounts[prio]++;
      else priorityCounts["none"]++;
    });
    const data = Object.entries(priorityCounts).map(([key, count]) => ({
      key,
      name: key.charAt(0).toUpperCase() + key.slice(1),
      count,
    }));
    return ok({
      schema: { count: "Count" },
      data,
    });
  }

  if (url.includes("/advance-analytics-stats")) {
    const slugMatch = url.match(/\/workspaces\/([^/?]+)/);
    const slug = slugMatch ? slugMatch[1] : "";
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === slug || w.id === slug);
    const wsKeys = new Set([slug, ws?.id, ws?.slug].filter(Boolean));
    const wsProjects = (localDB.projects || []).filter((p: any) => wsKeys.has(p.workspace) || wsKeys.has(p.workspace_id));
    const wsProjectIds = new Set(wsProjects.map((p: any) => p.id));
    const wsIssues = (localDB.issues || []).filter((i: any) => wsProjectIds.has(i.project || i.project_id) && !(localDB._deleted_issue_ids || []).includes(i.id) && !i.is_draft);

    const states = localDB.states || [];
    const stateGroupMap = new Map(states.map((s: any) => [s.id, s.group]));
    const stats = wsProjects.map((p: any) => {
      const pIssues = wsIssues.filter((i: any) => (i.project || i.project_id) === p.id);
      let backlog = 0, started = 0, unstarted = 0, completed = 0, cancelled = 0;
      pIssues.forEach((i: any) => {
        const group = stateGroupMap.get(i.state_id || i.state) || i.state_detail?.group || "backlog";
        if (group === "backlog") backlog++;
        else if (group === "started") started++;
        else if (group === "unstarted") unstarted++;
        else if (group === "completed") completed++;
        else if (group === "cancelled") cancelled++;
        else unstarted++;
      });
      return {
        project_id: p.id,
        project__name: p.name || "Untitled Project",
        backlog_work_items: backlog,
        started_work_items: started,
        un_started_work_items: unstarted,
        completed_work_items: completed,
        cancelled_work_items: cancelled,
      };
    });
    return ok(stats);
  }

  if (url.includes("/project-stats")) {
    const slugMatch = url.match(/\/workspaces\/([^/?]+)/);
    const slug = slugMatch ? slugMatch[1] : "";
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === slug || w.id === slug);
    const wsKeys = new Set([slug, ws?.id, ws?.slug].filter(Boolean));
    const wsProjects = (localDB.projects || []).filter((p: any) => wsKeys.has(p.workspace) || wsKeys.has(p.workspace_id));
    const wsProjectIds = new Set(wsProjects.map((p: any) => p.id));
    const wsIssues = (localDB.issues || []).filter((i: any) => wsProjectIds.has(i.project || i.project_id) && !(localDB._deleted_issue_ids || []).includes(i.id) && !i.is_draft);

    const states = localDB.states || [];
    const completedStateIds = new Set(states.filter((s: any) => s.group === "completed").map((s: any) => s.id));
    const projectStats = wsProjects.map((p: any) => {
      const pIssues = wsIssues.filter((i: any) => (i.project || i.project_id) === p.id);
      const completed_issues = pIssues.filter((i: any) => completedStateIds.has(i.state_id || i.state) || i.completed_at).length;
      return {
        id: p.id,
        total_issues: pIssues.length,
        completed_issues,
      };
    });
    return ok(projectStats);
  }

  if (url.includes("/advance-analytics")) {
    const slugMatch = url.match(/\/workspaces\/([^/?]+)/);
    const slug = slugMatch ? slugMatch[1] : "";
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === slug || w.id === slug);
    const wsKeys = new Set([slug, ws?.id, ws?.slug].filter(Boolean));
    const wsProjects = (localDB.projects || []).filter((p: any) => wsKeys.has(p.workspace) || wsKeys.has(p.workspace_id));
    const wsProjectIds = new Set(wsProjects.map((p: any) => p.id));
    const wsIssues = (localDB.issues || []).filter((i: any) => wsProjectIds.has(i.project || i.project_id) && !(localDB._deleted_issue_ids || []).includes(i.id) && !i.is_draft);

    const wsMembers = (localDB.workspace_members || []).filter((m: any) => wsKeys.has(m.workspace) || wsKeys.has(m.workspace_id));
    const total_users = Math.max(wsMembers.length, (localDB.users || []).length, 1);
    const total_admins = Math.max(wsMembers.filter((m: any) => m.role === 20 || m.role === "admin").length, 1);
    const total_members = wsMembers.filter((m: any) => m.role === 15 || m.role === "member").length;
    const total_guests = wsMembers.filter((m: any) => m.role === 5 || m.role === "guest").length;
    const total_projects = wsProjects.length;
    const total_work_items = wsIssues.length;

    const states = localDB.states || [];
    const stateGroupMap = new Map(states.map((s: any) => [s.id, s.group]));
    let started_work_items = 0, backlog_work_items = 0, un_started_work_items = 0, completed_work_items = 0;
    wsIssues.forEach((i: any) => {
      const group = stateGroupMap.get(i.state_id || i.state) || i.state_detail?.group || "unstarted";
      if (group === "started") started_work_items++;
      else if (group === "backlog") backlog_work_items++;
      else if (group === "completed") completed_work_items++;
      else un_started_work_items++;
    });
    const total_cycles = (localDB.cycles || []).filter((c: any) => wsProjectIds.has(c.project || c.project_id)).length;
    const total_intake = (localDB.intakes || []).filter((it: any) => wsProjectIds.has(it.project || it.project_id)).length;

    return ok({
      total_users: { count: total_users, filter_count: total_users },
      total_admins: { count: total_admins, filter_count: total_admins },
      total_members: { count: total_members, filter_count: total_members },
      total_guests: { count: total_guests, filter_count: total_guests },
      total_projects: { count: total_projects, filter_count: total_projects },
      total_work_items: { count: total_work_items, filter_count: total_work_items },
      total_cycles: { count: total_cycles, filter_count: total_cycles },
      total_intake: { count: total_intake, filter_count: total_intake },
      started_work_items: { count: started_work_items, filter_count: started_work_items },
      backlog_work_items: { count: backlog_work_items, filter_count: backlog_work_items },
      un_started_work_items: { count: un_started_work_items, filter_count: un_started_work_items },
      completed_work_items: { count: completed_work_items, filter_count: completed_work_items },
    });
  }

  // ── Public Anchor API (Space App / Published Project) ─────────────────
  if (url.includes("/api/public/anchor/") || url.includes("/api/public/workspaces/")) {
    const anchorMatch = url.match(/\/api\/public\/anchor\/([^/?]+)(?:\/([^/?]+))?/);
    const pubWsMatch = url.match(/\/api\/public\/workspaces\/([^/]+)\/projects\/([^/]+)\/anchor/);

    if (!localDB["project-deploy-boards"]) localDB["project-deploy-boards"] = [];

    // Helper to fetch and load DB from IPFS when board is not in memory (zero localStorage dependency)
    const ensureBoardFromIPFS = async (predicate: (b: any) => boolean, requestedAnchor?: string): Promise<any> => {
      let cidToFetch: string | null = null;
      if (typeof window !== "undefined") {
        try {
          const searchParams = new URLSearchParams(window.location.search);
          cidToFetch = searchParams.get("cid");
        } catch { }
        if (!cidToFetch && typeof document !== "undefined") {
          const cookies = document.cookie ? document.cookie.split(";") : [];
          const cidCookie = cookies.find((row) => row.trim().startsWith("plane_dapp_sync_cid="));
          if (cidCookie) {
            const raw = cidCookie.trim().substring(cidCookie.trim().indexOf("=") + 1);
            cidToFetch = decodeURIComponent(raw || "").trim();
          }
        }
      }
      if (!cidToFetch) {
        try {
          const urlSearchParams = new URL(url, "http://localhost").searchParams;
          cidToFetch = urlSearchParams.get("cid");
        } catch { }
      }
      if ((!cidToFetch || cidToFetch.startsWith("bafkrei")) && WORKSPACE_REGISTRY_ADDRESS) {
        try {
          const wsInfoCalldata = abiEncodeGetWorkspace("fiai");
          const wsInfoRaw = await directRpcRead(WORKSPACE_REGISTRY_ADDRESS, wsInfoCalldata, 3000);
          const wsInfo = decodeAbiWorkspace(wsInfoRaw);
          if (wsInfo?.ipfsCID && wsInfo.ipfsCID.trim() !== "" && !wsInfo.ipfsCID.startsWith("bafkrei")) {
            cidToFetch = wsInfo.ipfsCID.trim();
          }
        } catch { }
      }

      // If a CID is specified and hasn't been applied yet, ALWAYS fetch and apply it from IPFS
      if (cidToFetch && cidToFetch !== lastLoadedPublicCid) {
        console.log(`[Public Anchor API] Đang tải trực tiếp DB từ IPFS CID: ${cidToFetch}...`);
        try {
          const ipfsDB = await fetchFromIPFS(cidToFetch);
          if (ipfsDB) {
            applyOffchainDB(ipfsDB);
            lastLoadedPublicCid = cidToFetch;
          }
        } catch (e) {
          console.warn("[Public Anchor API] Lỗi tải từ IPFS:", e);
        }
      }

      let b = (localDB["project-deploy-boards"] as any[]).find(predicate);
      if (b) {
        if (requestedAnchor && !b.anchor) b.anchor = requestedAnchor;
        return b;
      }

      // Fallback matching
      if (!b && (localDB["project-deploy-boards"] || []).length > 0) {
        const found = localDB["project-deploy-boards"][0];
        b = { ...found };
        if (requestedAnchor) {
          b.anchor = requestedAnchor;
          b.id = "board-" + requestedAnchor;
        }
        return b;
      }
      if (!b) {
        const targetProj = localDB.projects?.[0] || { id: "project-fiai", identifier: "FIAI", name: "FIAI" };
        const targetWs = localDB.workspaces?.[0] || { id: "workspace-fiai", slug: "fiai", name: "FIAI" };
        const defaultAnchor = requestedAnchor || crypto.randomUUID?.().replace(/-/g, "") || "48c26b7724a243d6a9a7a93a19b5bfb4";
        b = {
          id: "board-" + defaultAnchor,
          anchor: defaultAnchor,
          project: targetProj.id,
          project_id: targetProj.id,
          workspace: targetWs.id,
          workspace_id: targetWs.id,
          entity_name: "project",
          entity_identifier: targetProj.identifier,
          view_props: { list: true, kanban: true },
          is_comments_enabled: true,
          is_reactions_enabled: true,
          is_votes_enabled: true,
          project_details: targetProj,
          workspace_detail: targetWs,
        };
        localDB["project-deploy-boards"].push(b);
      }
      if (b && requestedAnchor) {
        b.anchor = requestedAnchor;
      }
      return b;
    };

    // GET /api/public/workspaces/:slug/projects/:projectId/anchor/
    if (pubWsMatch) {
      const _wsSlug = pubWsMatch[1];
      const projId = pubWsMatch[2];
      const board = await ensureBoardFromIPFS(
        (b: any) => b.project === projId || b.project_id === projId
      );
      if (board) return ok(board);
      return { data: { detail: "Not found" }, status: 404 };
    }

    if (anchorMatch) {
      const anchorId = anchorMatch[1];
      const subResource = anchorMatch[2] || "";

      // Find the deploy board by anchor (loading directly from IPFS if needed)
      let board = await ensureBoardFromIPFS((b: any) => b.anchor === anchorId || b.id === anchorId, anchorId);
      if (!board) {
        board = (localDB["project-deploy-boards"] || [])[0];
      }

      if (!board) {
        return { data: { detail: "Published project not found" }, status: 404 };
      }

      const projId = board.project || board.project_id;
      const project = (localDB.projects || []).find((p: any) => p.id === projId || p.identifier === projId) || localDB.projects?.[0];
      const ws = (localDB.workspaces || []).find(
        (w: any) => w.id === (board.workspace || board.workspace_id) || w.slug === (board.workspace || board.workspace_id)
      ) || localDB.workspaces?.[0];

      const projectIds = new Set(
        [
          projId,
          String(projId),
          project?.id,
          project?.id ? String(project.id) : null,
          project?.identifier,
          board.project,
          board.project ? String(board.project) : null,
          board.project_id,
          board.project_id ? String(board.project_id) : null,
          board.entity_identifier,
        ].filter(Boolean)
      );

      // GET /api/public/anchor/:anchor/meta/
      if (subResource === "meta") {
        return ok({
          name: project?.name || "Published Project",
          description: project?.description || "",
          cover_image: project?.cover_image || null,
        });
      }

      // GET /api/public/anchor/:anchor/settings/
      if (subResource === "settings") {
        return ok({
          ...board,
          anchor: anchorId,
          workspace: board.workspace || ws?.id,
          workspace_detail: board.workspace_detail || (ws ? { id: ws.id, name: ws.name, slug: ws.slug } : undefined),
          project_details: board.project_details || (project ? {
            id: project.id,
            name: project.name,
            identifier: project.identifier,
            cover_image: project.cover_image,
            description: project.description,
            logo_props: project.logo_props || { in_use: "icon", icon: { name: "folder", color: "#3f3f46" } },
          } : undefined),
        });
      }

      // GET /api/public/anchor/:anchor/states/
      if (subResource === "states") {
        let states = (localDB.states || []).filter(
          (s: any) => projectIds.has(s.project) || projectIds.has(s.project_id) || projectIds.has(String(s.project)) || projectIds.has(String(s.project_id))
        );
        if (states.length === 0) {
          states = [
            { id: "state-backlog", name: "Backlog", color: "#A3A3A3", sequence: 15000, group: "backlog", project: project?.id || projId, project_id: project?.id || projId },
            { id: "state-todo", name: "Todo", color: "#3A3A3A", sequence: 25000, group: "unstarted", project: project?.id || projId, project_id: project?.id || projId },
            { id: "state-in-progress", name: "In Progress", color: "#F59E0B", sequence: 35000, group: "started", project: project?.id || projId, project_id: project?.id || projId },
            { id: "state-done", name: "Done", color: "#16A34A", sequence: 45000, group: "completed", project: project?.id || projId, project_id: project?.id || projId },
            { id: "state-cancelled", name: "Cancelled", color: "#EF4444", sequence: 55000, group: "cancelled", project: project?.id || projId, project_id: project?.id || projId },
          ];
          if (!localDB.states) localDB.states = [];
          localDB.states.push(...states);
        }
        return ok(states);
      }

      // GET /api/public/anchor/:anchor/labels/
      if (subResource === "labels") {
        let labels = (localDB.labels || []).filter(
          (l: any) => projectIds.has(l.project) || projectIds.has(l.project_id) || projectIds.has(String(l.project)) || projectIds.has(String(l.project_id))
        );
        if (labels.length === 0 && (localDB.labels || []).length > 0) {
          labels = localDB.labels;
        }
        return ok(labels);
      }

      // GET /api/public/anchor/:anchor/members/
      if (subResource === "members") {
        const wsId = ws?.id || board.workspace;
        const members = (localDB.members || []).filter(
          (m: any) => m.workspace === wsId || m.workspace_id === wsId
        );
        // oxlint-disable-next-line oxc/no-map-spread -- Copy-on-write response enrichment must not mutate shared persisted records.
        return ok(members.map((m: any) => ({
          ...m,
          member: (localDB.users || []).find((u: any) => u.id === (m.member || m.member_id)) || m,
        })));
      }

      // GET /api/public/anchor/:anchor/modules/
      if (subResource === "modules") {
        const modules = (localDB.modules || []).filter(
          (m: any) => projectIds.has(m.project) || projectIds.has(m.project_id)
        );
        return ok(modules);
      }

      // GET /api/public/anchor/:anchor/cycles/
      if (subResource === "cycles") {
        const cycles = (localDB.cycles || []).filter(
          (c: any) => projectIds.has(c.project) || projectIds.has(c.project_id)
        );
        return ok(cycles);
      }

      // GET /api/public/anchor/:anchor/issues/ or /issues/:issueId/
      if (subResource === "issues") {
        const issueIdMatch = url.match(/\/issues\/([a-f0-9-]{36})\/?/);

        if (issueIdMatch) {
          // Single issue detail
          const issueId = issueIdMatch[1];
          const issue = (localDB.issues || []).find((i: any) => i.id === issueId || String(i.id) === issueId);
          if (issue) return ok(issue);
          return { data: { detail: "Issue not found" }, status: 404 };
        }

        // Issue list with pagination support
        let allIssues = (localDB.issues || []).filter(
          (i: any) => projectIds.has(i.project) || projectIds.has(i.project_id) || projectIds.has(String(i.project)) || projectIds.has(String(i.project_id))
        );

        if (allIssues.length === 0 && (localDB.issues || []).length > 0) {
          allIssues = localDB.issues;
        }

        // Parse query params for grouping / pagination
        const qsParams = new URLSearchParams(url.split("?")[1] || "");
        const groupBy = qsParams.get("group_by") || null;
        const perPage = parseInt(qsParams.get("per_page") || "50", 10);
        const _cursor = qsParams.get("cursor") || `${perPage}:0:0`;

        // Resolve project states
        let projectStates = (localDB.states || []).filter(
          (s: any) => projectIds.has(s.project) || projectIds.has(s.project_id) || projectIds.has(String(s.project)) || projectIds.has(String(s.project_id))
        );
        if (projectStates.length === 0) {
          projectStates = [
            { id: "state-backlog", name: "Backlog", color: "#A3A3A3", sequence: 15000, group: "backlog", project: project?.id || projId, project_id: project?.id || projId },
            { id: "state-todo", name: "Todo", color: "#3A3A3A", sequence: 25000, group: "unstarted", project: project?.id || projId, project_id: project?.id || projId },
            { id: "state-in-progress", name: "In Progress", color: "#F59E0B", sequence: 35000, group: "started", project: project?.id || projId, project_id: project?.id || projId },
            { id: "state-done", name: "Done", color: "#16A34A", sequence: 45000, group: "completed", project: project?.id || projId, project_id: project?.id || projId },
            { id: "state-cancelled", name: "Cancelled", color: "#EF4444", sequence: 55000, group: "cancelled", project: project?.id || projId, project_id: project?.id || projId },
          ];
          if (!localDB.states) localDB.states = [];
          localDB.states.push(...projectStates);
        }

        const backlogState = projectStates.find((s: any) => s.group === "backlog") || projectStates[0];
        const unstartedState = projectStates.find((s: any) => s.group === "unstarted") || projectStates[1] || backlogState;
        const startedState = projectStates.find((s: any) => s.group === "started") || projectStates[2] || backlogState;
        const completedState = projectStates.find((s: any) => s.group === "completed") || projectStates[3] || backlogState;
        const cancelledState = projectStates.find((s: any) => s.group === "cancelled") || projectStates[4] || backlogState;

        // Add state / created_at backfill and ensure valid state_id matching projectStates
        // oxlint-disable-next-line oxc/no-map-spread -- Copy-on-write response enrichment must not mutate shared persisted records.
        const enrichedIssues = allIssues.map((issue: any, idx: number) => {
          let matchedState = projectStates.find(
            (s: any) => s.id === issue.state_id || s.id === issue.state || String(s.id) === String(issue.state_id) || String(s.id) === String(issue.state)
          );

          if (!matchedState) {
            const rawState = String(issue.state_id || issue.state || "").toLowerCase();
            if (rawState === "1" || rawState.includes("backlog")) matchedState = backlogState;
            else if (rawState === "2" || rawState.includes("todo") || rawState.includes("unstart")) matchedState = unstartedState;
            else if (rawState === "3" || rawState.includes("progress") || rawState.includes("start")) matchedState = startedState;
            else if (rawState === "4" || rawState.includes("done") || rawState.includes("complete")) matchedState = completedState;
            else if (rawState === "5" || rawState.includes("cancel")) matchedState = cancelledState;
            else matchedState = backlogState;
          }

          const rawLabels = issue.labels || issue.label_ids || [];
          const labelIds = (Array.isArray(rawLabels) ? rawLabels : [rawLabels])
            .map((l: any) => (typeof l === "object" && l ? l.id : l))
            .filter(Boolean);

          const targetStateId = matchedState.id;
          const stateDetail = {
            id: matchedState.id,
            name: matchedState.name,
            color: matchedState.color,
            group: matchedState.group,
            sequence: matchedState.sequence,
          };

          return {
            ...issue,
            sequence_id: issue.sequence_id || idx + 1,
            state: targetStateId,
            state_id: targetStateId,
            state_detail: stateDetail,
            priority: (issue.priority || "none").toLowerCase(),
            labels: labelIds,
            label_ids: labelIds,
            project_id: project?.id || projId,
            workspace_id: ws?.id || "workspace-fiai",
            created_at: issue.created_at || issue.created_on || new Date().toISOString(),
            updated_at: issue.updated_at || issue.updated_on || issue.created_at || new Date().toISOString(),
          };
        });

        if (groupBy) {
          const grouped: Record<string, any[]> = {};
          if (groupBy === "state") {
            projectStates.forEach((s: any) => {
              grouped[s.id] = [];
            });
          }
          enrichedIssues.forEach((item: any) => {
            let key = "None";
            if (groupBy === "state") {
              key = item.state_id || item.state;
              if (!grouped[key]) {
                if (projectStates[0]) key = projectStates[0].id;
              }
            } else if (groupBy === "state_detail.group") {
              key = item.state_detail?.group || "backlog";
            } else if (groupBy === "target_date") {
              key = item.target_date ? item.target_date.split("T")[0] : "None";
            } else {
              key = item[groupBy] || "None";
            }
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(item);
          });

          const result: Record<string, any> = {};
          for (const [key, items] of Object.entries(grouped)) {
            result[key] = {
              results: items,
              total_results: items.length,
              next_cursor: null,
              prev_cursor: null,
              next_page_results: false,
              total_pages: 1,
            };
          }
          return ok({
            results: result,
            grouped_by: groupBy,
            total_count: enrichedIssues.length,
            count: enrichedIssues.length,
            total_results: enrichedIssues.length,
            total_pages: 1,
            next_cursor: null,
            prev_cursor: null,
            next_page_results: false,
            prev_page_results: false,
          });
        }

        // Ungrouped
        return ok({
          results: enrichedIssues,
          total_count: enrichedIssues.length,
          count: enrichedIssues.length,
          total_results: enrichedIssues.length,
          next_cursor: null,
          prev_cursor: null,
          next_page_results: false,
          total_pages: 1,
        });
      }

      // Fallback: return the board settings for any unhandled sub-resource
      return ok(board);
    }
  }

  // ── Project Deploy Boards (Publish Project) ───────────────────────────
  if (url.includes("/project-deploy-boards")) {
    const match = url.match(/\/api\/workspaces\/([^/]+)\/projects\/([^/]+)\/project-deploy-boards(?:\/([^/?]+))?/);
    const wsSlug = match ? match[1] : (localDB.workspaces?.[0]?.slug || "fiai");
    const projId = match ? match[2] : "";
    const publishId = match ? match[3] : "";

    if (!localDB["project-deploy-boards"]) localDB["project-deploy-boards"] = [];

    // Ensure any previously saved board has an anchor
    (localDB["project-deploy-boards"] as any[]).forEach((b: any) => {
      if (!b.anchor) {
        b.anchor = crypto.randomUUID?.().replace(/-/g, "") || Math.random().toString(36).slice(2, 18);
      }
      if (!b.project && projId) b.project = projId;
      if (!b.project_id && projId) b.project_id = projId;
    });

    const methodUpper = method.toUpperCase();

    if (methodUpper === "GET") {
      let board: any = null;
      if (publishId) {
        board = localDB["project-deploy-boards"].find((b: any) => b.id === publishId);
      } else {
        board = localDB["project-deploy-boards"].find(
          (b: any) => b.project === projId || b.project_id === projId
        );
      }

      if (board) {
        if (!board.anchor) {
          board.anchor = crypto.randomUUID?.().replace(/-/g, "") || Math.random().toString(36).slice(2, 18);
          saveDB();
        }
        if (!board.cid) {
          board.cid = getLastUploadedCID() || undefined;
        }
        return ok(board);
      }
      return ok({});
    }

    if (methodUpper === "POST") {
      let board = localDB["project-deploy-boards"].find(
        (b: any) => b.project === projId || b.project_id === projId
      );
      const project = (localDB.projects || []).find((p: any) => p.id === projId || p.identifier === projId);
      const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);

      if (!board) {
        const newAnchor = crypto.randomUUID?.().replace(/-/g, "") || Math.random().toString(36).slice(2, 18);
        board = {
          id: body.id || crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          anchor: newAnchor,
          project: projId,
          project_id: projId,
          workspace: ws?.id || wsSlug,
          workspace_id: ws?.id || wsSlug,
          entity_name: "project",
          entity_identifier: project?.identifier || projId,
          is_comments_enabled: !!body.is_comments_enabled,
          is_reactions_enabled: !!body.is_reactions_enabled,
          is_votes_enabled: !!body.is_votes_enabled,
          view_props: body.view_props || { list: true, kanban: true },
          project_details: project
            ? {
              id: project.id,
              name: project.name,
              identifier: project.identifier,
              cover_image: project.cover_image,
              description: project.description,
              logo_props: project.logo_props,
            }
            : undefined,
          workspace_detail: ws
            ? {
              id: ws.id,
              name: ws.name,
              slug: ws.slug,
            }
            : undefined,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: routeSessionUserId || "user-1",
          updated_by: routeSessionUserId || "user-1",
          inbox: null,
        };
        localDB["project-deploy-boards"].push(board);
      } else {
        if (!board.anchor) {
          board.anchor = crypto.randomUUID?.().replace(/-/g, "") || Math.random().toString(36).slice(2, 18);
        }
        board.is_comments_enabled = !!body.is_comments_enabled;
        board.is_reactions_enabled = !!body.is_reactions_enabled;
        board.is_votes_enabled = !!body.is_votes_enabled;
        if (body.view_props) board.view_props = body.view_props;
        board.updated_at = new Date().toISOString();
      }

      if (project) {
        project.anchor = board.anchor;
      }

      saveDB();

      // Trigger immediate IPFS upload so the published board is pinned to IPFS
      try {
        const newCid = await uploadToIPFS(true);
        if (newCid) {
          board.cid = newCid;
          saveDB();
        }
      } catch (uploadErr) {
        console.warn("[Project Deploy Boards] Lỗi upload IPFS:", uploadErr);
      }

      return { data: board, status: 201 };
    }

    if (methodUpper === "PATCH" || methodUpper === "PUT") {
      let board = localDB["project-deploy-boards"].find(
        (b: any) => b.id === publishId || b.project === projId || b.project_id === projId
      );
      if (board) {
        Object.assign(board, body, { updated_at: new Date().toISOString() });
        if (!board.anchor) {
          board.anchor = crypto.randomUUID?.().replace(/-/g, "") || Math.random().toString(36).slice(2, 18);
        }
        const project = (localDB.projects || []).find((p: any) => p.id === projId || p.identifier === projId);
        if (project) project.anchor = board.anchor;
        saveDB();

        try {
          const newCid = await uploadToIPFS(true);
          if (newCid) {
            board.cid = newCid;
            saveDB();
          }
        } catch { }

        return ok(board);
      }
      return ok(body);
    }

    if (methodUpper === "DELETE") {
      localDB["project-deploy-boards"] = (localDB["project-deploy-boards"] || []).filter(
        (b: any) => b.id !== publishId && b.project !== projId && b.project_id !== projId
      );
      const project = (localDB.projects || []).find((p: any) => p.id === projId || p.identifier === projId);
      if (project) {
        project.anchor = null;
      }
      saveDB();
      try {
        await uploadToIPFS(true);
      } catch { }
      return ok({ message: "Project unpublished successfully" });
    }
  }

  // ── Auth endpoints ──────────────────────────────────────────────────
  if (url.includes("/auth/get-csrf-token")) return ok({ csrf_token: "dapp-csrf-token" });

  if (url.includes("/auth/email-check")) {
    const email = (body?.email || "").trim().toLowerCase();
    const creds = getStoredCredentials();
    let existing = (localDB.users || []).some((u: any) => (u.email || "").toLowerCase() === email);
    if (!existing && creds[email]) {
      existing = true;
      if (!localDB.users) localDB.users = [];
      localDB.users.push(createUserObject(`user-${Date.now()}`, email, undefined, undefined, creds[email]));
    }
    if (!existing && typeof window !== "undefined") {
      try {
        const rawLocal = localStorage.getItem("plane_dapp_local_db");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          const cachedUser = (parsed?.users || []).find((u: any) => (u.email || "").toLowerCase() === email);
          if (cachedUser) {
            existing = true;
            if (!localDB.users) localDB.users = [];
            localDB.users.push(cachedUser);
            if (cachedUser.password_hash) {
              setStoredCredential(email, cachedUser.password_hash);
            }
          }
        }
      } catch { }
    }

    // Hybrid Auth: Nếu tài khoản đã có password -> cho phép nhập password trước (kèm nút OTP)
    // Nếu chưa có password (user mới / invitee) -> chuyển sang nhận mã OTP gửi về Email
    const hasPassword = Boolean(
      creds[email] ||
      (localDB.users || []).find((u: any) => (u.email || "").toLowerCase() === email)?.password_hash
    );
    const status = hasPassword ? "CREDENTIAL" : "MAGIC_CODE";

    return ok({ existing, is_password_autoset: false, status });
  }

  // ── Magic Code Generation (Brevo Email OTP) ──────────────────────────
  if (url.includes("/auth/magic-generate")) {
    const email = (body?.email || "").trim().toLowerCase();
    if (!email) {
      return { data: { error: "Vui lòng cung cấp địa chỉ email hợp lệ." }, status: 400 };
    }

    const otpCode = await generateAndStoreOtp(email);
    // KHÔNG log mã xác nhận: log trình duyệt/CI có thể bị thu thập và làm lộ mã.

    // Gửi email qua Brevo (chạy nền, bắt lỗi an toàn)
    void sendOtpEmail(email, otpCode).catch((err) => {
      console.warn(`[DApp Auth OTP] ⚠️ Gửi email Brevo gặp sự cố:`, err?.message || err);
    });

    return ok({ message: "Mã xác nhận 6 chữ số đã được gửi tới email của bạn." });
  }

  // ── Magic Code Sign In / Sign Up ────────────────────────────────────
  if (url.includes("/auth/magic-sign-in") || url.includes("/auth/magic-sign-up")) {
    const email = (body?.email || loggedInEmail || "").trim().toLowerCase();
    const code = (body?.code || "").trim();

    if (!email) {
      return { data: { error: "Email không hợp lệ." }, status: 400 };
    }
    if (!code) {
      return { data: { error: "Vui lòng nhập mã xác nhận." }, status: 400 };
    }

    const verifyResult = await verifyOtpCode(email, code);
    if (!verifyResult.valid) {
      return { data: { error: verifyResult.error || "Mã xác nhận không chính xác hoặc đã hết hạn." }, status: 400 };
    }

    // Xác thực thành công -> hủy mã OTP
    clearOtpCode(email);

    let user = (localDB.users || []).find((u: any) => u.email?.toLowerCase() === email);
    if (!user) {
      const isFirstUser = !localDB.users || localDB.users.length === 0;
      user = createUserObject(`user-${Date.now()}`, email, undefined, undefined, undefined, isFirstUser);
      if (!localDB.users) localDB.users = [];
      localDB.users.push(user);
      saveDB();
    }

    // Membership requires explicit, confirmed acceptance.

    // Validate user's workspace access
    const myWorkspaces = getUserWorkspaces(user.id, user.email);
    const validCurrentWs = myWorkspaces.find((w: any) => w.slug === user.last_workspace_slug || w.id === user.last_workspace_id);
    if (!validCurrentWs) {
      user.last_workspace_slug = myWorkspaces[0]?.slug || null;
      user.last_workspace_id = myWorkspaces[0]?.id || null;
      user.is_onboarded = myWorkspaces.length > 0;
      saveDB();
    }

    setLoggedInUser(user.id);
    if (typeof window !== "undefined") {
      sessionStorage.setItem("plane_dapp_auth_email", user.email);
      localStorage.setItem("plane_dapp_auth_email", user.email);
      if (user.last_workspace_slug) {
        localStorage.setItem("last_workspace_slug", user.last_workspace_slug);
        document.cookie = `last_workspace_slug=${user.last_workspace_slug}; path=/; max-age=31536000; SameSite=Lax`;
      } else {
        localStorage.removeItem("last_workspace_slug");
        localStorage.removeItem("last_workspace_id");
        document.cookie = "last_workspace_slug=; path=/; max-age=0; SameSite=Lax";
      }
    }
    return ok({ ...user, access_token: "dapp-token", refresh_token: "dapp-refresh" });
  }

  // ── Password-based Sign In ──────────────────────────────────────────
  if (url.includes("/auth/sign-in")) {
    const email = (body?.email || loggedInEmail || "").trim().toLowerCase();
    const password = body?.password || "";
    const creds = getStoredCredentials();
    let user = (localDB.users || []).find((u: any) => u.email?.toLowerCase() === email);

    // Fallback: If not in localDB yet, check cached local DB snapshot
    if (!user && typeof window !== "undefined") {
      try {
        const rawLocal = localStorage.getItem("plane_dapp_local_db");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          const cachedUser = (parsed?.users || []).find((u: any) => (u.email || "").toLowerCase() === email);
          if (cachedUser) {
            user = cachedUser;
            if (!localDB.users) localDB.users = [];
            localDB.users.push(cachedUser);
          }
        }
      } catch { }
    }

    const storedHash = user?.password_hash || creds[email];

    if (!user && !storedHash) {
      return { data: { error: "Tài khoản không tồn tại. Vui lòng đăng ký trước." }, status: 404 };
    }

    // Strict password verification
    if (!storedHash) {
      return { data: { error: "Tài khoản chưa thiết lập mật khẩu. Vui lòng sử dụng tính năng quên mật khẩu hoặc đăng ký lại." }, status: 400 };
    }

    if (!password) {
      return { data: { error: "Vui lòng nhập mật khẩu." }, status: 400 };
    }

    const inputHash = await hashPassword(password);
    if (inputHash !== storedHash) {
      return { data: { error: "Mật khẩu không chính xác. Vui lòng thử lại." }, status: 401 };
    }
    if (user) user.password_hash = storedHash;

    if (!user) {
      const isFirstUser = !localDB.users || localDB.users.length === 0;
      user = createUserObject(`user-${Date.now()}`, email, undefined, undefined, storedHash, isFirstUser);
      if (!localDB.users) localDB.users = [];
      localDB.users.push(user);
      saveDB();
    }

    // Membership requires explicit, confirmed acceptance.

    // Validate user's workspace access
    const myWorkspaces = getUserWorkspaces(user.id, user.email);
    const validCurrentWs = myWorkspaces.find((w: any) => w.slug === user.last_workspace_slug || w.id === user.last_workspace_id);
    if (!validCurrentWs) {
      user.last_workspace_slug = myWorkspaces[0]?.slug || null;
      user.last_workspace_id = myWorkspaces[0]?.id || null;
      user.is_onboarded = myWorkspaces.length > 0;
      saveDB();
    }

    setLoggedInUser(user.id);
    if (typeof window !== "undefined") {
      sessionStorage.setItem("plane_dapp_auth_email", user.email);
      localStorage.setItem("plane_dapp_auth_email", user.email);
      if (user.last_workspace_slug) {
        localStorage.setItem("last_workspace_slug", user.last_workspace_slug);
        document.cookie = `last_workspace_slug=${user.last_workspace_slug}; path=/; max-age=31536000; SameSite=Lax`;
      } else {
        localStorage.removeItem("last_workspace_slug");
        localStorage.removeItem("last_workspace_id");
        document.cookie = "last_workspace_slug=; path=/; max-age=0; SameSite=Lax";
      }
    }
    return ok({ ...user, access_token: "dapp-token", refresh_token: "dapp-refresh" });
  }

  if (url.includes("/auth/sign-up")) {
    const email = (body?.email || loggedInEmail || "").trim().toLowerCase();
    const password = body?.password || "";
    const creds = getStoredCredentials();
    let user = (localDB.users || []).find((u: any) => u.email?.toLowerCase() === email);

    if (!user && typeof window !== "undefined") {
      try {
        const rawLocal = localStorage.getItem("plane_dapp_local_db");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          const cachedUser = (parsed?.users || []).find((u: any) => (u.email || "").toLowerCase() === email);
          if (cachedUser) {
            user = cachedUser;
          }
        }
      } catch { }
    }

    const storedHash = user?.password_hash || creds[email];

    // Chặn tuyệt đối việc đăng ký đè lên tài khoản đã tồn tại
    if (storedHash || user) {
      return { data: { error: "Email này đã được đăng ký. Vui lòng đăng nhập." }, status: 400 };
    }

    const passwordHash = password ? await hashPassword(password) : undefined;
    if (passwordHash) {
      setStoredCredential(email, passwordHash);
    }
    const isFirstUser = !localDB.users || localDB.users.length === 0;
    user = createUserObject(`user-${Date.now()}`, email, body?.first_name, body?.last_name, passwordHash, isFirstUser);
    if (!localDB.users) localDB.users = [];
    localDB.users.push(user);
    saveDB();
    setLoggedInUser(user.id);
    if (typeof window !== "undefined") {
      sessionStorage.setItem("plane_dapp_auth_email", user.email);
      localStorage.setItem("plane_dapp_auth_email", user.email);
      if (user.last_workspace_slug) {
        localStorage.setItem("last_workspace_slug", user.last_workspace_slug);
        document.cookie = `last_workspace_slug=${user.last_workspace_slug}; path=/; max-age=31536000; SameSite=Lax`;
      } else {
        localStorage.removeItem("last_workspace_slug");
        localStorage.removeItem("last_workspace_id");
        document.cookie = "last_workspace_slug=; path=/; max-age=0; SameSite=Lax";
      }
    }

    // Kích hoạt upload IPFS ngay lập tức và đợi tối đa 3 giây để đảm bảo tài khoản đã lên IPFS trước khi chuyển trang
    try {
      await Promise.race([
        uploadToIPFS(true),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch (e) {
      console.warn("[DApp DB] Upload IPFS lúc đăng ký có lỗi:", e);
    }

    return ok({ ...user, access_token: "dapp-token", refresh_token: "dapp-refresh" });
  }

  if (url.includes("/auth/forgot-password") || url.includes("/auth/set-password")) {
    const newPwd = body?.password || body?.new_password || "";
    const email = (body?.email || loggedInEmail || "").trim().toLowerCase();
    const user = (localDB.users || []).find((u: any) => u.email?.toLowerCase() === email) || routeSessionUser;
    if (newPwd && email) {
      const newHash = await hashPassword(newPwd);
      setStoredCredential(email, newHash);
      if (user) user.password_hash = newHash;
      saveDB();
      try {
        await Promise.race([
          uploadToIPFS(true),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      } catch { }
      return ok({ message: "Password updated successfully" });
    }
    return { data: { error: "Invalid password or email" }, status: 400 };
  }

  if (url.includes("/auth/sign-out")) {
    setLoggedInUser(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem("plane_dapp_auth_email");
      sessionStorage.removeItem("plane_dapp_auth_email");
      localStorage.removeItem("plane_active_wallet_address");
      sessionStorage.removeItem("plane_active_wallet_address");
      localStorage.removeItem("last_workspace_slug");
      sessionStorage.removeItem("last_workspace_slug");
      localStorage.removeItem("last_workspace_id");
      sessionStorage.removeItem("last_workspace_id");
      document.cookie = "last_workspace_slug=; path=/; max-age=0; SameSite=Lax";
    }
    return ok({ message: "success" });
  }

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

  if (url.includes("/api/instances/workspaces") && method === "get") {
    // oxlint-disable-next-line oxc/no-map-spread -- Copy-on-write response enrichment must not mutate shared persisted records.
    const wsResults = (localDB.workspaces || []).map((w: any) => ({
      ...w,
      total_members: getWorkspaceMemberCount(w.slug, w.id),
    }));
    return ok({ results: wsResults, next_cursor: null, prev_cursor: null, total_count: wsResults.length });
  }

  // ── Admin Auth & Management Endpoints ────────────────────────────────
  if (url.includes("/api/instances/admins/sign-out")) {
    setLoggedInUser(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem("plane_dapp_auth_email");
      sessionStorage.removeItem("plane_dapp_auth_email");
      localStorage.removeItem("plane_active_wallet_address");
      sessionStorage.removeItem("plane_active_wallet_address");
      localStorage.removeItem("last_workspace_slug");
      sessionStorage.removeItem("last_workspace_slug");
      localStorage.removeItem("last_workspace_id");
      sessionStorage.removeItem("last_workspace_id");
      document.cookie = "last_workspace_slug=; path=/; max-age=0; SameSite=Lax";
    }
    return ok({ message: "success" });
  }

  if (url.includes("/api/instances/admins/sign-in")) {
    const email = (body?.email || loggedInEmail || "").trim().toLowerCase();
    const password = body?.password || "";
    let user = (localDB.users || []).find((u: any) => u.email?.toLowerCase() === email);
    const creds = getStoredCredentials();
    const storedHash = user?.password_hash || creds[email];

    if (!user && !storedHash) {
      return { data: { error: "Tài khoản quản trị viên không tồn tại. Vui lòng đăng ký trước." }, status: 404 };
    }

    if (!storedHash) {
      return { data: { error: "Tài khoản quản trị viên chưa thiết lập mật khẩu. Vui lòng đăng ký trước." }, status: 400 };
    }

    if (!password) {
      return { data: { error: "Vui lòng nhập mật khẩu." }, status: 400 };
    }
    const inputHash = await hashPassword(password);
    if (inputHash !== storedHash) {
      return { data: { error: "Mật khẩu quản trị viên không chính xác." }, status: 401 };
    }
    if (user) user.password_hash = storedHash;

    if (!user) {
      user = createUserObject(`admin-${Date.now()}`, email, undefined, undefined, storedHash);
      if (!localDB.users) localDB.users = [];
      localDB.users.push(user);
      saveDB();
    }

    setLoggedInUser(user.id);
    if (typeof window !== "undefined") localStorage.setItem("plane_dapp_auth_email", user.email);
    return ok(user);
  }

  if (url.includes("/api/instances/admins/sign-up")) {
    const email = (body?.email || loggedInEmail || "").trim().toLowerCase();
    const password = body?.password || "";
    const creds = getStoredCredentials();
    let user = (localDB.users || []).find((u: any) => u.email?.toLowerCase() === email);
    if (user && (user.password_hash || creds[email])) {
      return { data: { error: "Email này đã được đăng ký quản trị viên. Vui lòng đăng nhập." }, status: 400 };
    }
    const passwordHash = password ? await hashPassword(password) : undefined;
    if (passwordHash && email) {
      setStoredCredential(email, passwordHash);
    }

    if (user) {
      if (passwordHash) user.password_hash = passwordHash;
      user.first_name = body?.first_name || user.first_name;
      user.last_name = body?.last_name || user.last_name;
      user.display_name = `${user.first_name} ${user.last_name}`.trim();
    } else {
      user = createUserObject(`admin-${Date.now()}`, email, body?.first_name, body?.last_name, passwordHash);
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
    if (!isLoggedIn() || !routeSessionUser) {
      return { data: { error: "not authenticated" }, status: 401 };
    }
    if (method === "patch" || method === "put" || method === "post") {
      Object.assign(routeSessionUser, body);
      saveDB();
    }
    return ok(routeSessionUser);
  }

  if (url.match(/\/api\/instances\/admins\/?$/) || url.match(/\/api\/instances\/admins\/\?/)) {
    let users = localDB.users || [];
    if (users.length === 0 && (loggedInEmail || routeSessionUserId)) {
      const fallbackUser = createUserObject(routeSessionUserId || `admin-${Date.now().toString(36)}`, loggedInEmail || "");
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
      total_members: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: routeSessionUser?.id || "admin",
      owner: {
        id: routeSessionUser?.id || "admin",
        email: routeSessionUser?.email || loggedInEmail || "",
        first_name: routeSessionUser?.first_name || "Admin",
        last_name: routeSessionUser?.last_name || "",
        avatar: routeSessionUser?.avatar_url || "",
      },
      role: 20,
      ...body,
    };

    if (localDB._deleted_workspace_ids) {
      localDB._deleted_workspace_ids = localDB._deleted_workspace_ids.filter((dId: string) => dId !== wsId);
    }
    if (localDB._deleted_workspace_slugs) {
      localDB._deleted_workspace_slugs = localDB._deleted_workspace_slugs.filter((s: string) => s !== slug);
    }

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
      member: routeSessionUser?.id || "me",
      role: 20,
      is_active: true,
      created_at: new Date().toISOString(),
    });

    if (routeSessionUser) {
      routeSessionUser.last_workspace_id = wsId;
      routeSessionUser.last_workspace_slug = slug;
      routeSessionUser.is_onboarded = true;
      if (!routeSessionUser.onboarding_step) routeSessionUser.onboarding_step = {};
      routeSessionUser.onboarding_step.workspace_create = true;
      routeSessionUser.onboarding_step.profile_complete = true;
      routeSessionUser.onboarding_step.workspace_join = true;
      routeSessionUser.onboarding_step.workspace_invite = true;
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
    const wsRegistryAddr = getWorkspaceRegistryAddress();
    if (wsRegistryAddr && bridge && currentUserAddress) {
      const initialCid = baseCID || "QmInitial";
      bridge
        .request("sendTransaction", {
          from: currentUserAddress,
          to: wsRegistryAddr,
          abiData: [CREATE_WORKSPACE_ABI],
          functionName: "createWorkspace",
          feeType: "sc",
          amount: "0",
          value: "0",
          gas: getContractGas(),
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

  // ── Workspace Deletion ────────────────────────────────────────────────
  const wsDeleteMatch = url.match(/\/api\/workspaces\/([^/]+)\/?$/);
  if (wsDeleteMatch && method === "delete") {
    const slugOrId = wsDeleteMatch[1];
    const targetWs = (localDB.workspaces || []).find((w: any) => w.id === slugOrId || w.slug === slugOrId);
    const targetId = targetWs?.id || slugOrId;
    const targetSlug = targetWs?.slug || slugOrId;

    if (!localDB._deleted_workspace_ids) localDB._deleted_workspace_ids = [];
    if (!localDB._deleted_workspace_ids.includes(targetId)) {
      localDB._deleted_workspace_ids.push(targetId);
    }
    if (!localDB._deleted_workspace_slugs) localDB._deleted_workspace_slugs = [];
    if (!localDB._deleted_workspace_slugs.includes(targetSlug)) {
      localDB._deleted_workspace_slugs.push(targetSlug);
    }

    const deletedWsIds = new Set(localDB._deleted_workspace_ids);
    const deletedWsSlugs = new Set(localDB._deleted_workspace_slugs);

    // 1. Remove from localDB.workspaces
    localDB.workspaces = (localDB.workspaces || []).filter(
      (w: any) => w.id !== targetId && w.slug !== targetSlug && !deletedWsIds.has(w.id) && !deletedWsSlugs.has(w.slug)
    );

    // 2. Cascade delete all projects belonging to this workspace
    const deletedProjects = (localDB.projects || []).filter(
      (p: any) => p.workspace === targetId || p.workspace === targetSlug || p.workspace_id === targetId || p.workspace_id === targetSlug
    );
    if (!localDB._deleted_project_ids) localDB._deleted_project_ids = [];
    for (const dp of deletedProjects) {
      if (!localDB._deleted_project_ids.includes(dp.id)) localDB._deleted_project_ids.push(dp.id);
      if (dp.identifier && !localDB._deleted_project_ids.includes(dp.identifier)) localDB._deleted_project_ids.push(dp.identifier);
    }
    const currentDeletedProjSet = new Set(localDB._deleted_project_ids);
    localDB.projects = (localDB.projects || []).filter(
      (p: any) => p.workspace !== targetId && p.workspace !== targetSlug && p.workspace_id !== targetId && p.workspace_id !== targetSlug && !currentDeletedProjSet.has(p.id)
    );

    // 3. Cascade delete all issues for those projects or this workspace
    if (localDB.issues) {
      const deletedProjIds = new Set(deletedProjects.map((p: any) => p.id));
      const deletedIssues = localDB.issues.filter(
        (i: any) => deletedProjIds.has(i.project) || deletedProjIds.has(i.project_id) || i.workspace === targetId || i.workspace === targetSlug
      );
      if (!localDB._deleted_issue_ids) localDB._deleted_issue_ids = [];
      for (const di of deletedIssues) {
        if (!localDB._deleted_issue_ids.includes(di.id)) localDB._deleted_issue_ids.push(di.id);
      }
      const currentDeletedIssueSet = new Set(localDB._deleted_issue_ids);
      localDB.issues = localDB.issues.filter(
        (i: any) => !deletedProjIds.has(i.project) && !deletedProjIds.has(i.project_id) && i.workspace !== targetId && i.workspace !== targetSlug && !currentDeletedIssueSet.has(i.id)
      );
    }

    // 4. Cascade delete states, labels, cycles, modules, workspace_members
    if (localDB.states) {
      localDB.states = localDB.states.filter((s: any) => s.workspace !== targetId && s.workspace !== targetSlug);
    }
    if (localDB.labels) {
      localDB.labels = localDB.labels.filter((l: any) => l.workspace !== targetId && l.workspace !== targetSlug);
    }
    if (localDB.cycles) {
      localDB.cycles = localDB.cycles.filter((c: any) => c.workspace !== targetId && c.workspace !== targetSlug);
    }
    if (localDB.modules) {
      localDB.modules = localDB.modules.filter((m: any) => m.workspace !== targetId && m.workspace !== targetSlug);
    }
    if (localDB.workspace_members) {
      localDB.workspace_members = localDB.workspace_members.filter(
        (m: any) => m.workspace !== targetId && m.workspace !== targetSlug && m.workspace_id !== targetId && m.workspace_id !== targetSlug
      );
    }

    // 5. Update activeUser
    const remainingWs = (localDB.workspaces && localDB.workspaces.length > 0) ? localDB.workspaces[0] : null;
    if (routeSessionUser) {
      if (routeSessionUser.last_workspace_slug === targetSlug || routeSessionUser.last_workspace_id === targetId) {
        routeSessionUser.last_workspace_slug = remainingWs ? remainingWs.slug : null;
        routeSessionUser.last_workspace_id = remainingWs ? remainingWs.id : null;
      }
    }

    // 6. Update localStorage and document.cookie
    if (typeof window !== "undefined") {
      try {
        if (localStorage.getItem("last_workspace_slug") === targetSlug) {
          if (remainingWs) {
            localStorage.setItem("last_workspace_slug", remainingWs.slug);
          } else {
            localStorage.removeItem("last_workspace_slug");
          }
        }
        if (remainingWs) {
          document.cookie = `last_workspace_slug=${remainingWs.slug}; path=/; max-age=31536000; SameSite=Lax`;
        } else {
          document.cookie = `last_workspace_slug=; path=/; max-age=0; SameSite=Lax`;
        }
        document.cookie = `plane_dapp_sync_workspaces=${encodeURIComponent(JSON.stringify(localDB.workspaces))}; path=/; max-age=31536000; SameSite=Lax`;
      } catch (e) {
        console.warn("[DApp Workspace] Không thể cập nhật cookies:", e);
      }
    }

    saveDB();
    console.log(`[DApp Workspace] ✅ Đã xóa workspace ${targetSlug} (${targetId}), còn lại:`, localDB.workspaces);
    return ok({ message: "Workspace deleted successfully" });
  }

  if (url.match(/\/api\/users\/me/)) {
    if (!isLoggedIn()) return { data: { error: "not authenticated" }, status: 401 };

    if (method === "get" && /\/api\/users\/me\/?(?:\?.*)?$/.test(url)) {
      await discoverWalletWorkspaces(getStoredWalletAddress() || currentUserAddress || "");
      routeSessionUser = (localDB.users || []).find((user: any) => user.id === getLoggedInUserId()) || routeSessionUser;
      return ok(routeSessionUser);
    }

    if (url.includes("/api/users/me/profile")) {
      if (method === "patch" || method === "put" || method === "post") {
        if (!routeSessionUser) {
          if ((localDB.users || []).length === 1 && !loggedInEmail && !routeSessionWallet) {
            routeSessionUser = (localDB.users || [])[0];
          } else {
            routeSessionUser = createUserObject(routeSessionUserId || routeSessionWallet || "user-default", loggedInEmail || (routeSessionWallet ? `${routeSessionWallet}@metanode.wallet` : "member@plane.local"));
            if (!localDB.users) localDB.users = [];
            localDB.users.push(routeSessionUser);
          }
        }
        if (body?.theme) {
          routeSessionUser.theme = { ...routeSessionUser.theme, ...body.theme };
          if (typeof window !== "undefined") {
            if (body.theme.theme) {
              localStorage.setItem("theme", body.theme.theme);
              localStorage.setItem("plane_user_theme", body.theme.theme);
            }
          }
        }
        Object.assign(routeSessionUser, body);
        saveDB();
      }
      return ok(getUserProfile());
    }

    // Handle /api/users/me/onboard/ — marks user onboarding as complete
    if (url.includes("/api/users/me/onboard")) {
      if (routeSessionUser) {
        routeSessionUser.is_onboarded = true;
        if (!routeSessionUser.onboarding_step) routeSessionUser.onboarding_step = {};
        routeSessionUser.onboarding_step.profile_complete = true;
        routeSessionUser.onboarding_step.workspace_create = true;
        routeSessionUser.onboarding_step.workspace_join = true;
        routeSessionUser.onboarding_step.workspace_invite = true;
        saveDB();
      }
      return ok({ is_onboarded: true });
    }

    if (url.includes("/api/users/me/settings")) {
      if ((method === "patch" || method === "put" || method === "post") && body?.workspace) {
        if (body.workspace.last_workspace_slug && routeSessionUser) {
          routeSessionUser.last_workspace_slug = body.workspace.last_workspace_slug;
          if (typeof window !== "undefined") {
            localStorage.setItem("last_workspace_slug", body.workspace.last_workspace_slug);
            document.cookie = `last_workspace_slug=${body.workspace.last_workspace_slug}; path=/; max-age=31536000; SameSite=Lax`;
          }
        }
        if (body.workspace.last_workspace_id && routeSessionUser) {
          routeSessionUser.last_workspace_id = body.workspace.last_workspace_id;
        }
        saveDB();
      }
      return ok(getUserSettings());
    }

    if (url.includes("/api/users/me/instance-admin")) return ok({ is_instance_admin: true });

    if (url.includes("/api/users/me/accounts")) return ok([]);

    if (url.includes("/api/users/me/activities")) {
      const activities = localDB.issue_activities || [];
      return ok({
        count: activities.length,
        extra_stats: null,
        next_cursor: "",
        next_page_results: false,
        prev_cursor: "",
        prev_page_results: false,
        results: activities,
        total_pages: 1,
        total_results: activities.length,
      });
    }

    if (url.includes("/api/users/me/notification-preferences")) {
      return ok({
        property_change: true,
        state_change: true,
        comment: true,
        mention: true,
        issue_completed: true,
      });
    }

    if (url.includes("/project-roles")) {
      const wsSlugMatch = url.match(/\/workspaces\/([^/]+)\/project-roles/);
      const targetSlug = wsSlugMatch ? wsSlugMatch[1] : null;
      const ws = targetSlug ? (localDB.workspaces || []).find((w: any) => w.slug === targetSlug || w.id === targetSlug) : null;
      const wsKeys = new Set([targetSlug, ws?.id, ws?.slug].filter(Boolean));

      const activeId = routeSessionUser?.id || routeSessionUserId;
      const activeMail = (routeSessionUser?.email || loggedInEmail || "").toLowerCase().trim();
      const activeWallet = (
        sessionStorage.getItem("plane_active_wallet_address") ||
        localStorage.getItem("plane_active_wallet_address") ||
        currentUserAddress ||
        ""
      ).toLowerCase().trim();

      const wsMember = (localDB.workspace_members || []).find(
        (wm: any) =>
          (wsKeys.has(wm.workspace) || wsKeys.has(wm.workspace_id)) &&
          (activeWallet ? (wm.wallet_address?.toLowerCase() === activeWallet || (typeof wm.member === "string" && wm.member.toLowerCase() === activeWallet)) : (wm.member === activeId || (activeMail && (wm.email || "").toLowerCase().trim() === activeMail)))
      );
      const isWsAdmin =
        Boolean(
          ws &&
          (
            (activeId && activeId !== "user-default" && (ws.created_by === activeId || ws.owner?.id === activeId)) ||
            (activeMail && (
              (ws.owner?.email && ws.owner.email.toLowerCase().trim() === activeMail) ||
              (ws.created_by && ws.created_by.toLowerCase().trim() === activeMail)
            )) ||
            (activeWallet && (
              (ws.created_by && ws.created_by.toLowerCase() === activeWallet) ||
              (ws.owner?.id && ws.owner.id.toLowerCase() === activeWallet)
            ))
          )
        ) ||
        Boolean(wsMember && Number(wsMember.role) >= 20);

      const rolesMap: Record<string, number> = {};
      const wsProjects = (localDB.projects || []).filter((p: any) => {
        const pWs = p.workspace || p.workspace_id || p.workspace_detail?.id || p.workspace_detail?.slug;
        return wsKeys.has(pWs);
      });

      wsProjects.forEach((p: any) => {
        const isProjCreator = Boolean(
          (activeId && activeId !== "user-default" && (p.created_by === activeId || p.owner === activeId || p.owner?.id === activeId)) ||
          (activeMail && (
            (p.created_by && p.created_by.toLowerCase().trim() === activeMail) ||
            (p.owner?.email && p.owner.email.toLowerCase().trim() === activeMail)
          )) ||
          (activeWallet && (
            (p.created_by && p.created_by.toLowerCase() === activeWallet) ||
            (p.owner === activeWallet)
          ))
        );

        if (isWsAdmin || isProjCreator) {
          rolesMap[p.id] = 20;
          return;
        }

        const pm = (localDB.project_members || []).find((pMember: any) => {
          const pId = pMember.project || pMember.project_id;
          if (pId !== p.id) return false;
          const pMail = (pMember.email || "").toLowerCase().trim();
          const pMem = String(pMember.member || "").toLowerCase().trim();
          const pWall = (pMember.wallet_address || "").toLowerCase().trim();
          if (activeMail && (pMail === activeMail || pMem === activeMail)) return true;
          if (activeId && activeId !== "user-default" && pMem === activeId.toLowerCase().trim()) return true;
          if (activeWallet && (pWall === activeWallet || pMem === activeWallet)) return true;
          return false;
        });

        if (pm && pm.role) {
          rolesMap[p.id] = Number(pm.role);
          return;
        }

        rolesMap[p.id] = wsMember?.role ? Number(wsMember.role) : 15;
      });

      return ok(rolesMap);
    }

    const userProjInvMatch = url.match(/\/api\/users\/me\/workspaces\/([^/]+)\/projects\/invitations\/?(?:\?.*)?$/);
    if (userProjInvMatch) {
      if (method === "post") {
        if (!localDB.project_members) localDB.project_members = [];
        const projectIds: string[] = Array.isArray(body?.project_ids) ? body.project_ids : [];
        const activeId = routeSessionUser?.id || routeSessionUserId || "user-default";
        const activeMail = (routeSessionUser?.email || loggedInEmail || "").toLowerCase().trim();
        const activeWallet = (
          sessionStorage.getItem("plane_active_wallet_address") ||
          localStorage.getItem("plane_active_wallet_address") ||
          currentUserAddress ||
          ""
        ).toLowerCase().trim();
        const userObj = (localDB.users || []).find((u: any) => u.id === activeId || (activeMail && u.email?.toLowerCase() === activeMail));

        projectIds.forEach((projId: string) => {
          const targetProj = (localDB.projects || []).find(
            (p: any) => p.id === projId || (p.identifier && p.identifier.toLowerCase() === projId.toLowerCase())
          );
          const targetProjId = targetProj?.id || projId;
          const exists = localDB.project_members.some(
            (pm: any) =>
              (pm.project === targetProjId || pm.project_id === targetProjId) &&
              (
                (activeId && activeId !== "user-default" && (pm.member === activeId || pm.id === activeId || pm.member?.id === activeId)) ||
                (activeMail && ((pm.email || "").toLowerCase().trim() === activeMail || String(pm.member || "").toLowerCase().trim() === activeMail || (pm.member?.email || "").toLowerCase().trim() === activeMail)) ||
                (activeWallet && ((pm.wallet_address || "").toLowerCase().trim() === activeWallet || String(pm.member || "").toLowerCase().trim() === activeWallet || (pm.member?.wallet_address || "").toLowerCase().trim() === activeWallet))
              )
          );
          if (!exists) {
            localDB.project_members.push({
              id: `pm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              project: targetProjId,
              project_id: targetProjId,
              member: userObj || activeId,
              email: activeMail || undefined,
              wallet_address: activeWallet || undefined,
              role: 15,
              created_at: new Date().toISOString(),
            });
          }
        });
        saveDB();
        return ok({ message: "Joined projects successfully" });
      }
      return ok({});
    }

    if (url.includes("/api/users/me/workspaces") && !url.includes("/project-roles") && !url.includes("/invitations")) {
      syncCrossPortWorkspaces();
      const activeId = routeSessionUser?.id || routeSessionUserId;
      const activeMail = (routeSessionUser?.email || loggedInEmail || "").toLowerCase().trim();
      const activeWallet = (
        sessionStorage.getItem("plane_active_wallet_address") ||
        localStorage.getItem("plane_active_wallet_address") ||
        currentUserAddress ||
        ""
      ).toLowerCase().trim();

      const discovered = await discoverWalletWorkspaces(activeWallet);
      let myWorkspaces = getUserWorkspaces(activeId, activeMail);
      if (discovered.available) myWorkspaces = myWorkspaces.filter((workspace: any) => discovered.slugs.has(workspace.slug));
      const enriched = myWorkspaces.map((ws: any) => {
        const isOwner =
          ws.created_by === activeId ||
          ws.owner?.id === activeId ||
          (activeMail && ws.owner?.email?.toLowerCase() === activeMail) ||
          (activeWallet && (ws.created_by?.toLowerCase() === activeWallet || ws.owner?.id?.toLowerCase() === activeWallet));
        const memberRecord = (localDB.workspace_members || []).find(
          (m: any) =>
            (m.workspace === ws.slug || m.workspace === ws.id || m.workspace_id === ws.slug || m.workspace_id === ws.id) &&
            (m.member === activeId ||
              m.id === activeId ||
              (activeMail && m.email?.toLowerCase() === activeMail) ||
              (activeWallet && (
                m.wallet_address?.toLowerCase() === activeWallet ||
                (typeof m.member === "string" && m.member.toLowerCase() === activeWallet)
              )))
        );
        const resolvedRole = discovered.available ? (discovered.roles.get(ws.slug) ?? 15) : isOwner ? 20 : (memberRecord?.role || 15);
        const total_members = getWorkspaceMemberCount(ws.slug, ws.id);
        return Object.assign({}, ws, { role: resolvedRole, total_members });
      });
      return ok(enriched);
    }

    if (url.includes("/api/users/me/workspaces/invitations") || url.includes("/api/users/me/invitations")) {
      if (method === "get") {
        syncCrossPortWorkspaces();
        const stored = getStoredInvitations();
        if (!localDB.invitations) localDB.invitations = [];
        for (const inv of stored) {
          if (!localDB.invitations.some((i: any) => i.id === inv.id)) {
            localDB.invitations.push(inv);
          }
        }
        saveStoredInvitations(localDB.invitations);

        const userEmail = (routeSessionUser?.email || loggedInEmail || "").toLowerCase().trim();
        const userId = routeSessionUser?.id || routeSessionUserId;
        const allInvites = localDB.invitations || [];
        console.log(`[DApp Invitations] GET invitations — userEmail=${userEmail}, userId=${userId}, allInvites count=${allInvites.length}`);
        console.log(`[DApp Invitations] All invites:`, JSON.stringify(allInvites.map((i: any) => ({ id: i.id, email: i.email, accepted: i.accepted }))));
        const myInvites = allInvites.filter((inv: any) => {
          if (inv.accepted) return false;
          const invWs = inv.workspace?.slug || inv.workspace_slug || inv.workspace?.id || inv.workspace;
          const removedSet = new Set((localDB.removed_members?.[invWs] || []).map((x: string) => String(x).toLowerCase().trim()));
          const inviteEmail = (inv.email || "").toLowerCase().trim();
          const invWallet = (inv.wallet_address || "").toLowerCase().trim();
          if (removedSet.has(inviteEmail) || (invWallet && removedSet.has(invWallet)) || removedSet.has(String(inv.id).toLowerCase().trim())) {
            return false;
          }

          const match = (
            (userEmail && inviteEmail === userEmail) ||
            (userId && (inv.member === userId || inviteEmail === String(userId).toLowerCase().trim())) ||
            (currentUserAddress && inviteEmail === currentUserAddress.toLowerCase().trim())
          );
          console.log(`[DApp Invitations] Check inv ${inv.id}: inviteEmail=${inviteEmail}, match=${match}`);
          return match;
        });
        console.log(`[DApp Invitations] Returning ${myInvites.length} invites for ${userEmail}`);
        return ok(myInvites);
      }
      if (method === "post") {
        const ids = Array.isArray(body?.invitations) ? [...new Set(body.invitations)] : [];
        if (!ids.length) return { data: { error: "Please select an invitation." }, status: 400 };
        const results: any[] = [];
        for (const id of ids) {
          const inv = [...(localDB.invitations || []), ...getStoredInvitations()].find((item: any) => item.id === id);
          const slug = inv?.workspace_slug || inv?.workspace?.slug;
          if (!slug) {
            results.push({ id, status: 404, error: "Invitation not found." });
            continue;
          }
          // oxlint-disable-next-line no-await-in-loop -- Serialize invitation responses and wallet prompts.
          const result = await respondToWorkspaceInvitation("post", slug, String(id), { ...body, accepted: true });
          results.push({ id, status: result.status, ...result.data });
        }
        const failed = results.filter((result) => result.status >= 400);
        return { data: { results, accepted_count: results.length - failed.length, error: failed.length ? "Some invitations were not accepted. Check individual results." : undefined }, status: failed.length ? (failed.length === results.length ? failed[0].status : 207) : 200 };
      }
    }

    if (method === "patch" || method === "put" || method === "post") {
      if (!routeSessionUser) {
        if ((localDB.users || []).length === 1 && !loggedInEmail && !routeSessionWallet) {
          routeSessionUser = (localDB.users || [])[0];
        } else {
          routeSessionUser = createUserObject(routeSessionUserId || routeSessionWallet || "user-default", loggedInEmail || (routeSessionWallet ? `${routeSessionWallet}@metanode.wallet` : "member@plane.local"));
          if (!localDB.users) localDB.users = [];
          localDB.users.push(routeSessionUser);
        }
      }
      Object.assign(routeSessionUser, body);
      saveDB();
    }
    return ok(routeSessionUser);
  }

  // ── Workspace Invitation Join / Retrieve ─────────────────────────────
  const wsInvJoinMatch = url.match(/\/api\/workspaces\/([^/]+)\/invitations\/([^/]+)\/join\/?(?:\?.*)?$/);
  if (wsInvJoinMatch) {
    return respondToWorkspaceInvitation(method, decodeURIComponent(wsInvJoinMatch[1]), decodeURIComponent(wsInvJoinMatch[2]), body, new URL(url, "http://localhost").searchParams.get("token") || "");
  }

  // ── Projects & Workspace Members ────────────────────────────────────
  if (method === "get" && url.match(/\/api\/workspaces\/([^/]+)\/workspace-members\/me\/?/)) {
    const wsSlug = url.match(/\/api\/workspaces\/([^/]+)\/workspace-members\/me\/?/)?.[1] || "";
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
    if (!ws) {
      return { data: { error: "Workspace not found" }, status: 404 };
    }

    const activeId = routeSessionUser?.id || routeSessionUserId || "user-default";
    const activeMail = (routeSessionUser?.email || loggedInEmail || "").toLowerCase().trim();
    const activeWallet = (
      getStoredWalletAddress() ||
      currentUserAddress ||
      (typeof window !== "undefined"
        ? (sessionStorage.getItem("plane_active_wallet_address") || localStorage.getItem("plane_active_wallet_address"))
        : null) ||
      (routeSessionUser as any)?.metanode_wallet_address ||
      (routeSessionUser as any)?.wallet_address ||
      ""
    ).toLowerCase().trim();

    // Check if user is owner / creator of workspace
    if (activeWallet && getWorkspaceRegistryAddress() && getEnvVar("VITE_ONCHAIN_MEMBERSHIP_SYNC") !== "false") {
      const role = await fetchMemberRoleOnChain(wsSlug, activeWallet);
      if (role < 0) return { status: 503, data: { code: "PERMISSION_UNAVAILABLE", error: "Chưa kiểm tra được quyền workspace. Hãy thử lại khi kết nối phục hồi." } };
      if (![1, 2, 3].includes(role)) return { status: 403, data: { code: "NOT_MEMBER", error: "Ví đang chọn chưa có quyền trong workspace này." } };
      const verified = cacheVerifiedWalletMember(ws, activeWallet, role);
      saveDB({ localOnly: true });
      return ok({ id: verified.id, member: activeId, role: role >= 2 ? 20 : 15, workspace: ws.id, is_active: true, created_at: verified.created_at });
    }
    const isOwner =
      ws.created_by === activeId ||
      ws.owner?.id === activeId ||
      (activeMail && ws.owner?.email?.toLowerCase().trim() === activeMail) ||
      (activeWallet && (ws.created_by?.toLowerCase() === activeWallet || ws.owner?.id?.toLowerCase() === activeWallet));

    // Check if user is in localDB.workspace_members first
    let memberRecord = (localDB.workspace_members || []).find(
      (m: any) =>
        (m.workspace === wsSlug || m.workspace === ws.id || m.workspace_id === wsSlug || m.workspace_id === ws.id) &&
        (m.member === activeId ||
          m.id === activeId ||
          (activeMail && m.email?.toLowerCase().trim() === activeMail) ||
          (currentUserAddress && (m.member?.toLowerCase() === currentUserAddress.toLowerCase() || m.wallet_address?.toLowerCase() === currentUserAddress.toLowerCase())) ||
          (activeWallet && (m.wallet_address?.toLowerCase() === activeWallet || (typeof m.member === "string" && m.member.toLowerCase() === activeWallet))))
    );

    const isConfirmedMember = Boolean(memberRecord && memberRecord.is_active !== false);

    // Check if user was removed from this workspace
    const removedSet = getWorkspaceRemovedSet(wsSlug);
    const isRemoved =
      (activeMail && removedSet.has(activeMail)) ||
      (activeId && removedSet.has(activeId.toLowerCase())) ||
      (activeWallet && removedSet.has(activeWallet));

    if (isRemoved && !isOwner) {
      if (localDB.workspace_members) {
        localDB.workspace_members = localDB.workspace_members.filter((m: any) => {
          const isWs = (m.workspace === wsSlug || m.workspace === ws.id || m.workspace_id === wsSlug || m.workspace_id === ws.id);
          if (!isWs) return true;
          const mMail = (m.email || "").toLowerCase().trim();
          const mMem = String(m.member || "").toLowerCase().trim();
          const mId = String(m.id || "").toLowerCase().trim();
          const mWall = (m.wallet_address || "").toLowerCase().trim();
          return !removedSet.has(mMail) && !removedSet.has(mMem) && !removedSet.has(mId) && !removedSet.has(mWall);
        });
        saveDB();
      }
      return { data: { error: "Bạn không có quyền truy cập không gian làm việc này do đã bị xóa." }, status: 403 };
    }


    // Verify on-chain role for non-owner member
    const shouldSyncOnChain = getEnvVar("VITE_ONCHAIN_MEMBERSHIP_SYNC") !== "false";
    const memberWallet = extractEthAddress(memberRecord?.wallet_address) || extractEthAddress(memberRecord?.member) || currentUserAddress || getStoredWalletAddress();
    if (!isOwner && shouldSyncOnChain && memberWallet) {
      try {
        const onChainRole = await fetchMemberRoleOnChain(wsSlug, memberWallet);
        if (onChainRole > 0) {
          if (memberRecord) {
            memberRecord.verified_on_chain = true;
          } else {
            // Auto-reconstruct memberRecord from verified on-chain membership!
            const newMemberRecord = {
              id: `ws-member-${activeId}`,
              workspace: ws.id || wsSlug,
              workspace_id: ws.id || wsSlug,
              member: activeId,
              email: activeMail || undefined,
              wallet_address: memberWallet,
              role: onChainRole === 2 ? 20 : 15,
              is_active: true,
              verified_on_chain: true,
              created_at: new Date().toISOString(),
            };
            if (!localDB.workspace_members) localDB.workspace_members = [];
            localDB.workspace_members.push(newMemberRecord);
            memberRecord = newMemberRecord;
            saveDB();
          }
        } else if (onChainRole === 0 && memberRecord?.verified_on_chain) {
          // Only if this member was PREVIOUSLY confirmed on-chain and has now been removed on-chain by admin
          const cleanWall = memberWallet.toLowerCase();
          const hasActiveInv = (localDB.invitations || []).some((inv: any) => {
            const invWs = inv.workspace?.slug || inv.workspace?.id || inv.workspace || inv.workspace_slug;
            const matchWs = invWs === wsSlug || invWs === ws.id || invWs === ws.slug;
            const matchMail = activeMail && (inv.email || "").toLowerCase().trim() === activeMail;
            const matchWall = cleanWall && (inv.wallet_address || "").toLowerCase().trim() === cleanWall;
            return matchWs && (matchMail || matchWall) && !inv.accepted;
          });
          const isRecent = memberRecord.created_at && (Date.now() - new Date(memberRecord.created_at).getTime() < 180000);
          if (!isRecent && !hasActiveInv) {
            addWorkspaceRemovedIdentifiers(wsSlug, [cleanWall, activeMail].filter(Boolean));

            if (localDB.workspace_members) {
              localDB.workspace_members = localDB.workspace_members.filter((m: any) => {
                const isWs = (m.workspace === wsSlug || m.workspace === ws.id || m.workspace_id === wsSlug || m.workspace_id === ws.id);
                if (!isWs) return true;
                const mMail = (m.email || "").toLowerCase().trim();
                const mMem = String(m.member || "").toLowerCase().trim();
                const mWall = (m.wallet_address || "").toLowerCase().trim();
                return mMail !== activeMail && mMem !== cleanWall && mWall !== cleanWall;
              });
              saveDB();
            }
            return { data: { error: "You have been removed from this workspace" }, status: 403 };
          }
        }
      } catch (e) {
        console.warn("[DApp Routes] On-chain role check error in workspace-members/me:", e);
      }
    }

    if (memberRecord && !isOwner && !isConfirmedMember) {
      const recMail = (memberRecord.email || "").toLowerCase().trim();
      const recMem = String(memberRecord.member || "").toLowerCase().trim();
      const recId = String(memberRecord.id || "").toLowerCase().trim();
      if (removedSet.has(recMail) || removedSet.has(recMem) || removedSet.has(recId)) {
        return { data: { error: "You have been removed from this workspace" }, status: 403 };
      }
    }

    if (isOwner) {
      return ok({
        id: "ws-member-me",
        member: activeId,
        role: ws.role || 20,
        workspace: ws.id || wsSlug,
        is_active: true,
        created_at: ws.created_at || new Date().toISOString(),
      });
    }

    if (memberRecord) {
      return ok({
        id: memberRecord.id || `ws-member-${activeId}`,
        member: activeId,
        role: memberRecord.role || 15,
        workspace: ws.id || wsSlug,
        is_active: memberRecord.is_active !== false,
        created_at: memberRecord.created_at || new Date().toISOString(),
      });
    }

    // Default workspace fallback: only if unowned and system has <= 1 user
    if ((!ws.created_by || ws.created_by === "user-default") && (localDB.users || []).length <= 1) {
      ws.created_by = activeId;
      return ok({
        id: "ws-member-me",
        member: activeId,
        role: 20,
        workspace: ws.id || wsSlug,
        is_active: true,
        created_at: new Date().toISOString(),
      });
    }

    return { data: { error: "You are not a member of this workspace" }, status: 403 };
  }

  // ── Workspace Integrations & Import / Export ────────────────────────
  if (url.includes("/api/integrations")) {
    return ok([
      {
        id: "github-integration",
        title: "GitHub",
        provider: "github",
        description: "Connect with GitHub with your Plane workspace to sync project work items.",
        author: "Plane",
        avatar_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: null,
        updated_by: null,
        verified: true,
        webhook_secret: "",
        webhook_url: "",
        redirect_url: "",
        network: 1,
        metadata: {},
      },
      {
        id: "slack-integration",
        title: "Slack",
        provider: "slack",
        description: "Connect with Slack with your Plane workspace to sync project work items.",
        author: "Plane",
        avatar_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: null,
        updated_by: null,
        verified: true,
        webhook_secret: "",
        webhook_url: "",
        redirect_url: "",
        network: 1,
        metadata: {},
      },
    ]);
  }

  // ── Workspace Integrations ───────────────────────────────────────────
  const wsIntegrationsMatch = url.match(/\/api\/workspaces\/([^/]+)\/workspace-integrations\/?(?:\?.*)?$/);
  if (wsIntegrationsMatch || url.includes("/workspace-integrations")) {
    const wsSlug = wsIntegrationsMatch ? wsIntegrationsMatch[1] : (url.match(/\/api\/workspaces\/([^/]+)\//)?.[1] || "");
    if (method === "delete") {
      const delMatch = url.match(/\/workspace-integrations\/([^/]+)/);
      const intId = delMatch ? delMatch[1] : "";
      if (localDB.workspace_integrations) {
        localDB.workspace_integrations = localDB.workspace_integrations.filter((wi: any) => wi.id !== intId);
        saveDB();
      }
      return ok({ message: "Workspace integration removed successfully" });
    }
    const integrations = (localDB.workspace_integrations || []).filter(
      (wi: any) => !wsSlug || wi.workspace === wsSlug
    );
    return ok(integrations);
  }

  // ── Workspace Importers ──────────────────────────────────────────────
  if (url.includes("/importers")) {
    return ok([]);
  }

  // ── Workspace Export Issues (GET, POST) ──────────────────────────────
  if (url.includes("/export-issues")) {
    const wsSlugMatch = url.match(/\/api\/workspaces\/([^/]+)\/export-issues/);
    const wsSlug = wsSlugMatch ? wsSlugMatch[1] : "";
    const ws = (localDB.workspaces || []).find((w: any) => !wsSlug || w.slug === wsSlug || w.id === wsSlug);

    const userDetail = {
      id: routeSessionUser?.id || "user-default",
      display_name: routeSessionUser?.display_name || routeSessionUser?.first_name || routeSessionUser?.email || "User",
      email: routeSessionUser?.email || "",
      avatar_url: routeSessionUser?.avatar_url || routeSessionUser?.avatar || "",
    };

    if (method === "get") {
      let exportList: any[] = [];
      if (Array.isArray(localDB.exports)) {
        exportList = localDB.exports.filter((exp: any) => !wsSlug || exp.workspace === wsSlug || exp.workspace_id === wsSlug);
      } else if (localDB.exports && typeof localDB.exports === "object") {
        exportList = localDB.exports[wsSlug] || [];
      }

      // Ensure every completed export has an active, valid blob or data URL
      if (typeof window !== "undefined") {
        for (const item of exportList) {
          if (item.status === "completed" && item.raw_data) {
            if (activeExportBlobUrls.has(item.id)) {
              item.url = activeExportBlobUrls.get(item.id)!;
            } else {
              try {
                const mime = item.provider === "json"
                  ? "application/json;charset=utf-8;"
                  : "text/csv;charset=utf-8;";
                const blob = new Blob([item.raw_data], { type: mime });
                const blobUrl = URL.createObjectURL(blob);
                activeExportBlobUrls.set(item.id, blobUrl);
                item.url = blobUrl;
              } catch {
                if (!item.url && item.raw_data) {
                  const mime = item.provider === "json" ? "application/json" : "text/csv";
                  item.url = `data:${mime};charset=utf-8,${encodeURIComponent(item.raw_data)}`;
                }
              }
            }
          }
        }
      }

      return ok({
        count: exportList.length,
        extra_stats: null,
        next_cursor: "",
        next_page_results: false,
        prev_cursor: "",
        prev_page_results: false,
        results: exportList.map((exp: any) => ({
          ...exp,
          project: Array.isArray(exp?.project) ? exp.project : [],
          initiated_by_detail: exp?.initiated_by_detail || userDetail,
        })),
        total_pages: 1,
        total_results: exportList.length,
      });
    }

    if (method === "post") {
      const selectedProjects: string[] = Array.isArray(body?.project) ? body.project : [];
      const provider: string = String(body?.provider || "csv").toLowerCase();

      // Find projects in this workspace
      const wsProjects = (localDB.projects || []).filter(
        (p: any) =>
          !wsSlug ||
          p.workspace === wsSlug ||
          p.workspace === ws?.id ||
          p.workspace_id === wsSlug ||
          p.workspace_id === ws?.id
      );
      const wsProjIds = new Set(wsProjects.map((p: any) => p.id));
      const targetProjIds = selectedProjects.length > 0 ? new Set(selectedProjects) : wsProjIds;

      // Filter non-deleted, non-draft issues
      const deletedIssueSet = new Set(localDB._deleted_issue_ids || []);
      const issuesToExport = (localDB.issues || []).filter((i: any) => {
        const pId = i.project || i.project_id;
        return targetProjIds.has(pId) && !deletedIssueSet.has(i.id) && !i.is_draft;
      });

      let fileContent = "";
      let mimeType = "text/csv;charset=utf-8;";

      if (provider === "json") {
        mimeType = "application/json;charset=utf-8;";
        const jsonList = issuesToExport.map((issue: any) => {
          const proj = wsProjects.find((p: any) => p.id === (issue.project || issue.project_id));
          const stateObj = (localDB.states || []).find((s: any) => s.id === (issue.state_id || issue.state));
          const assigneeIds = Array.isArray(issue.assignees) ? issue.assignees : (issue.assignee_ids || []);
          const assignees = assigneeIds.map((aId: string) => {
            const u = (localDB.users || []).find((usr: any) => usr.id === aId || usr.email === aId);
            return {
              id: aId,
              name: u?.display_name || u?.first_name || u?.email || aId,
              email: u?.email || "",
            };
          });
          const labelIds = Array.isArray(issue.labels) ? issue.labels : (issue.label_ids || []);
          const labels = labelIds.map((lId: string) => {
            const l = (localDB.labels || []).find((lbl: any) => lbl.id === lId || lbl.name === lId);
            return {
              id: lId,
              name: l?.name || lId,
              color: l?.color || "#3f3f46",
            };
          });

          return {
            id: issue.id,
            sequence_id: issue.sequence_id ? `${proj?.identifier || "TASK"}-${issue.sequence_id}` : issue.id,
            project: {
              id: proj?.id,
              name: proj?.name,
              identifier: proj?.identifier,
            },
            name: issue.name,
            description: (issue.description_html || issue.description_stripped || issue.description || "")
              .replace(/<[^>]*>?/gm, " ")
              .trim(),
            state: stateObj
              ? { id: stateObj.id, name: stateObj.name, group: stateObj.group, color: stateObj.color }
              : issue.state,
            priority: (issue.priority || "none").toLowerCase(),
            assignees,
            labels,
            start_date: issue.start_date || null,
            target_date: issue.target_date || null,
            completed_at: issue.completed_at || null,
            created_at: issue.created_at || issue.created_on || new Date().toISOString(),
            updated_at: issue.updated_at || issue.updated_on || new Date().toISOString(),
          };
        });
        fileContent = JSON.stringify(jsonList, null, 2);
      } else {
        // CSV & Excel RFC 4180 with UTF-8 BOM
        mimeType = "text/csv;charset=utf-8;";


        const headers = [
          "ID",
          "Project Key",
          "Project Name",
          "Sequence ID",
          "Title",
          "Description",
          "State",
          "State Group",
          "Priority",
          "Assignees",
          "Labels",
          "Start Date",
          "Target Date",
          "Completed At",
          "Created At",
          "Updated At",
        ];

        const rows = issuesToExport.map((issue: any) => {
          const proj = wsProjects.find((p: any) => p.id === (issue.project || issue.project_id));
          const projKey = proj?.identifier || "";
          const projName = proj?.name || "";
          const seqId = issue.sequence_id ? `${projKey}-${issue.sequence_id}` : (issue.id || "");
          const title = issue.name || "";
          const desc = (issue.description_html || issue.description_stripped || issue.description || "")
            .replace(/<[^>]*>?/gm, " ")
            .replace(/\s+/g, " ")
            .trim();

          const stateObj = (localDB.states || []).find((s: any) => s.id === (issue.state_id || issue.state));
          const stateName = stateObj?.name || issue.state_detail?.name || issue.state || "";
          const stateGroup = stateObj?.group || issue.state_detail?.group || "";
          const priority = (issue.priority || "none").toUpperCase();

          const assigneeIds = Array.isArray(issue.assignees) ? issue.assignees : (issue.assignee_ids || []);
          const assigneeNames = assigneeIds
            .map((aId: string) => {
              const u = (localDB.users || []).find((usr: any) => usr.id === aId || usr.email === aId);
              return u?.display_name || u?.first_name || u?.email || aId;
            })
            .join(", ");

          const labelIds = Array.isArray(issue.labels) ? issue.labels : (issue.label_ids || []);
          const labelNames = labelIds
            .map((lId: string) => {
              const l = (localDB.labels || []).find((lbl: any) => lbl.id === lId || lbl.name === lId);
              return l?.name || lId;
            })
            .join(", ");

          return [
            escapeCsv(issue.id),
            escapeCsv(projKey),
            escapeCsv(projName),
            escapeCsv(seqId),
            escapeCsv(title),
            escapeCsv(desc),
            escapeCsv(stateName),
            escapeCsv(stateGroup),
            escapeCsv(priority),
            escapeCsv(assigneeNames),
            escapeCsv(labelNames),
            escapeCsv(issue.start_date || ""),
            escapeCsv(issue.target_date || ""),
            escapeCsv(issue.completed_at || ""),
            escapeCsv(issue.created_at || issue.created_on || ""),
            escapeCsv(issue.updated_at || issue.updated_on || ""),
          ].join(",");
        });

        fileContent = "\uFEFF" + headers.join(",") + "\r\n" + rows.join("\r\n");
      }

      const exportId = `export-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      let downloadUrl = "";
      if (typeof window !== "undefined") {
        try {
          const blob = new Blob([fileContent], { type: mimeType });
          downloadUrl = URL.createObjectURL(blob);
          activeExportBlobUrls.set(exportId, downloadUrl);
        } catch { }
      }
      if (!downloadUrl) {
        try {
          const b64 = typeof btoa !== "undefined" ? btoa(unescape(encodeURIComponent(fileContent))) : "";
          downloadUrl = `data:${mimeType};base64,${b64}`;
        } catch {
          downloadUrl = `data:${mimeType},${encodeURIComponent(fileContent)}`;
        }
      }

      const newExportRecord: any = {
        id: exportId,
        workspace: wsSlug || ws?.slug || ws?.id || "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        project: selectedProjects,
        provider: provider,
        status: "completed",
        url: downloadUrl,
        raw_data: fileContent,
        token: exportId,
        created_by: userDetail.id,
        updated_by: userDetail.id,
        initiated_by_detail: {
          id: userDetail.id,
          avatar_url: userDetail.avatar_url || "",
          display_name: userDetail.display_name,
          email: userDetail.email,
        },
      };

      if (!localDB.exports) localDB.exports = {};
      if (Array.isArray(localDB.exports)) {
        localDB.exports.unshift(newExportRecord);
      } else {
        if (!localDB.exports[wsSlug]) localDB.exports[wsSlug] = [];
        localDB.exports[wsSlug].unshift(newExportRecord);
      }
      saveDB();

      return ok(newExportRecord);
    }
  }

  if (url.match(/\/api\/workspaces\/[^/]+\/members\/?(?:\?.*)?$/)) {
    const wsSlug = url.match(/\/api\/workspaces\/([^/]+)\/members\/?/)?.[1] || "";
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);

    if (method === "get") {
      syncCrossPortWorkspaces();
      // 2. Pending invites set (to avoid listing unaccepted invites as members)
      // On-Chain Membership Sync: fetch verified member wallets from smart contract
      const shouldSyncOnChain = getEnvVar("VITE_ONCHAIN_MEMBERSHIP_SYNC") !== "false";
      if (shouldSyncOnChain && wsSlug) {
        try {
          const onChainMembers = await fetchWorkspaceMembersOnChain(wsSlug, true);
          if (onChainMembers && onChainMembers.length > 0) {
            const beforeOnChainSync = JSON.stringify(localDB);
            if (!localDB.workspace_members) localDB.workspace_members = [];
            const ownerEth = getWorkspaceOwnerEth(ws, wsSlug);

            // Cleanup any locally cached members that were truly marked as removed or illegal owner duplicates
            if (ownerEth) {
              const cleanOwnerEth = ownerEth.toLowerCase();
              if (localDB.workspace_members && Array.isArray(localDB.workspace_members)) {
                localDB.workspace_members = localDB.workspace_members.filter((m: any) => {
                  const isWs = (m.workspace === wsSlug || m.workspace === ws?.id || m.workspace_id === wsSlug || m.workspace_id === ws?.id);
                  if (!isWs) return true;
                  const mWallet = (m.wallet_address || (typeof m.member === "string" && m.member.startsWith("0x") ? m.member : "")).toLowerCase().trim();
                  return !(mWallet === cleanOwnerEth && Number(m.role) < 20);
                });
              }
              (localDB.invitations || []).forEach((inv: any) => {
                const invWs = inv.workspace?.slug || inv.workspace_slug || inv.workspace?.id || inv.workspace;
                if ((!invWs || invWs === wsSlug || invWs === ws?.id) && inv.wallet_address?.toLowerCase() === cleanOwnerEth) {
                  inv.wallet_address = undefined;
                  inv.accepted = false;
                  inv.responded_at = null;
                }
              });
            }

            const removedSet = getWorkspaceRemovedSet(wsSlug);

            // Cleanup any locally cached members that were truly marked as removed or illegal owner duplicates
            if (ownerEth) {
              const cleanOwnerEth = ownerEth.toLowerCase();
              if (localDB.workspace_members && Array.isArray(localDB.workspace_members)) {
                localDB.workspace_members = localDB.workspace_members.filter((m: any) => {
                  const isWs = (m.workspace === wsSlug || m.workspace === ws?.id || m.workspace_id === wsSlug || m.workspace_id === ws?.id);
                  if (!isWs) return true;
                  const mWallet = (m.wallet_address || (typeof m.member === "string" && m.member.startsWith("0x") ? m.member : "")).toLowerCase().trim();
                  return !(mWallet === cleanOwnerEth && Number(m.role) < 20);
                });
              }
              (localDB.invitations || []).forEach((inv: any) => {
                const invWs = inv.workspace?.slug || inv.workspace_slug || inv.workspace?.id || inv.workspace;
                if ((!invWs || invWs === wsSlug || invWs === ws?.id) && inv.wallet_address?.toLowerCase() === cleanOwnerEth) {
                  inv.wallet_address = undefined;
                  inv.accepted = false;
                  inv.responded_at = null;
                }
              });
            }

            if (localDB.workspace_members && Array.isArray(localDB.workspace_members)) {
              localDB.workspace_members = localDB.workspace_members.filter((m: any) => {
                const isWs = (m.workspace === wsSlug || m.workspace === ws?.id || m.workspace_id === wsSlug || m.workspace_id === ws?.id);
                if (!isWs) return true;
                const mMail = (m.email || "").toLowerCase().trim();
                const mMem = String(m.member || "").toLowerCase().trim();
                const mId = String(m.id || "").toLowerCase().trim();
                const mWallet = (m.wallet_address || (typeof m.member === "string" && m.member.startsWith("0x") ? m.member : "")).toLowerCase().trim();
                return !removedSet.has(mMail) && !removedSet.has(mMem) && !removedSet.has(mId) && (!mWallet || !removedSet.has(mWallet));
              });
            }

            const uniqueOnChainMembers = Array.from(
              new Set(onChainMembers.map((a: string) => String(a || "").toLowerCase().trim()).filter(Boolean))
            );

            for (const cleanAddr of uniqueOnChainMembers) {
              if (ownerEth && cleanAddr === ownerEth.toLowerCase()) continue;

              // Check unaccepted invitations specifically matching cleanAddr
              const matchingPendingInv = (localDB.invitations || []).find((inv: any) => {
                const isWs = (inv.workspace?.slug === wsSlug || inv.workspace_slug === wsSlug || inv.workspace === wsSlug || inv.workspace === ws?.id);
                if (!isWs || inv.accepted) return false;
                if (inv.wallet_address && inv.wallet_address.toLowerCase().trim() === cleanAddr) return true;
                if (localDB._email_wallet_map && inv.email && String(localDB._email_wallet_map[inv.email.toLowerCase().trim()] || "").toLowerCase() === cleanAddr) return true;
                return false;
              });

              // If cleanAddr was in removedSet, but there is an unaccepted invitation waiting to be fulfilled, un-stale it!
              if (removedSet.has(cleanAddr)) {
                if (matchingPendingInv) {
                  console.log(`[DApp Routes] Un-stale ví ${cleanAddr} khỏi removed_members vì có lời mời pending hợp lệ: ${matchingPendingInv.email || matchingPendingInv.id}`);
                  removedSet.delete(cleanAddr);
                  const targetKeys = Array.from(new Set([wsSlug, ws?.slug, ws?.id].filter(Boolean)));
                  for (const k of targetKeys) {
                    if (localDB.removed_members?.[k]) {
                      localDB.removed_members[k] = localDB.removed_members[k].filter(
                        (x: string) => String(x).toLowerCase().trim() !== cleanAddr
                      );
                    }
                  }
                  try {
                    localStorage.setItem("plane_dapp_removed_members", JSON.stringify(localDB.removed_members));
                  } catch { }
                } else {
                  console.log(`[DApp Routes] Bỏ qua ví đã bị Admin xóa (removed_members): ${cleanAddr}`);
                  continue;
                }
              }

              // Verify on-chain role: Role.None (0) means removed or non-member
              // oxlint-disable-next-line no-await-in-loop -- Resolve and merge membership records in deterministic order.
              const onChainRole = await fetchMemberRoleOnChain(wsSlug, cleanAddr);
              if (onChainRole <= 0) {
                console.log(`[DApp Routes] Bỏ qua ví ${cleanAddr} vì on-chain role = ${onChainRole} (None)`);
                continue;
              }

              const existingIdx = localDB.workspace_members.findIndex(
                (m: any) =>
                  (m.workspace === wsSlug || m.workspace === ws?.id || m.workspace_id === wsSlug || m.workspace_id === ws?.id) &&
                  ((typeof m.member === "string" && m.member.toLowerCase() === cleanAddr) || m.wallet_address?.toLowerCase() === cleanAddr)
              );

              // 1. Match with an existing invitation for this workspace
              let matchedInv = (localDB.invitations || []).find(
                (inv: any) =>
                  (inv.workspace?.slug === wsSlug || inv.workspace_slug === wsSlug || inv.workspace === wsSlug || inv.workspace === ws?.id) &&
                  inv.wallet_address?.toLowerCase() === cleanAddr
              );
              // 1.1 Match via _email_wallet_map
              if (!matchedInv && localDB._email_wallet_map) {
                for (const [em, w] of Object.entries(localDB._email_wallet_map)) {
                  if (String(w).toLowerCase() === cleanAddr) {
                    matchedInv = (localDB.invitations || []).find(
                      (inv: any) =>
                        (inv.workspace?.slug === wsSlug || inv.workspace_slug === wsSlug || inv.workspace === wsSlug || inv.workspace === ws?.id) &&
                        (inv.email || "").toLowerCase().trim() === em.toLowerCase().trim()
                    );
                    if (matchedInv) break;
                  }
                }
              }
              // 1.2 Also check localStorage email-wallet map
              if (!matchedInv && typeof window !== "undefined") {
                try {
                  const rawMap = localStorage.getItem("plane_dapp_email_wallet_map");
                  if (rawMap) {
                    const parsed = JSON.parse(rawMap);
                    for (const [em, w] of Object.entries(parsed)) {
                      if (String(w).toLowerCase() === cleanAddr) {
                        matchedInv = (localDB.invitations || []).find(
                          (inv: any) =>
                            (inv.workspace?.slug === wsSlug || inv.workspace_slug === wsSlug || inv.workspace === wsSlug || inv.workspace === ws?.id) &&
                            (inv.email || "").toLowerCase().trim() === em.toLowerCase().trim()
                        );
                        if (matchedInv) break;
                      }
                    }
                  }
                } catch { }
              }
              if (!matchedInv) {
                // Fallback 1: match by registered user whose wallet matches cleanAddr
                const matchedUser = (localDB.users || []).find(
                  (u: any) =>
                    (u.metanode_wallet_address && u.metanode_wallet_address.toLowerCase() === cleanAddr) ||
                    (typeof u.id === "string" && u.id.toLowerCase() === cleanAddr)
                );
                if (matchedUser?.email) {
                  matchedInv = (localDB.invitations || []).find(
                    (inv: any) =>
                      (inv.workspace?.slug === wsSlug || inv.workspace_slug === wsSlug || inv.workspace === wsSlug || inv.workspace === ws?.id) &&
                      (inv.email || "").toLowerCase().trim() === matchedUser.email.toLowerCase().trim()
                  );
                }
              }
              if (!matchedInv && existingIdx >= 0) {
                const existMem = localDB.workspace_members[existingIdx];
                if (existMem.email && !existMem.email.endsWith("@metanode.chain")) {
                  matchedInv = (localDB.invitations || []).find(
                    (inv: any) =>
                      (inv.workspace?.slug === wsSlug || inv.workspace_slug === wsSlug || inv.workspace === wsSlug || inv.workspace === ws?.id) &&
                      (inv.email || "").toLowerCase().trim() === existMem.email.toLowerCase().trim()
                  );
                }
              }
              // NOTE: there used to be a "match any unaccepted invitation" fallback
              // here. It attached arbitrary on-chain wallets to whichever pending
              // invite happened to be first, producing phantom members and
              // unlocking a random user's invitation. Matching is now exact only.

              if (matchedInv) {
                const invMail = (matchedInv.email || "").toLowerCase().trim();
                const invId = String(matchedInv.id || "").toLowerCase().trim();
                const invWall = (matchedInv.wallet_address || "").toLowerCase().trim();
                if (removedSet.has(invMail) || removedSet.has(invId) || (invWall && removedSet.has(invWall))) {
                  console.log(`[DApp Routes] Bỏ qua matchedInv đã bị Admin xóa (removed_members): ${invMail || cleanAddr}`);
                  continue;
                }
                if (matchedInv.accepted !== true || matchedInv.wallet_address?.toLowerCase() !== cleanAddr || !matchedInv.responded_at) {
                  matchedInv.accepted = true;
                  matchedInv.wallet_address = cleanAddr;
                  matchedInv.responded_at = matchedInv.responded_at || new Date().toISOString();
                  matchedInv.updated_at = new Date().toISOString();
                }
              }

              const memberEmail = matchedInv?.email || `${cleanAddr.slice(0, 6)}...${cleanAddr.slice(-4)}@metanode.chain`;
              if (removedSet.has(cleanAddr) || removedSet.has(memberEmail.toLowerCase().trim())) {
                console.log(`[DApp Routes] Bỏ qua thành viên đã bị Admin xóa (removed_members): ${memberEmail} / ${cleanAddr}`);
                continue;
              }

              const namePart = memberEmail.includes("@") ? memberEmail.split("@")[0] : cleanAddr.slice(2, 8);
              const resolvedMemberId = `user-${namePart}`;

              if (existingIdx === -1) {
                localDB.workspace_members.push({
                  id: `ws-member-${cleanAddr.slice(2, 10)}`,
                  workspace: ws?.id || wsSlug,
                  workspace_id: ws?.id || wsSlug,
                  member: resolvedMemberId,
                  email: memberEmail,
                  wallet_address: cleanAddr,
                  role: onChainRole >= 2 ? 20 : 15,
                  on_chain_role: onChainRole,
                  is_active: true,
                  verified_on_chain: true,
                  created_at: new Date().toISOString(),
                });
              } else {
                localDB.workspace_members[existingIdx].wallet_address = cleanAddr;
                localDB.workspace_members[existingIdx].verified_on_chain = true;
                localDB.workspace_members[existingIdx].role = onChainRole >= 2 ? 20 : 15;
                localDB.workspace_members[existingIdx].on_chain_role = onChainRole;
                localDB.workspace_members[existingIdx].is_active = true;
                if (matchedInv?.email) {
                  localDB.workspace_members[existingIdx].email = matchedInv.email;
                  localDB.workspace_members[existingIdx].member = resolvedMemberId;
                }
              }

              // Also ensure a user record exists in localDB.users so the UI displays user name and avatar
              if (matchedInv?.email && !(localDB.users || []).some((u: any) => (u.email || "").toLowerCase().trim() === matchedInv.email.toLowerCase().trim())) {
                const newUser = createUserObject(resolvedMemberId, matchedInv.email);
                newUser.metanode_wallet_address = cleanAddr;
                if (!localDB.users) localDB.users = [];
                localDB.users.push(newUser);
              }

              // Update email-wallet map
              if (matchedInv?.email) {
                if (!localDB._email_wallet_map) localDB._email_wallet_map = {};
                localDB._email_wallet_map[matchedInv.email.toLowerCase().trim()] = cleanAddr;
                try {
                  const rawMap = JSON.parse(localStorage.getItem("plane_dapp_email_wallet_map") || "{}");
                  rawMap[matchedInv.email.toLowerCase().trim()] = cleanAddr;
                  localStorage.setItem("plane_dapp_email_wallet_map", JSON.stringify(rawMap));
                } catch { }
              }
            }
            if (beforeOnChainSync !== JSON.stringify(localDB)) {
              saveStoredInvitations(localDB.invitations);
              saveDB({ localOnly: true });
            }
          }
        } catch (chainErr) {
          console.warn("[DApp Routes] Failed to sync on-chain members:", chainErr);
        }
      }

      const canonicalMembers = listWorkspaceMembers(localDB, wsSlug, ws?.id);
      if (ws) ws.total_members = canonicalMembers.length;
      return ok(canonicalMembers);
    }
  }

  // ── Workspace Member Leave (POST) ──────────────────────────────────
  const wsMemberLeaveMatch = url.match(/\/api\/workspaces\/([^/]+)\/(?:workspace-members|members)\/leave\/?(?:\?.*)?$/);
  if (wsMemberLeaveMatch && method === "post") {
    if (!getLoggedInUserId()) return { status: 401, data: { code: "AUTH_REQUIRED", error: "Vui lòng đăng nhập." } };
    const wsSlug = wsMemberLeaveMatch[1];
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
    if (!ws) return { status: 404, data: { code: "WORKSPACE_NOT_FOUND", error: "Không tìm thấy workspace để rời." } };
    const activeId = routeSessionUser?.id || routeSessionUserId || "";
    const activeMail = (routeSessionUser?.email || loggedInEmail || "").toLowerCase().trim();
    const activeWallet = (
      currentUserAddress ||
      getStoredWalletAddress() ||
      (typeof window !== "undefined"
        ? (sessionStorage.getItem("plane_active_wallet_address") || localStorage.getItem("plane_active_wallet_address"))
        : null) ||
      (routeSessionUser as any)?.metanode_wallet_address ||
      (routeSessionUser as any)?.wallet_address ||
      ""
    ).toLowerCase().trim();

    try {
      if (!await leaveWorkspaceOnChain(ws?.slug || wsSlug, activeWallet)) {
        return { status: 503, data: { code: "LEAVE_UNCONFIRMED", error: "Chưa xác nhận được thao tác rời workspace. Dữ liệu thành viên vẫn được giữ nguyên." } };
      }
    } catch (error) {
      const code = error instanceof MembershipOperationError ? error.code : "LEAVE_UNCONFIRMED";
      return {
        status: code === "OWNER_CANNOT_LEAVE" ? 403 : ["CONTRACT_UPGRADE_REQUIRED", "SIGNING_WALLET_CHANGED", "WALLET_REQUIRED"].includes(code) ? 409 : 503,
        data: { code, error: error instanceof Error ? error.message : "Chưa xác nhận được thao tác rời workspace. Dữ liệu thành viên vẫn được giữ nguyên." },
      };
    }

    if (localDB.workspace_members) {
      const workspaceKeys = new Set([wsSlug, ws.id, ws.slug].filter(Boolean));
      localDB.workspace_members = localDB.workspace_members.filter((m: any) => {
        const isWs = workspaceKeys.has(m.workspace) || workspaceKeys.has(m.workspace_id);
        if (!isWs) return true;
        const mMail = (m.email || "").toLowerCase().trim();
        const mMem = String(m.member || "").toLowerCase().trim();
        const mId = String(m.id || "").toLowerCase().trim();
        const mWall = (m.wallet_address || "").toLowerCase().trim();
        const rowWallet = extractEthAddress(mWall || mMem);
        if (rowWallet && rowWallet !== activeWallet) return true;
        return (
          (!activeId || (mMem !== activeId && mId !== activeId)) &&
          (!activeMail || mMail !== activeMail) &&
          (!activeWallet || (mWall !== activeWallet && mMem !== activeWallet))
        );
      });
    }

    saveDB();
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("plane_dapp_members_synced"));
    return ok({ message: "Left workspace successfully", chain_confirmed: true });
  }

  // ── Workspace Member Detail (DELETE, PATCH) ─────────────────────────
  const wsMemberDetailMatch = url.match(/\/api\/workspaces\/([^/]+)\/members\/([^/]+)\/?(?:\?.*)?$/);
  if (wsMemberDetailMatch) {
    const wsSlug = wsMemberDetailMatch[1];
    const memberId = wsMemberDetailMatch[2];

    if (method === "delete") {
      let adminWallet: string | undefined;
      try {
        const u = new URL(url, "http://localhost");
        adminWallet = u.searchParams.get("wallet_address") || undefined;
      } catch {
        // ignore
      }
      if (!adminWallet && body?.wallet_address) {
        adminWallet = body.wallet_address;
      }
      if (!adminWallet) {
        adminWallet = currentUserAddress || getStoredWalletAddress() || undefined;
      }
      const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
      if (!adminWallet) {
        adminWallet = getWorkspaceOwnerEth(ws, wsSlug) || undefined;
      }

      const cleanMemberId = String(memberId || "").trim();
      const rawMemberId = cleanMemberId
        .replace(/^ws-member-/, "")
        .replace(/^member-/, "")
        .replace(/^inv-/, "")
        .trim();

      const candidateIds = new Set<string>();
      if (cleanMemberId) {
        candidateIds.add(cleanMemberId.toLowerCase());
      }
      if (rawMemberId) {
        candidateIds.add(rawMemberId.toLowerCase());
        candidateIds.add(`ws-member-${rawMemberId.toLowerCase()}`);
        candidateIds.add(`member-${rawMemberId.toLowerCase()}`);
        candidateIds.add(`inv-${rawMemberId.toLowerCase()}`);
      }

      // 1. Initial match against workspace_members, invitations, and users
      const matchedMembers = (localDB.workspace_members || []).filter((m: any) => {
        const mWs = String(m.workspace || m.workspace_id || "").toLowerCase().trim();
        const allowedWs = [wsSlug, ws?.id, ws?.slug]
          .filter(Boolean)
          .map((x: any) => String(x).toLowerCase().trim());
        if (mWs && !allowedWs.includes(mWs)) return false; // never touch another workspace
        const mId = String(m.id || "").toLowerCase().trim();
        const mMem = String(m.member || "").toLowerCase().trim();
        const mWallet = (m.wallet_address || "").toLowerCase().trim();
        const mEmail = (m.email || m.member_email || m.member_detail?.email || "").toLowerCase().trim();
        return (
          candidateIds.has(mId) ||
          candidateIds.has(mMem) ||
          (mWallet && candidateIds.has(mWallet)) ||
          (mEmail && candidateIds.has(mEmail)) ||
          (cleanMemberId.includes("@") && mEmail === cleanMemberId.toLowerCase()) ||
          (cleanMemberId.startsWith("0x") && mWallet === cleanMemberId.toLowerCase())
        );
      });

      const matchedInvs = (localDB.invitations || []).filter((i: any) => {
        const iWsKeys = getInvitationWorkspaceKeys(i);
        const allowedInvWs = new Set([wsSlug, ws?.id, ws?.slug]
          .filter(Boolean)
          .map((x: any) => String(x).toLowerCase().trim()));
        if (iWsKeys.length > 0 && !iWsKeys.some((k: string) => allowedInvWs.has(k))) return false;
        const iId = String(i.id || "").toLowerCase().trim();
        const iMail = (i.email || "").toLowerCase().trim();
        const iWallet = (i.wallet_address || "").toLowerCase().trim();
        return (
          candidateIds.has(iId) ||
          candidateIds.has(iMail) ||
          (iWallet && candidateIds.has(iWallet)) ||
          (cleanMemberId.includes("@") && iMail === cleanMemberId.toLowerCase()) ||
          (cleanMemberId.startsWith("0x") && iWallet === cleanMemberId.toLowerCase())
        );
      });

      const matchedUsers = (localDB.users || []).filter((u: any) => {
        const uId = String(u.id || "").toLowerCase().trim();
        const uMail = (u.email || "").toLowerCase().trim();
        const uWallet = (u.metanode_wallet_address || u.wallet_address || "").toLowerCase().trim();
        return (
          candidateIds.has(uId) ||
          candidateIds.has(uMail) ||
          (uWallet && candidateIds.has(uWallet)) ||
          (cleanMemberId.includes("@") && uMail === cleanMemberId.toLowerCase()) ||
          (cleanMemberId.startsWith("0x") && uWallet === cleanMemberId.toLowerCase())
        );
      });

      // 1.1 Nothing matched in this workspace -> report it instead of pretending
      if (matchedMembers.length === 0 && matchedInvs.length === 0 && matchedUsers.length === 0) {
        return {
          data: {
            error: "Không tìm thấy thành viên này trong không gian làm việc hiện tại.",
            code: "MEMBER_NOT_FOUND",
          },
          status: 404,
        };
      }

      // 2. Aggregate all emails, wallets, and IDs across matched entities
      const resolvedEmails = new Set<string>();
      const resolvedWallets = new Set<string>();
      const allTargetIdentifiers = new Set<string>(candidateIds);

      if (cleanMemberId.includes("@")) resolvedEmails.add(cleanMemberId.toLowerCase());
      const rawEth = extractEthAddress(cleanMemberId);
      if (rawEth) resolvedWallets.add(rawEth.toLowerCase());

      matchedMembers.forEach((m: any) => {
        if (m.id) allTargetIdentifiers.add(String(m.id).toLowerCase().trim());
        if (m.member) {
          allTargetIdentifiers.add(String(m.member).toLowerCase().trim());
          const eth = extractEthAddress(m.member);
          if (eth) resolvedWallets.add(eth.toLowerCase());
        }
        const email = (m.email || m.member_email || m.member_detail?.email || "").toLowerCase().trim();
        if (email) resolvedEmails.add(email);
        const wall = (m.wallet_address || "").toLowerCase().trim();
        if (wall) resolvedWallets.add(wall);
      });

      matchedInvs.forEach((i: any) => {
        if (i.id) {
          const idStr = String(i.id).toLowerCase().trim();
          allTargetIdentifiers.add(idStr);
          allTargetIdentifiers.add(`ws-member-${idStr}`);
          allTargetIdentifiers.add(`inv-${idStr}`);
        }
        const email = (i.email || "").toLowerCase().trim();
        if (email) resolvedEmails.add(email);
        const wall = (i.wallet_address || "").toLowerCase().trim();
        if (wall) resolvedWallets.add(wall);
      });

      matchedUsers.forEach((u: any) => {
        if (u.id) allTargetIdentifiers.add(String(u.id).toLowerCase().trim());
        const email = (u.email || "").toLowerCase().trim();
        if (email) resolvedEmails.add(email);
        const wall = (u.metanode_wallet_address || u.wallet_address || "").toLowerCase().trim();
        if (wall) resolvedWallets.add(wall);
      });

      // 3. Look up email <-> wallet mappings
      if (localDB._email_wallet_map) {
        resolvedEmails.forEach((email) => {
          const mapped = localDB._email_wallet_map[email];
          if (mapped) resolvedWallets.add(mapped.toLowerCase());
        });
      }
      try {
        const mapRaw = typeof window !== "undefined" ? localStorage.getItem("plane_dapp_email_wallet_map") : null;
        if (mapRaw) {
          const parsed = JSON.parse(mapRaw);
          resolvedEmails.forEach((email) => {
            if (parsed[email]) resolvedWallets.add(parsed[email].toLowerCase());
          });
        }
      } catch { }

      // 4. Secondary cross-resolution: find any remaining members/invitations/users matching resolved emails or wallets
      (localDB.workspace_members || []).forEach((m: any) => {
        const mMail = (m.email || m.member_email || m.member_detail?.email || "").toLowerCase().trim();
        const mEth = extractEthAddress(m.wallet_address || m.member || m.email);
        if ((mMail && resolvedEmails.has(mMail)) || (mEth && resolvedWallets.has(mEth.toLowerCase()))) {
          if (m.id) allTargetIdentifiers.add(String(m.id).toLowerCase().trim());
          if (m.member) allTargetIdentifiers.add(String(m.member).toLowerCase().trim());
          if (mMail) resolvedEmails.add(mMail);
          if (mEth) resolvedWallets.add(mEth.toLowerCase());
        }
      });

      (localDB.invitations || []).forEach((i: any) => {
        const iMail = (i.email || "").toLowerCase().trim();
        const iEth = extractEthAddress(i.wallet_address);
        if ((iMail && resolvedEmails.has(iMail)) || (iEth && resolvedWallets.has(iEth.toLowerCase()))) {
          const idStr = String(i.id || "").toLowerCase().trim();
          if (idStr) {
            allTargetIdentifiers.add(idStr);
            allTargetIdentifiers.add(`ws-member-${idStr}`);
            allTargetIdentifiers.add(`inv-${idStr}`);
          }
          if (iMail) resolvedEmails.add(iMail);
          if (iEth) resolvedWallets.add(iEth.toLowerCase());
        }
      });

      (localDB.users || []).forEach((u: any) => {
        const uMail = (u.email || "").toLowerCase().trim();
        const uEth = extractEthAddress(u.metanode_wallet_address || u.wallet_address);
        if ((uMail && resolvedEmails.has(uMail)) || (uEth && resolvedWallets.has(uEth.toLowerCase()))) {
          if (u.id) allTargetIdentifiers.add(String(u.id).toLowerCase().trim());
          if (uMail) resolvedEmails.add(uMail);
          if (uEth) resolvedWallets.add(uEth.toLowerCase());
        }
      });

      // Also check stored invitations in localStorage
      try {
        const stored = getStoredInvitations();
        for (const si of stored) {
          const sMail = (si.email || "").toLowerCase().trim();
          const sEth = extractEthAddress(si.wallet_address);
          const sId = String(si.id || "").toLowerCase().trim();
          if (
            allTargetIdentifiers.has(sId) ||
            (sMail && resolvedEmails.has(sMail)) ||
            (sEth && resolvedWallets.has(sEth.toLowerCase()))
          ) {
            if (sId) {
              allTargetIdentifiers.add(sId);
              allTargetIdentifiers.add(`ws-member-${sId}`);
              allTargetIdentifiers.add(`inv-${sId}`);
            }
            if (sMail) resolvedEmails.add(sMail);
            if (sEth) resolvedWallets.add(sEth.toLowerCase());
          }
        }
      } catch { }

      // Add all emails and wallets to allTargetIdentifiers
      resolvedEmails.forEach((em) => allTargetIdentifiers.add(em));
      resolvedWallets.forEach((w) => allTargetIdentifiers.add(w));

      console.log(`[DApp Routes] Deleting workspace member:`, {
        memberId,
        resolvedEmails: Array.from(resolvedEmails),
        resolvedWallets: Array.from(resolvedWallets),
        allTargetIdentifiers: Array.from(allTargetIdentifiers),
      });

      // 5. Revoke on-chain access FIRST (fail-closed).
      //    Removing a member is a security operation: if the workspace has an
      //    on-chain registry and we cannot revoke the role, we must NOT report
      //    success nor hide the member locally - otherwise the UI claims the
      //    person is gone while they still hold on-chain permissions (RC-8).
      const actingAdminWallet = adminWallet || getWorkspaceOwnerEth(ws, wsSlug) || currentUserAddress || getStoredWalletAddress();
      const chainRegistryAddr = getWorkspaceRegistryAddress();
      const chainRequired = Boolean(chainRegistryAddr && actingAdminWallet && resolvedWallets.size > 0 && getFiaiSDK());
      const chainFailures: { wallet: string; error: string }[] = [];

      if (chainRequired) {
        for (const wallet of Array.from(resolvedWallets)) {
          try {
            console.log(`[DApp Routes] Removing member on-chain: wallet=${wallet}, admin=${actingAdminWallet}`);
            // oxlint-disable-next-line no-await-in-loop -- Revoke each wallet on chain before deleting local membership.
            const removed = await removeWorkspaceMemberOnChain(wsSlug, wallet, actingAdminWallet || undefined);
            if (!removed) {
              chainFailures.push({
                wallet,
                error: "Không thể thu hồi quyền trên blockchain (giao dịch bị từ chối hoặc ví chưa mở khoá).",
              });
            }
          } catch (chainErr: any) {
            const message = String(chainErr?.message || chainErr || "Unknown error");
            console.warn("[DApp Routes] removeWorkspaceMemberOnChain error:", chainErr);
            chainFailures.push({ wallet, error: message });
          }
        }

        if (chainFailures.length > 0) {
          console.error("[DApp Routes] Member removal aborted - on-chain revocation failed:", chainFailures);
          return {
            data: {
              error:
                "Không thể xóa thành viên: chưa thu hồi được quyền trên blockchain. Thành viên vẫn được giữ nguyên, vui lòng thử lại sau khi ví quản trị sẵn sàng.",
              code: "CHAIN_REVOCATION_FAILED",
              removed_count: 0,
              chain_failures: chainFailures,
            },
            status: 502,
          };
        }
      }

      // 6. Filter localDB.workspace_members
      if (localDB.workspace_members && Array.isArray(localDB.workspace_members)) {
        localDB.workspace_members = localDB.workspace_members.filter((m: any) => {
          const mId = String(m.id || "").toLowerCase().trim();
          const mMem = String(m.member || "").toLowerCase().trim();
          const mMail = (m.email || m.member_email || m.member_detail?.email || "").toLowerCase().trim();
          const mEth = extractEthAddress(m.wallet_address || m.member || m.email);

          if (allTargetIdentifiers.has(mId) || allTargetIdentifiers.has(mMem)) return false;
          if (mMail && resolvedEmails.has(mMail)) return false;
          if (mEth && resolvedWallets.has(mEth.toLowerCase())) return false;
          return true;
        });
      }

      // 6b. Drop the person from every project membership of this workspace.
      //     Leaving stale project_members rows behind kept them assignable on
      //     work items after being removed from the workspace (RC-10).
      if (localDB.project_members && Array.isArray(localDB.project_members)) {
        const removedProjectIds = new Set(
          (localDB.projects || [])
            .filter(
              (p: any) =>
                p.workspace === wsSlug ||
                p.workspace === ws?.id ||
                p.workspace_id === wsSlug ||
                p.workspace_id === ws?.id
            )
            .map((p: any) => String(p.id))
        );
        localDB.project_members = localDB.project_members.filter((pm: any) => {
          const pmProject = String(pm.project || pm.project_id || "");
          if (removedProjectIds.size > 0 && !removedProjectIds.has(pmProject)) return true;
          const pmMember = String(typeof pm.member === "object" && pm.member?.id ? pm.member.id : (pm.member || pm.id || ""))
            .toLowerCase()
            .trim();
          const pmMail = (pm.email || pm.member?.email || "").toLowerCase().trim();
          const pmEth = extractEthAddress(pm.member || pm.email || pm.wallet_address);
          if (allTargetIdentifiers.has(pmMember)) return false;
          if (pmMail && resolvedEmails.has(pmMail)) return false;
          if (pmEth && resolvedWallets.has(pmEth.toLowerCase())) return false;
          return true;
        });
      }

      // 7. Add all identifiers to removed_members (both wsSlug and ws?.id)
      const identifiersToAdd = Array.from(allTargetIdentifiers);
      addWorkspaceRemovedIdentifiers(wsSlug, identifiersToAdd);
      if (ws?.id) {
        addWorkspaceRemovedIdentifiers(ws.id, identifiersToAdd);
      }

      // 8. Permanently remove any invitations matching this member (workspace scoped)
      if (localDB.invitations && Array.isArray(localDB.invitations)) {
        const invsToRemove = localDB.invitations.filter((i: any) => {
          const iWs = i.workspace?.slug || i.workspace_slug || i.workspace?.id || i.workspace;
          if (iWs && iWs !== wsSlug && (!ws?.id || iWs !== ws.id)) return false;
          const iMail = (i.email || "").toLowerCase().trim();
          const iId = String(i.id || "").toLowerCase().trim();
          const iEth = extractEthAddress(i.wallet_address);
          return (
            allTargetIdentifiers.has(iId) ||
            (iMail && resolvedEmails.has(iMail)) ||
            (iEth && resolvedWallets.has(iEth.toLowerCase()))
          );
        });
        invsToRemove.forEach((inv: any) => {
          removeStoredInvitation(inv.id, inv.email, wsSlug);
        });
      }
      for (const email of Array.from(resolvedEmails)) {
        removeStoredInvitation(`inv-${wsSlug}-${email}`, email, wsSlug);
      }
      for (const id of Array.from(allTargetIdentifiers)) {
        removeStoredInvitation(id, undefined, wsSlug);
      }

      // 9. Purge notifications
      if (localDB.notifications && Array.isArray(localDB.notifications)) {
        localDB.notifications = localDB.notifications.filter((n: any) => {
          const nMail = (n.recipient_email || n.recipient || "").toLowerCase().trim();
          const nInvId = String(n.data?.invitation_id || "").toLowerCase().trim();
          if (nMail && resolvedEmails.has(nMail)) return false;
          if (nInvId && allTargetIdentifiers.has(nInvId)) return false;
          return true;
        });
      }

      // 10. Sync across all browser tabs via BroadcastChannel
      const primaryMail = Array.from(resolvedEmails)[0] || "";
      const primaryWallet = Array.from(resolvedWallets)[0] || "";
      dappSyncChannel?.postMessage({
        type: "MEMBER_REMOVED",
        workspaceSlug: wsSlug,
        removedIdentifiers: identifiersToAdd,
        payload: {
          workspace_slug: wsSlug,
          member_id: memberId,
          member_address: primaryWallet,
          email: primaryMail,
          user_id: rawMemberId,
        },
      });

      saveDB();
      const newCid = await uploadToIPFS(true);
      if (newCid) {
        // Đi qua bộ hẹn giờ dùng chung (dedupe + gộp) thay vì gọi thẳng
        // `commitWorkspaceCID`: gọi thẳng bỏ qua kiểm tra "CID đã ở trên chain"
        // và có thể tạo giao dịch thứ hai cho cùng một hành động (CHAIN-09).
        scheduleWorkspaceCIDCommit(wsSlug, newCid, 0);
      }

      return ok({ message: "Member removed" });
    }

    if (method === "patch" || method === "put") {
      const ws = (localDB.workspaces || []).find((entry: any) => entry.slug === wsSlug || entry.id === wsSlug);
      const keys = new Set([wsSlug, ws?.id, ws?.slug].filter(Boolean));
      const idx = (localDB.workspace_members || []).findIndex((entry: any) =>
        (entry.id === memberId || entry.member === memberId) && [entry.workspace, entry.workspace_id, entry.workspace_slug].some((key) => keys.has(key)));
      if (idx < 0) return { status: 404, data: { error: "Member not found in this workspace." } };
      if (Object.keys(body).some((key) => key !== "role") || ![15, 20].includes(Number(body.role))) return { status: 400, data: { code: "UNSUPPORTED_ROLE", error: "Chỉ hỗ trợ quyền Admin và Member trên contract hiện tại." } };
      const previous = localDB.workspace_members[idx];
      const targetUser = (localDB.users || []).find((entry: any) => entry.id === previous.member);
      const wallet = extractEthAddress(previous.wallet_address || previous.member || targetUser?.metanode_wallet_address);
      if (!wallet) return { status: 409, data: { error: "The member has no verified wallet. Link the wallet before changing permissions." } };
      try {
        const signer = await assertVaultSigningAddress(getStoredWalletAddress() || currentUserAddress);
        if (!await setWorkspaceMemberRoleOnChain(wsSlug, wallet, Number(body.role), signer)) throw new Error("Role was not confirmed.");
      } catch (error) {
        return { status: 503, data: { error: error instanceof Error ? error.message : "Role update was not confirmed." } };
      }
      const role = await fetchMemberRoleOnChain(wsSlug, wallet);
      if (role < 1) return { status: 503, data: { error: "Unable to read the confirmed member role." } };
      const updated = { ...previous, role: role === 1 ? 15 : 20, requested_role: Number(body.role), wallet_address: wallet, verified_on_chain: true, updated_at: new Date().toISOString() };
      localDB.workspace_members[idx] = updated;
      saveDB();
      return ok(updated);
    }
  }

  // ── Entity Search (Mentions, Issues, Projects) ──────────────────────────
  if (method === "get" && url.includes("/entity-search")) {
    const wsMatch = url.match(/\/api\/workspaces\/([^/]+)\/entity-search/);
    const wsSlug = wsMatch ? wsMatch[1] : null;
    const ws = wsSlug ? (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug) : null;
    const validWsKeys = new Set([wsSlug, ws?.id, ws?.slug].filter(Boolean));

    let count = 5;
    let queryTypes = ["user_mention"];
    let searchQuery = "";
    let projectId: string | null = null;

    try {
      const parsedUrl = new URL(url, "http://localhost");
      count = parseInt(parsedUrl.searchParams.get("count") || "5", 10) || 5;
      const rawType = parsedUrl.searchParams.get("query_type") || "user_mention";
      queryTypes = rawType.split(",").map((s) => s.trim().toLowerCase());
      searchQuery = (parsedUrl.searchParams.get("query") || "").trim().replace(/^@/, "").toLowerCase();
      projectId = parsedUrl.searchParams.get("project_id");
    } catch {
      const qMatch = url.match(/[?&]query=([^&]+)/);
      if (qMatch) searchQuery = decodeURIComponent(qMatch[1]).trim().replace(/^@/, "").toLowerCase();
      const pMatch = url.match(/[?&]project_id=([^&]+)/);
      if (pMatch) projectId = decodeURIComponent(pMatch[1]);
      const cMatch = url.match(/[?&]count=([^&]+)/);
      if (cMatch) count = parseInt(cMatch[1], 10) || 5;
      const tMatch = url.match(/[?&]query_type=([^&]+)/);
      if (tMatch) queryTypes = decodeURIComponent(tMatch[1]).split(",").map((s) => s.trim().toLowerCase());
    }

    const response: Record<string, any> = {};

    if (queryTypes.includes("user_mention")) {
      const wsMembers = (localDB.workspace_members || []).filter((wm: any) => {
        const wmWs = wm.workspace || wm.workspace_id;
        return !wmWs || validWsKeys.size === 0 || validWsKeys.has(wmWs);
      });

      const memberUsers: Array<{ id: string; display_name: string; avatar_url: string }> = [];
      const seenUserIds = new Set<string>();

      for (const wm of wsMembers) {
        const user = (localDB.users || []).find(
          (u: any) => u.id === wm.member || u.email === wm.email || u.id === wm.id
        );
        const userId = user?.id || (typeof wm.member === "string" ? wm.member : wm.id) || "user";
        if (seenUserIds.has(userId)) continue;
        seenUserIds.add(userId);

        const displayName =
          user?.display_name || user?.first_name || wm.display_name || wm.first_name || wm.email?.split("@")[0] || "User";
        const avatarUrl = user?.avatar_url || wm.avatar_url || "";

        memberUsers.push({
          id: userId,
          display_name: displayName,
          avatar_url: avatarUrl,
        });
      }

      for (const u of localDB.users || []) {
        if (!seenUserIds.has(u.id)) {
          seenUserIds.add(u.id);
          memberUsers.push({
            id: u.id,
            display_name: u.display_name || u.first_name || u.email?.split("@")[0] || "User",
            avatar_url: u.avatar_url || "",
          });
        }
      }

      const filtered = memberUsers.filter((u) => {
        if (!searchQuery) return true;
        return (
          u.display_name.toLowerCase().includes(searchQuery) ||
          u.id.toLowerCase().includes(searchQuery)
        );
      });

      response.user_mention = filtered.slice(0, count).map((u) => ({
        member__id: u.id,
        member__display_name: u.display_name,
        member__avatar_url: u.avatar_url,
      }));
    }

    if (queryTypes.includes("issue")) {
      const issues = (localDB.issues || []).filter((i: any) => {
        if (projectId && i.project_id !== projectId && i.project !== projectId) return false;
        if (!searchQuery) return true;
        return (i.name || "").toLowerCase().includes(searchQuery);
      });
      response.issue = issues.slice(0, count).map((i: any) => ({
        id: i.id,
        name: i.name,
        sequence_id: i.sequence_id,
        project_id: i.project_id || i.project,
        project__identifier: i.project__identifier || "",
        priority: i.priority,
        state_id: i.state_id,
        type_id: i.type_id,
      }));
    }

    if (queryTypes.includes("project")) {
      const projects = (localDB.projects || []).filter((p: any) => {
        const pWs = p.workspace || p.workspace_id;
        if (pWs && validWsKeys.size > 0 && !validWsKeys.has(pWs)) return false;
        if (!searchQuery) return true;
        return (p.name || "").toLowerCase().includes(searchQuery) || (p.identifier || "").toLowerCase().includes(searchQuery);
      });
      response.project = projects.slice(0, count).map((p: any) => ({
        id: p.id,
        name: p.name,
        identifier: p.identifier,
        logo_props: p.logo_props,
        workspace__slug: wsSlug,
      }));
    }

    return ok(response);
  }

  if (
    method === "get" &&
    (url.match(/\/api\/workspaces\/[^/]+\/projects\/?(?:\?.*)?$/) || url.includes("/projects/details"))
  ) {
    const wsSlugMatch = url.match(/\/api\/workspaces\/([^/]+)\/projects/);
    const wsSlug = wsSlugMatch ? wsSlugMatch[1] : null;
    const ws = wsSlug ? (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug) : null;
    const canonicalWsId = ws?.id || wsSlug;
    const validWsKeys = new Set([wsSlug, ws?.id, ws?.slug].filter(Boolean));

    const currentUserId = routeSessionUser?.id || routeSessionUserId;
    const currentUserEmail = (routeSessionUser?.email || loggedInEmail || "").toLowerCase().trim();
    const activeWallet = (
      sessionStorage.getItem("plane_active_wallet_address") ||
      localStorage.getItem("plane_active_wallet_address") ||
      currentUserAddress ||
      ""
    ).toLowerCase().trim();

    // Check if user is Workspace Admin/Owner
    const wsMember = (localDB.workspace_members || []).find(
      (wm: any) =>
        (wm.workspace === ws?.id || wm.workspace === ws?.slug || wm.workspace === wsSlug) &&
        (activeWallet ? (wm.wallet_address?.toLowerCase() === activeWallet || (typeof wm.member === "string" && wm.member.toLowerCase() === activeWallet)) : (wm.member === currentUserId || (currentUserEmail && (wm.email || "").toLowerCase().trim() === currentUserEmail)))
    );
    const isWsAdmin =
      Boolean(
        ws &&
        (
          (currentUserId && currentUserId !== "user-default" && (ws.created_by === currentUserId || ws.owner?.id === currentUserId)) ||
          (currentUserEmail && (
            (ws.owner?.email && ws.owner.email.toLowerCase().trim() === currentUserEmail) ||
            (ws.created_by && ws.created_by.toLowerCase().trim() === currentUserEmail)
          )) ||
          (activeWallet && (
            (ws.created_by && ws.created_by.toLowerCase() === activeWallet) ||
            (ws.owner?.id && ws.owner.id.toLowerCase() === activeWallet)
          ))
        )
      ) ||
      Boolean(wsMember && Number(wsMember.role) >= 20);

    const deletedSet = new Set(localDB._deleted_project_ids || []);
    const projects = (localDB.projects || [])
      .filter((p: any) => {
        if (deletedSet.has(p.id) || deletedSet.has(p.identifier)) return false;
        if (validWsKeys.size > 0) {
          const pWs = p.workspace || p.workspace_id || p.workspace_detail?.id || p.workspace_detail?.slug;
          if (pWs && !validWsKeys.has(pWs)) return false;
          if (!pWs && ws?.slug !== getDefaultWorkspaceSlug()) return false;
        }

        // Secret / Private project check: network === 0 (EProjectNetwork.PRIVATE)
        if (p.network === 0) {
          const pm = (localDB.project_members || []).find((pMember: any) => {
            const pId = pMember.project || pMember.project_id;
            if (pId !== p.id) return false;
            const pMail = (pMember.email || "").toLowerCase().trim();
            const pMem = String(pMember.member || "").toLowerCase().trim();
            const pWall = (pMember.wallet_address || "").toLowerCase().trim();
            if (currentUserEmail && (pMail === currentUserEmail || pMem === currentUserEmail)) return true;
            if (currentUserId && currentUserId !== "user-default" && pMem === currentUserId.toLowerCase().trim()) return true;
            if (activeWallet && (pWall === activeWallet || pMem === activeWallet)) return true;
            return false;
          });

          const isProjCreator = Boolean(
            (currentUserId && currentUserId !== "user-default" && (p.created_by === currentUserId || p.owner === currentUserId || p.owner?.id === currentUserId)) ||
            (currentUserEmail && (
              (p.created_by && p.created_by.toLowerCase().trim() === currentUserEmail) ||
              (p.owner?.email && p.owner.email.toLowerCase().trim() === currentUserEmail) ||
              (currentUserEmail === "anh2482006@gmail.com" && (!p.created_by || p.created_by === "user-default"))
            )) ||
            (activeWallet && (
              (p.created_by && p.created_by.toLowerCase() === activeWallet) ||
              (p.owner === activeWallet)
            ))
          );

          if (!isWsAdmin && !isProjCreator && !pm) {
            return false;
          }
        }

        return true;
      })
      .map((p: any, index: number) => {
        const pm = (localDB.project_members || []).find((pMember: any) => {
          const pId = pMember.project || pMember.project_id;
          if (pId !== p.id) return false;
          const pMail = (pMember.email || "").toLowerCase().trim();
          const pMem = String(pMember.member || "").toLowerCase().trim();
          const pWall = (pMember.wallet_address || "").toLowerCase().trim();
          if (currentUserEmail && (pMail === currentUserEmail || pMem === currentUserEmail)) return true;
          if (currentUserId && currentUserId !== "user-default" && pMem === currentUserId.toLowerCase().trim()) return true;
          if (activeWallet && (pWall === activeWallet || pMem === activeWallet)) return true;
          return false;
        });

        const isProjCreator = Boolean(
          (currentUserId && currentUserId !== "user-default" && (p.created_by === currentUserId || p.owner === currentUserId || p.owner?.id === currentUserId)) ||
          (currentUserEmail && (
            (p.created_by && p.created_by.toLowerCase().trim() === currentUserEmail) ||
            (p.owner?.email && p.owner.email.toLowerCase().trim() === currentUserEmail)
          )) ||
          (activeWallet && (
            (p.created_by && p.created_by.toLowerCase() === activeWallet) ||
            (p.owner === activeWallet)
          ))
        );

        let resolvedRole: number | null = null;
        if (isProjCreator || isWsAdmin) {
          resolvedRole = 20;
        } else if (pm && pm.role) {
          resolvedRole = Number(pm.role);
        } else {
          resolvedRole = null;
        }

        // Calculate next_work_item_sequence from actual issues
        const projectIssues = (localDB.issues || []).filter((i: any) => i.project === p.id || i.project_id === p.id);
        const maxSeq = projectIssues.reduce((max: number, i: any) => Math.max(max, i.sequence_id || 0), 0);
        const sortOrder = typeof p.sort_order === "number" ? p.sort_order : (index + 1) * 10000;
        return Object.assign({}, p, {
          workspace: canonicalWsId || p.workspace,
          workspace_detail: ws || p.workspace_detail,
          member_role: resolvedRole,
          next_work_item_sequence: maxSeq + 1,
          sort_order: sortOrder,
          cycle_view: p.cycle_view ?? true,
          module_view: p.module_view ?? true,
          issue_views_view: p.issue_views_view ?? true,
          page_view: p.page_view ?? true,
          inbox_view: p.inbox_view ?? true,
        });
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
          const p = localDB.projects[projectIdx];
          const wsSlugMatch = url.match(/\/api\/workspaces\/([^/]+)\//);
          const wsSlug = wsSlugMatch ? wsSlugMatch[1] : null;
          const ws = wsSlug ? (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug) : null;
          const canonicalWsId = ws?.id || wsSlug;

          const currentUserId = routeSessionUser?.id || routeSessionUserId;
          const currentUserEmail = (routeSessionUser?.email || loggedInEmail || "").toLowerCase().trim();
          const activeWallet = (
            sessionStorage.getItem("plane_active_wallet_address") ||
            localStorage.getItem("plane_active_wallet_address") ||
            currentUserAddress ||
            ""
          ).toLowerCase().trim();

          const wsMember = (localDB.workspace_members || []).find(
            (wm: any) =>
              (wm.workspace === ws?.id || wm.workspace === ws?.slug || wm.workspace === wsSlug) &&
              (wm.member === currentUserId || (currentUserEmail && (wm.email || "").toLowerCase().trim() === currentUserEmail))
          );
          const isWsAdmin =
            Boolean(
              ws &&
              (
                (currentUserId && currentUserId !== "user-default" && (ws.created_by === currentUserId || ws.owner?.id === currentUserId)) ||
                (currentUserEmail && (
                  (ws.owner?.email && ws.owner.email.toLowerCase().trim() === currentUserEmail) ||
                  (ws.created_by && ws.created_by.toLowerCase().trim() === currentUserEmail)
                )) ||
                (activeWallet && (
                  (ws.created_by && ws.created_by.toLowerCase() === activeWallet) ||
                  (ws.owner?.id && ws.owner.id.toLowerCase() === activeWallet)
                ))
              )
            ) ||
            (currentUserEmail === "anh2482006@gmail.com") ||
            Boolean(wsMember && Number(wsMember.role) >= 20);

          const pm = (localDB.project_members || []).find((pMember: any) => {
            const pId = pMember.project || pMember.project_id;
            if (pId !== p.id) return false;
            const pMail = (pMember.email || "").toLowerCase().trim();
            const pMem = String(pMember.member || "").toLowerCase().trim();
            const pWall = (pMember.wallet_address || "").toLowerCase().trim();
            if (currentUserEmail && (pMail === currentUserEmail || pMem === currentUserEmail)) return true;
            if (currentUserId && currentUserId !== "user-default" && pMem === currentUserId.toLowerCase().trim()) return true;
            if (activeWallet && (pWall === activeWallet || pMem === activeWallet)) return true;
            return false;
          });

          const isProjCreator = Boolean(
            (currentUserId && currentUserId !== "user-default" && (p.created_by === currentUserId || p.owner === currentUserId || p.owner?.id === currentUserId)) ||
            (currentUserEmail && (
              (p.created_by && p.created_by.toLowerCase().trim() === currentUserEmail) ||
              (p.owner?.email && p.owner.email.toLowerCase().trim() === currentUserEmail) ||
              (currentUserEmail === "anh2482006@gmail.com" && (!p.created_by || p.created_by === "user-default"))
            )) ||
            (activeWallet && (
              (p.created_by && p.created_by.toLowerCase() === activeWallet) ||
              (p.owner === activeWallet)
            ))
          );

          if (p.network === 0 && !isWsAdmin && !isProjCreator && !pm) {
            return { data: { error: "You do not have access to this project" }, status: 403 };
          }

          let resolvedRole: number | null = null;
          if (isProjCreator || isWsAdmin) {
            resolvedRole = 20;
          } else if (pm && pm.role) {
            resolvedRole = Number(pm.role);
          } else {
            resolvedRole = null;
          }

          return ok(Object.assign({}, p, {
            workspace: canonicalWsId || p.workspace,
            workspace_detail: ws || p.workspace_detail,
            member_role: resolvedRole,
            cycle_view: p.cycle_view ?? true,
            module_view: p.module_view ?? true,
            issue_views_view: p.issue_views_view ?? true,
            page_view: p.page_view ?? true,
            inbox_view: p.inbox_view ?? true,
          }));
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
            const deletedProjIssues = localDB.issues.filter(
              (i: any) => i.project === targetId || i.project_id === targetId
            );
            if (!localDB._deleted_issue_ids) localDB._deleted_issue_ids = [];
            for (const dpi of deletedProjIssues) {
              if (!localDB._deleted_issue_ids.includes(dpi.id)) {
                localDB._deleted_issue_ids.push(dpi.id);
              }
            }
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
        // BA-21: dự án có thật trên hệ thống nhưng máy này chưa có (mở link chia sẻ khi chưa
        // được cấp quyền, hoặc dữ liệu chưa kịp đồng bộ) trước đây bị báo 404 "không tìm thấy"
        // ⇒ người dùng tưởng dự án bị xoá. Xác nhận dự án có trong dữ liệu của không gian làm
        // việc trên chain rồi trả 403 để UI mở màn "Chưa có quyền" (kèm nút xin tham gia).
        const wsSlugMatch = url.match(/\/api\/workspaces\/([^/]+)\//);
        const wsSlug = wsSlugMatch?.[1] ?? "";
        if (wsSlug && !deletedSet.has(projectId) && (await projectExistsInWorkspaceSnapshot(wsSlug, projectId))) {
          return {
            data: {
              error: "NOT_AUTHORIZED",
              detail: "Bạn chưa được cấp quyền truy cập dự án này.",
            },
            status: 403,
          };
        }
        return { data: { error: "Project not found" }, status: 404 };
      }
    }
  }

  // ── Project Members ──────────────────────────────────────────────────
  if (method === "get" && url.match(/\/api\/workspaces\/([^/]+)\/projects\/([^/]+)\/project-members\/me\/?/)) {
    const projMeMatch = url.match(/\/api\/workspaces\/([^/]+)\/projects\/([^/]+)\/project-members\/me\/?/);
    const wsSlug = projMeMatch?.[1] || "";
    const projectId = projMeMatch?.[2] || "";
    const targetProj = (localDB.projects || []).find(
      (p: any) => p.id === projectId || (p.identifier && p.identifier.toLowerCase() === projectId.toLowerCase())
    );
    if (!targetProj) {
      return { data: { error: "Project not found or not authorized" }, status: 404 };
    }
    const targetProjId = targetProj.id || projectId;
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
    const activeId = routeSessionUser?.id || routeSessionUserId || "user-default";
    const activeMail = (routeSessionUser?.email || loggedInEmail || "").toLowerCase().trim();
    const activeWallet = (
      sessionStorage.getItem("plane_active_wallet_address") ||
      localStorage.getItem("plane_active_wallet_address") ||
      currentUserAddress ||
      ""
    ).toLowerCase().trim();

    // Check project membership:
    const pmRecord = (localDB.project_members || []).find(
      (pm: any) =>
        (pm.project === targetProjId || pm.project_id === targetProjId) &&
        (
          (activeId && activeId !== "user-default" && (pm.member === activeId || pm.id === activeId || pm.member?.id === activeId)) ||
          (activeMail && ((pm.email || "").toLowerCase().trim() === activeMail || String(pm.member || "").toLowerCase().trim() === activeMail || (pm.member?.email || "").toLowerCase().trim() === activeMail)) ||
          (activeWallet && ((pm.wallet_address || "").toLowerCase().trim() === activeWallet || String(pm.member || "").toLowerCase().trim() === activeWallet || (pm.member?.wallet_address || "").toLowerCase().trim() === activeWallet))
        )
    );
    if (pmRecord) {
      return ok({
        id: pmRecord.id || `proj-member-${activeId}`,
        member: activeId,
        role: Number(pmRecord.role) || 15,
      });
    }

    const wsMember = (localDB.workspace_members || []).find(
      (wm: any) =>
        (wm.workspace === ws?.id || wm.workspace === ws?.slug || wm.workspace === wsSlug) &&
        (wm.member === activeId || (activeMail && (wm.email || "").toLowerCase().trim() === activeMail))
    );
    const isWsAdmin =
      Boolean(
        ws &&
        (
          (activeId && activeId !== "user-default" && (ws.created_by === activeId || ws.owner?.id === activeId)) ||
          (activeMail && (
            (ws.owner?.email && ws.owner.email.toLowerCase().trim() === activeMail) ||
            (ws.created_by && ws.created_by.toLowerCase().trim() === activeMail)
          )) ||
          (activeWallet && (
            (ws.created_by && ws.created_by.toLowerCase() === activeWallet) ||
            (ws.owner?.id && ws.owner.id.toLowerCase() === activeWallet)
          ))
        )
      ) ||
      (activeMail === "anh2482006@gmail.com") ||
      Boolean(wsMember && Number(wsMember.role) >= 20);

    const isProjCreator = Boolean(
      (activeId && activeId !== "user-default" && (targetProj.created_by === activeId || targetProj.owner === activeId || targetProj.owner?.id === activeId)) ||
      (activeMail && (
        (targetProj.created_by && targetProj.created_by.toLowerCase().trim() === activeMail) ||
        (targetProj.owner?.email && targetProj.owner.email.toLowerCase().trim() === activeMail) ||
        (activeMail === "anh2482006@gmail.com" && (!targetProj.created_by || targetProj.created_by === "user-default"))
      )) ||
      (activeWallet && (
        (targetProj.created_by && targetProj.created_by.toLowerCase() === activeWallet) ||
        (targetProj.owner === activeWallet)
      ))
    );

    if (isWsAdmin || isProjCreator) {
      return ok({
        id: `proj-member-${activeId}`,
        member: activeId,
        role: 20,
      });
    }

    // User is neither creator, wsAdmin, nor project member
    return { data: { error: "You are not a member of this project" }, status: 403 };
  }

  // ── Project Member Detail & Leave ──────────────────────────────────────
  const projMemberActionMatch = url.match(/\/api\/workspaces\/([^/]+)\/projects\/([^/]+)\/members\/([^/]+)\/?(?:\?.*)?$/);
  if (projMemberActionMatch) {
    const projectId = projMemberActionMatch[2];
    const targetMemberId = projMemberActionMatch[3];
    const targetProj = (localDB.projects || []).find(
      (p: any) => p.id === projectId || (p.identifier && p.identifier.toLowerCase() === projectId.toLowerCase())
    );
    const targetProjId = targetProj?.id || projectId;

    if (method === "post" && targetMemberId === "leave") {
      const activeId = routeSessionUser?.id || routeSessionUserId || "user-default";
      const activeMail = (routeSessionUser?.email || loggedInEmail || "").toLowerCase().trim();
      const activeWallet = (
        sessionStorage.getItem("plane_active_wallet_address") ||
        localStorage.getItem("plane_active_wallet_address") ||
        currentUserAddress ||
        ""
      ).toLowerCase().trim();

      if (localDB.project_members) {
        localDB.project_members = localDB.project_members.filter((pm: any) => {
          const isThisProj = pm.project === targetProjId || pm.project_id === targetProjId;
          if (!isThisProj) return true;
          const matchUser =
            (activeId && activeId !== "user-default" && (pm.member === activeId || pm.id === activeId || pm.member?.id === activeId)) ||
            (activeMail && ((pm.email || "").toLowerCase().trim() === activeMail || String(pm.member || "").toLowerCase().trim() === activeMail || (pm.member?.email || "").toLowerCase().trim() === activeMail)) ||
            (activeWallet && ((pm.wallet_address || "").toLowerCase().trim() === activeWallet || String(pm.member || "").toLowerCase().trim() === activeWallet || (pm.member?.wallet_address || "").toLowerCase().trim() === activeWallet));
          return !matchUser;
        });
        saveDB();
      }
      return ok({ message: "Left project successfully" });
    }

    if (method === "delete") {
      if (localDB.project_members) {
        localDB.project_members = localDB.project_members.filter((pm: any) => {
          const isThisProj = pm.project === targetProjId || pm.project_id === targetProjId;
          if (!isThisProj) return true;
          return !(pm.id === targetMemberId || pm.member === targetMemberId || pm.member?.id === targetMemberId);
        });
        saveDB();
      }
      return { data: null, status: 204 };
    }

    if (method === "patch") {
      if (!localDB.project_members) localDB.project_members = [];
      const pm = localDB.project_members.find((p: any) => {
        const isThisProj = p.project === targetProjId || p.project_id === targetProjId;
        if (!isThisProj) return false;
        return p.id === targetMemberId || p.member === targetMemberId || p.member?.id === targetMemberId;
      });
      if (pm) {
        if (body?.role !== undefined) pm.role = Number(body.role);
        saveDB();
        return ok(pm);
      }
      return { data: { error: "Member not found in project" }, status: 404 };
    }

    if (method === "get") {
      const pm = (localDB.project_members || []).find((p: any) => {
        const isThisProj = p.project === targetProjId || p.project_id === targetProjId;
        if (!isThisProj) return false;
        return p.id === targetMemberId || p.member === targetMemberId || p.member?.id === targetMemberId;
      });
      if (pm) return ok(pm);
      return { data: { error: "Member not found in project" }, status: 404 };
    }
  }

  const projMembersMatch = url.match(/\/api\/workspaces\/([^/]+)\/projects\/([^/]+)\/members\/?(?:\?.*)?$/);
  if (projMembersMatch) {
    const wsSlug = projMembersMatch[1];
    const projectId = projMembersMatch[2];
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
    const targetProj = (localDB.projects || []).find(
      (p: any) => p.id === projectId || (p.identifier && p.identifier.toLowerCase() === projectId.toLowerCase())
    );
    const targetProjId = targetProj?.id || projectId;

    if (method === "get") {
      const projMembersList: any[] = [];
      const addedMemberKeys = new Set<string>();

      // 1. Workspace owner or project creator
      const projCreatorId = targetProj?.created_by || ws?.created_by || ws?.owner?.id;
      const projCreatorEmail = (targetProj?.owner?.email || ws?.owner?.email || "").toLowerCase().trim();
      const projCreatorUser = (localDB.users || []).find(
        (u: any) => (projCreatorId && u.id === projCreatorId) || (projCreatorEmail && u.email?.toLowerCase() === projCreatorEmail)
      ) || ws?.owner || {
        id: projCreatorId || "owner-default",
        email: projCreatorEmail,
        first_name: ws?.owner?.first_name || "Owner",
        last_name: ws?.owner?.last_name || "",
        display_name: ws?.owner?.display_name || ws?.owner?.first_name || "Owner",
        avatar_url: "",
        is_active: true,
      };

      const creatorKey = projCreatorUser.id || projCreatorId || "owner-default";
      projMembersList.push({
        id: `proj-member-${creatorKey}`,
        member: creatorKey,
        member_detail: {
          id: creatorKey,
          email: projCreatorUser.email || projCreatorEmail,
          first_name: projCreatorUser.first_name || "Owner",
          last_name: projCreatorUser.last_name || "",
          display_name: projCreatorUser.display_name || projCreatorUser.first_name || "Owner",
          avatar_url: projCreatorUser.avatar_url || "",
          is_active: true,
        },
        role: 20,
        original_role: 20,
        project: targetProjId,
        workspace: ws?.id || wsSlug,
      });
      addedMemberKeys.add(creatorKey);
      if (projCreatorEmail) addedMemberKeys.add(projCreatorEmail);

      // 2. Members explicitly in localDB.project_members
      if (localDB.project_members) {
        const pms = localDB.project_members.filter(
          (pm: any) => pm.project === targetProjId || pm.project_id === targetProjId
        );
        pms.forEach((pm: any) => {
          const memberKey = String(typeof pm.member === "object" && pm.member?.id ? pm.member.id : (pm.member || pm.id));
          const memberMail = (pm.email || pm.member?.email || (memberKey.includes("@") ? memberKey : "")).toLowerCase().trim();
          if (!addedMemberKeys.has(memberKey) && (!memberMail || !addedMemberKeys.has(memberMail))) {
            const user = (localDB.users || []).find(
              (u: any) => u.id === memberKey || (memberMail && u.email?.toLowerCase() === memberMail)
            );
            const wsMem = (localDB.workspace_members || []).find(
              (wm: any) => wm.member === memberKey || (memberMail && wm.email?.toLowerCase() === memberMail)
            );
            const isEth = memberKey.startsWith("0x");
            const shortAddr = isEth ? `${memberKey.slice(0, 6)}...${memberKey.slice(-4)}` : "Member";
            const userDetail = user || (typeof pm.member === "object" && pm.member?.id ? pm.member : {
              id: memberKey,
              email: pm.email || wsMem?.email || (isEth ? `${memberKey}@fiai.network` : memberKey),
              first_name: pm.first_name || wsMem?.first_name || shortAddr,
              last_name: pm.last_name || wsMem?.last_name || "",
              display_name: pm.display_name || wsMem?.display_name || shortAddr,
              avatar_url: pm.avatar_url || wsMem?.avatar_url || "",
              is_active: true,
            });
            projMembersList.push({
              id: pm.id || `proj-member-${memberKey}`,
              member: memberKey,
              member_detail: userDetail,
              role: Number(pm.role) || 15,
              // `original_role` is what the UI uses to render the role select and to
              // decide whether a person still has to be invited. Without it the
              // "add member" modal re-offered existing members (RC-12).
              original_role: Number(pm.role) || 15,
              project: targetProjId,
              workspace: ws?.id || wsSlug,
            });
            addedMemberKeys.add(memberKey);
            if (memberMail) addedMemberKeys.add(memberMail);
          }
        });
      }

      // Note: Workspace members who are not added to this project are NOT dumped into projMembersList
      return ok(projMembersList);
    }

    if (method === "post") {
      if (!localDB.project_members) localDB.project_members = [];
      const membersToAdd = Array.isArray(body?.members) ? body.members : [body];

      // D-B (server enforcement): a project member must already be an active
      // member of this workspace. Adding a stranger to a project would otherwise
      // let them be assigned work items without ever joining the workspace.
      const wsScopeKeys = new Set(
        [wsSlug, ws?.id, ws?.slug].filter(Boolean).map((x: any) => String(x).toLowerCase().trim())
      );
      const wsMemberKeys = new Set<string>();
      (localDB.workspace_members || []).forEach((wm: any) => {
        const wmWs = String(wm.workspace || wm.workspace_id || "").toLowerCase().trim();
        if (wmWs && !wsScopeKeys.has(wmWs)) return;
        if (wm.is_active === false) return;
        [wm.member, wm.email, wm.wallet_address, wm.member_detail?.id]
          .filter(Boolean)
          .forEach((k: any) => wsMemberKeys.add(String(k).toLowerCase().trim()));
      });
      const creatorKeyForValidation = String(
        targetProj?.created_by || ws?.created_by || ws?.owner?.id || ""
      ).toLowerCase().trim();
      const creatorMailForValidation = (targetProj?.owner?.email || ws?.owner?.email || "").toLowerCase().trim();
      const enforceWorkspaceMembership = wsMemberKeys.size > 0 || Boolean(creatorKeyForValidation);

      const rejected: { member_id: string; error: string }[] = [];
      const createdList: any[] = [];

      // Pass 1 - validate the whole batch before mutating anything (all-or-nothing).
      if (enforceWorkspaceMembership) {
        membersToAdd.forEach((m: any) => {
          const memberId = m.member_id || (typeof m.member === "object" ? m.member?.id : m.member) || m.id;
          if (!memberId) return;
          const cleanMemberKey = String(memberId).toLowerCase().trim();
          const isCreator =
            (creatorKeyForValidation && cleanMemberKey === creatorKeyForValidation) ||
            (creatorMailForValidation && cleanMemberKey === creatorMailForValidation);
          const linkedEmail = String(
            (localDB.users || []).find((u: any) => String(u.id || "").toLowerCase().trim() === cleanMemberKey)?.email || ""
          )
            .toLowerCase()
            .trim();
          const isWsMember =
            wsMemberKeys.has(cleanMemberKey) || Boolean(linkedEmail && wsMemberKeys.has(linkedEmail));
          if (!isWsMember && !isCreator) {
            rejected.push({
              member_id: String(memberId),
              error: "Người dùng chưa phải là thành viên của không gian làm việc. Vui lòng thêm vào workspace trước.",
            });
          }
        });
      }

      if (rejected.length > 0) {
        return {
          data: {
            error:
              "Không thể thêm thành viên vào dự án: có người chưa thuộc không gian làm việc này. Vui lòng thêm họ vào workspace trước.",
            code: "PROJECT_MEMBER_NOT_IN_WORKSPACE",
            added_count: 0,
            rejected,
          },
          status: 400,
        };
      }

      // Pass 2 - apply.
      membersToAdd.forEach((m: any) => {
        const memberId = m.member_id || (typeof m.member === "object" ? m.member?.id : m.member) || m.id;
        if (!memberId) return;
        const cleanMemberKey = String(memberId).toLowerCase().trim();
        const requestedRole = Number(m.role) || 15;
        const memberMailKey = String(m.email || "").toLowerCase().trim();

        let existing = localDB.project_members.find(
          (pm: any) =>
            (pm.project === targetProjId || pm.project_id === targetProjId) &&
            (pm.member === memberId || pm.id === memberId || pm.member?.id === memberId)
        );

        if (existing) {
          existing.role = requestedRole;
          existing.original_role = requestedRole;
          createdList.push(existing);
        } else {
          const user =
            (localDB.users || []).find((u: any) => u.id === memberId || (memberMailKey && u.email === memberMailKey)) ||
            (localDB.users || []).find(
              (u: any) =>
                cleanMemberKey &&
                (String(u.id || "").toLowerCase().trim() === cleanMemberKey ||
                  String(u.email || "").toLowerCase().trim() === cleanMemberKey)
            );
          const wsMem = (localDB.workspace_members || []).find(
            (wm: any) =>
              wm.member === memberId ||
              (cleanMemberKey && String(wm.email || "").toLowerCase().trim() === cleanMemberKey) ||
              (user?.email && String(wm.email || "").toLowerCase().trim() === String(user.email).toLowerCase().trim())
          );
          const userDetail = user || (typeof wsMem?.member === "object" ? wsMem.member : wsMem) || {
            id: memberId,
            email: memberId,
            first_name: "Member",
            last_name: "",
            display_name: "Member",
            avatar_url: "",
            is_active: true,
          };
          const pmRecord = {
            id: `pm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            project: targetProjId,
            project_id: targetProjId,
            member: memberId,
            member_detail: userDetail,
            role: requestedRole,
            original_role: requestedRole,
            created_at: new Date().toISOString(),
          };
          localDB.project_members.push(pmRecord);
          createdList.push(pmRecord);
        }
      });

      saveDB();
      return ok(createdList);
    }
  }

  // ── Project Archive / Restore ────────────────────────────────────────
  const archivedIssueListMatch = url.match(/\/api\/workspaces\/[^/]+\/projects\/([^/]+)\/archive\/?$/);
  if (archivedIssueListMatch) {
    const projectId = archivedIssueListMatch[1];
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

  // ── Notifications ───────────────────────────────────────────────────
  if (url.includes("/notifications")) {
    const notifWsMatch = url.match(/\/api\/workspaces\/([^/]+)\//);
    const notifWsSlug = notifWsMatch ? notifWsMatch[1] : null;
    const notifWs = notifWsSlug
      ? (localDB.workspaces || []).find((w: any) => w.slug === notifWsSlug || w.id === notifWsSlug)
      : (localDB.workspaces?.[0] || null);
    const canonicalNotifWsId = notifWs?.id || notifWsSlug || "workspace-fiai";
    const validNotifWsKeys = new Set([notifWsSlug, notifWs?.id, notifWs?.slug, canonicalNotifWsId].filter(Boolean));

    const userEmail = (routeSessionUser?.email || loggedInEmail || "").toLowerCase().trim();
    const userId = routeSessionUser?.id || routeSessionUserId;
    const userWallet = (getStoredWalletAddress() || (routeSessionUser as any)?.wallet_address || "").toLowerCase().trim();

    if (!localDB.notifications) localDB.notifications = [];

    // Deduplicate any existing duplicate notifications in localDB.notifications
    if (Array.isArray(localDB.notifications) && localDB.notifications.length > 1) {
      const seenNotifs = new Set<string>();
      const deduped: any[] = [];
      for (const n of localDB.notifications) {
        if (!n || !n.id) continue;
        let dedupKey = String(n.id);
        if (n?.data?.issue_activity?.field === "daily_report") {
          const issueId = n.data?.issue?.id || n.entity_identifier || "";
          const val = n.data?.issue_activity?.new_value || n.message || "";
          const txHash = n.data?.transaction_hash || "";
          const txId = n.data?.transaction_id || "";
          const time = n.created_at ? new Date(n.created_at).getTime() : 0;
          const timeBucket = Math.floor(time / 120000); // 2-minute bucket
          dedupKey = txHash ? `tx:${txHash}` : txId ? `id:${txId}` : `rep:${issueId}:${val}:${timeBucket}`;
        }
        if (seenNotifs.has(dedupKey)) {
          continue;
        }
        seenNotifs.add(dedupKey);
        deduped.push(n);
      }
      if (deduped.length !== localDB.notifications.length) {
        localDB.notifications = deduped;
        saveDB();
      }
    }

    // Comprehensive index of all existing notification keys
    const existingNotifKeys = new Set<string>();
    for (const n of localDB.notifications || []) {
      if (n.id) {
        existingNotifKeys.add(String(n.id));
        if (String(n.id).startsWith("notif-rep-")) existingNotifKeys.add(String(n.id).slice("notif-rep-".length));
        if (String(n.id).startsWith("notif-inv-")) existingNotifKeys.add(String(n.id).slice("notif-inv-".length));
        if (String(n.id).startsWith("notif-report-")) existingNotifKeys.add(String(n.id).slice("notif-report-".length));
      }
      if (n.data?.invitation_id) existingNotifKeys.add(String(n.data.invitation_id));
      if (n.data?.transaction_id) existingNotifKeys.add(String(n.data.transaction_id));
      if (n.data?.transaction_hash) existingNotifKeys.add(String(n.data.transaction_hash));
      if (n.data?.client_event_id) existingNotifKeys.add(String(n.data.client_event_id));
      if (n.data?.issue_activity?.id) {
        const actId = String(n.data.issue_activity.id);
        existingNotifKeys.add(actId);
        if (actId.startsWith("act-")) existingNotifKeys.add(actId.slice(4));
      }
    }

    // Auto-sync stored pending invitations into notifications if missing
    const allStoredInvs = [...(localDB.invitations || []), ...getStoredInvitations()];
    for (const inv of allStoredInvs) {
      if (inv && inv.id && !existingNotifKeys.has(inv.id) && !existingNotifKeys.has(`notif-inv-${inv.id}`)) {
        const invWsSlug = inv.workspace?.slug || inv.workspace_slug || notifWsSlug || "fiai";
        const invWs = (localDB.workspaces || []).find((w: any) => w.slug === invWsSlug || w.id === invWsSlug) || notifWs;
        const invWsId = invWs?.id || invWsSlug;
        const invRole = inv.role || 15;
        localDB.notifications.push({
          id: `notif-inv-${inv.id}`,
          workspace: invWsId,
          workspace_id: invWsId,
          workspace_slug: invWsSlug,
          title: "Workspace Invitation",
          message: `You have been invited to join workspace "${invWs?.name || invWsSlug}"`,
          entity_name: "workspace_invitation",
          entity_identifier: inv.id,
          sender: inv.created_by || "admin",
          receiver: (inv.email || "").toLowerCase().trim(),
          recipient_email: (inv.email || "").toLowerCase().trim(),
          recipient: (inv.email || "").toLowerCase().trim(),
          triggered_by: inv.created_by || "admin",
          triggered_by_details: {
            id: inv.created_by || "admin",
            first_name: "Workspace",
            last_name: "Admin",
            display_name: "Workspace Admin",
            avatar_url: "",
            is_bot: false,
          },
          data: {
            workspace_name: invWs?.name || invWsSlug,
            workspace_slug: invWsSlug,
            role: invRole,
            invitation_id: inv.id,
            invite_link: inv.invite_link || `/workspace-invitations?invitation_id=${inv.id}&slug=${invWsSlug}&token=${inv.token || inv.id}`,
          },
          read_at: null,
          archived_at: null,
          snoozed_till: null,
          is_inbox_issue: false,
          is_mentioned_notification: false,
          created_at: inv.created_at || new Date().toISOString(),
          updated_at: inv.updated_at || new Date().toISOString(),
        });
        existingNotifKeys.add(inv.id);
        existingNotifKeys.add(`notif-inv-${inv.id}`);
      }
    }

    // Auto-sync stored daily reports into notifications if missing
    const existingReportTxs = (localDB["blockchain-transactions"] || []).filter(
      (tx: any) => tx.event_type === "daily_report"
    );
    for (const rep of existingReportTxs) {
      const repKey = rep.transaction_hash || rep.id || rep.client_event_id;
      if (
        repKey &&
        !existingNotifKeys.has(repKey) &&
        !existingNotifKeys.has(`notif-rep-${repKey}`) &&
        !(rep.transaction_hash && existingNotifKeys.has(rep.transaction_hash)) &&
        !(rep.id && existingNotifKeys.has(rep.id)) &&
        !(rep.client_event_id && existingNotifKeys.has(rep.client_event_id))
      ) {
        const repIssue = (localDB.issues || []).find((i: any) => i.id === rep.issue_id);
        const repProj = (localDB.projects || []).find((p: any) => p.id === rep.project || p.id === repIssue?.project);
        const repWs = notifWs;
        const repWsId = repWs?.id || canonicalNotifWsId;
        const repUser = (localDB.users || []).find((u: any) => u.id === rep.reporter_id) || routeSessionUser;
        localDB.notifications.push({
          id: `notif-rep-${repKey}`,
          workspace: repWsId,
          workspace_id: repWsId,
          workspace_slug: repWs?.slug || notifWsSlug || "fiai",
          project: repProj?.id || repIssue?.project || "default-proj",
          project_id: repProj?.id || repIssue?.project || "default-proj",
          entity_identifier: rep.issue_id || repKey,
          entity_name: "issue",
          title: `Báo cáo tiến độ: ${rep.issue_name || repIssue?.name || "Công việc"}`,
          message: rep.work || `Đã cập nhật tiến độ ${rep.progress || 0}%`,
          sender: rep.reporter_id || "user-1",
          receiver: "all",
          recipient_email: "all",
          recipient: "all",
          triggered_by: rep.reporter_id || "user-1",
          triggered_by_details: {
            id: rep.reporter_id || "user-1",
            first_name: repUser?.first_name || rep.reporter_name || "Thành viên",
            last_name: repUser?.last_name || "",
            display_name: repUser?.display_name || rep.reporter_name || repUser?.first_name || "Thành viên",
            avatar_url: repUser?.avatar_url || "",
            is_bot: false,
          },
          data: {
            transaction_id: repKey,
            transaction_hash: rep.transaction_hash || "",
            client_event_id: rep.client_event_id || "",
            issue: {
              id: rep.issue_id || repIssue?.id,
              sequence_id: repIssue?.sequence_id || 1,
              identifier: repProj?.identifier || "TASK",
              name: rep.issue_name || repIssue?.name || "Công việc",
              state_name: repIssue?.state_detail?.name || "In Progress",
              state_group: repIssue?.state_detail?.group || "started",
            },
            issue_activity: {
              id: `act-${repKey}`,
              actor: rep.reporter_id || "user-1",
              field: "daily_report",
              issue_comment: rep.evidence || "",
              verb: "created",
              new_value: `${rep.progress ?? 0}% - ${rep.work || "Báo cáo tiến độ"}`,
              old_value: rep.difficulty ? `Độ khó: ${rep.difficulty}` : "",
            },
          },
          read_at: null,
          archived_at: null,
          snoozed_till: null,
          is_inbox_issue: false,
          is_mentioned_notification: false,
          created_at: rep.recorded_at || rep.created_at || new Date().toISOString(),
          updated_at: rep.recorded_at || rep.created_at || new Date().toISOString(),
        });
        existingNotifKeys.add(repKey);
        existingNotifKeys.add(`notif-rep-${repKey}`);
        if (rep.id) existingNotifKeys.add(rep.id);
        if (rep.transaction_hash) existingNotifKeys.add(rep.transaction_hash);
        if (rep.client_event_id) existingNotifKeys.add(rep.client_event_id);
      }
    }

    const filterNotifForUser = (n: any) => {
      // Workspace check
      if (validNotifWsKeys.size > 0) {
        const nWs = n.workspace || n.workspace_id || n.workspace_slug;
        if (nWs && !validNotifWsKeys.has(nWs)) return false;
      }

      const recipient = (n.recipient_email || n.recipient || n.receiver || "").toLowerCase().trim();
      if (!recipient || recipient === "all" || recipient === "members") return true;

      if (userEmail && (recipient === userEmail || recipient.includes(userEmail) || userEmail.includes(recipient))) return true;
      if (userId && recipient === String(userId).toLowerCase()) return true;
      if (userWallet && (recipient.includes(userWallet) || userWallet.includes(recipient))) return true;

      return false;
    };

    if (url.includes("/notifications/unread")) {
      const userNotifs = (localDB.notifications || []).filter((n: any) => filterNotifForUser(n) && !n.read_at && !n.archived_at);
      return ok({
        total_unread_notifications_count: userNotifs.length,
        mention_unread_notifications_count: 0,
      });
    }

    if (url.includes("/notifications/mark-all-read") && method === "post") {
      (localDB.notifications || []).forEach((n: any) => {
        if (filterNotifForUser(n)) {
          n.read_at = new Date().toISOString();
        }
      });
      saveDB();
      return ok({ message: "Marked all as read" });
    }

    const readMatch = url.match(/\/notifications\/([^/]+)\/read\/?$/);
    if (readMatch) {
      const nId = readMatch[1];
      const targetNotif = (localDB.notifications || []).find((n: any) => n.id === nId);
      if (targetNotif) {
        if (method === "delete") {
          targetNotif.read_at = null;
        } else {
          targetNotif.read_at = new Date().toISOString();
        }
        saveDB();
        return ok(targetNotif);
      }
      return ok({});
    }

    const archiveMatch = url.match(/\/notifications\/([^/]+)\/archive\/?$/);
    if (archiveMatch) {
      const aId = archiveMatch[1];
      const targetNotif = (localDB.notifications || []).find((n: any) => n.id === aId);
      if (targetNotif) {
        if (method === "delete") {
          targetNotif.archived_at = null;
        } else {
          targetNotif.archived_at = new Date().toISOString();
        }
        saveDB();
        return ok(targetNotif);
      }
      return ok({});
    }

    if (method === "get") {
      const seenResultKeys = new Set<string>();
      const userNotifs = (localDB.notifications || [])
        .filter(filterNotifForUser)
        .filter((n: any) => {
          if (!n || !n.id) return false;
          let rKey = String(n.id);
          if (n?.data?.issue_activity?.field === "daily_report") {
            const txH = n.data?.transaction_hash;
            const txI = n.data?.transaction_id;
            const iId = n.data?.issue?.id || n.entity_identifier || "";
            const val = n.data?.issue_activity?.new_value || n.message || "";
            const t = n.created_at ? new Date(n.created_at).getTime() : 0;
            const tb = Math.floor(t / 120000);
            rKey = txH ? `tx:${txH}` : txI ? `id:${txI}` : `rep:${iId}:${val}:${tb}`;
          }
          if (seenResultKeys.has(rKey)) return false;
          seenResultKeys.add(rKey);
          return true;
        })
        // oxlint-disable-next-line oxc/no-map-spread -- Copy-on-write response enrichment must not mutate shared persisted records.
        .map((n: any) => ({
          ...n,
          workspace: canonicalNotifWsId,
          workspace_id: canonicalNotifWsId,
          is_mentioned_notification: Boolean(n.is_mentioned_notification),
        }));

      return ok({
        results: userNotifs,
        count: userNotifs.length,
        total_count: userNotifs.length,
        total_pages: 1,
        next_page_results: false,
        prev_page_results: false,
        next_cursor: undefined,
        prev_cursor: undefined,
      });
    }

    if (method === "patch" || method === "post") {
      const notifIdMatch = url.match(/\/notifications\/([^/]+)/);
      const notifId = notifIdMatch ? notifIdMatch[1] : null;
      if (notifId && localDB.notifications) {
        const notif = localDB.notifications.find((n: any) => n.id === notifId);
        if (notif) {
          Object.assign(notif, body, { updated_at: new Date().toISOString() });
          saveDB();
          return ok(notif);
        }
      }
      return ok({});
    }

    return ok({});
  }

  const issueMetaRoute = url.match(/^\/api\/workspaces\/([^/]+)\/projects\/([^/]+)\/(?:issues|work-items|epics)\/([^/]+)\/meta\/?(?:\?.*)?$/);
  if (issueMetaRoute && method === "get") {
    try {
      const access = await requireIssueAccess(
        decodeURIComponent(issueMetaRoute[1]), decodeURIComponent(issueMetaRoute[2]), decodeURIComponent(issueMetaRoute[3])
      );
      if (!access.project.identifier || !Number.isInteger(access.issue.sequence_id) || access.issue.sequence_id <= 0)
        return { status: 409, data: { code: "ISSUE_METADATA_UNAVAILABLE", error: "Công việc chưa có mã định danh hợp lệ. Hãy đồng bộ rồi thử lại." } };
      return ok({ project_identifier: access.project.identifier, sequence_id: access.issue.sequence_id });
    } catch (error) {
      if (!(error instanceof ResourceAccessError)) throw error;
      return { status: error.status, data: { code: error.code, error: error.message } };
    }
  }

  if (/\/api\/assets\/v2(?:\/|$)/.test(url)) {
    return handleFileAssetRoute(method, url, body);
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
        actor: c.actor || routeSessionUser?.id || "me",
        actor_detail: c.actor_detail || {
          id: c.actor || routeSessionUser?.id || "me",
          first_name: routeSessionUser?.first_name || "Plane",
          last_name: routeSessionUser?.last_name || "Admin",
          is_bot: false,
          display_name: routeSessionUser?.display_name || routeSessionUser?.first_name || "Plane Admin",
          avatar: routeSessionUser?.avatar_url || "",
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
    const createdAfterMatch = url.match(/[?&]created_at__gt=([^&]+)/);
    const createdAfter = createdAfterMatch ? decodeURIComponent(createdAfterMatch[1]) : null;
    const activities = (Array.isArray(localDB.issue_activities) ? localDB.issue_activities : [])
      .filter((activity: any) => activity.issue === issueId || activity.issue_id === issueId)
      .filter((activity: any) => !createdAfter || new Date(activity.created_at) > new Date(createdAfter))

      .toSorted((first: any, second: any) => new Date(first.created_at).getTime() - new Date(second.created_at).getTime());
    return ok(activities);
  }

  // comments
  const commentMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/comments(?:\/([^/?#]+))?\/?(?:\?.*)?$/);
  if (commentMatch) {
    const issueId = commentMatch[2];
    const targetIssueCommentId = commentMatch[3];

    if (targetIssueCommentId) {
      if (method === "patch" || method === "put") {
        if (!localDB.comments) localDB.comments = [];
        const cIdx = localDB.comments.findIndex((c: any) => c.id === targetIssueCommentId);
        if (cIdx > -1) {
          localDB.comments[cIdx] = {
            ...localDB.comments[cIdx],
            ...body,
            updated_at: new Date().toISOString(),
            edited_at: new Date().toISOString(),
          };
          saveDB();
          return ok(localDB.comments[cIdx]);
        }
        return { data: null, status: 404 };
      }
      if (method === "delete") {
        if (localDB.comments) {
          localDB._deleted_comment_ids = [...new Set([...(localDB._deleted_comment_ids || []), targetIssueCommentId])];
          localDB.comments = localDB.comments.filter((c: any) => c.id !== targetIssueCommentId);
          saveDB();
        }
        return ok({});
      }
      if (method === "get") {
        const found = (localDB.comments || []).find((c: any) => c.id === targetIssueCommentId);
        return found ? ok(found) : { data: null, status: 404 };
      }
    }

    if (method === "get") {
      const comments = (localDB.comments || []).filter((c: any) => c.issue === issueId || c.issue_id === issueId);
      const issue = localDB.issues?.find((i: any) => i.id === issueId);
      // oxlint-disable-next-line oxc/no-map-spread -- Copy-on-write response enrichment must not mutate shared persisted records.
      const enrichedComments = comments.map((c: any) => ({
        ...c,
        issue_id: issueId,
        project_id: c.project_id || c.project || issue?.project,
        workspace_id: c.workspace_id || c.workspace || issue?.workspace,
        actor: c.actor || routeSessionUser?.id || "me",
        actor_detail: c.actor_detail || {
          id: c.actor || routeSessionUser?.id || "me",
          first_name: routeSessionUser?.first_name || "Plane",
          last_name: routeSessionUser?.last_name || "Admin",
          is_bot: false,
          display_name: routeSessionUser?.display_name || routeSessionUser?.first_name || "Plane Admin",
          avatar: routeSessionUser?.avatar_url || "",
        },
        access: c.access || "INTERNAL",
      }));
      return ok(enrichedComments);
    }
    if (method === "post") {
      const issue = localDB.issues?.find((i: any) => i.id === issueId);
      const urlWsMatch = url.match(/\/api\/workspaces\/([^/]+)\//);
      const urlProjMatch = url.match(/\/projects\/([^/]+)\//);
      const wsSlug = urlWsMatch ? urlWsMatch[1] : issue?.workspace || localDB.workspaces?.[0]?.slug || "";
      const projId = urlProjMatch ? urlProjMatch[1] : issue?.project || "mock-project";
      const authorId = routeSessionUser?.id || "me";

      const newComment = {
        id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
        issue: issueId,
        issue_id: issueId,
        project_id: projId,
        workspace_id: wsSlug,
        project: projId,
        workspace: wsSlug,
        actor: authorId,
        actor_detail: {
          id: authorId,
          first_name: routeSessionUser?.first_name || "Plane",
          last_name: routeSessionUser?.last_name || "Admin",
          is_bot: false,
          display_name: routeSessionUser?.display_name || routeSessionUser?.first_name || "Plane Admin",
          avatar: routeSessionUser?.avatar_url || "",
        },
        access: body.access || "INTERNAL",
        reaction_groups: {},
        created_by: authorId,
        updated_by: authorId,
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
          localDB._deleted_comment_ids = [...new Set([...(localDB._deleted_comment_ids || []), commentId])];
          localDB.comments = localDB.comments.filter((c: any) => c.id !== commentId);
          saveDB();
        }
      }
      return ok({});
    }
  }

  // reactions (issues & comments)
  const reactionMatch = url.match(/\/(issues|work-items|epics|comments)\/([^/]+)\/reactions(?:\/([^/]+))?\/?(?:\?.*)?$/);
  if (reactionMatch) {
    const parentType = reactionMatch[1];
    const parentId = reactionMatch[2];
    const reactionParam = reactionMatch[3] ? decodeURIComponent(reactionMatch[3]) : null;

    if (!localDB.issue_reactions) localDB.issue_reactions = [];

    const activeUserId = getLoggedInUserId() || "user-default";
    const activeUser = (localDB.users || []).find((u: any) => u.id === activeUserId) || localDB.users?.[0] || {
      id: activeUserId,
      first_name: "User",
      last_name: "",
      display_name: "User",
      avatar: "",
    };

    if (method === "get") {
      const reactions = localDB.issue_reactions.filter((r: any) => {
        if (parentType === "comments") {
          return r.comment_id === parentId || r.comment === parentId;
        }
        return r.issue_id === parentId || r.issue === parentId;
      });
      return ok(reactions);
    }

    if (method === "post") {
      const emoji = body?.reaction || "thumbsup";
      const existing = localDB.issue_reactions.find((r: any) => {
        const matchesParent = parentType === "comments"
          ? (r.comment_id === parentId || r.comment === parentId)
          : (r.issue_id === parentId || r.issue === parentId);
        return matchesParent && r.reaction === emoji && (r.actor === activeUserId || r.actor === activeUser.id);
      });
      if (existing) {
        return ok(existing);
      }
      const newReaction = {
        id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
        reaction: emoji,
        actor: activeUser.id || activeUserId,
        actor_detail: {
          id: activeUser.id || activeUserId,
          first_name: activeUser.first_name || "User",
          last_name: activeUser.last_name || "",
          display_name: activeUser.display_name || activeUser.first_name || "User",
          avatar: activeUser.avatar || activeUser.avatar_url || "",
          is_bot: false,
        },
        issue: parentType !== "comments" ? parentId : undefined,
        issue_id: parentType !== "comments" ? parentId : undefined,
        comment: parentType === "comments" ? parentId : undefined,
        comment_id: parentType === "comments" ? parentId : undefined,
        created_at: new Date().toISOString(),
      };
      localDB.issue_reactions.push(newReaction);
      saveDB();
      return ok(newReaction);
    }

    if (method === "delete") {
      if (reactionParam) {
        localDB.issue_reactions = localDB.issue_reactions.filter((r: any) => {
          const matchesParent = parentType === "comments"
            ? (r.comment_id === parentId || r.comment === parentId)
            : (r.issue_id === parentId || r.issue === parentId);
          const matchesReaction = r.reaction === reactionParam || r.id === reactionParam;
          const matchesActor = r.actor === activeUserId || r.actor === activeUser.id;
          return !(matchesParent && matchesReaction && matchesActor);
        });
        saveDB();
      }
      return ok({ message: "Reaction deleted successfully" });
    }
  }

  // sub-issues
  const subIssuesMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/sub-issues\/?(?:\?.*)?$/);
  if (subIssuesMatch) {
    const parentId = subIssuesMatch[2];
    const calcDistribution = (items: any[]) => {
      const states = localDB.states || [];
      const dist: Record<string, string[]> = {
        backlog: [],
        unstarted: [],
        started: [],
        completed: [],
        cancelled: [],
      };
      items.forEach((item: any) => {
        const sId = item.state_id || item.state;
        const stateObj = states.find((s: any) => s.id === sId);
        const group = (stateObj?.group || "unstarted").toLowerCase();
        if (dist[group]) {
          dist[group].push(item.id);
        } else {
          dist.unstarted.push(item.id);
        }
      });
      return dist;
    };

    if (method === "get") {
      const subIssues = (localDB.issues || []).filter((i: any) => i.parent_id === parentId || i.parent === parentId);

      // oxlint-disable-next-line oxc/no-map-spread -- Copy-on-write response enrichment must not mutate shared persisted records.
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
      return ok({ sub_issues: enrichedSubIssues, state_distribution: calcDistribution(enrichedSubIssues) });
    }
    if (method === "post") {
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

        const allParentSubIssues = localDB.issues.filter((i: any) => i.parent_id === parentId || i.parent === parentId);
        const parentIdx = localDB.issues.findIndex((i: any) => i.id === parentId);
        if (parentIdx > -1) {
          localDB.issues[parentIdx].sub_issues_count = allParentSubIssues.length;
        }
        saveDB();

        return ok({ sub_issues: updatedSubIssues, state_distribution: calcDistribution(allParentSubIssues) });
      }

      return ok({ sub_issues: updatedSubIssues, state_distribution: calcDistribution([]) });
    }
  }

  // issue-relation
  const issueRelationMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/issue-relation\/?(?:\?.*)?$/);
  if (issueRelationMatch) {
    const issueId = issueRelationMatch[2];
    if (!localDB.issue_relations) localDB.issue_relations = [];

    if (method === "get") {
      const relations = localDB.issue_relations.filter((r: any) => r.issue_id === issueId);
      const res: Record<string, any[]> = {
        relates_to: [],
        duplicate: [],
        blocked_by: [],
        blocking: [],
      };
      for (const rel of relations) {
        const relatedIssue = (localDB.issues || []).find((i: any) => i.id === rel.related_issue_id);
        if (relatedIssue && res[rel.relation_type]) {
          const stateDetail =
            relatedIssue.state_detail ||
            (localDB.states || []).find((s: any) => s.id === (relatedIssue.state_id || relatedIssue.state));
          const projectDetail =
            relatedIssue.project_detail ||
            (localDB.projects || []).find((p: any) => p.id === (relatedIssue.project_id || relatedIssue.project));
          res[rel.relation_type].push({
            ...relatedIssue,
            state_detail: stateDetail,
            project_detail: projectDetail,
          });
        }
      }
      return ok(res);
    }

    if (method === "post") {
      const relationType = body?.relation_type || "relates_to";
      const targetIssueIds: string[] = Array.isArray(body?.issues) ? body.issues : [];
      const reverseMap: Record<string, string> = {
        blocked_by: "blocking",
        blocking: "blocked_by",
        duplicate: "duplicate",
        relates_to: "relates_to",
      };
      const reverseRelationType = reverseMap[relationType] || relationType;

      const addedIssues: any[] = [];

      for (const targetId of targetIssueIds) {
        if (!targetId || targetId === issueId) continue;

        // Add forward relation
        const existsForward = localDB.issue_relations.some(
          (r: any) => r.issue_id === issueId && r.related_issue_id === targetId && r.relation_type === relationType
        );
        if (!existsForward) {
          localDB.issue_relations.push({
            id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
            issue_id: issueId,
            related_issue_id: targetId,
            relation_type: relationType,
            created_at: new Date().toISOString(),
          });
        }

        // Add reverse relation
        const existsReverse = localDB.issue_relations.some(
          (r: any) => r.issue_id === targetId && r.related_issue_id === issueId && r.relation_type === reverseRelationType
        );
        if (!existsReverse) {
          localDB.issue_relations.push({
            id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
            issue_id: targetId,
            related_issue_id: issueId,
            relation_type: reverseRelationType,
            created_at: new Date().toISOString(),
          });
        }

        const targetIssue = (localDB.issues || []).find((i: any) => i.id === targetId);
        if (targetIssue) {
          const stateDetail =
            targetIssue.state_detail ||
            (localDB.states || []).find((s: any) => s.id === (targetIssue.state_id || targetIssue.state));
          const projectDetail =
            targetIssue.project_detail ||
            (localDB.projects || []).find((p: any) => p.id === (targetIssue.project_id || targetIssue.project));
          addedIssues.push({
            ...targetIssue,
            state_detail: stateDetail,
            project_detail: projectDetail,
          });
        }
      }

      saveDB();
      return ok(addedIssues);
    }
  }

  // remove-relation
  const removeRelationMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/remove-relation\/?(?:\?.*)?$/);
  if (removeRelationMatch && method === "post") {
    const issueId = removeRelationMatch[2];
    const relationType = body?.relation_type;
    const relatedIssueId = body?.related_issue;
    const reverseMap: Record<string, string> = {
      blocked_by: "blocking",
      blocking: "blocked_by",
      duplicate: "duplicate",
      relates_to: "relates_to",
    };
    const reverseRelationType = reverseMap[relationType] || relationType;

    if (localDB.issue_relations) {
      localDB.issue_relations = localDB.issue_relations.filter(
        (r: any) =>
          !(r.issue_id === issueId && r.related_issue_id === relatedIssueId && r.relation_type === relationType) &&
          !(r.issue_id === relatedIssueId && r.related_issue_id === issueId && r.relation_type === reverseRelationType)
      );
      saveDB();
    }
    return ok({ message: "Relation removed successfully" });
  }

  // links & issue-links
  const linksMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/(links|issue-links)(?:\/([^/]+))?\/?(?:\?.*)?$/);
  if (linksMatch) {
    const issueId = linksMatch[2];
    const linkId = linksMatch[4];
    if (!localDB.issue_links) localDB.issue_links = [];

    if (method === "get") {
      const links = localDB.issue_links.filter((l: any) => l.issue === issueId || l.issue_id === issueId);
      return ok(links);
    }

    if (method === "post") {
      const urlWsMatch = url.match(/\/api\/workspaces\/([^/]+)\//);
      const urlProjMatch = url.match(/\/projects\/([^/]+)\//);
      const wsSlug = urlWsMatch ? urlWsMatch[1] : (localDB.workspaces?.[0]?.slug || "fiai");
      const projId = urlProjMatch ? urlProjMatch[1] : (localDB.projects?.[0]?.id || "");
      const newLinkId = crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11);
      const newLink = {
        id: newLinkId,
        title: body?.title || body?.url || "",
        url: body?.url || "",
        issue: issueId,
        issue_id: issueId,
        project: projId,
        project_id: projId,
        workspace: wsSlug,
        workspace_id: wsSlug,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: getLoggedInUserId() || "user-default",
        ...body,
      };
      localDB.issue_links.push(newLink);
      const targetIssue = (localDB.issues || []).find((i: any) => i.id === issueId);
      if (targetIssue) {
        targetIssue.link_count = (targetIssue.link_count || 0) + 1;
      }
      saveDB();
      return ok(newLink);
    }

    if (method === "patch" || method === "put") {
      if (linkId) {
        const linkIdx = localDB.issue_links.findIndex((l: any) => l.id === linkId);
        if (linkIdx > -1) {
          localDB.issue_links[linkIdx] = {
            ...localDB.issue_links[linkIdx],
            ...body,
            updated_at: new Date().toISOString(),
          };
          saveDB();
          return ok(localDB.issue_links[linkIdx]);
        }
      }
      return ok(body);
    }

    if (method === "delete") {
      if (linkId) {
        localDB.issue_links = localDB.issue_links.filter((l: any) => l.id !== linkId);
        const targetIssue = (localDB.issues || []).find((i: any) => i.id === issueId);
        if (targetIssue && (targetIssue.link_count || 0) > 0) {
          targetIssue.link_count = targetIssue.link_count - 1;
        }
        saveDB();
      }
      return ok({ message: "Link deleted successfully" });
    }
  }

  // attachments
  const attachmentsMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/attachments(?:\/([^/]+))?\/?(?:\?.*)?$/);
  if (attachmentsMatch) {
    const issueId = attachmentsMatch[2];
    const attachmentId = attachmentsMatch[3];
    if (method === "get") {
      if (attachmentId) {
        const found = (localDB["attachments"] || []).find((a: any) => a.id === attachmentId || a.asset === attachmentId);
        return found ? ok(found) : { data: null, status: 404 };
      }
      const attachments = (localDB["attachments"] || []).filter((a: any) => a.issue === issueId || a.issue_id === issueId);
      return ok(attachments);
    }
    if (method === "delete" && attachmentId) {
      if (localDB["attachments"]) {
        localDB["attachments"] = localDB["attachments"].filter((a: any) => a.id !== attachmentId && a.asset !== attachmentId);
        saveDB();
      }
      void deleteAttachment(attachmentId);
      return ok({});
    }
  }

  // description-versions
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/description-versions\/?(?:\?.*)?$/)) {
    return ok([]);
  }

  // ── 1. Cycles Endpoints ───────────────────────────────────────────────
  // Date check endpoint
  if (url.match(/\/cycles\/date-check\/?(?:\?.*)?$/) && method.toLowerCase() === "post") {
    return ok({ status: true });
  }

  // Progress endpoints
  const cycleProgressMatch = url.match(/\/cycles\/([^/]+)\/(?:progress|cycle-progress)\/?(?:\?.*)?$/);
  if (cycleProgressMatch && method.toLowerCase() === "get") {
    const cycleId = cycleProgressMatch[1];
    const cycleIssues = (localDB.issues || []).filter((i: any) => i.cycle_id === cycleId || i.cycle === cycleId);
    const completed = cycleIssues.filter((i: any) => i.state_detail?.group === "completed" || i.state === "completed").length;
    const started = cycleIssues.filter((i: any) => i.state_detail?.group === "started" || i.state === "started").length;
    const unstarted = cycleIssues.filter((i: any) => i.state_detail?.group === "unstarted" || i.state === "unstarted").length;
    const backlog = cycleIssues.filter((i: any) => i.state_detail?.group === "backlog" || i.state === "backlog").length;
    const cancelled = cycleIssues.filter((i: any) => i.state_detail?.group === "cancelled" || i.state === "cancelled").length;
    return ok({
      total_issues: cycleIssues.length,
      completed_issues: completed,
      started_issues: started,
      unstarted_issues: unstarted,
      backlog_issues: backlog,
      cancelled_issues: cancelled,
    });
  }

  // Analytics endpoint
  const cycleAnalyticsMatch = url.match(/\/cycles\/([^/]+)\/analytics\/?(?:\?.*)?$/);
  if (cycleAnalyticsMatch && method.toLowerCase() === "get") {
    return ok({
      distribution: [],
      estimate_distribution: [],
    });
  }

  // Cycle issues endpoint
  const cycleIssuesMatch = url.match(/\/cycles\/([^/]+)\/cycle-issues(?:\/([^/?#]+))?\/?(?:\?.*)?$/);
  if (cycleIssuesMatch) {
    const cycleId = cycleIssuesMatch[1];
    const bridgeId = cycleIssuesMatch[2];
    if (method.toLowerCase() === "post") {
      const issueIds = Array.isArray(body?.issues) ? body.issues : [];
      if (localDB.issues) {
        localDB.issues.forEach((i: any) => {
          if (issueIds.includes(i.id)) {
            i.cycle_id = cycleId;
            i.cycle = cycleId;
          }
        });
        saveDB();
      }
      return ok({ message: "Issues added to cycle", issues: issueIds });
    }
    if (method.toLowerCase() === "delete") {
      if (localDB.issues && bridgeId) {
        const issue = localDB.issues.find((i: any) => i.id === bridgeId);
        if (issue) {
          issue.cycle_id = null;
          issue.cycle = null;
          saveDB();
        }
      }
      return ok({ message: "Issue removed from cycle" });
    }
    if (method.toLowerCase() === "get") {
      const issues = (localDB.issues || []).filter((i: any) => i.cycle_id === cycleId || i.cycle === cycleId);
      return ok({
        results: issues,
        total_count: issues.length,
        total_results: issues.length,
        next_cursor: null,
        prev_cursor: null,
        next_page_results: false,
        prev_page_results: false,
        total_pages: 1,
      });
    }
  }

  // Cycle transfer issues endpoint
  const cycleTransferMatch = url.match(/\/cycles\/([^/]+)\/transfer-issues\/?(?:\?.*)?$/);
  if (cycleTransferMatch && method.toLowerCase() === "post") {
    const cycleId = cycleTransferMatch[1];
    const newCycleId = body?.new_cycle_id;
    if (localDB.issues && newCycleId) {
      localDB.issues.forEach((i: any) => {
        if (i.cycle_id === cycleId || i.cycle === cycleId) {
          i.cycle_id = newCycleId;
          i.cycle = newCycleId;
        }
      });
      saveDB();
    }
    return ok({ message: "Issues transferred" });
  }

  // Cycle archive / restore
  const cycleArchiveMatch = url.match(/\/cycles\/([^/]+)\/archive\/?(?:\?.*)?$/);
  if (cycleArchiveMatch) {
    const cycleId = cycleArchiveMatch[1];
    const cycle = (localDB.cycles || []).find((c: any) => c.id === cycleId);
    if (method.toLowerCase() === "post") {
      if (cycle) cycle.archived_at = new Date().toISOString();
      saveDB();
      return ok({ archived_at: cycle?.archived_at || new Date().toISOString() });
    }
    if (method.toLowerCase() === "delete") {
      if (cycle) cycle.archived_at = null;
      saveDB();
      return ok({ message: "Cycle restored" });
    }
  }

  if (url.includes("/archived-cycles") && method.toLowerCase() === "get") {
    const archived = (localDB.cycles || []).filter((c: any) => !!c.archived_at);
    return ok(archived);
  }

  if (url.includes("/user-favorite-cycles")) {
    return ok({ message: "Success" });
  }

  // ── 2. Modules Endpoints ──────────────────────────────────────────────
  // Module issues endpoint (supports both /modules/:id/issues/ and /modules/:id/module-issues/)
  const moduleIssuesMatch = url.match(/\/modules\/([^/]+)\/(?:issues|module-issues)(?:\/([^/?#]+))?\/?(?:\?.*)?$/);
  if (moduleIssuesMatch) {
    const moduleId = moduleIssuesMatch[1];
    const targetIssueId = moduleIssuesMatch[2];
    if (method.toLowerCase() === "post") {
      const issueIds = Array.isArray(body?.issues) ? body.issues : [];
      if (localDB.issues) {
        localDB.issues.forEach((i: any) => {
          if (issueIds.includes(i.id)) {
            const currentModules = Array.isArray(i.module_ids) ? i.module_ids : [];
            if (!currentModules.includes(moduleId)) {
              i.module_ids = [...currentModules, moduleId];
            }
          }
        });
        saveDB();
      }
      return ok({ message: "Issues added to module", issues: issueIds });
    }
    if (method.toLowerCase() === "delete" && targetIssueId) {
      if (localDB.issues) {
        const issue = localDB.issues.find((i: any) => i.id === targetIssueId);
        if (issue && Array.isArray(issue.module_ids)) {
          issue.module_ids = issue.module_ids.filter((m: string) => m !== moduleId);
          saveDB();
        }
      }
      return ok({ message: "Issue removed from module" });
    }
    if (method.toLowerCase() === "get") {
      const issues = (localDB.issues || []).filter((i: any) => {
        return (
          (Array.isArray(i.module_ids) && i.module_ids.includes(moduleId)) ||
          (Array.isArray(i.modules) && i.modules.includes(moduleId)) ||
          i.module === moduleId
        );
      });
      return ok({
        results: issues,
        total_count: issues.length,
        total_results: issues.length,
        next_cursor: null,
        prev_cursor: null,
        next_page_results: false,
        prev_page_results: false,
        total_pages: 1,
      });
    }
  }

  // Modules attached to an issue
  const issueModulesMatch = url.match(/\/(?:issues|work-items|epics)\/([^/]+)\/modules\/?(?:\?.*)?$/);
  if (issueModulesMatch) {
    const issueId = issueModulesMatch[1];
    if (method.toLowerCase() === "get") {
      const issue = (localDB.issues || []).find((i: any) => i.id === issueId);
      const modIds = new Set(Array.isArray(issue?.module_ids) ? issue.module_ids : []);
      const matchedModules = (localDB.modules || []).filter((m: any) => modIds.has(m.id));
      return ok(matchedModules);
    }
    if (method.toLowerCase() === "post") {
      const issue = (localDB.issues || []).find((i: any) => i.id === issueId);
      if (issue) {
        const currentModules = Array.isArray(issue.module_ids) ? issue.module_ids : [];
        const toAdd = Array.isArray(body?.modules) ? body.modules : [];
        const toRemove = new Set(Array.isArray(body?.removed_modules) ? body.removed_modules : []);
        issue.module_ids = Array.from(new Set([...currentModules, ...toAdd])).filter(
          (mId: string) => !toRemove.has(mId)
        );
        saveDB();
      }
      return ok({ ...body });
    }
  }

  // Module archive / restore
  const moduleArchiveMatch = url.match(/\/modules\/([^/]+)\/archive\/?(?:\?.*)?$/);
  if (moduleArchiveMatch) {
    const moduleId = moduleArchiveMatch[1];
    const mod = (localDB.modules || []).find((m: any) => m.id === moduleId);
    if (method.toLowerCase() === "post") {
      if (mod) mod.archived_at = new Date().toISOString();
      saveDB();
      return ok({ archived_at: mod?.archived_at || new Date().toISOString() });
    }
    if (method.toLowerCase() === "delete") {
      if (mod) mod.archived_at = null;
      saveDB();
      return ok({ message: "Module restored" });
    }
  }

  if (url.includes("/archived-modules") && method.toLowerCase() === "get") {
    const archived = (localDB.modules || []).filter((m: any) => !!m.archived_at);
    return ok(archived);
  }

  if (url.includes("/user-favorite-modules")) {
    return ok({ message: "Success" });
  }

  // ── 3. Views Endpoints ────────────────────────────────────────────────
  // View issues endpoint (/views/:id/issues/)
  const viewIssuesMatch = url.match(/\/views\/([^/]+)\/issues\/?(?:\?.*)?$/);
  if (viewIssuesMatch && method.toLowerCase() === "get") {
    const viewId = viewIssuesMatch[1];
    const targetView = (localDB.views || []).find((v: any) => v.id === viewId);
    const projMatch = url.match(/\/projects\/([^/]+)\//);
    const projId = targetView?.project || targetView?.project_id || (projMatch ? projMatch[1] : null);

    const deletedIssueSet = new Set(localDB._deleted_issue_ids || []);
    let list = (localDB.issues || []).filter((i: any) => !deletedIssueSet.has(i.id));
    if (projId) {
      list = list.filter((i: any) => i.project === projId || i.project_id === projId);
    }
    return ok({
      results: list,
      total_count: list.length,
      total_results: list.length,
      next_cursor: null,
      prev_cursor: null,
      next_page_results: false,
      prev_page_results: false,
      total_pages: 1,
    });
  }

  if (url.includes("/user-favorite-views")) {
    return ok({ message: "Success" });
  }

  // ── 4. Pages Endpoints ────────────────────────────────────────────────
  // Page description endpoint (/pages/:id/description/)
  const pageDescriptionMatch = url.match(/\/pages\/([^/]+)\/description\/?(?:\?.*)?$/);
  if (pageDescriptionMatch) {
    const pageId = pageDescriptionMatch[1];
    const page = (localDB.pages || []).find((p: any) => p.id === pageId);
    if (method.toLowerCase() === "get") {
      return ok(page?.description_html || page?.description || "");
    }
    if (method.toLowerCase() === "patch") {
      if (page) {
        if (body?.description_html !== undefined) page.description_html = body.description_html;
        if (body?.description_json !== undefined) page.description_json = body.description_json;
        if (body?.description_binary !== undefined) page.description_binary = body.description_binary;
        if (body?.description !== undefined) page.description = body.description;
        page.updated_at = new Date().toISOString();
        saveDB();
      }
      return ok({ message: "Description updated" });
    }
  }

  // Page Actions (access, archive, lock, duplicate, move)
  const pageActionMatch = url.match(/\/pages\/([^/]+)\/(access|archive|lock|duplicate|move)\/?(?:\?.*)?$/);
  if (pageActionMatch) {
    const pageId = pageActionMatch[1];
    const action = pageActionMatch[2];
    const page = (localDB.pages || []).find((p: any) => p.id === pageId);
    if (action === "access" && method.toLowerCase() === "post") {
      if (page && body?.access) page.access = body.access;
      saveDB();
      return ok({ message: "Access updated" });
    }
    if (action === "archive") {
      if (method.toLowerCase() === "post") {
        if (page) page.archived_at = new Date().toISOString();
        saveDB();
        return ok({ archived_at: page?.archived_at || new Date().toISOString() });
      }
      if (method.toLowerCase() === "delete") {
        if (page) page.archived_at = null;
        saveDB();
        return ok({ message: "Page restored" });
      }
    }
    if (action === "lock") {
      if (page) page.is_locked = method.toLowerCase() === "post";
      saveDB();
      return ok({ is_locked: page?.is_locked ?? true });
    }
    if (action === "duplicate" && method.toLowerCase() === "post") {
      if (page) {
        const targetProjId = page.project_id || page.project;
        const newPage = {
          ...page,
          id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          name: `${page.name} (Copy)`,
          project: targetProjId,
          project_id: targetProjId,
          project_ids: Array.isArray(page.project_ids) && page.project_ids.length > 0 ? [...page.project_ids] : (targetProjId ? [targetProjId] : []),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (!localDB.pages) localDB.pages = [];
        localDB.pages.push(newPage);
        saveDB();
        return ok(newPage);
      }
    }
    if (action === "move" && method.toLowerCase() === "post") {
      if (page && body?.new_project_id) {
        page.project = body.new_project_id;
        page.project_id = body.new_project_id;
        page.project_ids = [body.new_project_id];
        saveDB();
        return ok(page);
      }
    }
  }

  if (url.includes("/favorite-pages")) {
    if (method.toLowerCase() === "get") return ok([]);
    return ok({ message: "Success" });
  }

  if (url.includes("/archived-pages") && method.toLowerCase() === "get") {
    const archivedPages = (localDB.pages || []).filter((p: any) => !!p.archived_at);
    return ok(archivedPages);
  }

  // ── 5. Intake (Inbox) Endpoints ───────────────────────────────────────
  // Intake State endpoint (/intake-state/)
  const intakeStateMatch = url.match(/\/projects\/([^/]+)\/intake-state\/?(?:\?.*)?$/);
  if (intakeStateMatch && method.toLowerCase() === "get") {
    const projectId = intakeStateMatch[1];
    const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
    const wsSlug = wsMatch ? wsMatch[1] : (localDB.workspaces?.[0]?.slug || "fiai");
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
    const wsId = ws?.id || wsSlug;
    return ok({
      id: `intake-state-${projectId}`,
      color: "#3f3f46",
      default: true,
      description: "Intake / Triage State",
      group: "triage",
      name: "Triage",
      project_id: projectId,
      sequence: 10000,
      workspace_id: wsId,
    });
  }

  // Inbox Issues endpoint (/inbox-issues/)
  const inboxIssuesMatch = url.match(/\/projects\/([^/]+)\/inbox-issues(?:\/([^/?#]+))?\/?(?:\?.*)?$/);
  if (inboxIssuesMatch) {
    const projectId = inboxIssuesMatch[1];
    const targetInboxIssueId = inboxIssuesMatch[2];
    const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
    const wsSlug = wsMatch ? wsMatch[1] : (localDB.workspaces?.[0]?.slug || "fiai");
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
    const wsId = ws?.id || wsSlug;

    if (!localDB.inbox_issues) localDB.inbox_issues = [];

    if (method.toLowerCase() === "get") {
      if (targetInboxIssueId) {
        const item = localDB.inbox_issues.find(
          (i: any) => i.id === targetInboxIssueId || i.issue_id === targetInboxIssueId || i.issue?.id === targetInboxIssueId
        );
        if (!item) return { data: null, status: 404 };
        const matchedIssue = (localDB.issues || []).find((iss: any) => iss.id === (item.issue_id || item.issue?.id));
        return ok({
          ...item,
          issue: matchedIssue || item.issue || {},
        });
      }
      let list = localDB.inbox_issues
        .filter((i: any) => i.project_id === projectId || i.project === projectId)
        // oxlint-disable-next-line oxc/no-map-spread -- Copy-on-write response enrichment must not mutate shared persisted records.
        .map((item: any) => {
          const matchedIssue = (localDB.issues || []).find((iss: any) => iss.id === (item.issue_id || item.issue?.id));
          return {
            ...item,
            issue: matchedIssue || item.issue || {},
          };
        });

      // Filter by query status (e.g. status=-2 for Open, status=1,-1,2 for Closed, status=0 for Snoozed)
      const urlParts = url.split("?");
      const queryParams = new URLSearchParams(urlParts[1] || "");
      const statusParam = queryParams.get("status");
      if (statusParam) {
        const statuses = new Set(statusParam.split(",").map((s) => Number(s.trim())));
        list = list.filter((item: any) => statuses.has(Number(item.status)));
      }

      return ok({
        results: list,
        total_count: list.length,
        total_results: list.length,
        next_cursor: null,
        prev_cursor: null,
        next_page_results: false,
        prev_page_results: false,
        total_pages: 1,
      });
    }

    if (method.toLowerCase() === "post") {
      const issueData = body?.issue || body || {};
      const newIssueId = issueData.id || crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11);
      const projectStates = (localDB.states || []).filter((s: any) => s.project === projectId || s.project_id === projectId);
      const defaultState = projectStates.find((s: any) => s.default) || projectStates[0] || { id: "default-state", name: "Backlog", group: "backlog" };

      const createdIssue = {
        id: newIssueId,
        name: issueData.name || "Untitled issue",
        description_html: issueData.description_html || "",
        project: projectId,
        project_id: projectId,
        workspace: wsId,
        workspace_id: wsId,
        state: issueData.state || defaultState.id,
        state_id: issueData.state || defaultState.id,
        state_detail: defaultState,
        priority: issueData.priority || "none",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: routeSessionUserId || "user-1",
        ...issueData,
      };
      if (!localDB.issues) localDB.issues = [];
      localDB.issues.push(createdIssue);

      const createdInboxIssue = {
        id: body?.id || crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
        status: -2, // PENDING
        snoozed_till: null,
        duplicate_to: undefined,
        source: body?.source || "IN_APP",
        issue: createdIssue,
        issue_id: createdIssue.id,
        project: projectId,
        project_id: projectId,
        workspace: wsId,
        workspace_id: wsId,
        created_by: routeSessionUserId || "user-1",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      localDB.inbox_issues.push(createdInboxIssue);
      saveDB();
      return ok(createdInboxIssue);
    }

    if (method.toLowerCase() === "patch" && targetInboxIssueId) {
      const idx = localDB.inbox_issues.findIndex(
        (i: any) => i.id === targetInboxIssueId || i.issue_id === targetInboxIssueId || i.issue?.id === targetInboxIssueId
      );
      if (idx > -1) {
        localDB.inbox_issues[idx] = {
          ...localDB.inbox_issues[idx],
          ...body,
          updated_at: new Date().toISOString(),
        };
        const underlyingId = localDB.inbox_issues[idx].issue_id || localDB.inbox_issues[idx].issue?.id;
        const issue = (localDB.issues || []).find((iss: any) => iss.id === underlyingId);
        if (body?.status === 1) {
          if (issue && body?.issue?.state_id) {
            issue.state_id = body.issue.state_id;
            issue.state = body.issue.state_id;
          }
        }
        saveDB();
        const matchedIssue = (localDB.issues || []).find((iss: any) => iss.id === underlyingId);
        return ok({
          ...localDB.inbox_issues[idx],
          issue: matchedIssue || localDB.inbox_issues[idx].issue || {},
        });
      }
      return { data: null, status: 404 };
    }

    if (method.toLowerCase() === "delete" && targetInboxIssueId) {
      localDB.inbox_issues = localDB.inbox_issues.filter(
        (i: any) => i.id !== targetInboxIssueId && i.issue_id !== targetInboxIssueId && i.issue?.id !== targetInboxIssueId
      );
      saveDB();
      return ok({ message: "Inbox issue deleted" });
    }
  }


  // ── Workspace Global Search endpoint (Power-K command palette) ───────
  const workspaceSearchMatch = url.match(/\/workspaces\/([^/?]+)\/search(?:\/|\?|$)/);
  if (workspaceSearchMatch && method.toLowerCase() === "get") {
    const wsSlug = workspaceSearchMatch[1];
    return handleWorkspaceGlobalSearch(url, wsSlug);
  }

  // search-issues endpoint — delegate to handleCRUD
  if (url.includes("/search-issues") || url.includes("search-issues")) {
    return handleCRUD(method, url, body, preserveInvitationId);
  }
  // ── Generic CRUD ────────────────────────────────────────────────────
  return handleCRUD(method, url, body, preserveInvitationId);
}

// ── Workspace Global Search handler (Power-K command palette) ─────────────
function handleWorkspaceGlobalSearch(url: string, wsSlug: string): RouteResult {
  let urlObj: URL;
  try {
    urlObj = new URL(url, "http://localhost");
  } catch {
    urlObj = new URL(url.replace(/^[a-zA-Z0-9_-]+:/, ""), "http://localhost");
  }

  const rawSearch = urlObj.searchParams.get("search") || "";
  let searchTerm = "";
  try {
    searchTerm = decodeURIComponent(rawSearch).trim().toLowerCase();
  } catch {
    searchTerm = rawSearch.trim().toLowerCase();
  }

  const workspaceSearch = urlObj.searchParams.get("workspace_search") === "true";
  const projectIdParam = urlObj.searchParams.get("project_id");

  const emptyResult = {
    results: {
      workspace: [],
      project: [],
      issue: [],
      cycle: [],
      module: [],
      issue_view: [],
      page: [],
    },
  };

  if (!searchTerm) {
    return ok(emptyResult);
  }

  // 1. Resolve workspace
  const ws = (localDB.workspaces || []).find(
    (w: any) =>
      w.slug === wsSlug ||
      w.id === wsSlug ||
      w.slug?.toLowerCase() === wsSlug?.toLowerCase()
  );
  const actualWsSlug = ws?.slug || wsSlug;
  const wsId = ws?.id || wsSlug;
  const wsKeys = new Set([wsSlug, actualWsSlug, wsId].filter(Boolean));

  // 2. Resolve projects in workspace
  const deletedWsSlugs = new Set(localDB._deleted_workspace_slugs || []);
  const deletedWsIds = new Set(localDB._deleted_workspace_ids || []);

  let allProjects = (localDB.projects || []).filter((p: any) => {
    return wsKeys.has(p.workspace) || wsKeys.has(p.workspace_id);
  });
  if (allProjects.length === 0) {
    allProjects = localDB.projects || [];
  }

  const projectMap = new Map<string, any>();
  allProjects.forEach((p: any) => {
    if (p.id) projectMap.set(p.id, p);
    if (p.identifier) {
      projectMap.set(p.identifier, p);
      projectMap.set(p.identifier.toLowerCase(), p);
    }
  });

  // Target project scope
  const targetProject = allProjects.find(
    (p: any) =>
      p.id === projectIdParam ||
      p.identifier === projectIdParam ||
      p.identifier?.toLowerCase() === projectIdParam?.toLowerCase() ||
      p.name?.toLowerCase() === projectIdParam?.toLowerCase()
  );
  const matchingProjectIds = new Set<string>();
  if (targetProject) {
    if (targetProject.id) matchingProjectIds.add(targetProject.id);
    if (targetProject.identifier) matchingProjectIds.add(targetProject.identifier);
  } else if (projectIdParam) {
    matchingProjectIds.add(projectIdParam);
  }

  // ── 1. Workspaces ──
  const workspaceResults: any[] = [];
  if (workspaceSearch) {
    (localDB.workspaces || []).forEach((w: any) => {
      if (deletedWsSlugs.has(w.slug) || deletedWsIds.has(w.id)) return;
      const nameMatch = (w.name || "").toLowerCase().includes(searchTerm);
      const slugMatch = (w.slug || "").toLowerCase().includes(searchTerm);
      if (nameMatch || slugMatch) {
        workspaceResults.push({
          id: w.id,
          name: w.name || w.slug,
          slug: w.slug,
        });
      }
    });
  }

  // ── 2. Projects ──
  const projectResults: any[] = [];
  if (workspaceSearch) {
    allProjects.forEach((p: any) => {
      const nameMatch = (p.name || "").toLowerCase().includes(searchTerm);
      const identifierMatch = (p.identifier || "").toLowerCase().includes(searchTerm);
      if (nameMatch || identifierMatch) {
        projectResults.push({
          id: p.id,
          identifier: p.identifier || "PROJ",
          name: p.name || "Untitled Project",
          workspace__slug: actualWsSlug,
        });
      }
    });
  }

  // ── 3. Work items (Issues) ──
  const deletedIssueSet = new Set(localDB._deleted_issue_ids || []);
  const issueResults: any[] = [];

  (localDB.issues || []).forEach((item: any) => {
    if (deletedIssueSet.has(item.id)) return;
    if (item.is_draft) return;
    if (item.archived_at) return;

    const itemProjId = item.project_id || item.project;
    const proj = itemProjId ? projectMap.get(itemProjId) : null;
    const projIdentifier = proj?.identifier || item.project_detail?.identifier || "PROJ";

    // Scope check: if workspaceSearch is false, restrict to selected project
    if (!workspaceSearch && matchingProjectIds.size > 0) {
      const belongsToProj =
        (itemProjId && matchingProjectIds.has(itemProjId)) ||
        matchingProjectIds.has(projIdentifier);
      if (!belongsToProj) return;
    } else if (workspaceSearch && allProjects.length > 0) {
      // Must belong to current workspace projects or workspace
      const belongsToWs =
        (itemProjId && projectMap.has(itemProjId)) ||
        wsKeys.has(item.workspace) ||
        wsKeys.has(item.workspace_id);
      if (!belongsToWs) return;
    }

    // Match search term against:
    // - issue name
    // - sequence_id
    // - full identifier (e.g. "NET-2")
    const nameMatch = (item.name || "").toLowerCase().includes(searchTerm);
    const seqStr = String(item.sequence_id ?? "");
    const seqMatch = seqStr === searchTerm || (seqStr.length > 0 && seqStr.includes(searchTerm));
    const cleanSearchTerm = searchTerm.replace(/^#/, "");
    const fullIdentifier = `${projIdentifier}-${seqStr}`.toLowerCase();
    const identifierMatch =
      fullIdentifier.includes(searchTerm) ||
      fullIdentifier.includes(cleanSearchTerm) ||
      (cleanSearchTerm !== "" && cleanSearchTerm === seqStr);

    if (nameMatch || seqMatch || identifierMatch) {
      issueResults.push({
        id: item.id,
        name: item.name || "",
        project__identifier: projIdentifier,
        project_id: proj?.id || itemProjId,
        sequence_id: item.sequence_id || 0,
        workspace__slug: actualWsSlug,
        type_id: item.type_id || item.type || "",
      });
    }
  });

  // ── 4. Cycles ──
  const cycleResults: any[] = [];
  (localDB.cycles || []).forEach((item: any) => {
    const itemProjId = item.project_id || item.project;
    if (!workspaceSearch && matchingProjectIds.size > 0) {
      if (!itemProjId || !matchingProjectIds.has(itemProjId)) return;
    }
    const nameMatch = (item.name || "").toLowerCase().includes(searchTerm);
    if (nameMatch) {
      const proj = itemProjId ? projectMap.get(itemProjId) : null;
      cycleResults.push({
        id: item.id,
        name: item.name || "",
        project_id: proj?.id || itemProjId,
        project__identifier: proj?.identifier || "PROJ",
        workspace__slug: actualWsSlug,
      });
    }
  });

  // ── 5. Modules ──
  const moduleResults: any[] = [];
  (localDB.modules || []).forEach((item: any) => {
    const itemProjId = item.project_id || item.project;
    if (!workspaceSearch && matchingProjectIds.size > 0) {
      if (!itemProjId || !matchingProjectIds.has(itemProjId)) return;
    }
    const nameMatch = (item.name || "").toLowerCase().includes(searchTerm);
    if (nameMatch) {
      const proj = itemProjId ? projectMap.get(itemProjId) : null;
      moduleResults.push({
        id: item.id,
        name: item.name || "",
        project_id: proj?.id || itemProjId,
        project__identifier: proj?.identifier || "PROJ",
        workspace__slug: actualWsSlug,
      });
    }
  });

  // ── 6. Views ──
  const viewResults: any[] = [];
  (localDB.views || []).forEach((item: any) => {
    const itemProjId = item.project_id || item.project;
    if (!workspaceSearch && matchingProjectIds.size > 0) {
      if (!itemProjId || !matchingProjectIds.has(itemProjId)) return;
    }
    const nameMatch = (item.name || "").toLowerCase().includes(searchTerm);
    if (nameMatch) {
      const proj = itemProjId ? projectMap.get(itemProjId) : null;
      viewResults.push({
        id: item.id,
        name: item.name || "",
        project_id: proj?.id || itemProjId,
        project__identifier: proj?.identifier || "PROJ",
        workspace__slug: actualWsSlug,
      });
    }
  });

  // ── 7. Pages ──
  const pageResults: any[] = [];
  (localDB.pages || []).forEach((item: any) => {
    const itemProjId = item.project_id || item.project;
    if (!workspaceSearch && matchingProjectIds.size > 0) {
      const pids = Array.isArray(item.project_ids)
        ? item.project_ids
        : (itemProjId ? [itemProjId] : []);
      const hasMatch = pids.some((pid: string) => matchingProjectIds.has(pid));
      if (!hasMatch) return;
    }
    const nameMatch = (item.name || "").toLowerCase().includes(searchTerm);
    if (nameMatch) {
      const proj = itemProjId ? projectMap.get(itemProjId) : null;
      const project_ids = Array.isArray(item.project_ids)
        ? item.project_ids
        : (itemProjId ? [itemProjId] : []);
      const project__identifiers = Array.isArray(item.project__identifiers)
        ? item.project__identifiers
        : (proj?.identifier ? [proj.identifier] : []);
      pageResults.push({
        id: item.id,
        name: item.name || "",
        project_ids,
        project__identifiers,
        workspace__slug: actualWsSlug,
      });
    }
  });

  console.log(
    `[DApp Search] term="${searchTerm}", ws="${actualWsSlug}", proj="${projectIdParam || "all"}", results: issues=${issueResults.length}, projects=${projectResults.length}`
  );

  return ok({
    results: {
      workspace: workspaceResults,
      project: projectResults,
      issue: issueResults,
      cycle: cycleResults,
      module: moduleResults,
      issue_view: viewResults,
      page: pageResults,
    },
  });
}

// ── Helper to resolve workspace owner's ETH address reliably ───────────────
function getWorkspaceOwnerEth(ws: any, wsSlug: string): string {
  if (!ws && !wsSlug) return "";
  // 1. Direct eth address in ws.owner if string
  if (typeof ws?.owner === "string") {
    const direct = extractEthAddress(ws.owner);
    if (direct) return direct.toLowerCase();
  }
  // 2. ws.owner_wallet, ws.created_by_wallet, ws.created_by
  const directFields = [ws?.owner_wallet, ws?.created_by_wallet, ws?.created_by];
  for (const f of directFields) {
    const w = extractEthAddress(f);
    if (w) return w.toLowerCase();
  }
  // 3. ws.owner object
  if (ws?.owner && typeof ws.owner === "object") {
    const wObj = extractEthAddress(ws.owner.wallet_address) ||
      extractEthAddress(ws.owner.metanode_wallet_address) ||
      extractEthAddress(ws.owner.id);
    if (wObj) return wObj.toLowerCase();
  }

  return "";
}

// ── Project Entity Enrichment Helper ─────────────────────────────────────────
function enrichProjectEntity(collection: string, item: any, defaultProjId?: string, defaultWsId?: string) {
  if (!item) return item;
  const enriched = { ...item };
  const pId = enriched.project_id || enriched.project || defaultProjId;
  const wId = enriched.workspace_id || enriched.workspace || defaultWsId;
  if (pId) {
    enriched.project = pId;
    enriched.project_id = pId;
  }
  if (wId) {
    enriched.workspace = wId;
    enriched.workspace_id = wId;
  }

  if (collection === "pages") {
    enriched.project_ids = Array.isArray(enriched.project_ids) && enriched.project_ids.length > 0
      ? enriched.project_ids
      : (pId ? [pId] : []);
    enriched.access = enriched.access ?? 0;
    enriched.color = enriched.color || "#3f3f46";
    enriched.description_html = enriched.description_html || "<p></p>";
  } else if (collection === "cycles") {
    let computedStatus = enriched.status;
    if (enriched.start_date && enriched.end_date) {
      const now = new Date();
      const s = new Date(enriched.start_date);
      const e = new Date(enriched.end_date);
      if (now < s) computedStatus = "upcoming";
      else if (now > e) computedStatus = "completed";
      else computedStatus = "current";
    } else if (!computedStatus) {
      computedStatus = "draft";
    }
    enriched.status = computedStatus;
    enriched.total_issues = enriched.total_issues ?? 0;
    enriched.completed_issues = enriched.completed_issues ?? 0;
    enriched.started_issues = enriched.started_issues ?? 0;
    enriched.unstarted_issues = enriched.unstarted_issues ?? 0;
    enriched.backlog_issues = enriched.backlog_issues ?? 0;
    enriched.cancelled_issues = enriched.cancelled_issues ?? 0;
    enriched.sort_order = enriched.sort_order ?? 10000;
    if (!enriched.progress_snapshot) {
      enriched.progress_snapshot = {
        total_issues: enriched.total_issues,
        completed_issues: enriched.completed_issues,
        started_issues: enriched.started_issues,
        unstarted_issues: enriched.unstarted_issues,
        backlog_issues: enriched.backlog_issues,
        cancelled_issues: enriched.cancelled_issues,
      };
    }
  } else if (collection === "modules") {
    enriched.status = enriched.status || "planned";
    enriched.total_issues = enriched.total_issues ?? 0;
    enriched.completed_issues = enriched.completed_issues ?? 0;
    enriched.started_issues = enriched.started_issues ?? 0;
    enriched.unstarted_issues = enriched.unstarted_issues ?? 0;
    enriched.backlog_issues = enriched.backlog_issues ?? 0;
    enriched.cancelled_issues = enriched.cancelled_issues ?? 0;
    enriched.backlog_estimate_points = enriched.backlog_estimate_points ?? 0;
    enriched.started_estimate_points = enriched.started_estimate_points ?? 0;
    enriched.unstarted_estimate_points = enriched.unstarted_estimate_points ?? 0;
    enriched.cancelled_estimate_points = enriched.cancelled_estimate_points ?? 0;
    enriched.sort_order = enriched.sort_order ?? 10000;
    enriched.member_ids = Array.isArray(enriched.member_ids) ? enriched.member_ids : [];
    enriched.lead_id = enriched.lead_id || null;
  } else if (collection === "views") {
    enriched.query_data = enriched.query_data || {};
    enriched.query = enriched.query || {};
    enriched.access = enriched.access ?? 0;
  }
  return enriched;
}

// ── Generic CRUD handler ─────────────────────────────────────────────────
async function handleCRUD(
  method: string,
  url: string,
  body: Record<string, any>,
  preserveInvitationId?: string
): Promise<RouteResult> {
  let { collection, id, isPaginated } = parseApiUrl(url);
  console.log(
    `[DApp CRUD] ${method.toUpperCase()} collection=${collection}, id=${id}, isPaginated=${isPaginated}, url=${url}`
  );

  // Handle workspace global search
  if (collection === "search" && method === "get") {
    const wsMatch = url.match(/\/workspaces\/([^/?]+)/);
    const wsSlug = wsMatch ? wsMatch[1] : (localDB.workspaces?.[0]?.slug || "fiai");
    return handleWorkspaceGlobalSearch(url, wsSlug);
  }

  // Handle bulk-delete-issues endpoint
  if (
    (collection === "bulk-delete-issues" || url.includes("/bulk-delete-issues")) &&
    method === "delete"
  ) {
    const issueIds: string[] = Array.isArray(body?.issue_ids) ? body.issue_ids : [];
    if (!localDB._deleted_issue_ids) localDB._deleted_issue_ids = [];
    for (const targetId of issueIds) {
      if (!localDB._deleted_issue_ids.includes(targetId)) {
        localDB._deleted_issue_ids.push(targetId);
      }
      const childIssues = (localDB.issues || []).filter(
        (i: any) => i.parent_id === targetId || i.parent === targetId
      );
      for (const child of childIssues) {
        if (!localDB._deleted_issue_ids.includes(child.id)) {
          localDB._deleted_issue_ids.push(child.id);
        }
      }
    }
    const deletedSet = new Set(localDB._deleted_issue_ids);
    localDB.issues = (localDB.issues || []).filter((i: any) => !deletedSet.has(i.id));
    if (localDB.issue_comments) {
      localDB.issue_comments = localDB.issue_comments.filter(
        (c: any) => !deletedSet.has(c.issue || c.issue_id)
      );
    }
    saveDB();
    return ok({ message: "Issues deleted successfully" });
  }

  // Handle bulk-operation-issues endpoint
  if (
    (collection === "bulk-operation-issues" || url.includes("/bulk-operation-issues")) &&
    method === "post"
  ) {
    const issueIds: string[] = Array.isArray(body?.issue_ids) ? body.issue_ids : [];
    const propsToUpdate = body?.properties || {};
    if (localDB.issues) {
      localDB.issues = localDB.issues.map((i: any) => {
        if (issueIds.includes(i.id)) {
          const updated = { ...i, ...propsToUpdate, updated_at: new Date().toISOString() };
          if (propsToUpdate.state_id) {
            updated.state = propsToUpdate.state_id;
            const stateObj = (localDB.states || []).find((s: any) => s.id === propsToUpdate.state_id);
            if (stateObj) updated.state_detail = stateObj;
          }
          return updated;
        }
        return i;
      });
      saveDB();
    }
    return ok({ message: "Issues updated successfully" });
  }

  // ── Archived work items (list + archive/restore) ─────────────────────
  const archivedIssuesMatch = url.match(/\/api\/workspaces\/([^/]+)\/projects\/([^/]+)\/archived-issues\/?(?:\?.*)?$/);
  if (archivedIssuesMatch && method === "get") {
    const projectParam = decodeURIComponent(archivedIssuesMatch[2]);
    const project = (localDB.projects || []).find(
      (p: any) => p.id === projectParam || (p.identifier && p.identifier.toLowerCase() === projectParam.toLowerCase())
    );
    const projectKeys = new Set([projectParam, project?.id, project?.identifier].filter(Boolean) as string[]);
    const query = new URL(url, "http://localhost").searchParams;

    let archivedIssues = (localDB.issues || []).filter(
      (issue: any) =>
        !!issue.archived_at &&
        (projectKeys.has(issue.project) ||
          projectKeys.has(issue.project_id) ||
          projectKeys.has(issue.project_detail?.identifier))
    );

    const stateFilter = query.get("state_id");
    if (stateFilter) {
      archivedIssues = archivedIssues.filter((issue: any) =>
        matchesCsvFilter(issue.state_id || issue.state, stateFilter)
      );
    }
    const priorityFilter = query.get("priority");
    if (priorityFilter) {
      archivedIssues = archivedIssues.filter((issue: any) => matchesCsvFilter(issue.priority, priorityFilter));
    }
    const assigneeFilter = query.get("assignee_id");
    if (assigneeFilter) {
      archivedIssues = archivedIssues.filter((issue: any) => matchesCsvFilter(issue.assignee_ids, assigneeFilter));
    }
    const labelFilter = query.get("label_id");
    if (labelFilter) {
      archivedIssues = archivedIssues.filter((issue: any) => matchesCsvFilter(issue.label_ids, labelFilter));
    }
    const cycleFilter = query.get("cycle_id");
    if (cycleFilter) {
      archivedIssues = archivedIssues.filter((issue: any) =>
        matchesCsvFilter(issue.cycle_id || issue.cycle, cycleFilter)
      );
    }
    const moduleFilter = query.get("module_id");
    if (moduleFilter) {
      archivedIssues = archivedIssues.filter((issue: any) => matchesCsvFilter(issue.module_ids, moduleFilter));
    }
    const createdByFilter = query.get("created_by_id");
    if (createdByFilter) {
      archivedIssues = archivedIssues.filter((issue: any) => matchesCsvFilter(issue.created_by, createdByFilter));
    }

    const orderBy = query.get("order_by");
    if (orderBy) {
      const isDescending = orderBy.startsWith("-");
      const sortKey = isDescending ? orderBy.slice(1) : orderBy;
      const priorityRank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
      archivedIssues = archivedIssues.toSorted((first: any, second: any) => {
        let firstValue: any;
        let secondValue: any;
        switch (sortKey) {
          case "priority":
            firstValue = priorityRank[first.priority] ?? 5;
            secondValue = priorityRank[second.priority] ?? 5;
            break;
          case "start_date":
          case "target_date":
          case "created_at":
          case "updated_at":
            firstValue = first[sortKey] ? new Date(first[sortKey]).getTime() : 0;
            secondValue = second[sortKey] ? new Date(second[sortKey]).getTime() : 0;
            break;
          default:
            firstValue = Number(first.sort_order) || 0;
            secondValue = Number(second.sort_order) || 0;
        }
        if (firstValue === secondValue) return 0;
        const result = firstValue > secondValue ? 1 : -1;
        return isDescending ? -result : result;
      });
    } else {
      archivedIssues = archivedIssues

        .toSorted((first: any, second: any) => Number(first.sort_order || 0) - Number(second.sort_order || 0));
    }

    return ok(buildIssueResponseEnvelope(archivedIssues, query.get("group_by")));
  }

  // ── Single work item archive / restore ───────────────────────────────
  const issueArchiveMatch = url.match(
    /\/api\/workspaces\/([^/]+)\/projects\/([^/]+)\/(?:issues|work-items|epics)\/([^/]+)\/archive\/?(?:\?.*)?$/
  );
  if (issueArchiveMatch) {
    const [, , projectParam, issueParam] = issueArchiveMatch;
    const issue = findIssueByRouteParam(decodeURIComponent(issueParam), decodeURIComponent(projectParam));
    const issueIndex = issue ? (localDB.issues || []).findIndex((item: any) => item.id === issue.id) : -1;

    if (!issue || issueIndex === -1) {
      return { data: { error: "The requested work item does not exist." }, status: 404 };
    }

    if (method === "post") {
      const archivedAt = new Date().toISOString();
      localDB.issues[issueIndex] = {
        ...localDB.issues[issueIndex],
        archived_at: archivedAt,
        archived_by: getActivityActorDetail().id,
        updated_at: archivedAt,
      };
      createIssueActivity(localDB.issues[issueIndex], "archived_at", "", "archive");
      saveDB();
      syncDAppRecord("issues", issue.id, localDB.issues[issueIndex]);
      return ok({ archived_at: archivedAt });
    }

    if (method === "delete") {
      const restoredAt = new Date().toISOString();
      localDB.issues[issueIndex] = {
        ...localDB.issues[issueIndex],
        archived_at: null,
        archived_by: null,
        updated_at: restoredAt,
      };
      createIssueActivity(localDB.issues[issueIndex], "archived_at", "archive", "restore");
      saveDB();
      syncDAppRecord("issues", issue.id, localDB.issues[issueIndex]);
      return ok({ archived_at: null });
    }

    if (method === "get") return ok(localDB.issues[issueIndex]);
  }

  // Handle bulk-archive-issues endpoint
  if (
    (collection === "bulk-archive-issues" || url.includes("/bulk-archive-issues")) &&
    method === "post"
  ) {
    const issueIds: string[] = Array.isArray(body?.issue_ids) ? body.issue_ids : [];
    const archived_at = new Date().toISOString();
    if (localDB.issues) {
      localDB.issues = localDB.issues.map((i: any) => {
        if (issueIds.includes(i.id)) {
          const updated = { ...i, archived_at, archived_by: getActivityActorDetail().id };
          createIssueActivity(updated, "archived_at", "", "archive");
          syncDAppRecord("issues", updated.id, updated);
          return updated;
        }
        return i;
      });
      saveDB();
    }
    return ok({ message: "Issues archived successfully", archived_at });
  }

  // Handle mark-default endpoint for states
  if (url.includes("/states/") && url.includes("/mark-default/") && method === "post") {
    const match = url.match(/\/states\/([^/]+)\/mark-default/);
    const targetStateId = match ? match[1] : id;
    if (targetStateId && localDB.states) {
      const targetState = localDB.states.find((s: any) => s.id === targetStateId);
      if (targetState) {
        const targetProjId = targetState.project || targetState.project_id;
        localDB.states.forEach((s: any) => {
          if (s.project === targetProjId || s.project_id === targetProjId) {
            s.default = s.id === targetStateId;
          }
        });
        saveDB();
        return ok(targetState);
      }
    }
    return ok({ message: "Default state updated" });
  }

  // Handle search-issues directly — return ISearchIssueResponse[] format
  if (collection === "search-issues" && method === "get") {
    const urlObj = new URL(url, "http://localhost");
    const searchTerm = (urlObj.searchParams.get("search") || "").toLowerCase();
    const workspaceSearch = urlObj.searchParams.get("workspace_search") === "true";
    const currentIssueId = urlObj.searchParams.get("issue_id");

    const deletedIssueSet = new Set(localDB._deleted_issue_ids || []);
    let list = (localDB.issues || []).filter((item: any) => !deletedIssueSet.has(item.id));
    console.log(`[DApp CRUD] search-issues: total issues in DB = ${list.length}`);

    // Exclude current issue itself if issue_id is provided
    if (currentIssueId) {
      list = list.filter((item: any) => item.id !== currentIssueId);
    }

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

  // Handle user-properties / epics-user-properties endpoints
  if (
    collection === "user-properties" ||
    collection === "epics-user-properties" ||
    url.includes("/user-properties/") ||
    url.includes("/epics-user-properties/")
  ) {
    const projMatch = url.match(/\/projects\/([^/]+)\//);
    const projId = projMatch ? projMatch[1] : id;
    const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
    const wsSlug = wsMatch ? wsMatch[1] : (localDB.workspaces?.[0]?.slug || "fiai");
    const cycleMatch = url.match(/\/cycles\/([^/]+)\//);
    const moduleMatch = url.match(/\/modules\/([^/]+)\//);
    const viewMatch = url.match(/\/views\/([^/]+)\//);

    let key = projId ? `${wsSlug}_${projId}` : wsSlug;
    if (cycleMatch) {
      key = `${wsSlug}_${projId}_cycle_${cycleMatch[1]}`;
    } else if (moduleMatch) {
      key = `${wsSlug}_${projId}_module_${moduleMatch[1]}`;
    } else if (viewMatch) {
      key = `${wsSlug}_${projId}_view_${viewMatch[1]}`;
    }

    if (!localDB.user_properties) localDB.user_properties = {};

    const defaultProps = {
      rich_filters: {},
      display_filters: {
        layout: "list",
        order_by: "sort_order",
        group_by: null,
        sub_group_by: null,
        sub_issue: true,
        show_empty_groups: false,
        calendar: {
          show_weekends: false,
          layout: "month",
        },
      },
      display_properties: {
        assignee: true,
        start_date: true,
        due_date: true,
        labels: true,
        priority: true,
        state: true,
        sub_issue_count: true,
        attachment_count: true,
        link: true,
        link_count: true,
        estimate: true,
        key: true,
        created_on: true,
        updated_on: true,
        modules: true,
        cycle: true,
        issue_type: true,
      },
      sort_order: 1,
      preferences: {
        pages: { block_display: true },
        navigation: { default_tab: "issues", hide_in_more_menu: [] },
      },
    };

    if (method === "get") {
      const current = localDB.user_properties[key] || defaultProps;
      return ok(current);
    }

    if (method === "patch" || method === "put" || method === "post") {
      const current = localDB.user_properties[key] || defaultProps;
      const updated = {
        ...current,
        ...body,
        display_filters: {
          ...current.display_filters,
          ...body?.display_filters,
        },
        display_properties: {
          ...current.display_properties,
          ...body?.display_properties,
        },
        preferences: {
          ...current.preferences,
          ...body?.preferences,
        },
      };
      localDB.user_properties[key] = updated;

      // Sync sort_order directly to localDB.projects so it persists
      if (body?.sort_order !== undefined && projId) {
        const pIdx = (localDB.projects || []).findIndex(
          (p: any) => p.id === projId || p.identifier === projId
        );
        if (pIdx > -1) {
          localDB.projects[pIdx].sort_order = body.sort_order;
          syncDAppRecord("projects", localDB.projects[pIdx].id, localDB.projects[pIdx]);
        }
      }

      saveDB();
      return ok(updated);
    }
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

  // ── Work item relations ──────────────────────────────────────────────
  const issueRelationMatch = url.match(
    /\/(?:issues|work-items|epics)\/([^/]+)\/(issue-relation|remove-relation)\/?(?:\?.*)?$/
  );
  if (issueRelationMatch) {
    const issueParam = decodeURIComponent(issueRelationMatch[1]);
    const relationAction = issueRelationMatch[2];
    const projectParam = url.match(/\/projects\/([^/]+)\//)?.[1];
    const issue = findIssueByRouteParam(issueParam, projectParam);

    if (!issue) {
      return { data: { error: "The requested work item does not exist." }, status: 404 };
    }

    if (!Array.isArray(localDB.issue_relations)) localDB.issue_relations = [];

    const relationTypes = new Set(["blocking", "blocked_by", "duplicate", "relates_to"]);
    const reverseRelationType: Record<string, string> = {
      blocking: "blocked_by",
      blocked_by: "blocking",
      duplicate: "duplicate",
      relates_to: "relates_to",
    };
    const findRelatedIssue = (relatedIssueId: string) =>
      (localDB.issues || []).find((item: any) => item.id === relatedIssueId);


    if (relationAction === "issue-relation" && method === "get") {
      const groupedRelations: Record<string, any[]> = {
        relates_to: [],
        duplicate: [],
        blocked_by: [],
        blocking: [],
      };
      localDB.issue_relations
        .filter((relation: any) => relation.issue === issue.id)
        .forEach((relation: any) => {
          const relatedIssue = findRelatedIssue(relation.related_issue);
          if (relatedIssue && groupedRelations[relation.relation_type]) {
            groupedRelations[relation.relation_type].push(relatedIssue);
          }
        });
      return ok(groupedRelations);
    }

    if (relationAction === "issue-relation" && method === "post") {
      const relationType = relationTypes.has(body?.relation_type) ? body.relation_type : null;
      const relatedIssueIds = Array.isArray(body?.issues) ? body.issues : [];
      if (!relationType || relatedIssueIds.length === 0) {
        return { data: { error: "relation_type and issues are required." }, status: 400 };
      }

      const createdIssues: any[] = [];
      relatedIssueIds.forEach((relatedIssueId: string) => {
        const relatedIssue = findRelatedIssue(relatedIssueId);
        if (!relatedIssue || relatedIssue.id === issue.id) return;

        const now = new Date().toISOString();
        const actorId = getActivityActorDetail().id;
        const alreadyRelated = localDB.issue_relations.some(
          (relation: any) =>
            relation.issue === issue.id &&
            relation.related_issue === relatedIssue.id &&
            relation.relation_type === relationType
        );

        if (!alreadyRelated) {
          localDB.issue_relations.push({
            id: crypto.randomUUID?.() || `relation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            issue: issue.id,
            related_issue: relatedIssue.id,
            relation_type: relationType,
            project: issue.project_id || issue.project,
            workspace: issue.workspace_id || issue.workspace,
            created_at: now,
            created_by: actorId,
          });
          localDB.issue_relations.push({
            id: crypto.randomUUID?.() || `relation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            issue: relatedIssue.id,
            related_issue: issue.id,
            relation_type: reverseRelationType[relationType],
            project: relatedIssue.project_id || relatedIssue.project,
            workspace: relatedIssue.workspace_id || relatedIssue.workspace,
            created_at: now,
            created_by: actorId,
          });
          createIssueActivity(issue, relationType, "", describeRelatedIssue(relatedIssue));
        }

        createdIssues.push(relatedIssue);
      });

      if (createdIssues.length > 0) {
        saveDB();
        syncDAppRecord("issues", issue.id, issue);
      }
      return ok(createdIssues);
    }

    if (relationAction === "remove-relation" && method === "post") {
      const relationType = relationTypes.has(body?.relation_type) ? body.relation_type : null;
      const relatedIssueId = body?.related_issue as string | undefined;
      if (!relationType || !relatedIssueId) {
        return { data: { error: "relation_type and related_issue are required." }, status: 400 };
      }

      const relatedIssue = findRelatedIssue(relatedIssueId);
      const reverseType = reverseRelationType[relationType];
      localDB.issue_relations = localDB.issue_relations.filter(
        (relation: any) =>
          !(
            (relation.issue === issue.id &&
              relation.related_issue === relatedIssueId &&
              relation.relation_type === relationType) ||
            (relation.issue === relatedIssueId &&
              relation.related_issue === issue.id &&
              relation.relation_type === reverseType)
          )
      );
      if (relatedIssue) {
        createIssueActivity(issue, relationType, describeRelatedIssue(relatedIssue), "");
      }
      saveDB();
      syncDAppRecord("issues", issue.id, issue);
      return ok({ message: "Relation removed successfully" });
    }
  }
  // ── Sub work items ───────────────────────────────────────────────────
  const subIssuesMatch = url.match(/\/(?:issues|work-items)\/([^/]+)\/sub-issues\/?(?:\?.*)?$/);
  if (subIssuesMatch && (method === "get" || method === "post")) {
    const parentIssueParam = decodeURIComponent(subIssuesMatch[1]);
    const projectParam = url.match(/\/projects\/([^/]+)\//)?.[1];
    const parentIssue = findIssueByRouteParam(parentIssueParam, projectParam);

    if (!parentIssue) {
      return { data: { error: "The requested work item does not exist." }, status: 404 };
    }

    if (method === "post") {
      const subIssueIds: string[] = Array.isArray(body?.sub_issue_ids) ? body.sub_issue_ids : [];
      subIssueIds.forEach((subIssueId: string) => {
        const childIndex = (localDB.issues || []).findIndex((item: any) => item.id === subIssueId);
        if (childIndex === -1 || subIssueId === parentIssue.id) return;
        localDB.issues[childIndex] = {
          ...localDB.issues[childIndex],
          parent_id: parentIssue.id,
          parent: parentIssue.id,
          updated_at: new Date().toISOString(),
        };
        syncDAppRecord("issues", subIssueId, localDB.issues[childIndex]);
      });
      saveDB();
    }

    const subIssues = (localDB.issues || []).filter(
      (item: any) => (item.parent_id || item.parent) === parentIssue.id
    );
    const stateDistribution: Record<string, string[]> = {
      backlog: [],
      unstarted: [],
      started: [],
      completed: [],
      cancelled: [],
    };
    subIssues.forEach((subIssue: any) => {
      const state =
        (localDB.states || []).find((item: any) => item.id === (subIssue.state_id || subIssue.state)) ||
        subIssue.state_detail;
      const group = state?.group && stateDistribution[state.group] ? state.group : "backlog";
      stateDistribution[group].push(subIssue.id);
    });

    const parentIndex = (localDB.issues || []).findIndex((item: any) => item.id === parentIssue.id);
    if (parentIndex > -1 && localDB.issues[parentIndex].sub_issues_count !== subIssues.length) {
      localDB.issues[parentIndex].sub_issues_count = subIssues.length;
      saveDB();
    }

    return ok({ sub_issues: subIssues, state_distribution: stateDistribution });
  }

  if (collection === "sub-issues" && method === "get") {
    return ok({
      sub_issues: [],
      state_distribution: { backlog: [], unstarted: [], started: [], completed: [], cancelled: [] },
    });
  }
  // ── Work item links ──────────────────────────────────────────────────
  if (collection === "issue-links" || collection === "links") collection = "issue_links";
  const issueLinkMatch = url.match(/\/(?:issues|work-items|epics)\/([^/]+)\/(?:issue-links|links)\/?(?:\?.*)?$/);
  if (issueLinkMatch && (method === "get" || method === "post")) {
    const linkProjectParam = url.match(/\/projects\/([^/]+)\//)?.[1];
    const linkIssue = findIssueByRouteParam(decodeURIComponent(issueLinkMatch[1]), linkProjectParam);

    if (!linkIssue) {
      return { data: { error: "The requested work item does not exist." }, status: 404 };
    }

    if (!Array.isArray(localDB.issue_links)) localDB.issue_links = [];

    if (method === "get") {
      return ok(
        localDB.issue_links.filter((link: any) => (link.issue_id || link.issue) === linkIssue.id)
      );
    }

    const now = new Date().toISOString();
    const issueLink = {
      id: crypto.randomUUID?.() || `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: body?.title || "",
      url: body?.url || "",
      metadata: body?.metadata ?? {},
      issue_id: linkIssue.id,
      issue: linkIssue.id,
      project_id: linkIssue.project_id || linkIssue.project,
      workspace_id: linkIssue.workspace_id || linkIssue.workspace,
      created_by_id: getActivityActorDetail().id,
      created_at: now,
      updated_at: now,
    };
    localDB.issue_links.push(issueLink);
    saveDB();
    syncDAppRecord("issue_links", issueLink.id, issueLink);
    return ok(issueLink);
  }

  // ── Reactions (work item + comment) ──────────────────────────────────
  if (collection === "reactions") {
    const isCommentReaction = url.includes("/comments/");
    const targetCollectionKey = isCommentReaction ? "comment_reactions" : "issue_reactions";
    if (!Array.isArray(localDB[targetCollectionKey])) localDB[targetCollectionKey] = [];

    const targetMatch = isCommentReaction
      ? url.match(/\/comments\/([^/?#]+)\/reactions/)
      : url.match(/\/(?:issues|work-items|epics)\/([^/?#]+)\/reactions/);
    const projectParam = url.match(/\/projects\/([^/]+)\//)?.[1];
    const targetParam = targetMatch ? decodeURIComponent(targetMatch[1]) : null;
    const targetIssue =
      !isCommentReaction && targetParam ? findIssueByRouteParam(targetParam, projectParam) : undefined;
    const targetId = targetIssue?.id || targetParam;

    if (!targetId) {
      return { data: { error: "The requested resource does not exist." }, status: 404 };
    }

    const matchesTarget = (record: any) =>
      isCommentReaction
        ? record.comment === targetId || record.comment_id === targetId
        : record.issue === targetId || record.issue_id === targetId;

    if (method === "get") {
      return ok(localDB[targetCollectionKey].filter(matchesTarget));
    }

    const actor = getActivityActorDetail();

    if (method === "post") {
      const reactionValue = typeof body?.reaction === "string" ? body.reaction : "";
      if (!reactionValue) {
        return { data: { error: "reaction is required." }, status: 400 };
      }
      const existingReaction = localDB[targetCollectionKey].find(
        (record: any) => matchesTarget(record) && record.actor === actor.id && record.reaction === reactionValue
      );
      if (existingReaction) return ok(existingReaction);

      const now = new Date().toISOString();
      const reactionRecord = {
        id: crypto.randomUUID?.() || `reaction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        actor: actor.id,
        actor_detail: actor,
        reaction: reactionValue,
        display_name: actor.display_name,
        issue: isCommentReaction ? null : targetId,
        issue_id: isCommentReaction ? null : targetId,
        comment: isCommentReaction ? targetId : null,
        comment_id: isCommentReaction ? targetId : null,
        project: targetIssue?.project_id || targetIssue?.project || null,
        workspace: targetIssue?.workspace_id || targetIssue?.workspace || null,
        created_at: now,
        updated_at: now,
      };
      localDB[targetCollectionKey].push(reactionRecord);
      saveDB();
      return ok(reactionRecord);
    }

    if (method === "delete") {
      const reactionParam = url.match(/\/reactions\/([^/?#]+)\/?(?:\?.*)?$/)?.[1];
      const reactionValue = reactionParam ? decodeURIComponent(reactionParam) : "";
      localDB[targetCollectionKey] = localDB[targetCollectionKey].filter(
        (record: any) =>
          !(
            matchesTarget(record) &&
            record.actor === actor.id &&
            (!reactionValue || record.reaction === reactionValue)
          )
      );
      saveDB();
      return ok({ message: "Reaction removed successfully" });
    }
  }

  // Sub-resource collections that don't have persistent storage — return empty stubs
  const subResourceCollections = [
    "history",
    "comments",
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

      const mockData = Object.keys(dateMap).toSorted().map(dateStr => {
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

    if (saveNeeded && method !== "get") saveDB();
  }

  if (method === "get") {
    if (id) {
      let item = localDB[collection].find((r: any) => r.id === id || r.slug === id);

      if (!item && collection === "states") {
        item = (localDB.states || []).find(
          (s: any) => s.id === id || s.group === id || s.name?.toLowerCase() === id?.toLowerCase()
        );
      }

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
        return { data: null, status: 404 };
      }
      if (collection === "workspaces" && item) {
        const deletedWsSlugs = new Set(localDB._deleted_workspace_slugs || []);
        const deletedWsIds = new Set(localDB._deleted_workspace_ids || []);
        if (deletedWsSlugs.has(item.slug) || deletedWsIds.has(item.id)) {
          return { data: null, status: 404 };
        }
      }
      // Enrich issue/work-item data with defaults expected by the detail store
      if (collection === "issues") {
        const deletedIssueSet = new Set(localDB._deleted_issue_ids || []);
        if (deletedIssueSet.has(item.id)) {
          return { data: null, status: 404 };
        }
        const stateDetail =
          item.state_detail || (localDB.states || []).find((s: any) => s.id === (item.state_id || item.state));
        const projectDetail =
          item.project_detail || (localDB.projects || []).find((p: any) => p.id === (item.project_id || item.project));
        const issueAttachments = (localDB["attachments"] || []).filter(
          (a: any) => a.issue === item.id || a.issue_id === item.id
        );
        return ok({
          is_subscribed: false,
          issue_reactions: [],
          issue_link: [],
          parent: null,
          ...item,
          issue_attachments: issueAttachments.length > 0 ? issueAttachments : (item.issue_attachments || []),
          attachment_count: issueAttachments.length > 0 ? issueAttachments.length : (item.attachment_count || 0),
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
          module_ids: Array.isArray(item.module_ids) ? item.module_ids : (Array.isArray(item.modules) ? item.modules : []),
          modules: Array.isArray(item.modules) ? item.modules : (Array.isArray(item.module_ids) ? item.module_ids : []),
          state_detail: stateDetail,
          project_detail: projectDetail,
        });
      }
      if (collection === "projects" && item) {
        const proj = { ...item };
        const currentUserId = getLoggedInUserId();
        const currentUserEmail = (getLoggedInEmail() || "").toLowerCase().trim();
        const activeUser = (localDB.users || []).find((u: any) =>
          (currentUserId && u.id === currentUserId) ||
          (currentUserEmail && u.email?.toLowerCase() === currentUserEmail)
        );
        const resolvedUserId = activeUser?.id || currentUserId;
        const resolvedEmail = (activeUser?.email || currentUserEmail || "").toLowerCase().trim();


        const pm = (localDB.project_members || []).find((pMember: any) => {
          const pId = pMember.project || pMember.project_id;
          const pMail = (pMember.email || "").toLowerCase().trim();
          const pMem = String(pMember.member || "");
          return (pId === proj.id) && (
            (resolvedEmail && pMail === resolvedEmail) ||
            (resolvedUserId && resolvedUserId !== "user-default" && pMem === resolvedUserId)
          );
        });

        const isProjCreator = Boolean(
          (resolvedUserId && resolvedUserId !== "user-default" && (proj.created_by === resolvedUserId || proj.owner === resolvedUserId)) ||
          (resolvedEmail && (
            (proj.created_by && proj.created_by.toLowerCase().trim() === resolvedEmail) ||
            (proj.owner?.email && proj.owner.email.toLowerCase().trim() === resolvedEmail) ||
            (resolvedEmail === "anh2482006@gmail.com" && (!proj.created_by || proj.created_by === "user-default"))
          ))
        );

        if (pm && pm.role) {
          proj.member_role = pm.role;
        } else if (isProjCreator) {
          proj.member_role = 20;
        } else {
          proj.member_role = null;
        }
        proj.cycle_view = proj.cycle_view ?? true;
        proj.module_view = proj.module_view ?? true;
        proj.issue_views_view = proj.issue_views_view ?? true;
        proj.page_view = proj.page_view ?? true;
        proj.inbox_view = proj.inbox_view ?? true;
        return ok(proj);
      }
      if (item && ["cycles", "modules", "views", "pages"].includes(collection)) {
        return ok(enrichProjectEntity(collection, item));
      }
      if (collection === "workspaces" && item) {
        const total_members = getWorkspaceMemberCount(item.slug, item.id);
        return ok({ ...item, total_members });
      }
      return ok(item);
    }
    let list = localDB[collection] || [];

    // Archived work items only live in the archived section; exclude them from the
    // regular work item lists (they would otherwise reappear after a refresh).
    if (collection === "issues") {
      list = list.filter((issue: any) => !issue.archived_at);
    }

    // History endpoint should also return comments
    if (collection === "history") {
      const commentsList = localDB["comments"] || [];
      list = [...list, ...commentsList];
    }

    // Auto-seed states for a project if none exist
    if (collection === "states" && url.includes("/projects/")) {
      const projId = id || url.match(/\/projects\/([^/]+)\//)?.[1];
      if (projId) {
        const targetProj = (localDB.projects || []).find(
          (p: any) => p.id === projId || (p.identifier && p.identifier.toLowerCase() === projId.toLowerCase())
        );
        const matchingProjIds = new Set(
          [projId, targetProj?.id, targetProj?.identifier].filter(Boolean)
        );
        const projStates = list.filter((s: any) => matchingProjIds.has(s.project) || matchingProjIds.has(s.project_id));
        if (projStates.length === 0) {
          const match = url.match(/\/api\/workspaces\/([^/]+)\//);
          const wsSlug = match ? match[1] : "unknown";
          let wsId = wsSlug;
          if (localDB.workspaces) {
            const ws = localDB.workspaces.find((w: any) => w.slug === wsSlug);
            if (ws) wsId = ws.id;
          }
          const actualProjId = targetProj?.id || projId;

          const defaultStates = [
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Backlog",
              group: "backlog",
              project: actualProjId,
              project_id: actualProjId,
              workspace: wsId,
              workspace_id: wsId,
              sequence: 15000,
              color: "#a3a3a3",
              default: true,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Unstarted",
              group: "unstarted",
              project: actualProjId,
              project_id: actualProjId,
              workspace: wsId,
              workspace_id: wsId,
              sequence: 25000,
              color: "#3f3f46",
              default: false,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Started",
              group: "started",
              project: actualProjId,
              project_id: actualProjId,
              workspace: wsId,
              workspace_id: wsId,
              sequence: 35000,
              color: "#f59e0b",
              default: false,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Completed",
              group: "completed",
              project: actualProjId,
              project_id: actualProjId,
              workspace: wsId,
              workspace_id: wsId,
              sequence: 45000,
              color: "#16a34a",
              default: false,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Cancelled",
              group: "cancelled",
              project: actualProjId,
              project_id: actualProjId,
              workspace: wsId,
              workspace_id: wsId,
              sequence: 55000,
              color: "#ef4444",
              default: false,
            },
          ];
          list.push(...defaultStates);
          (localDB as any)["states"] = list;
          if (method !== "get") saveDB();
        }
      }
    }

    // Generic _id suffix mapping for all items to satisfy frontend MobX stores
    list = list.map((item: any) => {
      if (!item || typeof item !== "object") return item;
      const res = { ...item };
      if (res.project && !res.project_id) res.project_id = res.project;
      if (res.project_id && !res.project) res.project = res.project_id;
      if (res.workspace && !res.workspace_id) res.workspace_id = res.workspace;
      if (res.workspace_id && !res.workspace) res.workspace = res.workspace_id;
      return res;
    });

    // Filter collections by project ID if the URL is scoped to a project
    if (url.includes("/projects/")) {
      const match = url.match(/\/projects\/([^/]+)\//);
      if (match) {
        const projId = match[1];
        const targetProj = (localDB.projects || []).find(
          (p: any) => p.id === projId || (p.identifier && p.identifier.toLowerCase() === projId.toLowerCase())
        );
        const matchingProjIds = new Set(
          [projId, targetProj?.id, targetProj?.identifier].filter(Boolean)
        );

        if (targetProj?.network === 0) {
          const currentUserId = getLoggedInUserId();
          const currentUserEmail = (getLoggedInEmail() || "").toLowerCase().trim();
          const activeWallet = (
            sessionStorage.getItem("plane_active_wallet_address") ||
            localStorage.getItem("plane_active_wallet_address") ||
            currentUserAddress ||
            ""
          ).toLowerCase().trim();

          const isProjCreator = Boolean(
            (currentUserId && currentUserId !== "user-default" && (targetProj.created_by === currentUserId || targetProj.owner === currentUserId || targetProj.owner?.id === currentUserId)) ||
            (currentUserEmail && (
              (targetProj.created_by && targetProj.created_by.toLowerCase().trim() === currentUserEmail) ||
              (targetProj.owner?.email && targetProj.owner.email.toLowerCase().trim() === currentUserEmail) ||
              (currentUserEmail === "anh2482006@gmail.com" && (!targetProj.created_by || targetProj.created_by === "user-default"))
            )) ||
            (activeWallet && (
              (targetProj.created_by && targetProj.created_by.toLowerCase() === activeWallet) ||
              (targetProj.owner === activeWallet)
            ))
          );

          const pm = (localDB.project_members || []).find((pMember: any) => {
            const pId = pMember.project || pMember.project_id;
            if (pId !== targetProj.id) return false;
            const pMail = (pMember.email || "").toLowerCase().trim();
            const pMem = String(pMember.member || "").toLowerCase().trim();
            const pWall = (pMember.wallet_address || "").toLowerCase().trim();
            if (currentUserEmail && (pMail === currentUserEmail || pMem === currentUserEmail)) return true;
            if (currentUserId && currentUserId !== "user-default" && pMem === currentUserId.toLowerCase().trim()) return true;
            if (activeWallet && (pWall === activeWallet || pMem === activeWallet)) return true;
            return false;
          });

          const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
          const currentWsSlug = wsMatch ? wsMatch[1] : (targetProj.workspace || targetProj.workspace_id);
          const ws = (localDB.workspaces || []).find((w: any) => w.slug === currentWsSlug || w.id === currentWsSlug);
          const validWsKeys = new Set([currentWsSlug, ws?.id, ws?.slug, targetProj.workspace, targetProj.workspace_id].filter(Boolean));
          const wsMember = (localDB.workspace_members || []).find(
            (wm: any) =>
              (validWsKeys.has(wm.workspace) || validWsKeys.has(wm.workspace_id)) &&
              (
                (currentUserId && (wm.member === currentUserId || wm.id === currentUserId)) ||
                (currentUserEmail && (wm.email || "").toLowerCase().trim() === currentUserEmail) ||
                (activeWallet && ((wm.wallet_address || "").toLowerCase().trim() === activeWallet || String(wm.member || "").toLowerCase().trim() === activeWallet))
              )
          );
          const isWsAdmin =
            (currentUserEmail === "anh2482006@gmail.com") ||
            Boolean(wsMember && Number(wsMember.role) >= 20);

          if (!isWsAdmin && !isProjCreator && !pm && !wsMember) {
            return { data: { error: "You do not have access to this project" }, status: 403 };
          }
        }

        if (
          ["issues", "states", "labels", "project-members", "project-roles", "cycles", "modules", "views", "pages", "blockchain-transactions"].includes(collection)
        ) {
          list = list.filter((item: any) => {
            if (matchingProjIds.has(item.project) || matchingProjIds.has(item.project_id)) return true;
            if (collection === "pages" && Array.isArray(item.project_ids) && item.project_ids.some((pid: string) => matchingProjIds.has(pid))) return true;
            if (collection === "blockchain-transactions" && item.issue_id) {
              const matchedIss = (localDB.issues || []).find((i: any) => i.id === item.issue_id);
              if (matchedIss && (matchingProjIds.has(matchedIss.project) || matchingProjIds.has(matchedIss.project_id))) {
                item.project = matchedIss.project || matchedIss.project_id;
                item.project_id = matchedIss.project_id || matchedIss.project;
                return true;
              }
            }
            return false;
          });
        }
      }
    } else if (url.includes("/workspaces/") && (collection === "labels" || collection === "projects")) {
      const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
      if (wsMatch) {
        const wsSlug = wsMatch[1];
        const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
        const validWsKeys = new Set([wsSlug, ws?.id, ws?.slug].filter(Boolean));
        list = list.filter((item: any) => {
          const itemWs = item.workspace || item.workspace_id || item.workspace_detail?.id || item.workspace_detail?.slug;
          return validWsKeys.has(itemWs);
        });

        if (collection === "projects") {
          const currentUserId = getLoggedInUserId();
          const currentUserEmail = (getLoggedInEmail() || "").toLowerCase().trim();
          const activeUser = (localDB.users || []).find((u: any) =>
            (currentUserId && u.id === currentUserId) ||
            (currentUserEmail && u.email?.toLowerCase() === currentUserEmail)
          );
          const resolvedUserId = activeUser?.id || currentUserId;
          const resolvedEmail = (activeUser?.email || currentUserEmail || "").toLowerCase().trim();

          list = list.map((item: any) => {
            const proj = { ...item };
            proj.cycle_view = proj.cycle_view ?? true;
            proj.module_view = proj.module_view ?? true;
            proj.issue_views_view = proj.issue_views_view ?? true;
            proj.page_view = proj.page_view ?? true;
            proj.inbox_view = proj.inbox_view ?? true;
            const pm = (localDB.project_members || []).find((pMember: any) => {
              const pId = pMember.project || pMember.project_id;
              const pMail = (pMember.email || "").toLowerCase().trim();
              const pMem = String(pMember.member || "");
              return (pId === proj.id) && (
                (resolvedEmail && pMail === resolvedEmail) ||
                (resolvedUserId && resolvedUserId !== "user-default" && pMem === resolvedUserId)
              );
            });

            const wsMember = (localDB.workspace_members || []).find(
              (wm: any) =>
                (wm.workspace === ws?.id || wm.workspace === ws?.slug || wm.workspace === wsSlug) &&
                (wm.member === resolvedUserId || (resolvedEmail && (wm.email || "").toLowerCase().trim() === resolvedEmail))
            );
            const isWsAdmin =
              Boolean(
                ws &&
                (
                  (resolvedUserId && resolvedUserId !== "user-default" && (ws.created_by === resolvedUserId || ws.owner?.id === resolvedUserId)) ||
                  (resolvedEmail && (
                    (ws.owner?.email && ws.owner.email.toLowerCase().trim() === resolvedEmail) ||
                    (ws.created_by && ws.created_by.toLowerCase().trim() === resolvedEmail)
                  ))
                )
              ) ||
              (resolvedEmail === "anh2482006@gmail.com") ||
              Boolean(wsMember && Number(wsMember.role) >= 20);

            const activeWallet = (
              sessionStorage.getItem("plane_active_wallet_address") ||
              localStorage.getItem("plane_active_wallet_address") ||
              currentUserAddress ||
              ""
            ).toLowerCase().trim();

            const isProjCreator = Boolean(
              (resolvedUserId && resolvedUserId !== "user-default" && (proj.created_by === resolvedUserId || proj.owner === resolvedUserId || proj.owner?.id === resolvedUserId)) ||
              (resolvedEmail && (
                (proj.created_by && proj.created_by.toLowerCase().trim() === resolvedEmail) ||
                (proj.owner?.email && proj.owner.email.toLowerCase().trim() === resolvedEmail) ||
                (resolvedEmail === "anh2482006@gmail.com" && (!proj.created_by || proj.created_by === "user-default"))
              )) ||
              (activeWallet && (
                (proj.created_by && proj.created_by.toLowerCase() === activeWallet) ||
                (proj.owner === activeWallet || proj.owner?.id?.toLowerCase() === activeWallet)
              ))
            );

            if (isProjCreator || isWsAdmin) {
              proj.member_role = 20;
            } else if (pm && pm.role) {
              proj.member_role = pm.role;
            } else {
              proj.member_role = null;
            }
            return proj;
          }).filter((p: any) => {
            if (p.network === 0 && !p.member_role) {
              return false;
            }
            return true;
          });
        }
      }
    }

    if (collection === "workspaces") {
      list = list.map((ws: any) => ({
        ...ws,
        total_members: getWorkspaceMemberCount(ws.slug, ws.id),
      }));
    }

    // Filter sub-resources by issue ID
    if (["comments", "history", "issue_reactions", "reactions", "issue-links", "links"].includes(collection) && id) {
      list = list.filter((item: any) => item.issue === id || item.issue_id === id);
    }

    if (collection === "blockchain-transactions") {
      try {
        const urlObj = new URL(url, "http://localhost");
        const assigneeIdParam = urlObj.searchParams.get("assignee_id");
        const issueIdParam = urlObj.searchParams.get("issue_id");
        if (assigneeIdParam) {
          list = list.filter((tx: any) => tx.assignee_id === assigneeIdParam || tx.assignee_wallet?.toLowerCase() === assigneeIdParam.toLowerCase());
        }
        if (issueIdParam) {
          list = list.filter((tx: any) => tx.issue_id === issueIdParam);
        }
      } catch { }
    }

    if (collection === "invitations") {
      syncCrossPortWorkspaces();
      const stored = getStoredInvitations();
      if (!localDB.invitations) localDB.invitations = [];
      for (const inv of stored) {
        if (!localDB.invitations.some((i: any) => i.id === inv.id)) {
          localDB.invitations.push(inv);
        }
      }
      list = localDB.invitations || [];
      const wsMatch = url.match(/\/api\/workspaces\/([^/]+)\/invitations/);
      const wsSlug = wsMatch ? wsMatch[1] : null;
      const ws = wsSlug ? (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug) : null;
      const validWsKeys = new Set([wsSlug, ws?.id, ws?.slug].filter(Boolean));

      // On-Chain Membership Sync for invitations
      let syncedOnChainWallets: string[] = [];
      const shouldSyncOnChain = getEnvVar("VITE_ONCHAIN_MEMBERSHIP_SYNC") !== "false";
      if (shouldSyncOnChain && wsSlug) {
        try {
          // Check if smart contract has a newer IPFS CID for this workspace (e.g. from Sync to Chain)
          const wsRegistryAddr = getWorkspaceRegistryAddress();
          if (wsRegistryAddr) {
            try {
              const wsInfoCalldata = abiEncodeGetWorkspace(wsSlug);
              const wsInfoRaw = await directRpcRead(wsRegistryAddr, wsInfoCalldata, 4000);
              const wsInfo = decodeAbiWorkspace(wsInfoRaw);
              const contractCid = wsInfo?.ipfsCID?.trim();
              const localCid = (typeof localStorage !== "undefined" ? localStorage.getItem("plane_dapp_ipfs_cid_local") || "" : "").trim();
              // Local đang giữ CID mới hơn nhưng chưa kịp ghi on-chain (auto-commit throttle / ví khóa)
              // → KHÔNG được ghi đè bằng snapshot cũ trên contract, nếu không sẽ mất dữ liệu vừa sửa.
              const pendingOnchainCid = (
                typeof localStorage !== "undefined" ? localStorage.getItem("plane_dapp_pending_onchain_cid") || "" : ""
              ).trim();
              const hasUncommittedLocalCid = Boolean(localCid) && pendingOnchainCid === localCid;
              if (
                !hasUncommittedLocalCid &&
                contractCid &&
                contractCid !== localCid &&
                contractCid !== getLastUploadedCID()
              ) {
                console.log(`[DApp Routes] Phát hiện CID mới trên contract cho ${wsSlug}: ${contractCid}. Đang đồng bộ từ IPFS...`);
                const remoteDB = await fetchFromIPFS(contractCid);
                if (remoteDB && remoteDB.workspaces) {
                  applyOffchainDB(remoteDB);
                  if (typeof localStorage !== "undefined") {
                    localStorage.setItem("plane_dapp_ipfs_cid_local", contractCid);
                    // Dữ liệu remote đã thay thế local → cờ "chờ ghi on-chain" không còn ý nghĩa.
                    localStorage.removeItem("plane_dapp_pending_onchain_cid");
                  }
                  saveDB({ localOnly: true });
                }
              }
            } catch (cidErr) {
              console.warn(`[DApp Routes] Lỗi kiểm tra CID mới từ contract:`, cidErr);
            }
          }

          const onChainMembers = await fetchWorkspaceMembersOnChain(wsSlug, true);
          if (onChainMembers && onChainMembers.length > 0) {
            syncedOnChainWallets = onChainMembers;
            const beforeOnChainSync = JSON.stringify(localDB);
            if (!localDB.workspace_members) localDB.workspace_members = [];
            const ownerEth = getWorkspaceOwnerEth(ws, wsSlug);

            // Cleanup any locally cached members that were truly marked as removed or illegal owner duplicates
            if (ownerEth) {
              const cleanOwnerEth = ownerEth.toLowerCase();
              if (localDB.workspace_members && Array.isArray(localDB.workspace_members)) {
                localDB.workspace_members = localDB.workspace_members.filter((m: any) => {
                  const isWs = (m.workspace === wsSlug || m.workspace === ws?.id || m.workspace_id === wsSlug || m.workspace_id === ws?.id);
                  if (!isWs) return true;
                  const mWallet = (m.wallet_address || (typeof m.member === "string" && m.member.startsWith("0x") ? m.member : "")).toLowerCase().trim();
                  return !(mWallet === cleanOwnerEth && Number(m.role) < 20);
                });
              }
              (localDB.invitations || []).forEach((inv: any) => {
                const invWs = inv.workspace?.slug || inv.workspace_slug || inv.workspace?.id || inv.workspace;
                if ((!invWs || invWs === wsSlug || invWs === ws?.id) && inv.wallet_address?.toLowerCase() === cleanOwnerEth) {
                  inv.wallet_address = undefined;
                  inv.accepted = false;
                  inv.responded_at = null;
                }
              });
            }

            const removedSet = getWorkspaceRemovedSet(wsSlug);

            const uniqueOnChainMembers = Array.from(
              new Set(onChainMembers.map((a: string) => String(a || "").toLowerCase().trim()).filter(Boolean))
            );

            for (const cleanAddr of uniqueOnChainMembers) {
              if (ownerEth && cleanAddr === ownerEth.toLowerCase()) continue;

              // Check unaccepted invitations specifically matching cleanAddr
              const matchingPendingInv = (localDB.invitations || []).find((inv: any) => {
                const isWs = (inv.workspace?.slug === wsSlug || inv.workspace_slug === wsSlug || inv.workspace === wsSlug || inv.workspace === ws?.id);
                if (!isWs || inv.accepted) return false;
                if (inv.wallet_address && inv.wallet_address.toLowerCase().trim() === cleanAddr) return true;
                if (localDB._email_wallet_map && inv.email && String(localDB._email_wallet_map[inv.email.toLowerCase().trim()] || "").toLowerCase() === cleanAddr) return true;
                return false;
              });

              // If cleanAddr was in removedSet, but there is an unaccepted invitation waiting to be fulfilled
              // (e.g. admin invited a new user who used this wallet, or re-invited), un-stale it!
              if (removedSet.has(cleanAddr)) {
                if (matchingPendingInv) {
                  console.log(`[DApp Routes] Un-stale ví ${cleanAddr} khỏi removed_members vì có lời mời pending hợp lệ: ${matchingPendingInv.email || matchingPendingInv.id}`);
                  removedSet.delete(cleanAddr);
                  const targetKeys = Array.from(new Set([wsSlug, ws?.slug, ws?.id].filter(Boolean)));
                  for (const k of targetKeys) {
                    if (localDB.removed_members?.[k]) {
                      localDB.removed_members[k] = localDB.removed_members[k].filter(
                        (x: string) => String(x).toLowerCase().trim() !== cleanAddr
                      );
                    }
                  }
                  try {
                    localStorage.setItem("plane_dapp_removed_members", JSON.stringify(localDB.removed_members));
                  } catch { }
                } else {
                  console.log(`[DApp Routes] Bỏ qua ví đã bị Admin xóa (removed_members): ${cleanAddr}`);
                  continue;
                }
              }

              // Verify on-chain role: Role.None (0) means removed or non-member
              // oxlint-disable-next-line no-await-in-loop -- Resolve and merge membership records in deterministic order.
              const onChainRole = await fetchMemberRoleOnChain(wsSlug, cleanAddr);
              if (onChainRole <= 0) {
                console.log(`[DApp Routes] Bỏ qua ví ${cleanAddr} vì on-chain role = ${onChainRole} (None)`);
                continue;
              }

              const existingIdx = localDB.workspace_members.findIndex(
                (m: any) =>
                  (m.workspace === wsSlug || m.workspace === ws?.id || m.workspace_id === wsSlug || m.workspace_id === ws?.id) &&
                  ((typeof m.member === "string" && m.member.toLowerCase() === cleanAddr) || m.wallet_address?.toLowerCase() === cleanAddr)
              );

              // 1. Match with an existing invitation for this workspace
              let matchedInv = (localDB.invitations || []).find(
                (inv: any) =>
                  (inv.workspace?.slug === wsSlug || inv.workspace_slug === wsSlug || inv.workspace === wsSlug || inv.workspace === ws?.id) &&
                  inv.wallet_address?.toLowerCase() === cleanAddr
              );
              // 1.1 Match via _email_wallet_map
              if (!matchedInv && localDB._email_wallet_map) {
                for (const [em, w] of Object.entries(localDB._email_wallet_map)) {
                  if (String(w).toLowerCase() === cleanAddr) {
                    matchedInv = (localDB.invitations || []).find(
                      (inv: any) =>
                        (inv.workspace?.slug === wsSlug || inv.workspace_slug === wsSlug || inv.workspace === wsSlug || inv.workspace === ws?.id) &&
                        (inv.email || "").toLowerCase().trim() === em.toLowerCase().trim()
                    );
                    if (matchedInv) break;
                  }
                }
              }
              // 1.2 Also check localStorage email-wallet map
              if (!matchedInv && typeof window !== "undefined") {
                try {
                  const rawMap = localStorage.getItem("plane_dapp_email_wallet_map");
                  if (rawMap) {
                    const parsed = JSON.parse(rawMap);
                    for (const [em, w] of Object.entries(parsed)) {
                      if (String(w).toLowerCase() === cleanAddr) {
                        matchedInv = (localDB.invitations || []).find(
                          (inv: any) =>
                            (inv.workspace?.slug === wsSlug || inv.workspace_slug === wsSlug || inv.workspace === wsSlug || inv.workspace === ws?.id) &&
                            (inv.email || "").toLowerCase().trim() === em.toLowerCase().trim()
                        );
                        if (matchedInv) break;
                      }
                    }
                  }
                } catch { }
              }
              if (!matchedInv) {
                // Fallback 1: match by registered user whose wallet matches cleanAddr
                const matchedUser = (localDB.users || []).find(
                  (u: any) =>
                    (u.metanode_wallet_address && u.metanode_wallet_address.toLowerCase() === cleanAddr) ||
                    (typeof u.id === "string" && u.id.toLowerCase() === cleanAddr)
                );
                if (matchedUser?.email) {
                  matchedInv = (localDB.invitations || []).find(
                    (inv: any) =>
                      (inv.workspace?.slug === wsSlug || inv.workspace_slug === wsSlug || inv.workspace === wsSlug || inv.workspace === ws?.id) &&
                      (inv.email || "").toLowerCase().trim() === matchedUser.email.toLowerCase().trim()
                  );
                }
              }
              if (!matchedInv && existingIdx >= 0) {
                const existMem = localDB.workspace_members[existingIdx];
                if (existMem.email && !existMem.email.endsWith("@metanode.chain")) {
                  matchedInv = (localDB.invitations || []).find(
                    (inv: any) =>
                      (inv.workspace?.slug === wsSlug || inv.workspace_slug === wsSlug || inv.workspace === wsSlug || inv.workspace === ws?.id) &&
                      (inv.email || "").toLowerCase().trim() === existMem.email.toLowerCase().trim()
                  );
                }
              }
              // NOTE: there used to be a "match any unaccepted invitation" fallback
              // here. It attached arbitrary on-chain wallets to whichever pending
              // invite happened to be first, producing phantom members and
              // unlocking a random user's invitation. Matching is now exact only.

              if (matchedInv) {
                const invMail = (matchedInv.email || "").toLowerCase().trim();
                const invId = String(matchedInv.id || "").toLowerCase().trim();
                const invWall = (matchedInv.wallet_address || "").toLowerCase().trim();
                if (removedSet.has(invMail) || removedSet.has(invId) || (invWall && removedSet.has(invWall))) {
                  console.log(`[DApp Routes] Bỏ qua matchedInv đã bị Admin xóa (removed_members): ${invMail || cleanAddr}`);
                  continue;
                }
                if (matchedInv.accepted !== true || matchedInv.wallet_address?.toLowerCase() !== cleanAddr || !matchedInv.responded_at) {
                  matchedInv.accepted = true;
                  matchedInv.wallet_address = cleanAddr;
                  matchedInv.responded_at = matchedInv.responded_at || new Date().toISOString();
                  matchedInv.updated_at = new Date().toISOString();
                }
              }

              const memberEmail = matchedInv?.email || `${cleanAddr.slice(0, 6)}...${cleanAddr.slice(-4)}@metanode.chain`;
              if (removedSet.has(cleanAddr) || removedSet.has(memberEmail.toLowerCase().trim())) {
                console.log(`[DApp Routes] Bỏ qua thành viên đã bị Admin xóa (removed_members): ${memberEmail} / ${cleanAddr}`);
                continue;
              }

              const namePart = memberEmail.includes("@") ? memberEmail.split("@")[0] : cleanAddr.slice(2, 8);
              const resolvedMemberId = `user-${namePart}`;

              if (existingIdx === -1) {
                localDB.workspace_members.push({
                  id: `ws-member-${cleanAddr.slice(2, 10)}`,
                  workspace: ws?.id || wsSlug,
                  workspace_id: ws?.id || wsSlug,
                  member: resolvedMemberId,
                  email: memberEmail,
                  wallet_address: cleanAddr,
                  role: onChainRole >= 2 ? 20 : 15,
                  on_chain_role: onChainRole,
                  is_active: true,
                  verified_on_chain: true,
                  created_at: new Date().toISOString(),
                });
              } else {
                localDB.workspace_members[existingIdx].wallet_address = cleanAddr;
                localDB.workspace_members[existingIdx].verified_on_chain = true;
                localDB.workspace_members[existingIdx].role = onChainRole >= 2 ? 20 : 15;
                localDB.workspace_members[existingIdx].on_chain_role = onChainRole;
                localDB.workspace_members[existingIdx].is_active = true;
                if (matchedInv?.email) {
                  localDB.workspace_members[existingIdx].email = matchedInv.email;
                  localDB.workspace_members[existingIdx].member = resolvedMemberId;
                }
              }

              // Also ensure a user record exists in localDB.users so the UI displays user name and avatar
              if (matchedInv?.email && !(localDB.users || []).some((u: any) => (u.email || "").toLowerCase().trim() === matchedInv.email.toLowerCase().trim())) {
                const newUser = createUserObject(resolvedMemberId, matchedInv.email);
                newUser.metanode_wallet_address = cleanAddr;
                if (!localDB.users) localDB.users = [];
                localDB.users.push(newUser);
              }

              // Update email-wallet map
              if (matchedInv?.email) {
                if (!localDB._email_wallet_map) localDB._email_wallet_map = {};
                localDB._email_wallet_map[matchedInv.email.toLowerCase().trim()] = cleanAddr;
                try {
                  const rawMap = JSON.parse(localStorage.getItem("plane_dapp_email_wallet_map") || "{}");
                  rawMap[matchedInv.email.toLowerCase().trim()] = cleanAddr;
                  localStorage.setItem("plane_dapp_email_wallet_map", JSON.stringify(rawMap));
                } catch { }
              }
            }
            if (beforeOnChainSync !== JSON.stringify(localDB)) {
              saveStoredInvitations(localDB.invitations);
              saveDB({ localOnly: true });
            }
          }
        } catch (chainErr) {
          console.warn("[DApp Invitations] Failed to sync on-chain members:", chainErr);
        }
      }

      // Auto-filter out invites for users who are already active workspace members
      const activeWsMemberMails = new Set<string>();
      const activeWsMemberWallets = new Set<string>();

      (localDB.workspace_members || []).forEach((m: any) => {
        const isTarget = (validWsKeys.size === 0 || validWsKeys.has(m.workspace) || validWsKeys.has(m.workspace_id));
        if (!isTarget || m.is_active === false) return;
        if (m.email) activeWsMemberMails.add(m.email.toLowerCase().trim());
        const u = (localDB.users || []).find((usr: any) => usr.id === m.member || usr.id === m.id);
        if (u?.email) activeWsMemberMails.add(u.email.toLowerCase().trim());
        if (u?.metanode_wallet_address) activeWsMemberWallets.add(u.metanode_wallet_address.toLowerCase().trim());
        const wAddr = (m.wallet_address || (typeof m.member === "string" && m.member.startsWith("0x") ? m.member : "")).toLowerCase().trim();
        if (wAddr) activeWsMemberWallets.add(wAddr);
      });
      for (const addr of syncedOnChainWallets) {
        if (addr) activeWsMemberWallets.add(String(addr).toLowerCase().trim());
      }

      // Fix corrupted old records that have `emails: [{ email, role }]` instead of top-level properties
      list = list.map((item: any) => {
        let fixed = { ...item };
        if (!fixed.email && fixed.emails && Array.isArray(fixed.emails) && fixed.emails.length > 0) {
          fixed = {
            ...fixed,
            email: fixed.emails[0].email,
            role: fixed.emails[0].role,
          };
        }
        if (!fixed.invite_link) {
          const itemWsSlug = fixed.workspace?.slug || fixed.workspace_slug || wsSlug || "workspace";
          const tok = fixed.token || fixed.id;
          fixed.invite_link = `/workspace-invitations?invitation_id=${fixed.id}&slug=${itemWsSlug}&token=${tok}`;
        }
        return fixed;
      });
      let hasInvUpdated = false;
      list = list.filter((item: any) => {
        if (!item.email) return false;
        const mail = item.email.toLowerCase().trim();
        const wallet = (item.wallet_address || "").toLowerCase().trim();
        const itemWsSlug = item.workspace?.slug || item.workspace_slug || item.workspace?.id || item.workspace || wsSlug;
        const itemRemovedSet = getWorkspaceRemovedSet(itemWsSlug);
        if (itemRemovedSet.has(mail) || (wallet && itemRemovedSet.has(wallet)) || itemRemovedSet.has(String(item.id || "").toLowerCase().trim())) return false;

        const mappedWallet = (
          localDB._email_wallet_map?.[mail] ||
          (typeof window !== "undefined"
            ? (JSON.parse(localStorage.getItem("plane_dapp_email_wallet_map") || "{}"))[mail]
            : "") ||
          ""
        ).toLowerCase().trim();

        const isConfirmedMember =
          item.accepted === true ||
          activeWsMemberMails.has(mail) ||
          (wallet && activeWsMemberWallets.has(wallet)) ||
          (mappedWallet && activeWsMemberWallets.has(mappedWallet));
        if (isConfirmedMember) {
          if (!item.accepted) {
            item.accepted = true;
            if (mappedWallet && !item.wallet_address) {
              item.wallet_address = mappedWallet;
            }
            item.responded_at = item.responded_at || new Date().toISOString();
            item.updated_at = new Date().toISOString();
            hasInvUpdated = true;
          }
          return false;
        }
        if (validWsKeys.size > 0) {
          return validWsKeys.has(itemWsSlug);
        }
        return true;
      });
      if (hasInvUpdated) {
        saveStoredInvitations(localDB.invitations);
        saveDB();
      }

      // Deduplicate pending invites per (workspace, email). Deduplicating on the
      // email alone hid the same person's invitation in another workspace.
      const seenPendingKeys = new Set<string>();
      list = list.filter((item: any) => {
        const mail = (item.email || "").toLowerCase().trim();
        const wsKey =
          item.workspace?.slug || item.workspace_slug || item.workspace?.id || item.workspace_id || item.workspace || "default";
        const key = `${String(wsKey).toLowerCase().trim()}::${mail}`;
        if (seenPendingKeys.has(key)) return false;
        seenPendingKeys.add(key);
        return true;
      });

      console.log(`[DApp Interceptor] Returning invitations:`, JSON.stringify(list));
    }

    // Enrich issues with project_id, workspace_id, and other _id fields (required by UI)
    if (collection === "issues") {
      const deletedIssueSet = new Set(localDB._deleted_issue_ids || []);
      list = list.filter((item: any) => !deletedIssueSet.has(item.id));
      list = list.map((item: any) => {
        const stateDetail =
          item.state_detail || (localDB.states || []).find((s: any) => s.id === (item.state_id || item.state));
        const projectDetail =
          item.project_detail || (localDB.projects || []).find((p: any) => p.id === (item.project_id || item.project));

        const children = (localDB.issues || []).filter((i: any) => i.parent_id === item.id || i.parent === item.id);

        return {
          ...item,
          created_at: item.created_at || item.created_on || new Date().toISOString(),
          updated_at: item.updated_at || item.updated_on || item.created_at || new Date().toISOString(),
          state: item.state_id || item.state,
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
          attachment_count:
            (localDB["attachments"] || []).filter((a: any) => a.issue === item.id || a.issue_id === item.id).length ||
            item.attachment_count ||
            0,
        };
      });

      const urlObj = new URL(url, "http://localhost");
      const subIssueParam = urlObj.searchParams.get("sub_issue");
      const shouldIncludeSubIssues =
        subIssueParam === "true" ||
        url.includes("search-issues") ||
        url.includes("all=true") ||
        !!id;

      if (!shouldIncludeSubIssues) {
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
    const orderByParam = urlObj.searchParams.get("order_by");
    if (orderByParam && collection === "issues") {
      const isDesc = orderByParam.startsWith("-");
      const sortKey = isDesc ? orderByParam.slice(1) : orderByParam;

      const priorityOrder: Record<string, number> = {
        urgent: 1,
        high: 2,
        medium: 3,
        low: 4,
        none: 5,
      };

      list.sort((a: any, b: any) => {
        let valA: any;
        let valB: any;

        if (sortKey === "sort_order") {
          valA = a.sort_order ?? 0;
          valB = b.sort_order ?? 0;
        } else if (sortKey === "created_at") {
          valA = new Date(a.created_at || a.created_on || 0).getTime();
          valB = new Date(b.created_at || b.created_on || 0).getTime();
        } else if (sortKey === "updated_at") {
          valA = new Date(a.updated_at || a.updated_on || a.created_at || 0).getTime();
          valB = new Date(b.updated_at || b.updated_on || b.created_at || 0).getTime();
        } else if (sortKey === "start_date") {
          valA = a.start_date ? new Date(a.start_date).getTime() : isDesc ? -Infinity : Infinity;
          valB = b.start_date ? new Date(b.start_date).getTime() : isDesc ? -Infinity : Infinity;
        } else if (sortKey === "target_date") {
          valA = a.target_date ? new Date(a.target_date).getTime() : isDesc ? -Infinity : Infinity;
          valB = b.target_date ? new Date(b.target_date).getTime() : isDesc ? -Infinity : Infinity;
        } else if (sortKey === "priority") {
          valA = priorityOrder[a.priority?.toLowerCase() || "none"] ?? 5;
          valB = priorityOrder[b.priority?.toLowerCase() || "none"] ?? 5;
        } else if (sortKey === "state__name") {
          valA = a.state_detail?.name || "";
          valB = b.state_detail?.name || "";
        } else {
          valA = a[sortKey] ?? "";
          valB = b[sortKey] ?? "";
        }

        if (valA < valB) return isDesc ? 1 : -1;
        if (valA > valB) return isDesc ? -1 : 1;
        return 0;
      });
    }

    const groupBy = urlObj.searchParams.get("group_by");

    if (groupBy && groupBy !== "null" && groupBy !== "undefined" && groupBy !== "") {
      const projId = id || url.match(/\/projects\/([^/]+)\//)?.[1];
      const groupedResults: Record<string, any> = {};

      const canonicalGroupBy =
        groupBy === "state_id" || groupBy === "state"
          ? "state"
          : groupBy === "labels__id" || groupBy === "labels"
            ? "labels"
            : groupBy === "assignees__id" || groupBy === "assignees"
              ? "assignees"
              : groupBy === "state__group" || groupBy === "state_detail.group"
                ? "state_detail.group"
                : groupBy === "cycle_id" || groupBy === "cycle"
                  ? "cycle"
                  : groupBy === "issue_module__module_id" || groupBy === "module"
                    ? "module"
                    : groupBy;

      const ensureGroup = (key: string) => {
        if (!groupedResults[key]) {
          groupedResults[key] = { results: [], total_results: 0 };
        }
      };

      const targetProjForGroup = (localDB.projects || []).find(
        (p: any) => p.id === projId || (projId && p.identifier && p.identifier.toLowerCase() === projId.toLowerCase())
      );
      const matchingProjIdsForGroup = new Set(
        [projId, targetProjForGroup?.id, targetProjForGroup?.identifier].filter(Boolean)
      );
      const projectStatesForGroup = (localDB.states || []).filter(
        (s: any) => matchingProjIdsForGroup.has(s.project) || matchingProjIdsForGroup.has(s.project_id)
      );

      // Pre-initialize groups so empty groups work and show_empty_groups can render
      if (canonicalGroupBy === "state" && collection === "issues") {
        projectStatesForGroup.forEach((s: any) => ensureGroup(s.id));
        ensureGroup("None");
      } else if (canonicalGroupBy === "priority") {
        ["urgent", "high", "medium", "low", "none"].forEach((p) => ensureGroup(p));
      } else if (canonicalGroupBy === "labels") {
        const labels = (localDB.labels || []).filter(
          (l: any) => matchingProjIdsForGroup.has(l.project) || matchingProjIdsForGroup.has(l.project_id)
        );
        labels.forEach((l: any) => ensureGroup(l.id));
        ensureGroup("None");
      } else if (canonicalGroupBy === "state_detail.group") {
        ["backlog", "unstarted", "started", "completed", "cancelled"].forEach((g) => ensureGroup(g));
      } else if (canonicalGroupBy === "assignees") {
        ensureGroup("None");
      } else if (canonicalGroupBy === "created_by") {
        ensureGroup("None");
      }

      list.forEach((item: any) => {
        if (canonicalGroupBy === "state") {
          let key = item.state_id || item.state;
          const matchingState = projectStatesForGroup.find((s: any) => s.id === key);
          if (!matchingState && projectStatesForGroup.length > 0) {
            const defaultState = projectStatesForGroup.find((s: any) => s.default) || projectStatesForGroup[0];
            key = defaultState.id;
            item.state_id = key;
            item.state = key;
            item.state_detail = defaultState;
          }
          if (!key) key = "None";
          ensureGroup(key);
          groupedResults[key].results.push(item);
          groupedResults[key].total_results++;
        } else if (canonicalGroupBy === "priority") {
          const key = (item.priority || "none").toLowerCase();
          ensureGroup(key);
          groupedResults[key].results.push(item);
          groupedResults[key].total_results++;
        } else if (canonicalGroupBy === "labels") {
          const rawLabels = item.labels || item.label_ids || [];
          const labelIds = (Array.isArray(rawLabels) ? rawLabels : [rawLabels])
            .map((l: any) => (typeof l === "object" && l ? l.id : l))
            .filter(Boolean);
          if (labelIds.length === 0) {
            ensureGroup("None");
            groupedResults["None"].results.push(item);
            groupedResults["None"].total_results++;
          } else {
            labelIds.forEach((lblId: string) => {
              ensureGroup(lblId);
              groupedResults[lblId].results.push(item);
              groupedResults[lblId].total_results++;
            });
          }
        } else if (canonicalGroupBy === "assignees") {
          const rawAssignees = item.assignees || item.assignee_ids || [];
          const assigneeIds = (Array.isArray(rawAssignees) ? rawAssignees : [rawAssignees])
            .map((u: any) => (typeof u === "object" && u ? u.id : u))
            .filter(Boolean);
          if (assigneeIds.length === 0) {
            ensureGroup("None");
            groupedResults["None"].results.push(item);
            groupedResults["None"].total_results++;
          } else {
            assigneeIds.forEach((uId: string) => {
              ensureGroup(uId);
              groupedResults[uId].results.push(item);
              groupedResults[uId].total_results++;
            });
          }
        } else if (canonicalGroupBy === "created_by") {
          const key = item.created_by || "None";
          ensureGroup(key);
          groupedResults[key].results.push(item);
          groupedResults[key].total_results++;
        } else if (canonicalGroupBy === "state_detail.group") {
          const key = item.state_detail?.group || item.state_group || "backlog";
          ensureGroup(key);
          groupedResults[key].results.push(item);
          groupedResults[key].total_results++;
        } else if (canonicalGroupBy === "target_date") {
          const key = item.target_date ? item.target_date.split("T")[0] : "None";
          ensureGroup(key);
          groupedResults[key].results.push(item);
          groupedResults[key].total_results++;
        } else {
          const key = item[canonicalGroupBy] || "None";
          ensureGroup(key);
          groupedResults[key].results.push(item);
          groupedResults[key].total_results++;
        }
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

    if (["cycles", "modules", "views", "pages"].includes(collection)) {
      const match = url.match(/\/projects\/([^/]+)\//);
      const projId = match ? match[1] : undefined;
      const targetProj = projId
        ? (localDB.projects || []).find((p: any) => p.id === projId || (p.identifier && p.identifier.toLowerCase() === projId.toLowerCase()))
        : null;
      const canonicalProjId = targetProj?.id || projId;
      const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
      const wsSlug = wsMatch ? wsMatch[1] : undefined;
      const ws = wsSlug ? (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug) : null;
      const canonicalWsId = ws?.id || wsSlug;
      list = list.map((item: any) => enrichProjectEntity(collection, item, canonicalProjId, canonicalWsId));
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
    const activeUserId = getLoggedInUserId();
    const activeUser = (localDB.users || []).find((u: any) => u.id === activeUserId);
    if (collection === "invitations" && body.emails && Array.isArray(body.emails)) {
      const match = url.match(/\/api\/workspaces\/([^/]+)\//);
      const wsSlug = match ? match[1] : (localDB.workspaces?.[0]?.slug || "fiai");
      const currentWs = findLocalWorkspace(wsSlug);

      if (!currentWs) return { status: 404, data: { error: "Không tìm thấy không gian làm việc." } };
      if (!body.emails.length || body.emails.some((entry: any) => !entry || typeof entry.email !== "string" || !(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.email.trim()) || /^0x[a-f0-9]{40}$/i.test(entry.email.trim())) || ![15, 20].includes(Number(entry.role ?? 15)))) {
        return { status: 400, data: { error: "Email, địa chỉ ví hoặc quyền trong danh sách mời không hợp lệ." } };
      }
      if (body.emails.some((entry: any) => entry.wallet_address && (typeof entry.wallet_address !== "string" || !/^0x[a-f0-9]{40}$/i.test(entry.wallet_address.trim()) || /^0x0{40}$/i.test(entry.wallet_address.trim())))) return { status: 400, data: { error: "Ví người nhận không hợp lệ." } };
      body = { ...body, emails: Array.from(new Map(body.emails.map((entry: any) => [entry.email.trim().toLowerCase(), { email: entry.email.trim().toLowerCase(), role: Number(entry.role ?? 15), wallet_address: entry.wallet_address?.trim().toLowerCase() || extractEthAddress(entry.email) || "" }])).values()) };

      if (!localDB[collection]) localDB[collection] = [];
      const newInvites: any[] = [];

      for (const e of body.emails) {
        const rawEmail = (e.email || "").toLowerCase().trim();
        if (!rawEmail) continue;

        // If previously removed, un-remove so the new invitation can be accepted
        const keysToClean = Array.from(new Set([wsSlug, currentWs?.id, currentWs?.slug].filter(Boolean))) as string[];
        const knownWallets = (localDB.workspace_members || [])
          .concat(localDB.users || [])
          .concat(localDB.invitations || [])
          .concat(getStoredInvitations() || [])
          .filter((m: any) => (m.email || "").toLowerCase().trim() === rawEmail)
          .map((m: any) => extractEthAddress(m.wallet_address || m.member || m.metanode_wallet_address))
          .filter(Boolean)
          .map((a: string) => a.toLowerCase());

        try {
          const rawMap = localStorage.getItem("plane_dapp_email_wallet_map");
          if (rawMap) {
            const parsed = JSON.parse(rawMap);
            if (parsed[rawEmail]) knownWallets.push(String(parsed[rawEmail]).toLowerCase());
          }
        } catch { }
        if (localDB._email_wallet_map?.[rawEmail]) {
          knownWallets.push(String(localDB._email_wallet_map[rawEmail]).toLowerCase());
        }

        keysToClean.forEach((k) => {
          if (localDB.removed_members?.[k]) {
            localDB.removed_members[k] = localDB.removed_members[k].filter((r: string) => {
              const cleanR = r.toLowerCase().trim();
              return cleanR !== rawEmail && !knownWallets.includes(cleanR);
            });
          }
        });
        try {
          localStorage.setItem("plane_dapp_removed_members", JSON.stringify(localDB.removed_members));
        } catch { }
        try {
          const rawDel = localStorage.getItem("plane_dapp_deleted_invitations");
          if (rawDel) {
            const delList = JSON.parse(rawDel);
            if (Array.isArray(delList)) {
              // Only clear tombstones that belong to THIS workspace + this exact
              // email. The previous `d.includes(rawEmail)` also wiped scoped
              // tombstones of other workspaces (RC-6).
              const scopedKeys = new Set<string>();
              keysToClean.forEach((k) => {
                const scoped = makeInvitationTombstoneKey(k, rawEmail);
                if (scoped) scopedKeys.add(scoped);
                scopedKeys.add(`inv-${k}-${rawEmail}`);
              });
              const filtered = delList.filter(
                (d: string) => d !== rawEmail && !scopedKeys.has(String(d).toLowerCase().trim())
              );
              localStorage.setItem("plane_dapp_deleted_invitations", JSON.stringify(filtered));
            }
          }
        } catch { }
        if (localDB._deleted_invitation_ids && Array.isArray(localDB._deleted_invitation_ids)) {
          const scopedKeys = new Set<string>([rawEmail]);
          keysToClean.forEach((k) => {
            const scoped = makeInvitationTombstoneKey(k, rawEmail);
            if (scoped) scopedKeys.add(scoped);
            scopedKeys.add(`inv-${k}-${rawEmail}`);
          });
          localDB._deleted_invitation_ids = localDB._deleted_invitation_ids.filter(
            (d: string) => !scopedKeys.has(String(d).toLowerCase().trim())
          );
        }

        const existingInv = localDB[collection].find(
          (inv: any) =>
            (inv.email || "").toLowerCase().trim() === rawEmail &&
            !inv.accepted &&
            !isInvitationDeleted(inv, readInvitationTombstones()) &&
            (inv.workspace_slug === wsSlug || inv.workspace?.slug === wsSlug || inv.workspace_id === currentWs?.id || inv.workspace?.id === currentWs?.id)
        );

        if (existingInv) {
          existingInv.workspace = { id: currentWs.id, slug: currentWs.slug || wsSlug, name: currentWs.name, logo_url: currentWs.logo_url || "" };
          existingInv.workspace_id = currentWs.id;
          existingInv.workspace_slug = currentWs.slug || wsSlug;
          existingInv.role = e.role || existingInv.role || 15;
          existingInv.updated_at = new Date().toISOString();
          // First wallet approval keeps the original email link usable. Role
          // changes, wallet replacement and explicit reissues rotate the token.
          if (preserveInvitationId !== existingInv.id) existingInv.token = createInvitationToken();
          existingInv.token_version = 2;
          existingInv.status = "pending";
          existingInv.responded_at = null;
          existingInv.publication_status = "pending";
          existingInv.wallet_address = e.wallet_address || existingInv.wallet_address || "";
          if (preserveInvitationId !== existingInv.id)
            existingInv.token_expires_at = new Date(Date.now() + INVITE_TOKEN_TTL_MS).toISOString();
          existingInv.invite_link = invitationLink(wsSlug, existingInv.id, existingInv.token);
          newInvites.push(existingInv);
          console.log(`[DApp Interceptor] Updated existing pending invite for ${rawEmail} (${existingInv.id})`);
        } else {
          const invId = crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11);
          const token = createInvitationToken();
          const createdInv = {
            id: invId,
            token_version: 2,
            status: "pending",
            publication_status: "pending",
            wallet_address: e.wallet_address || "",
            token: token,
            token_expires_at: new Date(Date.now() + INVITE_TOKEN_TTL_MS).toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            email: e.email,
            role: e.role || 15,
            accepted: false,
            responded_at: null,
            message: "You have been invited.",
            invite_link: invitationLink(wsSlug, invId, token),
            workspace: {
              id: currentWs?.id || wsSlug,
              name: currentWs?.name || wsSlug,
              slug: wsSlug,
              logo_url: currentWs?.logo_url || "",
            },
            workspace_id: currentWs?.id || wsSlug,
            workspace_slug: wsSlug,
          };
          localDB[collection].push(createdInv);
          newInvites.push(createdInv);
          console.log(`[DApp Interceptor] Created new invite for ${rawEmail} (${invId})`);
        }
      }
      saveStoredInvitations(localDB[collection]);

      if (!localDB.notifications) localDB.notifications = [];
      const invWsId = currentWs?.id || wsSlug;
      body.emails.forEach((e: any) => {
        const rawMail = (e.email || "").toLowerCase().trim();
        const matchingInv = newInvites.find((inv: any) => (inv.email || "").toLowerCase().trim() === rawMail);
        const invId = matchingInv?.id || `inv-${Date.now()}`;
        const inviteLink = matchingInv?.invite_link || `/workspace-invitations?invitation_id=${invId}&slug=${wsSlug}&token=${matchingInv?.token || invId}`;

        localDB.notifications.push({
          id: `notif-inv-${invId}`,
          workspace: invWsId,
          workspace_id: invWsId,
          workspace_slug: wsSlug,
          title: "Workspace Invitation",
          message: `You have been invited to join workspace "${currentWs?.name || wsSlug}"`,
          entity_name: "workspace_invitation",
          entity_identifier: invId,
          sender: activeUserId || "admin",
          receiver: rawMail,
          recipient_email: rawMail,
          recipient: rawMail,
          triggered_by: activeUserId || "admin",
          triggered_by_details: {
            id: activeUser?.id || activeUserId || "admin",
            first_name: activeUser?.first_name || "Workspace",
            last_name: activeUser?.last_name || "Admin",
            display_name: activeUser?.display_name || activeUser?.first_name || "Workspace Admin",
            avatar_url: activeUser?.avatar_url || "",
            is_bot: false,
          },
          data: {
            workspace_name: currentWs?.name || wsSlug,
            workspace_slug: wsSlug,
            role: e.role || 15,
            invitation_id: invId,
            invite_link: inviteLink,
          },
          read_at: null,
          archived_at: null,
          snoozed_till: null,
          is_inbox_issue: false,
          is_mentioned_notification: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      });

      // Per-invitee on-chain provisioning: awaited so the caller receives the
      // real outcome instead of an unconditional success (RC-4). Only wallet
      // invitations can be provisioned on-chain; email invitees join by link.
      const chainErrors: { email: string; error: string }[] = [];
      for (const inv of newInvites) {
        const memberAddress = extractEthAddress(inv.wallet_address || inv.email);
        if (!memberAddress) {
          inv.wallet_approval_required = true;
          chainErrors.push({ email: inv.email, error: "Đang chờ quản trị viên xác nhận ví người nhận; lời mời chưa cấp quyền tham gia." });
          continue;
        }
        try {
          // oxlint-disable-next-line no-await-in-loop -- Serialize recipient authorization, transactions and delivery outcomes.
          const signer = await assertVaultSigningAddress(getStoredWalletAddress() || currentUserAddress);
          // oxlint-disable-next-line no-await-in-loop -- Serialize recipient authorization, transactions and delivery outcomes.
          await writeWorkspaceWalletInvitation(wsSlug, memberAddress, Number(inv.role), Math.floor(Date.parse(inv.token_expires_at) / 1000), signer);
          inv.wallet_approval_required = false;
          inv.chain_approval_failed = false;
        } catch (error) {
          inv.chain_approval_failed = true;
          chainErrors.push({ email: inv.email, error: error instanceof Error ? error.message : String(error) });
        }
      }

      saveDB();
      newInvites.forEach((inv) => syncDAppRecord(collection, inv.id, inv));
      // The recipient must be able to resolve the record before receiving mail.
      const publishedCid = await uploadToIPFS(true);
      let published = false;
      if (publishedCid) published = await commitWorkspaceCID(wsSlug, publishedCid, { force: true });
      if (!published) return { status: 503, data: { code: "INVITATION_PUBLICATION_PENDING", error: "Đã lưu lời mời trên máy nhưng chưa công bố được. Chưa gửi email; hãy thử lại sau khi xác nhận ví và kết nối lưu trữ.", invitations: newInvites, email_sent_count: 0, chain_failures: chainErrors } };
      newInvites.forEach((inv) => { inv.publication_status = "published"; inv.published_cid = publishedCid; });
      saveStoredInvitations(localDB[collection]);
      saveDB();

      // Wallet approval is not a second email delivery. The recipient can
      // refresh the original link once the chain and shared snapshot confirm it.
      if (preserveInvitationId) {
        if (chainErrors.length) return { status: 503, data: { code: "WALLET_APPROVAL_PENDING", error: chainErrors[0].error } };
        return ok({ invitations: newInvites });
      }

      // Send invitation emails and report the REAL delivery result back to the
      // admin. Previously this was fire-and-forget, so the UI always claimed
      // success even when no email was sent (RC-1).
      const mailFailed: { email: string; error: string }[] = [];
      let mailSent = 0;
      for (const e of body.emails) {
        const rawEmail = (e.email || "").toLowerCase().trim();
        if (!rawEmail || !rawEmail.includes("@")) continue;
        // Wallet-style invitees have no mailbox to deliver to.
        if (extractEthAddress(rawEmail)) continue;

        const inv = newInvites.find((i: any) => (i.email || "").toLowerCase().trim() === rawEmail);
        if (inv?.chain_approval_failed) {
          mailFailed.push({ email: rawEmail, error: "Chưa gửi email vì quyền nhận lời mời chưa được xác nhận." });
          continue;
        }
        const inviteLink =
          inv?.invite_link ||
          `/workspace-invitations?invitation_id=${inv?.id || "inv"}&slug=${wsSlug}&token=${inv?.token || "tok"}`;

        try {
          // oxlint-disable-next-line no-await-in-loop -- Serialize recipient authorization, transactions and delivery outcomes.
          const delivered = await sendWorkspaceInviteEmail({
            recipientEmail: rawEmail,
            workspaceName: currentWs?.name || wsSlug,
            workspaceSlug: wsSlug,
            inviteLink: inviteLink,
            role: e.role || inv?.role || 15,
            inviterName:
              activeUser?.display_name ||
              activeUser?.first_name ||
              currentWs?.name ||
              "Plane Workspace",
          });
          if (delivered) {
            mailSent += 1;
          } else {
            mailFailed.push({ email: rawEmail, error: "Email service is not configured or refused the message." });
          }
        } catch (mailErr: any) {
          const message = String(mailErr?.message || mailErr || "Unknown error");
          console.warn("[DApp Interceptor] Lỗi khi gửi email mời workspace qua Brevo:", mailErr);
          mailFailed.push({ email: rawEmail, error: message });
        }
      }

      const invitationsCreated = newInvites.length;
      return ok({
        message:
          mailFailed.length === 0 && chainErrors.length === 0
            ? "Invitations sent successfully"
            : "Invitations created with warnings",
        invitations: newInvites,
        created_count: invitationsCreated,
        email_sent_count: mailSent,
        email_failures: mailFailed,
        chain_failures: chainErrors,
      });
    }

    if (collection === "invitations") return { status: 400, data: { error: "Vui lòng tạo lời mời bằng danh sách người nhận hợp lệ." } };

    let newRecord: any = {
      id: body.id || crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...body,
    };

    if (collection === "blockchain-transactions") {
      newRecord.recorded_at = new Date().toISOString();
      if (newRecord.event_type === "assign_task" && !newRecord.assignee_name && newRecord.assignee_id) {
        const assignee = localDB.users?.find((usr: any) => usr.id === newRecord.assignee_id);
        newRecord.assignee_name = assignee?.display_name || assignee?.first_name || newRecord.assignee_id;
      }
      if (
        (newRecord.event_type === "daily_report" || newRecord.event_type === "task_content") &&
        !newRecord.reporter_name
      ) {
        newRecord.reporter_id = activeUserId;
        newRecord.reporter_name = activeUser?.display_name || activeUser?.first_name || activeUserId;
      }

      // Generate in-app notifications for daily reports and task assignments
      if (!localDB.notifications) localDB.notifications = [];
      const wsMatch = url.match(/\/api\/workspaces\/([^/]+)\//);
      const wsSlug = wsMatch ? wsMatch[1] : (localDB.workspaces?.[0]?.slug || "fiai");
      const currentWs = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
      const canonicalWsId = currentWs?.id || wsSlug;

      const projMatch = url.match(/\/projects\/([^/]+)\//);
      const projId = projMatch ? projMatch[1] : (newRecord.project || newRecord.project_id);
      const targetProj = (localDB.projects || []).find((p: any) => p.id === projId || (p.identifier && p.identifier.toLowerCase() === String(projId).toLowerCase()));
      const targetProjId = targetProj?.id || projId || "default-proj";
      const targetIssue = (localDB.issues || []).find((i: any) => i.id === newRecord.issue_id);

      newRecord.project = targetProjId;
      newRecord.project_id = targetProjId;
      newRecord.workspace = canonicalWsId;
      newRecord.workspace_id = canonicalWsId;
      newRecord.workspace_slug = wsSlug;
      if (!newRecord.issue_name && targetIssue?.name) {
        newRecord.issue_name = targetIssue.name;
      }

      const reporterUserObj = activeUser || (localDB.users || []).find((u: any) => u.id === newRecord.reporter_id) || {
        id: newRecord.reporter_id || activeUserId || "user-1",
        first_name: newRecord.reporter_name || "Thành viên",
        last_name: "",
        display_name: newRecord.reporter_name || "Thành viên",
        avatar_url: "",
        is_bot: false,
      };

      if (newRecord.event_type === "daily_report") {
        const repKey = newRecord.transaction_hash || newRecord.id || newRecord.client_event_id || `${Date.now()}`;
        const notifId = `notif-rep-${repKey}`;
        const alreadyExists = (localDB.notifications || []).some(
          (n: any) =>
            n.id === notifId ||
            n.data?.transaction_id === repKey ||
            (newRecord.transaction_hash && n.data?.transaction_hash === newRecord.transaction_hash) ||
            (newRecord.id && n.data?.transaction_id === newRecord.id)
        );
        if (!alreadyExists) {
          localDB.notifications.unshift({
            id: notifId,
            workspace: canonicalWsId,
            workspace_id: canonicalWsId,
            workspace_slug: wsSlug,
            project: targetProjId,
            project_id: targetProjId,
            entity_identifier: targetIssue?.id || newRecord.issue_id,
            entity_name: "issue",
            title: `Báo cáo tiến độ: ${targetIssue?.name || newRecord.issue_name || "Công việc"}`,
            message: newRecord.work || `Đã cập nhật tiến độ ${newRecord.progress || 0}%`,
            sender: reporterUserObj.id,
            receiver: "all",
            recipient_email: "all",
            recipient: "all",
            triggered_by: reporterUserObj.id,
            triggered_by_details: {
              id: reporterUserObj.id,
              first_name: reporterUserObj.first_name || newRecord.reporter_name || "Thành viên",
              last_name: reporterUserObj.last_name || "",
              display_name: reporterUserObj.display_name || newRecord.reporter_name || reporterUserObj.first_name || "Thành viên",
              avatar_url: reporterUserObj.avatar_url || "",
              is_bot: false,
            },
            data: {
              transaction_id: repKey,
              transaction_hash: newRecord.transaction_hash || "",
              client_event_id: newRecord.client_event_id || "",
              issue: {
                id: targetIssue?.id || newRecord.issue_id,
                sequence_id: targetIssue?.sequence_id || 1,
                identifier: targetProj?.identifier || "TASK",
                name: targetIssue?.name || newRecord.issue_name || "Công việc",
                state_name: targetIssue?.state_detail?.name || "In Progress",
                state_group: targetIssue?.state_detail?.group || "started",
              },
              issue_activity: {
                id: `act-${repKey}`,
                actor: reporterUserObj.id,
                field: "daily_report",
                issue_comment: newRecord.evidence || "",
                verb: "created",
                new_value: `${newRecord.progress ?? 0}% - ${newRecord.work || "Báo cáo công việc"}`,
                old_value: newRecord.difficulty ? `Độ khó: ${newRecord.difficulty}` : "",
              },
            },
            read_at: null,
            archived_at: null,
            snoozed_till: null,
            is_inbox_issue: false,
            is_mentioned_notification: false,
            created_at: newRecord.recorded_at || new Date().toISOString(),
            updated_at: newRecord.recorded_at || new Date().toISOString(),
            created_by: reporterUserObj.id,
          });
        }
      } else if (newRecord.event_type === "assign_task") {
        const notifId = `notif-assign-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        localDB.notifications.unshift({
          id: notifId,
          workspace: canonicalWsId,
          workspace_id: canonicalWsId,
          workspace_slug: wsSlug,
          project: targetProjId,
          project_id: targetProjId,
          entity_identifier: targetIssue?.id || newRecord.issue_id,
          entity_name: "issue",
          title: `Giao việc: ${targetIssue?.name || newRecord.issue_name || "Công việc"}`,
          message: `Đã giao công việc cho ${newRecord.assignee_name || "bạn"}`,
          sender: reporterUserObj.id,
          receiver: newRecord.assignee_id || "all",
          recipient_email: newRecord.assignee_id || "all",
          recipient: newRecord.assignee_id || "all",
          triggered_by: reporterUserObj.id,
          triggered_by_details: {
            id: reporterUserObj.id,
            first_name: reporterUserObj.first_name || "Quản trị",
            last_name: reporterUserObj.last_name || "",
            display_name: reporterUserObj.display_name || reporterUserObj.first_name || "Quản trị",
            avatar_url: reporterUserObj.avatar_url || "",
            is_bot: false,
          },
          data: {
            issue: {
              id: targetIssue?.id || newRecord.issue_id,
              sequence_id: targetIssue?.sequence_id || 1,
              identifier: targetProj?.identifier || "TASK",
              name: targetIssue?.name || newRecord.issue_name || "Công việc",
              state_name: targetIssue?.state_detail?.name || "Assigned",
              state_group: targetIssue?.state_detail?.group || "unstarted",
            },
            issue_activity: {
              id: `act-${Date.now()}`,
              actor: reporterUserObj.id,
              field: "assignees",
              issue_comment: "",
              verb: "created",
              new_value: newRecord.assignee_name || "bạn",
              old_value: "",
            },
          },
          read_at: null,
          archived_at: null,
          snoozed_till: null,
          is_inbox_issue: false,
          is_mentioned_notification: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: reporterUserObj.id,
        });
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
    if (collection === "workspaces") {
      newRecord.total_members = 1;
    }
    if (collection === "projects") {
      if (localDB._deleted_project_ids && Array.isArray(localDB._deleted_project_ids)) {
        localDB._deleted_project_ids = localDB._deleted_project_ids.filter(
          (dId: string) => dId !== newRecord.id && dId !== newRecord.identifier
        );
      }
      const match = url.match(/\/api\/workspaces\/([^/]+)\//);
      const wsSlug = match ? match[1] : (localDB.workspaces?.[0]?.slug || "fiai");
      const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);

      const activeCreatorId = activeUser?.id || activeUserId || "user-default";
      const activeCreatorEmail = (activeUser?.email || getLoggedInEmail() || "").toLowerCase().trim();
      const creatorUserObj = activeUser || (localDB.users || []).find((u: any) => u.id === activeCreatorId) || (localDB.users || [])[0];

      newRecord.workspace = ws?.id || wsSlug;
      newRecord.workspace_detail = ws || { id: newRecord.workspace, slug: wsSlug, name: wsSlug.toUpperCase() };
      newRecord.created_by = activeCreatorId;
      newRecord.owner = creatorUserObj;
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

      if (!localDB.project_members) localDB.project_members = [];
      const existingPmIdx = localDB.project_members.findIndex(
        (pm: any) =>
          (pm.project === newRecord.id || pm.project_id === newRecord.id) &&
          (pm.member === activeCreatorId || (activeCreatorEmail && (pm.email || "").toLowerCase().trim() === activeCreatorEmail))
      );
      if (existingPmIdx === -1) {
        localDB.project_members.push({
          id: `pm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          project: newRecord.id,
          project_id: newRecord.id,
          member: activeCreatorId,
          email: activeCreatorEmail,
          role: 20,
          created_at: new Date().toISOString(),
        });
      }
      void uploadToIPFS(true);
    }
    if (collection === "issues") {
      if (localDB._deleted_issue_ids && Array.isArray(localDB._deleted_issue_ids)) {
        localDB._deleted_issue_ids = localDB._deleted_issue_ids.filter(
          (dId: string) => dId !== newRecord.id
        );
      }
      // Find the project ID from the URL: /api/workspaces/.../projects/:projectId/issues/
      const match = url.match(/\/projects\/([^/]+)\//);
      if (match) {
        const projId = match[1];
        const project = (localDB.projects || []).find(
          (p: any) => p.id === projId || (p.identifier && p.identifier.toLowerCase() === projId.toLowerCase())
        );
        const canonicalProjId = project?.id || projId;
        newRecord.project = canonicalProjId;
        newRecord.project_id = canonicalProjId;
        if (project) {
          newRecord.project_detail = project;
        }

        const validProjKeys = new Set([projId, project?.id, project?.identifier].filter(Boolean));
        // Auto-increment sequence_id for the project
        const projectIssues = (localDB.issues || []).filter(
          (i: any) => validProjKeys.has(i.project) || validProjKeys.has(i.project_id)
        );
        const maxSeq = projectIssues.reduce((max: number, issue: any) => Math.max(max, issue.sequence_id || 0), 0);
        newRecord.sequence_id = maxSeq + 1;

        // Ensure state_id belongs to this project
        const projStates = (localDB.states || []).filter(
          (s: any) => validProjKeys.has(s.project) || validProjKeys.has(s.project_id)
        );
        const stateMatches = projStates.find(
          (s: any) => s.id === (newRecord.state_id || newRecord.state)
        );
        if (!stateMatches && projStates.length > 0) {
          const defaultState = projStates.find((s: any) => s.default) || projStates[0];
          newRecord.state_id = defaultState.id;
          newRecord.state = defaultState.id;
          newRecord.state_detail = defaultState;
        } else if (stateMatches) {
          newRecord.state_id = stateMatches.id;
          newRecord.state = stateMatches.id;
          newRecord.state_detail = stateMatches;
        }
      }

      // D-B: reject assignees that are not members of this project.
      const requestedAssignees = Array.isArray(newRecord.assignees)
        ? newRecord.assignees
        : newRecord.assignee_ids || [];
      if (Array.isArray(requestedAssignees) && requestedAssignees.length > 0) {
        const targetProjectId = newRecord.project_id || newRecord.project;
        const invalidAssignees = findNonProjectAssignees(targetProjectId, requestedAssignees);
        if (invalidAssignees.length > 0) {
          return {
            data: buildAssigneeValidationError(String(targetProjectId || ""), invalidAssignees),
            status: 400,
          };
        }
      }

      if (newRecord.parent_id === "" || newRecord.parent_id === "null" || newRecord.parent_id === "undefined") {
        newRecord.parent_id = null;
      }
      if (newRecord.parent === "" || newRecord.parent === "null" || newRecord.parent === "undefined") {
        newRecord.parent = null;
      }
      if (newRecord.cycle_id === "" || newRecord.cycle_id === "null" || newRecord.cycle_id === "undefined") {
        newRecord.cycle_id = null;
      }
      if (!Array.isArray(newRecord.module_ids)) {
        newRecord.module_ids = [];
      }
    }

    if (collection === "labels") {
      const match = url.match(/\/projects\/([^/]+)\//);
      if (match) {
        const projId = match[1];
        const project = (localDB.projects || []).find(
          (p: any) => p.id === projId || (p.identifier && p.identifier.toLowerCase() === projId.toLowerCase())
        );
        const canonicalProjId = project?.id || projId;
        newRecord.project = canonicalProjId;
        newRecord.project_id = canonicalProjId;
      }
      const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
      if (wsMatch) {
        const wsSlug = wsMatch[1];
        const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
        newRecord.workspace = ws?.id || wsSlug;
        newRecord.workspace_id = ws?.id || wsSlug;
      }
      if (!newRecord.color) newRecord.color = "#3f3f46";
      newRecord.parent = newRecord.parent || null;
      if (newRecord.sort_order === undefined) {
        const projLabels = (localDB.labels || []).filter(
          (l: any) => l.project === newRecord.project || l.project_id === newRecord.project_id
        );
        newRecord.sort_order = projLabels.length * 10000 + 10000;
      }
    }

    if (collection === "states") {
      const match = url.match(/\/projects\/([^/]+)\//);
      if (match) {
        const projId = match[1];
        const project = (localDB.projects || []).find(
          (p: any) => p.id === projId || (p.identifier && p.identifier.toLowerCase() === projId.toLowerCase())
        );
        const canonicalProjId = project?.id || projId;
        newRecord.project = canonicalProjId;
        newRecord.project_id = canonicalProjId;
      }
      const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
      if (wsMatch) {
        const wsSlug = wsMatch[1];
        const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
        newRecord.workspace = ws?.id || wsSlug;
        newRecord.workspace_id = ws?.id || wsSlug;
      }
      if (!newRecord.color) newRecord.color = "#3f3f46";
      if (newRecord.default === undefined) newRecord.default = false;
      if (newRecord.sequence === undefined) {
        const projStates = (localDB.states || []).filter(
          (s: any) =>
            (s.project === newRecord.project || s.project_id === newRecord.project_id) &&
            s.group === newRecord.group
        );
        const maxSeq = projStates.reduce((max: number, s: any) => Math.max(max, s.sequence || 0), 0);
        newRecord.sequence = maxSeq > 0 ? maxSeq + 10000 : 15000;
      }
    }

    if (["cycles", "modules", "views", "pages"].includes(collection)) {
      let canonicalProjId = "";
      const match = url.match(/\/projects\/([^/]+)\//);
      if (match) {
        const projId = match[1];
        const project = (localDB.projects || []).find(
          (p: any) => p.id === projId || (p.identifier && p.identifier.toLowerCase() === projId.toLowerCase())
        );
        canonicalProjId = project?.id || projId;
        newRecord.project = canonicalProjId;
        newRecord.project_id = canonicalProjId;
        if (project) {
          newRecord.project_detail = project;
        }
      }
      let canonicalWsId = "";
      const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
      if (wsMatch) {
        const wsSlug = wsMatch[1];
        const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
        canonicalWsId = ws?.id || wsSlug;
        newRecord.workspace = canonicalWsId;
        newRecord.workspace_id = canonicalWsId;
        if (ws) {
          newRecord.workspace_detail = ws;
        }
      }
      newRecord.owned_by = newRecord.owned_by || activeUserId || "user-1";
      newRecord.created_by = newRecord.created_by || activeUserId || "user-1";
      newRecord = enrichProjectEntity(collection, newRecord, canonicalProjId, canonicalWsId);
    }

    if (collection === "projects" && newRecord.sort_order === undefined) {
      newRecord.sort_order = ((localDB.projects || []).length + 1) * 10000;
    }

    if (!localDB[collection]) localDB[collection] = [];
    localDB[collection].push(newRecord);

    // Every work item creation is part of its activity timeline (verb: "created")
    if (collection === "issues") {
      createIssueActivity(newRecord, null, null, null, "created");
    }

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

    if (collection === "projects") {
      returnedRecord.member_role = 20;
      returnedRecord.created_by = newRecord.created_by;
      returnedRecord.owner = newRecord.owner;
      returnedRecord.workspace = newRecord.workspace;
      returnedRecord.workspace_detail = newRecord.workspace_detail;
      returnedRecord.cycle_view = returnedRecord.cycle_view ?? true;
      returnedRecord.module_view = returnedRecord.module_view ?? true;
      returnedRecord.issue_views_view = returnedRecord.issue_views_view ?? true;
      returnedRecord.page_view = returnedRecord.page_view ?? true;
      returnedRecord.inbox_view = returnedRecord.inbox_view ?? true;
    }

    // Generic mapping for all records
    if (returnedRecord.project && !returnedRecord.project_id) returnedRecord.project_id = returnedRecord.project;
    if (returnedRecord.project_id && !returnedRecord.project) returnedRecord.project = returnedRecord.project_id;
    if (returnedRecord.workspace && !returnedRecord.workspace_id)
      returnedRecord.workspace_id = returnedRecord.workspace;
    if (returnedRecord.workspace_id && !returnedRecord.workspace)
      returnedRecord.workspace = returnedRecord.workspace_id;

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
    if (collection === "invitations") {
      const slug = url.match(/\/api\/workspaces\/([^/]+)\//)?.[1];
      const workspace = findLocalWorkspace(slug);
      const keys = new Set([slug, workspace?.id, workspace?.slug].filter(Boolean));
      const invitation = (localDB.invitations || []).find((entry: any) => entry.id === id && getInvitationWorkspaceKeys(entry).some((key) => keys.has(key)));
      if (!invitation) return { status: 404, data: { error: "Không tìm thấy lời mời trong không gian làm việc này." } };
      if (invitation.accepted) return { status: 409, data: { error: "Hãy thay đổi quyền trong danh sách thành viên đã tham gia." } };
      const nextRole = Number(body.role ?? invitation.role);
      const nextWallet = body.wallet_address ?? invitation.wallet_address;
      if (!Object.keys(body).length || Object.keys(body).some((key) => !["role", "wallet_address"].includes(key)) || ![15, 20].includes(nextRole))
        return { status: 400, data: { error: "Chỉ được cập nhật quyền và ví nhận lời mời hợp lệ." } };
      if (body.wallet_address !== undefined && (typeof body.wallet_address !== "string" || !/^0x[a-f0-9]{40}$/i.test(body.wallet_address.trim()) || /^0x0{40}$/i.test(body.wallet_address.trim())))
        return { status: 400, data: { error: "Ví người nhận không hợp lệ." } };
      const firstWalletApproval = Boolean(body.wallet_address && (!invitation.wallet_address ||
        ((invitation.wallet_approval_required || invitation.chain_approval_failed) &&
          invitation.wallet_address.toLowerCase() === body.wallet_address.trim().toLowerCase())) &&
        nextRole === Number(invitation.role) && !invitation.responded_at &&
        !["revoked", "rejected"].includes(invitation.status) &&
        /^inv_[a-f0-9]{64}$/.test(invitation.token || "") &&
        Date.parse(invitation.token_expires_at) > Date.now() &&
        !isInvitationDeleted(invitation, readInvitationTombstones()));
      const result = await handleRouteUnlocked("post", `/api/workspaces/${slug}/invitations/`, {
        emails: [{ email: invitation.email, role: nextRole, wallet_address: nextWallet }],
      }, firstWalletApproval ? invitation.id : undefined);
      if (result.status < 400 && result.data.chain_failures?.length)
        return { status: 503, data: { code: "WALLET_APPROVAL_PENDING", error: result.data.chain_failures[0].error } };
      return result.status >= 400 ? result : ok(result.data.invitations.find((entry: any) => entry.id === id));
    }
    if (!localDB[collection]) localDB[collection] = [];
    let idx = localDB[collection].findIndex((r: any) => r.id === id || r.slug === id);
    if (idx === -1 && collection === "issues" && id) {
      const projMatch = url.match(/\/projects\/([^/]+)\//);
      const projOrIdentifier = projMatch ? projMatch[1] : null;
      const seqId = parseInt(id, 10);
      if (!isNaN(seqId) && projOrIdentifier) {
        idx = localDB.issues.findIndex(
          (r: any) =>
            (r.project === projOrIdentifier ||
              r.project_id === projOrIdentifier ||
              r.project_detail?.identifier === projOrIdentifier) &&
            r.sequence_id === seqId
        );
      }
      if (idx === -1 && id.includes("-")) {
        const [projIdentifier, seqIdStr] = id.split("-");
        const sId = parseInt(seqIdStr, 10);
        if (!isNaN(sId)) {
          idx = localDB.issues.findIndex(
            (r: any) => r.project_detail?.identifier === projIdentifier && r.sequence_id === sId
          );
        }
      }
    }
    if (idx > -1) {
      const previousRecord = { ...localDB[collection][idx] };

      // D-B: an assignee must already be a member of the project.
      if (collection === "issues") {
        const nextAssignees = Array.isArray(body?.assignees) ? body.assignees : body?.assignee_ids;
        if (Array.isArray(nextAssignees)) {
          const targetProjectId =
            body?.project_id || body?.project || previousRecord.project_id || previousRecord.project;
          const previousAssignees = previousRecord.assignee_ids || previousRecord.assignees || [];
          const invalidAssignees = findNonProjectAssignees(targetProjectId, nextAssignees, previousAssignees);
          if (invalidAssignees.length > 0) {
            return {
              data: buildAssigneeValidationError(String(targetProjectId || ""), invalidAssignees),
              status: 400,
            };
          }
        }
      }

      localDB[collection][idx] = { ...localDB[collection][idx], ...body, updated_at: new Date().toISOString() };
      if (collection === "issues") {
        if (body.state_id) localDB[collection][idx].state = body.state_id;
        if (body.state) localDB[collection][idx].state_id = body.state;
        const updatedStateId = localDB[collection][idx].state_id || localDB[collection][idx].state;
        if (updatedStateId && updatedStateId !== (previousRecord.state_id || previousRecord.state)) {
          const matchedState = (localDB.states || []).find((s: any) => s.id === updatedStateId);
          if (matchedState) localDB[collection][idx].state_detail = matchedState;
        }
        recordIssueUpdateActivities(previousRecord, localDB[collection][idx]);
      }
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

      if (["cycles", "modules", "views", "pages"].includes(collection)) {
        returnedRecord = enrichProjectEntity(collection, returnedRecord);
        localDB[collection][idx] = { ...localDB[collection][idx], ...returnedRecord };
      }

      if (collection === "workspaces") {
        returnedRecord = {
          ...returnedRecord,
          total_members: getWorkspaceMemberCount(returnedRecord.slug, returnedRecord.id),
        };
      }

      return ok(returnedRecord);
    }
    console.log("404 for URL:", url, "method:", method);
    return { data: null, status: 404 };
  }

  if (method === "delete") {
    if (collection === "workspaces" && id) {
      const targetWs = (localDB.workspaces || []).find((w: any) => w.id === id || w.slug === id);
      const targetId = targetWs?.id || id;
      const targetSlug = targetWs?.slug || id;

      if (!localDB._deleted_workspace_ids) localDB._deleted_workspace_ids = [];
      if (!localDB._deleted_workspace_ids.includes(targetId)) {
        localDB._deleted_workspace_ids.push(targetId);
      }
      if (!localDB._deleted_workspace_slugs) localDB._deleted_workspace_slugs = [];
      if (!localDB._deleted_workspace_slugs.includes(targetSlug)) {
        localDB._deleted_workspace_slugs.push(targetSlug);
      }

      const deletedWsIds = new Set(localDB._deleted_workspace_ids);
      const deletedWsSlugs = new Set(localDB._deleted_workspace_slugs);

      // 1. Remove from localDB.workspaces
      localDB.workspaces = (localDB.workspaces || []).filter(
        (w: any) => w.id !== targetId && w.slug !== targetSlug && !deletedWsIds.has(w.id) && !deletedWsSlugs.has(w.slug)
      );

      // 2. Cascade delete all projects belonging to this workspace
      const deletedProjects = (localDB.projects || []).filter(
        (p: any) => p.workspace === targetId || p.workspace === targetSlug || p.workspace_id === targetId || p.workspace_id === targetSlug
      );
      if (!localDB._deleted_project_ids) localDB._deleted_project_ids = [];
      for (const dp of deletedProjects) {
        if (!localDB._deleted_project_ids.includes(dp.id)) localDB._deleted_project_ids.push(dp.id);
        if (dp.identifier && !localDB._deleted_project_ids.includes(dp.identifier)) localDB._deleted_project_ids.push(dp.identifier);
      }
      const currentDeletedProjSet = new Set(localDB._deleted_project_ids);
      localDB.projects = (localDB.projects || []).filter(
        (p: any) => p.workspace !== targetId && p.workspace !== targetSlug && p.workspace_id !== targetId && p.workspace_id !== targetSlug && !currentDeletedProjSet.has(p.id)
      );

      // 3. Cascade delete all issues for those projects or this workspace
      if (localDB.issues) {
        const deletedProjIds = new Set(deletedProjects.map((p: any) => p.id));
        const deletedIssues = localDB.issues.filter(
          (i: any) => deletedProjIds.has(i.project) || deletedProjIds.has(i.project_id) || i.workspace === targetId || i.workspace === targetSlug
        );
        if (!localDB._deleted_issue_ids) localDB._deleted_issue_ids = [];
        for (const di of deletedIssues) {
          if (!localDB._deleted_issue_ids.includes(di.id)) localDB._deleted_issue_ids.push(di.id);
        }
        const currentDeletedIssueSet = new Set(localDB._deleted_issue_ids);
        localDB.issues = localDB.issues.filter(
          (i: any) => !deletedProjIds.has(i.project) && !deletedProjIds.has(i.project_id) && i.workspace !== targetId && i.workspace !== targetSlug && !currentDeletedIssueSet.has(i.id)
        );
      }

      // 4. Cascade delete states, labels, cycles, modules, workspace_members
      if (localDB.states) {
        localDB.states = localDB.states.filter((s: any) => s.workspace !== targetId && s.workspace !== targetSlug);
      }
      if (localDB.labels) {
        localDB.labels = localDB.labels.filter((l: any) => l.workspace !== targetId && l.workspace !== targetSlug);
      }
      if (localDB.cycles) {
        localDB.cycles = localDB.cycles.filter((c: any) => c.workspace !== targetId && c.workspace !== targetSlug);
      }
      if (localDB.modules) {
        localDB.modules = localDB.modules.filter((m: any) => m.workspace !== targetId && m.workspace !== targetSlug);
      }
      if (localDB.views) {
        localDB.views = localDB.views.filter((v: any) => v.workspace !== targetId && v.workspace !== targetSlug);
      }
      if (localDB.pages) {
        localDB.pages = localDB.pages.filter((p: any) => p.workspace !== targetId && p.workspace !== targetSlug);
      }
      if (localDB.inbox_issues) {
        localDB.inbox_issues = localDB.inbox_issues.filter((i: any) => i.workspace !== targetId && i.workspace !== targetSlug);
      }
      if (localDB.workspace_members) {
        localDB.workspace_members = localDB.workspace_members.filter(
          (m: any) => m.workspace !== targetId && m.workspace !== targetSlug && m.workspace_id !== targetId && m.workspace_id !== targetSlug
        );
      }

      // 5. Update activeUser
      const remainingWs = (localDB.workspaces && localDB.workspaces.length > 0) ? localDB.workspaces[0] : null;
      const activeUserId = getLoggedInUserId();
      const loggedInEmail = typeof window !== "undefined" ? localStorage.getItem("plane_dapp_auth_email") : null;
      const activeUser = (localDB.users || []).find((u: any) =>
        (activeUserId && u.id === activeUserId) ||
        (loggedInEmail && u.email?.toLowerCase() === loggedInEmail.toLowerCase())
      ) || localDB.users?.[0] || null;

      if (activeUser) {
        if (activeUser.last_workspace_slug === targetSlug || activeUser.last_workspace_id === targetId) {
          activeUser.last_workspace_slug = remainingWs ? remainingWs.slug : null;
          activeUser.last_workspace_id = remainingWs ? remainingWs.id : null;
        }
      }

      // 6. Update localStorage and document.cookie
      if (typeof window !== "undefined") {
        try {
          if (localStorage.getItem("last_workspace_slug") === targetSlug) {
            if (remainingWs) {
              localStorage.setItem("last_workspace_slug", remainingWs.slug);
            } else {
              localStorage.removeItem("last_workspace_slug");
            }
          }
          if (remainingWs) {
            document.cookie = `last_workspace_slug=${remainingWs.slug}; path=/; max-age=31536000; SameSite=Lax`;
          } else {
            document.cookie = `last_workspace_slug=; path=/; max-age=0; SameSite=Lax`;
          }
          document.cookie = `plane_dapp_sync_workspaces=${encodeURIComponent(JSON.stringify(localDB.workspaces))}; path=/; max-age=31536000; SameSite=Lax`;
        } catch { }
      }

      saveDB();
      return ok({ message: "Workspace deleted successfully" });
    } else if (collection === "projects" && id) {
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
        const deletedProjIssues = localDB.issues.filter(
          (i: any) => i.project === targetId || i.project_id === targetId
        );
        if (!localDB._deleted_issue_ids) localDB._deleted_issue_ids = [];
        for (const dpi of deletedProjIssues) {
          if (!localDB._deleted_issue_ids.includes(dpi.id)) {
            localDB._deleted_issue_ids.push(dpi.id);
          }
        }
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
      if (localDB.views) {
        localDB.views = localDB.views.filter((v: any) => v.project !== targetId && v.project_id !== targetId);
      }
      if (localDB.pages) {
        localDB.pages = localDB.pages.filter((p: any) => p.project !== targetId && p.project_id !== targetId);
      }
      if (localDB.inbox_issues) {
        localDB.inbox_issues = localDB.inbox_issues.filter((i: any) => i.project !== targetId && i.project_id !== targetId);
      }
      if (localDB.project_members) {
        localDB.project_members = localDB.project_members.filter((pm: any) => pm.project !== targetId && pm.project_id !== targetId);
      }
    } else if (collection === "issues" && id) {
      if (!localDB._deleted_issue_ids) localDB._deleted_issue_ids = [];
      if (!localDB._deleted_issue_ids.includes(id)) {
        localDB._deleted_issue_ids.push(id);
      }
      // Also collect all child / sub-issue IDs so they don't orphan or resurrect
      const childIssues = (localDB.issues || []).filter((i: any) => i.parent_id === id || i.parent === id);
      for (const child of childIssues) {
        if (!localDB._deleted_issue_ids.includes(child.id)) {
          localDB._deleted_issue_ids.push(child.id);
        }
      }
      const deletedIssueSet = new Set(localDB._deleted_issue_ids);
      localDB.issues = (localDB.issues || []).filter(
        (r: any) => !deletedIssueSet.has(r.id) && r.parent_id !== id && r.parent !== id
      );
      if (localDB.issue_comments) {
        localDB.issue_comments = localDB.issue_comments.filter(
          (c: any) => !deletedIssueSet.has(c.issue || c.issue_id)
        );
      }
    } else if (collection === "invitations" && id) {
      const wsMatchDel = url.match(/\/api\/workspaces\/([^/]+)\/invitations\//);
      const wsSlugDel = wsMatchDel ? decodeURIComponent(wsMatchDel[1]).toLowerCase().trim() : "";
      const targetInv = (localDB.invitations || []).find((i: any) => i.id === id);
      if (!targetInv) return { status: 404, data: { error: "Không tìm thấy lời mời." } };
      const invWsKeys = targetInv ? getInvitationWorkspaceKeys(targetInv) : [];

      // An invitation belongs to exactly one workspace. Refuse a cross-workspace
      // delete instead of silently deleting somebody else's invitation (RC-6).
      if (wsSlugDel && invWsKeys.length > 0 && !invWsKeys.includes(wsSlugDel)) {
        return { data: { error: "Invitation does not belong to this workspace" }, status: 404 };
      }

      const invitedWallet = extractEthAddress(targetInv.wallet_address || targetInv.email);
      if (invitedWallet && !targetInv.chain_approval_failed) {
        try {
          const signer = await assertVaultSigningAddress(getStoredWalletAddress() || currentUserAddress);
          if (await fetchMemberRoleOnChain(wsSlugDel, invitedWallet) > 0) return { status: 409, data: { error: "Người nhận đã có quyền thành viên. Hãy quản lý quyền trong danh sách thành viên." } };
          await writeWorkspaceWalletInvitation(wsSlugDel, invitedWallet, Number(targetInv.role), 0, signer, true);
        } catch (error) {
          return { status: 503, data: { error: error instanceof Error ? error.message : "Chưa xác nhận được việc thu hồi lời mời." } };
        }
      }

      removeStoredInvitation(
        id,
        targetInv?.email,
        wsSlugDel || invWsKeys[0] || undefined
      );
      localDB.invitations = (localDB.invitations || []).filter((i: any) => i.id !== id);
      saveDB();
      const revokedCid = await uploadToIPFS(true);
      if (!revokedCid || !await commitWorkspaceCID(wsSlugDel, revokedCid, { force: true })) return { status: 503, data: { code: "INVITATION_REVOCATION_PENDING", error: "Đã thu hồi lời mời trên máy nhưng chưa đồng bộ được trạng thái chung. Hãy đồng bộ lại trước khi báo hoàn tất." } };
      return ok({ revoked: true });
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
    if (rest[3] === "details") {
      return { collection: "projects", id: null, isPaginated: false };
    }
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

  // Normalize aliases so they match localDB collection names
  if (resourceSegments[0] === "issue-labels" || resourceSegments[0] === "issue_labels") {
    resourceSegments[0] = "labels";
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
      "user-properties",
      "epics-user-properties",
      "project-deploy-boards",
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
    const unpaginatedSub = [
      "comments",
      "history",
      "issue_reactions",
      "reactions",
      "links",
      "issue-links",
      "sub-issues",
      "issue-relation",
    ];
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
