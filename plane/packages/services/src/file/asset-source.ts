import { localDB } from "../dapp/store";
import { getAttachment, type StoredAttachment } from "./attachment-storage";

/** Browser-loadable content; an API metadata URL is never an image source. */
export function isDirectAssetSource(source: string): boolean {
  return /^(https?:\/\/|blob:|data:)/i.test(source) && !/\/api\/(?:public\/)?assets\//i.test(source);
}

export function getLocalAssetId(source: string): string {
  if (!source || isDirectAssetSource(source)) return "";
  const clean = source.split(/[?#]/)[0].replace(/\/+$/, "");
  const tail = clean.split("/").pop() || "";
  try {
    return decodeURIComponent(tail);
  } catch {
    return "";
  }
}

export function attachmentDataUrl(file: Pick<StoredAttachment, "base64" | "type">): string {
  return file.base64.startsWith("data:")
    ? file.base64
    : `data:${file.type || "application/octet-stream"};base64,${file.base64}`;
}

/** Resolve saved editor IDs and legacy API paths locally, including after reload.
 * Shared snapshots may carry the content URL when the local byte cache is absent.
 * No raw image/download request is sent to an HTTP backend.
 */
export async function resolveAssetSource(source: string): Promise<string> {
  if (!source) return "";
  if (isDirectAssetSource(source)) return source;
  const id = getLocalAssetId(source);
  if (!id) throw new Error("Đường dẫn tệp không hợp lệ.");
  if ([...(localDB._deleted_asset_ids || []), ...(localDB._deleted_attachment_ids || [])].includes(id))
    throw new Error("Tệp này đã được xóa.");
  const stored = await getAttachment(id);
  if (stored?.base64) return attachmentDataUrl(stored);
  const record = [...(localDB.assets || []), ...(localDB.attachments || [])].find((asset: any) =>
    [asset.id, asset.asset_id, asset.asset].includes(id)
  );
  for (const url of [record?.asset_url, record?.file_url]) {
    if (typeof url === "string" && isDirectAssetSource(url)) return url;
  }
  if (typeof record?.base64 === "string" && record.base64) return attachmentDataUrl(record);
  throw new Error("Không tìm thấy nội dung tệp trên thiết bị hoặc dữ liệu đã đồng bộ. Hãy tải lại tệp gốc.");
}
