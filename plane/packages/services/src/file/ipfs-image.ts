import { getProxyUrl, getConfiguredIpfsGateways } from "../dapp/chain";
import { isPublishedCID } from "../dapp/snapshot-upload";
import { MAX_PRESENTATION_IMAGE_BYTES, presentationImageMime } from "./image-policy";
import { readIpfsImage } from "./ipfs-image-reader";
import { recordPresetPin, verifyCoverPreset } from "./cover-presets";

export async function verifyIpfsImage(cid: string, signal?: AbortSignal): Promise<string> {
  if (!isPublishedCID(cid)) throw new Error("Dịch vụ lưu ảnh trả CID không hợp lệ.");
  const gateways = getConfiguredIpfsGateways(cid).filter((url) => /^https?:\/\//.test(url));
  if (!gateways.length) throw new Error("Chưa cấu hình gateway đọc ảnh IPFS.");
  try {
    return await readIpfsImage(gateways, signal);
  } catch {
    throw new Error(
      signal?.aborted ? "Đã hủy upload ảnh." : "Chưa đọc được ảnh từ IPFS. Ảnh cũ vẫn được giữ; hãy thử lại."
    );
  }
}

/** Sends original image bytes to the existing proxy. No base64 or local byte cache. */
export async function pinPresentationImage(
  file: File,
  signal?: AbortSignal,
  preset?: { assetId: string; presetKey: string }
): Promise<{ cid: string; url: string }> {
  if (!file.size || file.size > MAX_PRESENTATION_IMAGE_BYTES)
    throw new Error("Ảnh phải có nội dung và không vượt quá 5 MB.");
  const mime = presentationImageMime(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!mime) throw new Error("Chỉ hỗ trợ ảnh PNG, JPEG hoặc WebP hợp lệ.");
  const presetKey = preset ? await verifyCoverPreset(file, preset.presetKey) : undefined;
  if (preset && !preset.assetId) throw new Error("Thiếu mã tệp ảnh mẫu.");
  const endpoint = getProxyUrl();
  if (!endpoint) throw new Error("Chưa cấu hình dịch vụ lưu ảnh IPFS.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort();
  }, 45000);
  try {
    if (signal?.aborted) throw new Error("Đã hủy upload ảnh.");
    const form = new FormData();
    form.append("file", new Blob([await file.arrayBuffer()], { type: mime }), file.name);
    const response = await fetch(endpoint, { method: "POST", body: form, signal: controller.signal });
    if (!response.ok)
      throw new Error(`Dịch vụ lưu ảnh IPFS chưa hoàn tất upload (${response.status}). Ảnh cũ vẫn được giữ.`);
    const result = await response.json();
    if (!isPublishedCID(result?.cid)) throw new Error("Dịch vụ lưu ảnh IPFS trả CID không hợp lệ.");
    // Upload and retrieval have separate deadlines so pinning does not consume
    // the time needed to read and verify the complete image from a gateway.
    clearTimeout(timer);
    if (preset && presetKey) {
      if (controller.signal.aborted) throw new Error("Đã hủy upload ảnh.");
      const url = getConfiguredIpfsGateways(result.cid).find((value) => /^https?:\/\//.test(value));
      if (!url) throw new Error("Chưa cấu hình gateway đọc ảnh IPFS.");
      recordPresetPin(preset.assetId, result.cid, url, presetKey);
      return { cid: result.cid, url };
    }
    return { cid: result.cid, url: await verifyIpfsImage(result.cid, controller.signal) };
  } catch (error) {
    if (signal?.aborted) throw new Error("Đã hủy upload ảnh.", { cause: error });
    if (timedOut) throw new Error("Dịch vụ IPFS phản hồi quá lâu. Ảnh cũ vẫn được giữ; hãy thử lại.", { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
