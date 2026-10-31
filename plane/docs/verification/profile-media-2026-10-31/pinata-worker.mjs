// packages/services/src/file/image-policy.ts
var MAX_PRESENTATION_IMAGE_BYTES = 5 * 1024 * 1024;
function presentationImageMime(bytes) {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

// pinata-worker.ts
var StorageProxyError = class extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
};
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "Retry-After",
  "Access-Control-Max-Age": "86400"
};
var bounded = (raw, fallback, min, max) => {
  const value = raw?.trim() ? Number(raw) : Number.NaN;
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
};
var json = (status, value, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json", ...extra } });
async function readBoundedBody(request, limit, signal) {
  const declared = request.headers.get("Content-Length");
  if (declared && Number(declared) > limit) throw new StorageProxyError(413, "STORAGE_TOO_LARGE");
  if (!request.body) throw new StorageProxyError(400, "STORAGE_INVALID_REQUEST");
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  const cancel = () => {
    void reader.cancel().catch(() => void 0);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) {
        cancel();
        throw new StorageProxyError(413, "STORAGE_TOO_LARGE");
      }
      chunks.push(chunk.value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  if (signal.aborted) throw new StorageProxyError(504, "STORAGE_UPSTREAM_TIMEOUT");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
async function readBoundedJson(request, limit, signal) {
  const bytes = await readBoundedBody(request, limit, signal);
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new StorageProxyError(400, "STORAGE_INVALID_REQUEST");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new StorageProxyError(400, "STORAGE_INVALID_REQUEST");
  return parsed;
}
var pinata_worker_default = {
  async fetch(request, env, _ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json(405, { code: "METHOD_NOT_ALLOWED", error: "Use POST." });
    if (!env.PINATA_JWT)
      return json(500, {
        code: "STORAGE_CONFIGURATION",
        error: "Storage configuration requires administrator attention."
      });
    const maxBytes = bounded(env.MAX_SNAPSHOT_BYTES, 2 * 1024 * 1024, 1024, 16 * 1024 * 1024);
    const timeoutMs = bounded(env.PINATA_TIMEOUT_MS, 4e4, 1e3, 11e4);
    const controller = new AbortController();
    let timer;
    try {
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new StorageProxyError(504, "STORAGE_UPSTREAM_TIMEOUT"));
        }, timeoutMs);
      });
      const operation = (async () => {
        const multipart = request.headers.get("Content-Type")?.toLowerCase().startsWith("multipart/form-data;");
        let response;
        if (multipart) {
          const bytes = await readBoundedBody(request, MAX_PRESENTATION_IMAGE_BYTES + 64 * 1024, controller.signal);
          let form;
          try {
            form = await new Response(bytes.buffer, { headers: { "Content-Type": request.headers.get("Content-Type") } }).formData();
          } catch {
            throw new StorageProxyError(400, "STORAGE_INVALID_REQUEST");
          }
          const image = form.get("file");
          if (!image || typeof image === "string" || form.getAll("file").length !== 1 || !image.size)
            throw new StorageProxyError(400, "STORAGE_INVALID_IMAGE");
          if (image.size > MAX_PRESENTATION_IMAGE_BYTES) throw new StorageProxyError(413, "STORAGE_TOO_LARGE");
          const mime = presentationImageMime(new Uint8Array(await image.slice(0, 12).arrayBuffer()));
          if (!mime || image.type && image.type.replace("image/jpg", "image/jpeg") !== mime)
            throw new StorageProxyError(400, "STORAGE_INVALID_IMAGE");
          const payload = new FormData();
          const name = image.name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 128) || "image";
          payload.append("file", new Blob([await image.arrayBuffer()], { type: mime }), name);
          payload.append("pinataMetadata", JSON.stringify({ name }));
          response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
            method: "POST",
            headers: { Authorization: `Bearer ${env.PINATA_JWT}` },
            body: payload,
            signal: controller.signal
          });
        } else {
          const content = await readBoundedJson(request, maxBytes, controller.signal);
          response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.PINATA_JWT}` },
            body: JSON.stringify({ pinataContent: content, pinataMetadata: { name: "OffchainDataRegistry_Upload" } }),
            signal: controller.signal
          });
        }
        if (response.status === 401 || response.status === 403)
          return json(503, {
            code: "STORAGE_UPSTREAM_AUTH",
            error: "Storage configuration requires administrator attention."
          });
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const extra = retryAfter ? { "Retry-After": retryAfter } : {};
          return json(429, { code: "STORAGE_RATE_LIMIT", error: "Storage is busy. Retry later." }, extra);
        }
        if (!response.ok)
          return json(response.status === 413 ? 413 : 502, {
            code: response.status === 413 ? "STORAGE_TOO_LARGE" : "STORAGE_TEMPORARY",
            error: "Storage did not complete the upload."
          });
        let result;
        try {
          result = await response.json();
        } catch {
          throw new StorageProxyError(502, "STORAGE_BAD_RESPONSE");
        }
        if (typeof result?.IpfsHash !== "string" || !/^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{30,120})$/.test(result.IpfsHash))
          throw new StorageProxyError(502, "STORAGE_BAD_RESPONSE");
        return json(200, { cid: result.IpfsHash });
      })();
      return await Promise.race([operation, deadline]);
    } catch (error) {
      const failure = error instanceof StorageProxyError ? error : new StorageProxyError(502, "STORAGE_TEMPORARY");
      return json(failure.status, { code: failure.code, error: "Storage did not complete the upload." });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
};
export {
  pinata_worker_default as default
};
