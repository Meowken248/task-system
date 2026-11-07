import { localDB, saveDB } from "./store";
import {
  ResourceAccessError,
  requireWorkspaceAccess,
  requireProjectAccess,
  captureResourceRequestIdentity,
  projectAccessFromWorkspace,
  type ResourceRequestIdentity,
} from "./resource-access";
import { getStoredWalletAddress } from "./chain";
import { isValidScope, nextRecordTimestamp } from "./scope.helper";
import type { RouteResult } from "./types";

export type TPageAction =
  | "read"
  | "read_content"
  | "edit_content"
  | "edit_metadata"
  | "change_access"
  | "lock"
  | "unlock"
  | "archive"
  | "restore"
  | "delete"
  | "duplicate"
  | "move";

type RecordData = Record<string, any>;

const deny = (msg = "Bạn không có quyền thực hiện thao tác này.") =>
  new ResourceAccessError(403, "NOT_AUTHORIZED", msg);

const notFound = (msg = "Không tìm thấy trang trong dự án này.") =>
  new ResourceAccessError(404, "NOT_FOUND", msg);

const badRequest = (msg = "Dữ liệu yêu cầu không hợp lệ.") =>
  new ResourceAccessError(400, "INVALID_PAGE_DATA", msg);

const safeString = (val: unknown): string => (typeof val === "string" ? val.toLowerCase().trim() : "");

/**
 * Standardized owner resolution from source code and UI:
 * Canonical: page.owned_by takes priority.
 * Fallback: page.created_by for legacy data lacking owned_by.
 * Never grants dual ownership to conflicting IDs.
 */
export function getPageOwner(page: RecordData): string {
  if (typeof page?.owned_by === "string" && page.owned_by.trim()) {
    return page.owned_by.trim();
  }
  if (typeof page?.created_by === "string" && page.created_by.trim()) {
    return page.created_by.trim();
  }
  return "";
}

/**
 * Normalizes all linked project IDs for a page.
 */
export function getPageProjectIds(page: RecordData): string[] {
  const ids = [
    page?.project_id,
    page?.project,
    ...(Array.isArray(page?.project_ids) ? page.project_ids : []),
  ];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0))];
}

/**
 * Computes highest role of user across all valid linked projects of the page
 * within the specified workspace (matching getHighestRoleAcrossProjects in project-page.ts
 * and standard requireProjectAccess constraints).
 */
export function getHighestPageRole(
  page: RecordData,
  user: RecordData,
  workspace: RecordData,
  workspaceRole: number
): number {
  if (workspaceRole >= 20) return 20;

  const linkedProjectIds = getPageProjectIds(page);
  let highest = 0;
  const rawWallet = getStoredWalletAddress();
  const wallet = safeString(rawWallet);

  for (const pid of linkedProjectIds) {
    const proj = (localDB.projects || []).find(
      (p: any) =>
        (p.id === pid || p.identifier === pid) &&
        (p.workspace === workspace.id ||
          p.workspace_id === workspace.id ||
          p.workspace === workspace.slug ||
          p.workspace_id === workspace.slug) &&
        !(localDB._deleted_project_ids || []).includes(p.id)
    );
    if (!proj) continue;

    // Check project member role matching requireProjectAccess exactly
    const member = (localDB.project_members || []).find((entry: any) => {
      if (
        (entry.project !== proj.id && entry.project_id !== proj.id) ||
        entry.is_active === false ||
        Number(entry.role) === 0
      ) {
        return false;
      }
      const entryMemberId =
        typeof entry.member === "object" && entry.member !== null ? entry.member.id : entry.member;
      const entryWallet = safeString(
        entry.wallet_address ||
          (typeof entry.member === "object" && entry.member !== null
            ? entry.member.metanode_wallet_address
            : undefined) ||
          (typeof entry.member === "string" ? entry.member : "")
      );
      if (wallet) {
        if (entryWallet && entryWallet === wallet) return true;
        const userWallet = safeString(user.metanode_wallet_address || user.wallet_address);
        if (entryMemberId === user.id && userWallet && userWallet === wallet) return true;
        return false;
      }
      return entryMemberId === user.id;
    });

    const creator = proj.created_by || proj.owner?.id || proj.owner;
    const profileMatchesWallet =
      !wallet || safeString(user.metanode_wallet_address || user.wallet_address) === wallet;
    const isCreator = Boolean(
      (wallet && safeString(creator) === wallet) ||
        (profileMatchesWallet && creator === user.id)
    );

    let projectRole = 0;
    if (workspaceRole < 20 && proj.network === 0 && !member && !isCreator) {
      projectRole = 0;
    } else {
      projectRole =
        workspaceRole >= 20
          ? 20
          : workspaceRole >= 15
            ? isCreator
              ? 20
              : Number(member?.role) || 15
            : Math.min(workspaceRole, Number(member?.role) || workspaceRole);
    }

    if (projectRole > highest) highest = projectRole;
  }

  return highest;
}

