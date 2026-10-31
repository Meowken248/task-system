import type { RouteResult } from "./types";
import { localDB, saveDB } from "./store";
import { saveAttachment, getAttachment, deleteAttachment, type StoredAttachment } from "../file/attachment-storage";
import { attachmentDataUrl } from "../file/asset-source";
import {
  authenticatedResourceUser, requireWorkspaceAccess, requireProjectAccess,
  resourceWorkspace, resourceProject, ResourceAccessError,
} from "./resource-access";

const ok = (data: any): RouteResult => ({ status: 200, data });
const fail = (status: number, error: string): RouteResult => ({ status, data: { error } });
const assetRecord = (id: string) =>
  (localDB.assets || []).find((asset: any) => asset.id === id || asset.asset_id === id);
const attachmentRecord = (id: string) =>
  (localDB.attachments || []).find((asset: any) => asset.id === id || asset.asset_id === id);
const makeId = () =>
  `asset_${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;

const forbidden = () => new ResourceAccessError(403, "NOT_AUTHORIZED", "Bạn không có quyền truy cập tệp này.");

function inferScope(record: any): { workspace?: string; project?: string } {
  let workspace = record.workspace || record.workspace_id;
  let project = record.project || record.project_id;
  const entity = record.entity_identifier || record.issue_id || record.issue;
  if (record.entity_type === "WORKSPACE_LOGO") workspace ||= entity;
  if (record.entity_type === "PROJECT_COVER") project ||= entity;
  const issue = (localDB.issues || []).find((entry: any) => entry.id === entity);
  const page = (localDB.pages || []).find((entry: any) => entry.id === entity);
  const comment = (localDB.comments || []).find((entry: any) => entry.id === entity);
  project ||= issue?.project || issue?.project_id || page?.project || page?.project_id || comment?.project || comment?.project_id;
  if (project) {
    const parent = (localDB.projects || []).find((entry: any) => entry.id === project || entry.identifier === project);
    workspace ||= parent?.workspace || parent?.workspace_id;
  }
  return { workspace, project };
}

async function authorizeScope(record: any, pathname: string, write: boolean, user: any) {
  const wsPath = pathname.match(/\/workspaces\/([^/]+)/)?.[1];
  const projectPath = pathname.match(/\/projects\/([^/]+)/)?.[1];
  const userAsset = record.user_asset || ["USER_AVATAR", "USER_COVER"].includes(record.entity_type);
  if (userAsset) {
    if (wsPath || projectPath || (record.created_by || record.entity_identifier) !== user.id) throw forbidden();
    return { role: 20, workspace: undefined, project: undefined };
  }
  const scope = inferScope(record);
  if (!scope.workspace) throw forbidden(); // Never guess the owner of unscoped legacy bytes.
  const workspace = resourceWorkspace(scope.workspace);
  if (wsPath && resourceWorkspace(decodeURIComponent(wsPath)).id !== workspace.id) throw forbidden();
  const project = scope.project ? resourceProject(workspace, scope.project) : undefined;
  if (projectPath && (!project || resourceProject(workspace, decodeURIComponent(projectPath)).id !== project.id)) throw forbidden();
  // Workspace settings never inherit the administrator role of a project.
  if (record.entity_type === "WORKSPACE_LOGO" && project) throw forbidden();
  const role = project
    ? (await requireProjectAccess(workspace.slug, project.id, write)).projectRole
    : (await requireWorkspaceAccess(workspace.slug)).role;
  if (write && role < 15) throw forbidden();
  if (write && ["WORKSPACE_LOGO", "PROJECT_COVER"].includes(record.entity_type) && role < 20) throw forbidden();
  // Existing entities may not be rebound to a project/workspace supplied by the caller.
  const entity = record.entity_identifier;
  if (record.entity_type === "WORKSPACE_LOGO" && resourceWorkspace(entity).id !== workspace.id) throw forbidden();
  if (record.entity_type === "PROJECT_COVER" && resourceProject(workspace, entity).id !== project?.id) throw forbidden();
  const issue = (localDB.issues || []).find((entry: any) => entry.id === entity);
  const page = (localDB.pages || []).find((entry: any) => entry.id === entity);
  const comment = (localDB.comments || []).find((entry: any) => entry.id === entity);
  const commentIssue = comment && (localDB.issues || []).find((entry: any) => entry.id === (comment.issue || comment.issue_id));
  for (const parent of [issue, page, comment, commentIssue].filter(Boolean)) {
    const parentProject = parent.project || parent.project_id;
    if (parentProject && resourceProject(workspace, parentProject).id !== project?.id) throw forbidden();
  }
  return { role, workspace: workspace.id, project: project?.id };
}

async function authorizeAsset(id: string, pathname: string, method: string, user: any) {
  const record = assetRecord(id) || attachmentRecord(id);
  if (!record) throw new ResourceAccessError(404, "NOT_FOUND", "Không tìm thấy thông tin tệp.");
  const access = await authorizeScope(record, pathname, method !== "get", user);
  if (method === "delete" && access.role < 20 && record.created_by !== user.id) throw forbidden();
  return record;
}

async function content(id: string): Promise<StoredAttachment | null> {
  if ([...(localDB._deleted_asset_ids || []), ...(localDB._deleted_attachment_ids || [])].includes(id)) return null;
  const cached = await getAttachment(id);
  if (cached?.base64) return cached;
  const record = assetRecord(id) || attachmentRecord(id);
  const url = record?.asset_url;
  // Recover content embedded in a previously confirmed shared snapshot.
  if (record?.is_uploaded !== false && typeof url === "string" && /^data:[^;,]+;base64,/.test(url)) {
    return {
      key: id,
      name: record.name || record.attributes?.name || "attachment",
      type: url.slice(5, url.indexOf(";")),
      base64: url.slice(url.indexOf(",") + 1),
      size: record.size || record.attributes?.size,
    };
  }
  return null;
}

function bindAsset(record: any, url: string, user: any): void {
  const profile = (localDB.users || []).find((candidate: any) => candidate.id === user?.id);
  if (record.entity_type === "USER_COVER") {
    if (profile) {
      profile.cover_image_url = url;
      profile.cover_image = url;
    }
  } else if (record.entity_type === "USER_AVATAR" || (record.user_asset && !record.entity_type)) {
    if (profile) {
      profile.avatar_url = url;
      profile.avatar = url;
    }
  } else if (record.entity_type === "PROJECT_COVER") {
    const project = (localDB.projects || []).find(
      (candidate: any) => candidate.id === record.entity_identifier || candidate.identifier === record.entity_identifier
    );
    if (project) project.cover_image = url;
  } else if (record.entity_type === "WORKSPACE_LOGO") {
    const workspace = (localDB.workspaces || []).find(
      (candidate: any) => candidate.id === record.entity_identifier || candidate.slug === record.entity_identifier
    );
    if (workspace) workspace.logo_url = url;
  }
}

async function confirm(id: string, user: any): Promise<RouteResult> {
  const asset = assetRecord(id);
  const attachment = attachmentRecord(id);
  if (!asset && !attachment) return fail(404, "Không tìm thấy mã tệp để xác nhận.");
  const file = await content(id);
  if (!file) return fail(409, "Chưa lưu được nội dung tệp. Không xác nhận upload thành công.");
  const url = attachmentDataUrl(file);
  for (const record of [asset, attachment].filter(Boolean)) {
    record.is_uploaded = true;
    record.asset_url = url;
    record.updated_at = new Date().toISOString();
  }
  if (asset) bindAsset(asset, url, user);
  saveDB();
  return ok(asset || attachment);
}

/** Metadata API stays in the DApp adapter. Renderers resolve content locally. */
export async function handleFileAssetRoute(method: string, url: string, body: any): Promise<RouteResult> {
  try {
    return await handleAuthorizedFileAssetRoute(method, url, body, authenticatedResourceUser());
  } catch (error) {
    if (!(error instanceof ResourceAccessError)) throw error;
    return { status: error.status, data: { code: error.code, error: error.message } };
  }
}

async function handleAuthorizedFileAssetRoute(method: string, url: string, body: any, user: any): Promise<RouteResult> {
  const pathname = url.split("?")[0].replace(/\/+$/, "");
  const segments = pathname.split("/").filter(Boolean);
  const id = decodeURIComponent(segments[segments.length - 1] || "");

  if (method === "post" && pathname.endsWith("/upload")) {
    const key = body?.asset_id || body?.id || body?.key;
    if (!key || typeof body?.base64 !== "string" || !body.base64)
      return fail(400, "Thiếu mã tệp hoặc nội dung upload.");
    await authorizeAsset(key, pathname, method, user);
    await saveAttachment(key, {
      name: body.name || "attachment",
      base64: body.base64,
      type: body.type || "application/octet-stream",
      size: body.size,
    });
    const file = await getAttachment(key);
    if (!file) return fail(503, "Chưa đọc lại được tệp vừa lưu.");
    return ok({
      id: key,
      asset_id: key,
      asset_url: attachmentDataUrl(file),
      file_url: attachmentDataUrl(file),
      success: true,
    });
  }

  if (method === "post" && pathname.endsWith("/bulk")) {
    const ids = [...new Set<string>(Array.isArray(body?.asset_ids) ? body.asset_ids : [])];
    // Authorize the complete batch before confirming any record.
    await Promise.all(ids.map((key) => authorizeAsset(key, pathname, method, user)));
    const files = await Promise.all(ids.map(content));
    if (files.some((file) => !file)) return fail(409, "Một số tệp chưa có nội dung; chưa xác nhận upload.");
    const results = await Promise.all(ids.map((key) => confirm(key, user)));
    const failed = results.find((result) => result.status >= 400);
    return failed || ok({ success: true, asset_ids: ids });
  }

  if (method === "get" && pathname.includes("/check/")) {
    if (!assetRecord(id) && !attachmentRecord(id)) return ok({ exists: false });
    await authorizeAsset(id, pathname, method, user);
    return ok({ exists: Boolean(await content(id)) });
  }
  if (method === "post" && pathname.includes("/restore/")) {
    await authorizeAsset(id, pathname, method, user);
    const file = await content(id);
    return file
      ? ok({ id, asset_id: id, asset_url: attachmentDataUrl(file), is_uploaded: true })
      : fail(404, "Không còn nội dung tệp để khôi phục.");
  }

  if (method === "post" && pathname.includes("/duplicate-assets/")) {
    const original = await authorizeAsset(id, pathname, method, user);
    const destination = {
      ...original,
      entity_type: body?.entity_type || original.entity_type,
      entity_identifier: body?.entity_id,
      created_by: user.id,
    };
    await authorizeScope(destination, pathname, true, user);
    const source = await content(id);
    if (!source) return fail(404, "Không có nội dung tệp gốc để sao chép.");
    const key = makeId();
    await saveAttachment(key, source);
    const clone = {
      ...destination,
      id: key,
      asset_id: key,
      name: source.name,
      entity_type: body?.entity_type || original?.entity_type,
      entity_identifier: body?.entity_id,
      asset_url: attachmentDataUrl(source),
      is_uploaded: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (!localDB.assets) localDB.assets = [];
    localDB.assets.push(clone);
    saveDB();
    return ok(clone);
  }

  if (method === "post") {
    // Only collection URLs can initialize metadata. Restore/other actions must
    // never silently create a phantom asset via the generic POST handler.
    if (!/(?:\/user-assets|\/workspaces\/[^/]+(?:\/projects\/[^/]+)?)$/.test(pathname))
      return fail(404, "Thao tác tệp không được hỗ trợ.");
    const key = makeId();
    const record = {
      id: key,
      asset_id: key,
      entity_type: body?.entity_type,
      entity_identifier: body?.entity_identifier,
      name: body?.name || "attachment",
      size: body?.size || 0,
      type: body?.type || "application/octet-stream",
      user_asset: pathname.endsWith("/user-assets"),
      workspace: pathname.match(/\/workspaces\/([^/]+)/)?.[1],
      project: pathname.match(/\/projects\/([^/]+)/)?.[1],
      created_by: user.id,
      is_uploaded: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (record.user_asset) {
      if (record.entity_type && !["USER_AVATAR", "USER_COVER"].includes(record.entity_type)) throw forbidden();
      if (record.entity_identifier && record.entity_identifier !== user.id) throw forbidden();
      record.entity_identifier = user.id;
    } else if (["USER_AVATAR", "USER_COVER"].includes(record.entity_type)) throw forbidden();
    const scope = await authorizeScope(record, pathname, true, user);
    record.workspace = scope.workspace;
    record.project = scope.project;
    if (!localDB.assets) localDB.assets = [];
    localDB.assets.push(record);
    saveDB({ localOnly: true });
    return ok({
      ...record,
      asset_url: "",
      upload_data: { url: "/api/assets/v2/upload/", fields: { asset_id: key, key, "Content-Type": record.type } },
    });
  }

  if (["get", "patch", "delete"].includes(method)) await authorizeAsset(id, pathname, method, user);
  if (method === "patch") return confirm(id, user);

  if (method === "get") {
    const file = await content(id);
    if (!file) return fail(404, "Không tìm thấy nội dung tệp trên thiết bị hoặc snapshot đã đồng bộ.");
    return ok({
      id,
      asset_id: id,
      name: file.name,
      type: file.type,
      size: file.size,
      base64: file.base64,
      asset_url: attachmentDataUrl(file),
      file_url: attachmentDataUrl(file),
      is_uploaded: true,
    });
  }

  if (method === "delete") {
    const removedAttachments = (localDB.attachments || []).filter((asset: any) => asset.id === id || asset.asset_id === id);
    await deleteAttachment(id);
    localDB._deleted_asset_ids = [...new Set([...(localDB._deleted_asset_ids || []), id])];
    if (removedAttachments.length)
      localDB._deleted_attachment_ids = [...new Set([...(localDB._deleted_attachment_ids || []), id, ...removedAttachments.map((asset: any) => asset.id)])];
    localDB.assets = (localDB.assets || []).filter((asset: any) => asset.id !== id && asset.asset_id !== id);
    localDB.attachments = (localDB.attachments || []).filter((asset: any) => asset.id !== id && asset.asset_id !== id);
    const affectedIssues = new Set(removedAttachments.map((asset: any) => asset.issue || asset.issue_id));
    for (const issue of localDB.issues || []) {
      if (affectedIssues.has(issue.id)) issue.attachment_count = localDB.attachments.filter((asset: any) => (asset.issue || asset.issue_id) === issue.id).length;
    }
    saveDB();
    return ok({ success: true, deleted: id });
  }
  return fail(405, "Thao tác tệp không được hỗ trợ.");
}
