import { MAX_FILE_SIZE } from "@plane/constants";
import { getProxyUrl, getConfiguredIpfsGateways } from "../dapp/chain";
import { isPublishedCID } from "../dapp/snapshot-upload";

const CHUNK_BYTES = 512 * 1024;
const cache = new Map<string, SharedFile>();
export type SharedFile = { name: string; type: string; size: number; sha256: string; bytes: Uint8Array };
const hash = async (bytes: Uint8Array) => {
  if (!crypto.subtle) throw new Error("Trình duyệt cần HTTPS hoặc localhost để xác minh tệp.");
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const encode = (bytes: Uint8Array) => {
  let value = ""; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value);
};
const decode = (value: unknown) => {
  if (typeof value !== "string" || value.length > Math.ceil(CHUNK_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("Nội dung tệp không hợp lệ.");
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
};
async function deadline<T>(signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>, timeout = 20_000): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (signal?.aborted) throw new Error("Đã hủy upload tệp.");
    return await Promise.race([work(controller.signal), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Dịch vụ lưu tệp phản hồi quá lâu. Hãy thử lại.")); }, timeout);
      controller.signal.addEventListener("abort", () => reject(new Error("Yêu cầu tệp đã bị hủy.")), { once: true });
    })]);
  } finally { if (timer) clearTimeout(timer); controller.abort(); signal?.removeEventListener("abort", abort); }
}
async function boundedJson(response: Response) {
  if (!response.body) throw new Error("Gateway trả nội dung rỗng.");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 800_000) throw new Error("Phần tệp vượt giới hạn đọc.");
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function mapChunks<T, R>(values: T[], work: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await work(values[index], index);
    }
  }));
  return results;
}
async function pinJson(value: unknown, signal?: AbortSignal): Promise<string> {
  const endpoint = getProxyUrl();
  if (!endpoint) throw new Error("Chưa cấu hình dịch vụ lưu tệp dùng chung.");
  return deadline(signal, async (requestSignal) => {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value), signal: requestSignal });
    if (!response.ok) throw new Error(`Chưa lưu được tệp (${response.status}). Hãy thử lại.`);
    const result = await boundedJson(response);
    if (!isPublishedCID(result?.cid)) throw new Error("Dịch vụ lưu tệp trả CID không hợp lệ.");
    return result.cid;
  });
}
async function readJson(cid: string, signal?: AbortSignal): Promise<any> {
  if (!isPublishedCID(cid)) throw new Error("Mã tệp dùng chung không hợp lệ.");
  const urls = getConfiguredIpfsGateways(cid).filter((url) => /^https?:\/\//.test(url)).slice(0, 3);
  if (!urls.length) throw new Error("Chưa cấu hình gateway tải tệp.");
  return deadline(signal, async (requestSignal) => Promise.any(urls.map(async (url) => {
    const response = await fetch(url, { signal: requestSignal });
    if (!response.ok) throw new Error(`Gateway chưa đọc được tệp (${response.status}).`);
    return boundedJson(response);
  })));
}

/** Existing JSON storage proxy supports these bounded chunks; no Worker/env change is needed. */
export async function pinSharedFile(file: File, signal?: AbortSignal, progress?: (value: number) => void) {
  if (!file.size || file.size > MAX_FILE_SIZE) throw new Error("Tệp phải có nội dung và không vượt quá 5 MB.");
  return deadline(signal, async (operationSignal) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = await hash(bytes);
  let completed = 0;
  const parts = Array.from({ length: Math.ceil(bytes.length / CHUNK_BYTES) }, (_, index) => bytes.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES));
  const chunks = await mapChunks(parts, async (part) => {
    const digest = await hash(part);
    const cid = await pinJson({ kind: "plane-file-chunk-v1", base64: encode(part) }, operationSignal);
    completed += part.length;
    progress?.(Math.min(0.9, (completed / bytes.length) * 0.9));
    return { cid, sha256: digest, size: part.length };
  });
  const cid = await pinJson({ kind: "plane-file-v1", name: file.name, type: file.type || "application/octet-stream", size: bytes.length, sha256, chunks }, operationSignal);
  // Only a complete, verified retrieval acknowledges a shared upload.
  await readSharedFile(cid, operationSignal, sha256);
  progress?.(1);
  return { cid, sha256 };
  }, 60_000);
}

export async function readSharedFile(cid: string, signal?: AbortSignal, expectedHash?: string): Promise<SharedFile> {
  if (signal?.aborted) throw new Error("Đã hủy tải tệp.");
  const cached = cache.get(cid);
  if (cached && (!expectedHash || cached.sha256 === expectedHash)) return cached;
  return deadline(signal, async (operationSignal) => {
  const manifest = await readJson(cid, operationSignal);
  if (manifest?.kind !== "plane-file-v1" || typeof manifest.name !== "string" || typeof manifest.type !== "string" ||
    !Number.isSafeInteger(manifest.size) || manifest.size < 1 || manifest.size > MAX_FILE_SIZE ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256) || !Array.isArray(manifest.chunks) ||
    manifest.chunks.length !== Math.ceil(manifest.size / CHUNK_BYTES)) throw new Error("Thông tin tệp dùng chung không hợp lệ.");
  if (expectedHash && manifest.sha256 !== expectedHash) throw new Error("Nội dung tệp không khớp lần upload.");
  const bytes = new Uint8Array(manifest.size);
  const parts = await mapChunks(manifest.chunks as Array<{ cid: string; size: number; sha256: string }>, async (chunk, index) => {
    const expectedSize = Math.min(CHUNK_BYTES, manifest.size - index * CHUNK_BYTES);
    if (chunk.size !== expectedSize || !/^[a-f0-9]{64}$/.test(chunk.sha256)) throw new Error("Kích thước phần tệp không hợp lệ.");
    const data = await readJson(chunk.cid, operationSignal);
    if (data?.kind !== "plane-file-chunk-v1") throw new Error("Phần tệp không hợp lệ.");
    const part = decode(data.base64);
    if (part.length !== chunk.size || await hash(part) !== chunk.sha256) throw new Error("Nội dung phần tệp không khớp.");
    return part;
  });
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  if (offset !== bytes.length || await hash(bytes) !== manifest.sha256) throw new Error("Tệp tải về chưa đầy đủ hoặc không khớp.");
  const result: SharedFile = { name: manifest.name, type: manifest.type, size: manifest.size, sha256: manifest.sha256, bytes };
  if (operationSignal.aborted) throw new Error("Đã hủy tải tệp.");
  cache.set(cid, result); if (cache.size > 3) cache.delete(cache.keys().next().value!);
  return result;
  }, 60_000);
}

export async function sharedFileDataUrl(cid: string, signal?: AbortSignal, expectedHash?: string): Promise<string> {
  const file = await readSharedFile(cid, signal, expectedHash);
  return `data:${file.type};base64,${encode(file.bytes)}`;
}
