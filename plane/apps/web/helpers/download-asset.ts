import { resolveAssetSource } from "@plane/services";
import { downloadBase64File } from "@plane/utils";

/** Download actual bytes/content, never an API metadata response or fake proof. */
export async function downloadAsset(sources: string[], filename: string): Promise<void> {
  let url = "";
  for (const source of new Set(sources.filter(Boolean))) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- Try legacy identifiers only if the previous identifier has no content.
      url = await resolveAssetSource(source);
      if (url) break;
    } catch {
      /* Try another known identifier for this same attachment. */
    }
  }
  if (!url) throw new Error("Không tìm thấy nội dung tệp. Hãy mở trên thiết bị đã tải lên hoặc tải lại tệp gốc.");
  if (url.startsWith("data:")) {
    const mime = url.slice(5, url.indexOf(";")) || "application/octet-stream";
    downloadBase64File(url, filename, mime);
    return;
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener noreferrer";
  if (/^https?:\/\//i.test(url)) link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
