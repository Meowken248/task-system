import type { RouteResult } from "./types";
import { localDB, saveDB } from "./store";
import { saveAttachment, getAttachment, deleteAttachment, type StoredAttachment } from "../file/attachment-storage";
import { attachmentDataUrl } from "../file/asset-source";

const ok = (data: any): RouteResult => ({ status: 200, data });
const fail = (status: number, error: string): RouteResult => ({ status, data: { error } });
const assetRecord = (id: string) =>
  (localDB.assets || []).find((asset: any) => asset.id === id || asset.asset_id === id);
const attachmentRecord = (id: string) =>
  (localDB.attachments || []).find((asset: any) => asset.id === id || asset.asset_id === id);
const makeId = () =>
  `asset_${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;

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
export async function handleFileAssetRoute(method: string, url: string, body: any, user: any): Promise<RouteResult> {
  const pathname = url.split("?")[0].replace(/\/+$/, "");
  const segments = pathname.split("/").filter(Boolean);
  const id = decodeURIComponent(segments[segments.length - 1] || "");

  if (method === "post" && pathname.endsWith("/upload")) {
    const key = body?.asset_id || body?.id || body?.key;
    if (!key || typeof body?.base64 !== "string" || !body.base64)
      return fail(400, "Thiếu mã tệp hoặc nội dung upload.");
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
    const files = await Promise.all(ids.map(content));
    if (files.some((file) => !file)) return fail(409, "Một số tệp chưa có nội dung; chưa xác nhận upload.");
    const results = await Promise.all(ids.map((key) => confirm(key, user)));
    const failed = results.find((result) => result.status >= 400);
    return failed || ok({ success: true, asset_ids: ids });
  }

  if (method === "get" && pathname.includes("/check/")) return ok({ exists: Boolean(await content(id)) });
  if (method === "post" && pathname.includes("/restore/")) {
    const file = await content(id);
    return file
      ? ok({ id, asset_id: id, asset_url: attachmentDataUrl(file), is_uploaded: true })
      : fail(404, "Không còn nội dung tệp để khôi phục.");
  }

  if (method === "post" && pathname.includes("/duplicate-assets/")) {
    const source = await content(id);
    if (!source) return fail(404, "Không có nội dung tệp gốc để sao chép.");
    const key = makeId();
    await saveAttachment(key, source);
    const original = assetRecord(id) || attachmentRecord(id);
    const clone = {
      ...original,
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
      is_uploaded: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (!localDB.assets) localDB.assets = [];
    localDB.assets.push(record);
    saveDB({ localOnly: true });
    return ok({
      ...record,
      asset_url: "",
      upload_data: { url: "/api/assets/v2/upload/", fields: { asset_id: key, key, "Content-Type": record.type } },
    });
  }

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
    await deleteAttachment(id);
    localDB._deleted_asset_ids = [...new Set([...(localDB._deleted_asset_ids || []), id])];
    localDB.assets = (localDB.assets || []).filter((asset: any) => asset.id !== id && asset.asset_id !== id);
    localDB.attachments = (localDB.attachments || []).filter((asset: any) => asset.id !== id && asset.asset_id !== id);
    saveDB();
    return ok({ success: true, deleted: id });
  }
  return fail(405, "Thao tác tệp không được hỗ trợ.");
}