export interface PageAccessResult {
  user: any;
  workspace: any;
  project: any;
  destProject?: any;
  page: any;
  highestRole: number;
  isOwner: boolean;
}

/**
 * Centralized authorization helper for all Page operations.
 * Strictly verifies:
 * 1. Session & wallet authentication.
 * 2. Workspace and project existence and scope.
 * 3. Page existence, tombstone check, and relation to requested project.
 * 4. Multi-project highest role resolution.
 * 5. Operation-specific permission rules matching project-page.ts.
 */
export async function requirePageAccess(
  workspaceKey: string,
  projectKey: string,
  pageKey: string,
  action: TPageAction,
  body?: RecordData,
  identity: ResourceRequestIdentity = captureResourceRequestIdentity()
): Promise<PageAccessResult> {
  identity.assertCurrent();
  if (!identity.userId) {
    throw new ResourceAccessError(401, "AUTH_REQUIRED", "Vui lòng đăng nhập.");
  }

  const writeMode = [
    "edit_metadata",
    "edit_content",
    "change_access",
    "lock",
    "unlock",
    "archive",
    "restore",
    "delete",
    "move",
  ].includes(action);

  // 1. Strictly verify access to the requested workspace
  const wsAccess = await requireWorkspaceAccess(workspaceKey, false);
  identity.assertCurrent();

  // 2. Resolve requested project in URL within the target workspace
  const targetProject = (localDB.projects || []).find(
    (p: any) =>
      (p.id === projectKey || (typeof p.identifier === "string" && p.identifier.toLowerCase() === projectKey.toLowerCase())) &&
      (p.workspace === wsAccess.workspace.id ||
        p.workspace_id === wsAccess.workspace.id ||
        p.workspace === wsAccess.workspace.slug ||
        p.workspace_id === wsAccess.workspace.slug) &&
      !(localDB._deleted_project_ids || []).includes(p.id)
  );

  if (!targetProject) {
    throw notFound("Không tìm thấy dự án trong không gian làm việc.");
  }

  // 3. Strictly verify access to the requested project using standard requireProjectAccess
  const targetProjectAccess = await requireProjectAccess(workspaceKey, targetProject.id, writeMode);
  identity.assertCurrent();

  // Find page
  const page = (localDB.pages || []).find((p: any) => p.id === pageKey);
  const deletedPageIds = new Set(localDB._deleted_page_ids || []);

  if (!page || deletedPageIds.has(pageKey)) {
    throw notFound();
  }

  // Validate that the requested project is actually linked to this page and belongs to the workspace
  const linkedProjectIds = getPageProjectIds(page);
  const canonicalTargetProjectId = targetProject.id;
  const canonicalTargetProjIdent = targetProject.identifier;

  const isLinkedToTargetProject = linkedProjectIds.some(
    (pid) => pid === canonicalTargetProjectId || pid === canonicalTargetProjIdent
  );

  if (!isLinkedToTargetProject || !isValidScope(page, canonicalTargetProjectId, wsAccess.workspace.id)) {
    throw notFound("Trang không thuộc dự án được yêu cầu.");
  }

  // Adopt the latest verified workspace role from targetProjectAccess (never preserve stale higher Admin)
  const currentWsRole = targetProjectAccess.role;
  const linkedRoles = getHighestPageRole(page, targetProjectAccess.user, targetProjectAccess.workspace, currentWsRole);
  const highestRole = Math.max(targetProjectAccess.projectRole, linkedRoles);

  const pageOwner = getPageOwner(page);
  const isOwner = Boolean(pageOwner && pageOwner === targetProjectAccess.user.id);
  const isPagePublic = page.access === 0;
  const isLocked = Boolean(page.is_locked);
  const isArchived = Boolean(page.archived_at);

  // Evaluate permission per action
  switch (action) {
    case "read": {
      // canCurrentUserAccessPage: isPagePublic || isOwner
      if (!isPagePublic && !isOwner) {
        throw deny("Trang riêng tư chỉ chủ sở hữu mới có quyền truy cập.");
      }
      if (isPagePublic && highestRole < 5) {
        throw deny("Bạn không có quyền truy cập dự án này.");
      }
      break;
    }

    case "read_content": {
      // Content reading: private pages strictly require ownership (Admin does NOT bypass)
      if (!isPagePublic && !isOwner) {
        throw deny("Nội dung trang riêng tư chỉ chủ sở hữu mới có quyền đọc.");
      }
      if (isPagePublic && highestRole < 5) {
        throw deny("Bạn không có quyền truy cập dự án này.");
      }
      break;
    }

    case "edit_content": {
      // isContentEditable: !archived && !locked && (isOwner || (isPublic && highestRole >= 15))
      if (isLocked) {
        throw deny("Trang đã bị khóa, không thể chỉnh sửa nội dung.");
      }
      if (isArchived) {
        throw deny("Trang đã bị lưu trữ, không thể chỉnh sửa nội dung.");
      }
      if (!isPagePublic && !isOwner) {
        throw deny("Chỉ chủ sở hữu mới được chỉnh sửa trang riêng tư.");
      }
      if (isPagePublic && highestRole < 15) {
        throw deny("Bạn cần quyền thành viên (Member) trở lên để chỉnh sửa nội dung trang.");
      }
      break;
    }

    case "edit_metadata": {
      // Guard action fields and immutable / identity fields from generic payload mutation FIRST
      if (body) {
        for (const immutableKey of [
          "id",
          "project",
          "project_id",
          "workspace",
          "workspace_id",
          "created_by",
          "owned_by",
          "project_ids",
        ]) {
          if (
            Object.hasOwn(body, immutableKey) &&
            JSON.stringify(body[immutableKey]) !== JSON.stringify(page[immutableKey])
          ) {
            throw badRequest(`Không được thay đổi trường ${immutableKey} qua thao tác này.`);
          }
        }

        for (const actionKey of ["is_locked", "archived_at"]) {
          if (
            Object.hasOwn(body, actionKey) &&
            JSON.stringify(body[actionKey]) !== JSON.stringify(page[actionKey])
          ) {
            if (!isOwner && highestRole < 20) {
              throw deny(`Chỉ chủ sở hữu hoặc quản trị viên mới có quyền thay đổi trạng thái ${actionKey}.`);
            }
            throw badRequest(`Không được thay đổi trường ${actionKey} qua generic update. Hãy dùng endpoint chuyên dụng.`);
          }
        }

        if (
          Object.hasOwn(body, "access") &&
          JSON.stringify(body.access) !== JSON.stringify(page.access)
        ) {
          if (!isOwner && highestRole < 20) {
            throw deny("Chỉ chủ sở hữu hoặc quản trị viên mới có quyền đổi chế độ truy cập trang.");
          }
          if (body.access !== 0 && body.access !== 1) {
            throw badRequest("Quyền trang phải là 0 (Công khai) hoặc 1 (Riêng tư).");
          }
          if (isArchived) {
            throw deny("Trang đã bị lưu trữ, không thể thay đổi quyền truy cập.");
          }
        }
      }

      // canCurrentUserEditPage: !archived && !locked && (isOwner || (isPublic && highestRole >= 15))
      if (isLocked) {
        throw deny("Trang đã bị khóa, không thể thay đổi thông tin.");
      }
      if (isArchived) {
        throw deny("Trang đã bị lưu trữ, không thể thay đổi thông tin.");
      }
      if (!isPagePublic && !isOwner) {
        throw deny("Chỉ chủ sở hữu mới được sửa thông tin trang riêng tư.");
      }
      if (isPagePublic && highestRole < 15) {
        throw deny("Bạn cần quyền thành viên trở lên để sửa thông tin trang.");
      }

      if (body) {
        const hasContentChange = [
          "description",
          "description_html",
          "description_binary",
          "description_json",
        ].some(
          (k) => Object.hasOwn(body, k) && JSON.stringify(body[k]) !== JSON.stringify(page[k])
        );
        if (hasContentChange) {
          if (isLocked) throw deny("Trang đã bị khóa, không thể chỉnh sửa nội dung.");
          if (isArchived) throw deny("Trang đã bị lưu trữ, không thể chỉnh sửa nội dung.");
          if (!isPagePublic && !isOwner) throw deny("Chỉ chủ sở hữu mới được chỉnh sửa trang riêng tư.");
          if (isPagePublic && highestRole < 15) throw deny("Bạn cần quyền thành viên trở lên để chỉnh sửa nội dung trang.");
        }
      }
      break;
    }

    case "change_access": {
      // canCurrentUserChangeAccess: !archived && (isOwner || highestRole >= 20)
      if (isArchived) {
        throw deny("Trang đã bị lưu trữ, không thể thay đổi quyền truy cập.");
      }
      if (!isOwner && highestRole < 20) {
        throw deny("Chỉ chủ sở hữu hoặc quản trị viên mới có quyền đổi chế độ truy cập trang.");
      }
      if (body) {
        if (body.access !== 0 && body.access !== 1) {
          throw badRequest("Quyền trang phải là 0 (Công khai) hoặc 1 (Riêng tư).");
        }
        for (const scopeKey of [
          "id",
          "project",
          "project_id",
          "workspace",
          "workspace_id",
          "created_by",
          "owned_by",
          "project_ids",
        ]) {
          if (
            Object.hasOwn(body, scopeKey) &&
            JSON.stringify(body[scopeKey]) !== JSON.stringify(page[scopeKey])
          ) {
            throw badRequest("Không được đổi phạm vi hoặc chủ sở hữu đồng thời với quyền trang.");
          }
        }
      }
      break;
    }

    case "lock": {
      // canCurrentUserLockPage: !archived && (isOwner || highestRole >= 20)
      if (isArchived) {
        throw deny("Trang đã bị lưu trữ, không thể khóa.");
      }
      if (!isOwner && highestRole < 20) {
        throw deny("Chỉ chủ sở hữu hoặc quản trị viên mới có quyền khóa trang.");
      }
      break;
    }

    case "unlock": {
      // canCurrentUserLockPage: !archived && (isOwner || highestRole >= 20)
      if (isArchived) {
        throw deny("Trang đã bị lưu trữ, không thể mở khóa.");
      }
      if (!isOwner && highestRole < 20) {
        throw deny("Chỉ chủ sở hữu hoặc quản trị viên mới có quyền mở khóa trang.");
      }
      break;
    }

    case "archive": {
      // canCurrentUserArchivePage: isOwner || highestRole >= 20
      if (!isOwner && highestRole < 20) {
        throw deny("Chỉ chủ sở hữu hoặc quản trị viên mới có quyền lưu trữ trang.");
      }
      break;
    }

    case "restore": {
      // canCurrentUserArchivePage: isOwner || highestRole >= 20
      if (!isOwner && highestRole < 20) {
        throw deny("Chỉ chủ sở hữu hoặc quản trị viên mới có quyền phục hồi trang.");
      }
      break;
    }

    case "delete": {
      // canCurrentUserDeletePage: (archived || admin) && (isOwner || highestRole >= 20)
      if (!isOwner && highestRole < 20) {
        throw deny("Chỉ chủ sở hữu hoặc quản trị viên mới có quyền xóa trang.");
      }
      break;
    }

    case "duplicate": {
      // canCurrentUserDuplicatePage: read source allowed AND highestRole >= 15
      if (!isPagePublic && !isOwner) {
        throw deny("Không thể nhân bản trang riêng tư của người khác.");
      }
      if (highestRole < 15) {
        throw deny("Bạn cần quyền thành viên trở lên để nhân bản trang.");
      }
      break;
    }

    case "move": {
      // canCurrentUserMovePage: isOwner || highestRole >= 20
      if (!isOwner && highestRole < 20) {
        throw deny("Chỉ chủ sở hữu hoặc quản trị viên mới có quyền di chuyển trang.");
      }
      if (!body?.new_project_id || typeof body.new_project_id !== "string") {
        throw badRequest("Cần chỉ định dự án đích hợp lệ.");
      }
      const targetMoveProject = (localDB.projects || []).find(
        (p: any) =>
          (p.id === body.new_project_id || p.identifier === body.new_project_id) &&
          (p.workspace === wsAccess.workspace.id ||
            p.workspace_id === wsAccess.workspace.id ||
            p.workspace === wsAccess.workspace.slug ||
            p.workspace_id === wsAccess.workspace.slug) &&
          !(localDB._deleted_project_ids || []).includes(p.id)
      );
      if (!targetMoveProject) {
        throw notFound("Không tìm thấy dự án đích trong không gian làm việc này.");
      }
      // Verify user has at least Member role in destination project
      const destProjectRole = await requireProjectAccess(
        wsAccess.workspace.slug,
        targetMoveProject.id,
        true
      );
      identity.assertCurrent();
      if (destProjectRole.projectRole < 15) {
        throw deny("Bạn không có quyền chuyển trang tới dự án đích này.");
      }
      // The destination RPC may have observed a downgrade. Recheck source access
      // and management with that role instead of retaining its earlier Admin role.
      projectAccessFromWorkspace(destProjectRole, targetProject.id, true);
      const latestHighestRole = getHighestPageRole(page, destProjectRole.user, destProjectRole.workspace, destProjectRole.role);
      if (!isOwner && latestHighestRole < 20) {
        throw deny("Chỉ chủ sở hữu hoặc quản trị viên mới có quyền di chuyển trang.");
      }
      return {
        user: destProjectRole.user,
        workspace: destProjectRole.workspace,
        project: targetProject,
        destProject: targetMoveProject,
        page,
        highestRole: latestHighestRole,
        isOwner,
      };
    }
  }

  identity.assertCurrent();
  return {
    user: targetProjectAccess.user,
    workspace: targetProjectAccess.workspace,
    project: targetProject,
    page,
    highestRole,
    isOwner,
  };
}

