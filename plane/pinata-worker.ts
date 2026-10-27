/** Storage proxy. Deployment secrets remain in Worker environment bindings. */
import type { ExecutionContext } from "@cloudflare/workers-types";

export interface Env {
  PINATA_JWT: string;
  MAX_SNAPSHOT_BYTES?: string;
  PINATA_TIMEOUT_MS?: string;
}

class StorageProxyError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "Retry-After",
  "Access-Control-Max-Age": "86400",
};
const bounded = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const value = raw?.trim() ? Number(raw) : Number.NaN;
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
};
const json = (status: number, value: Record<string, unknown>, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json", ...extra } });

async function readBoundedJson(request: Request, limit: number, signal: AbortSignal): Promise<Record<string, unknown>> {
  const declared = request.headers.get("Content-Length");
  if (declared && Number(declared) > limit) throw new StorageProxyError(413, "STORAGE_TOO_LARGE");
  if (!request.body) throw new StorageProxyError(400, "STORAGE_INVALID_REQUEST");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      // oxlint-disable-next-line no-await-in-loop -- Bound streamed bytes before allocating a complete snapshot.
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new StorageProxyError(400, "STORAGE_INVALID_REQUEST");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new StorageProxyError(400, "STORAGE_INVALID_REQUEST");
  return parsed as Record<string, unknown>;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json(405, { code: "METHOD_NOT_ALLOWED", error: "Use POST." });
    if (!env.PINATA_JWT)
      return json(500, {
        code: "STORAGE_CONFIGURATION",
        error: "Storage configuration requires administrator attention.",
      });
    const maxBytes = bounded(env.MAX_SNAPSHOT_BYTES, 2 * 1024 * 1024, 1024, 16 * 1024 * 1024);
    const timeoutMs = bounded(env.PINATA_TIMEOUT_MS, 40_000, 1000, 110_000);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new StorageProxyError(504, "STORAGE_UPSTREAM_TIMEOUT"));
        }, timeoutMs);
      });
      const operation = (async () => {
        const content = await readBoundedJson(request, maxBytes, controller.signal);
        const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.PINATA_JWT}` },
          body: JSON.stringify({ pinataContent: content, pinataMetadata: { name: "OffchainDataRegistry_Upload" } }),
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403)
          return json(503, {
            code: "STORAGE_UPSTREAM_AUTH",
            error: "Storage configuration requires administrator attention.",
          });
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const extra: Record<string, string> = retryAfter ? { "Retry-After": retryAfter } : {};
          return json(429, { code: "STORAGE_RATE_LIMIT", error: "Storage is busy. Retry later." }, extra);
        }
        if (!response.ok)
          return json(response.status === 413 ? 413 : 502, {
            code: response.status === 413 ? "STORAGE_TOO_LARGE" : "STORAGE_TEMPORARY",
            error: "Storage did not complete the upload.",
          });
        let result: any;
        try {
          result = await response.json();
        } catch {
          throw new StorageProxyError(502, "STORAGE_BAD_RESPONSE");
        }
        if (
          typeof result?.IpfsHash !== "string" ||
          !/^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{30,120})$/.test(result.IpfsHash)
        )
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
  },
};
