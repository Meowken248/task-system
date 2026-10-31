import { getProxyUrl, getConfiguredIpfsGateways } from "../dapp/chain";
import { isPublishedCID } from "../dapp/snapshot-upload";
import { MAX_PRESENTATION_IMAGE_BYTES, presentationImageMime } from "./image-policy";

export async function verifyIpfsImage(cid: string, signal?: AbortSignal): Promise<string> {
  if (!isPublishedCID(cid)) throw new Error("Dịch vụ lưu ảnh trả CID không hợp lệ.");
  const gateways = getConfiguredIpfsGateways(cid).filter((url) => /^https?:\/\//.test(url));
  if (!gateways.length) throw new Error("Chưa cấu hình gateway đọc ảnh IPFS.");
  const controllers = gateways.map(() => new AbortController());
  const abort = () => controllers.forEach((controller) => controller.abort());
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw new Error("Đã hủy upload ảnh.");
    return await Promise.any(gateways.map(async (url, index) => {
      const timeout = setTimeout(() => controllers[index].abort(), 15000);
      try {
        const response = await fetch(url, { signal: controllers[index].signal });
        if (!response.ok || !response.body) throw new Error("Gateway chưa đọc được ảnh.");
        const reader = response.body.getReader();
        let size = 0;
        let header = new Uint8Array();
        try {
          while (true) {
            // oxlint-disable-next-line no-await-in-loop -- Bound streamed image bytes, including chunked responses.
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > MAX_PRESENTATION_IMAGE_BYTES) throw new Error("Ảnh vượt giới hạn 5 MB.");
            if (header.length < 12) header = new Uint8Array([...header, ...chunk.value.slice(0, 12 - header.length)]);
          }
          if (!presentationImageMime(header)) throw new Error("CID không chứa ảnh PNG, JPEG hoặc WebP hợp lệ.");
          return url;
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      } finally { clearTimeout(timeout); }
    }));
  } catch {
    throw new Error(signal?.aborted ? "Đã hủy upload ảnh." : "Chưa đọc được ảnh từ IPFS. Ảnh cũ vẫn được giữ; hãy thử lại.");
  } finally {
    signal?.removeEventListener("abort", abort);
    abort();
  }
}

/** Sends original image bytes to the existing proxy. No base64 or local byte cache. */
export async function pinPresentationImage(file: File, signal?: AbortSignal): Promise<{ cid: string; url: string }> {
  if (!file.size || file.size > MAX_PRESENTATION_IMAGE_BYTES) throw new Error("Ảnh phải có nội dung và không vượt quá 5 MB.");
  const mime = presentationImageMime(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!mime) throw new Error("Chỉ hỗ trợ ảnh PNG, JPEG hoặc WebP hợp lệ.");
  const endpoint = getProxyUrl();
  if (!endpoint) throw new Error("Chưa cấu hình dịch vụ lưu ảnh IPFS.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 45000);
  try {
    if (signal?.aborted) throw new Error("Đã hủy upload ảnh.");
    const form = new FormData();
    form.append("file", new Blob([await file.arrayBuffer()], { type: mime }), file.name);
    const response = await fetch(endpoint, { method: "POST", body: form, signal: controller.signal });
    if (!response.ok) throw new Error(`Dịch vụ lưu ảnh IPFS chưa hoàn tất upload (${response.status}). Ảnh cũ vẫn được giữ.`);
    const result = await response.json();
    if (!isPublishedCID(result?.cid)) throw new Error("Dịch vụ lưu ảnh IPFS trả CID không hợp lệ.");
    return { cid: result.cid, url: await verifyIpfsImage(result.cid, controller.signal) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