/**
 * Handles all specific Page sub-actions under:
 * /api/workspaces/:wsSlug/projects/:projectId/pages/:pageId/(access|archive|lock|duplicate|move)/
 * and /api/workspaces/:wsSlug/projects/:projectId/pages/:pageId/description/
 */
export async function handlePageActionRoute(
  method: string,
  url: string,
  body: RecordData,
  identity: ResourceRequestIdentity = captureResourceRequestIdentity()
): Promise<RouteResult> {
  identity.assertCurrent();

  const urlObj = new URL(url, "http://dapp.invalid");
  const segments = urlObj.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  // Format: /api/workspaces/:wsSlug/projects/:projectId/pages/:pageId/:action/
  const wsIdx = segments.indexOf("workspaces");
  const projIdx = segments.indexOf("projects");
  const pagesIdx = segments.indexOf("pages");

  if (wsIdx === -1 || projIdx === -1 || pagesIdx === -1 || segments.length <= pagesIdx + 1) {
    throw notFound();
  }

  const workspaceSlug = segments[wsIdx + 1];
  const projectId = segments[projIdx + 1];
  const pageId = segments[pagesIdx + 1];
  const actionSegment = segments[pagesIdx + 2];
  const lowerMethod = method.toLowerCase();

  // 1. Description endpoint (/pages/:pageId/description/)
  if (actionSegment === "description") {
    if (lowerMethod === "get") {
      const access = await requirePageAccess(workspaceSlug, projectId, pageId, "read_content", undefined, identity);
      identity.assertCurrent();
      return {
        status: 200,
        data: access.page.description_html || access.page.description || "",
      };
    }
    if (lowerMethod === "patch") {
      const access = await requirePageAccess(workspaceSlug, projectId, pageId, "edit_content", body, identity);
      identity.assertCurrent();
      const targetPage = access.page;
      if (body.description_html !== undefined) targetPage.description_html = body.description_html;
      if (body.description_json !== undefined) targetPage.description_json = body.description_json;
      if (body.description_binary !== undefined) targetPage.description_binary = body.description_binary;
      if (body.description !== undefined) targetPage.description = body.description;
      targetPage.updated_at = nextRecordTimestamp(targetPage);
      saveDB();
      return { status: 200, data: { message: "Description updated" } };
    }
    throw new ResourceAccessError(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");
  }

  // 2. Access change (/pages/:pageId/access/)
  if (actionSegment === "access") {
    if (lowerMethod !== "post") {
      throw new ResourceAccessError(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");
    }
    const access = await requirePageAccess(workspaceSlug, projectId, pageId, "change_access", body, identity);
    identity.assertCurrent();
    const targetPage = access.page;
    targetPage.access = body.access;
    targetPage.updated_at = nextRecordTimestamp(targetPage);
    saveDB();
    return {
      status: 200,
      data: {
        id: targetPage.id,
        access: targetPage.access,
        updated_at: targetPage.updated_at,
      },
    };
  }

  // 3. Lock / Unlock (/pages/:pageId/lock/)
  if (actionSegment === "lock") {
    if (lowerMethod !== "post" && lowerMethod !== "delete") {
      throw new ResourceAccessError(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");
    }
    const isLocking = lowerMethod === "post";
    const access = await requirePageAccess(
      workspaceSlug,
      projectId,
      pageId,
      isLocking ? "lock" : "unlock",
      undefined,
      identity
    );
    identity.assertCurrent();
    const targetPage = access.page;
    targetPage.is_locked = isLocking;
    targetPage.updated_at = nextRecordTimestamp(targetPage);
    saveDB();
    return { status: 200, data: { is_locked: targetPage.is_locked, updated_at: targetPage.updated_at } };
  }

  // 4. Archive / Restore (/pages/:pageId/archive/)
  if (actionSegment === "archive") {
    if (lowerMethod !== "post" && lowerMethod !== "delete") {
      throw new ResourceAccessError(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");
    }
    const isArchiving = lowerMethod === "post";
    const access = await requirePageAccess(
      workspaceSlug,
      projectId,
      pageId,
      isArchiving ? "archive" : "restore",
      undefined,
      identity
    );
    identity.assertCurrent();
    const targetPage = access.page;
    targetPage.archived_at = isArchiving ? new Date().toISOString() : null;
    targetPage.updated_at = nextRecordTimestamp(targetPage);
    saveDB();
    return isArchiving
      ? { status: 200, data: { archived_at: targetPage.archived_at } }
      : { status: 200, data: { message: "Page restored" } };
  }

  // 5. Duplicate (/pages/:pageId/duplicate/)
  if (actionSegment === "duplicate") {
    if (lowerMethod !== "post") {
      throw new ResourceAccessError(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");
    }
    const access = await requirePageAccess(workspaceSlug, projectId, pageId, "duplicate", undefined, identity);
    identity.assertCurrent();
    const sourcePage = access.page;
    const targetProjId = access.project.id;
    const newPageId = crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11);

    const duplicatedPage: RecordData = {
      ...sourcePage,
      id: newPageId,
      name: `${sourcePage.name} (Copy)`,
      owned_by: access.user.id,
      created_by: access.user.id,
      project: targetProjId,
      project_id: targetProjId,
      project_ids: [targetProjId],
      is_locked: false,
      archived_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (!localDB.pages) localDB.pages = [];
    localDB.pages.push(duplicatedPage);
    saveDB();
    return { status: 200, data: duplicatedPage };
  }

  // 6. Move (/pages/:pageId/move/)
  if (actionSegment === "move") {
    if (lowerMethod !== "post") {
      throw new ResourceAccessError(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");
    }
    const access = await requirePageAccess(workspaceSlug, projectId, pageId, "move", body, identity);
    identity.assertCurrent();
    const targetPage = access.page;
    const destProject = access.destProject;
    if (!destProject?.id) {
      throw badRequest("Dự án đích không hợp lệ.");
    }
    const destProjectId = destProject.id;
    targetPage.project = destProjectId;
    targetPage.project_id = destProjectId;
    targetPage.project_ids = [destProjectId];
    targetPage.workspace = access.workspace.id;
    targetPage.workspace_id = access.workspace.id;
    targetPage.updated_at = nextRecordTimestamp(targetPage);
    saveDB();

    const pageData = { ...targetPage };
    // Bug C: Do NOT leak private page content to non-owner admins
    if (targetPage.access === 1 && !access.isOwner) {
      delete pageData.description;
      delete pageData.description_html;
      delete pageData.description_binary;
      delete pageData.description_json;
    }
    return { status: 200, data: pageData };
  }

  throw notFound("Không tìm thấy thao tác trên trang.");
}

