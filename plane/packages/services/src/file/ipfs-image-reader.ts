import { MAX_PRESENTATION_IMAGE_BYTES, presentationImageMime } from "./image-policy";

type ReadPolicy = {
  totalTimeoutMs?: number;
  attemptTimeoutMs?: number;
  fallbackDelayMs?: number;
  retryDelayMs?: number;
};

/** Read configured gateways with bounded retries while a newly pinned CID propagates. */
export async function readIpfsImage(
  gateways: string[],
  signal?: AbortSignal,
  policy: ReadPolicy = {}
): Promise<string> {
  const urls = [...new Set(gateways)];
  if (!urls.length) throw new Error("Chưa cấu hình gateway đọc ảnh IPFS.");
  const totalTimeoutMs = policy.totalTimeoutMs ?? 45000;
  const attemptTimeoutMs = policy.attemptTimeoutMs ?? 20000;
  const fallbackDelayMs = policy.fallbackDelayMs ?? 2000;
  const retryDelayMs = policy.retryDelayMs ?? 750;
  const controller = new AbortController();
  const unavailable = new Set<string>();
  const retryAfter = new Map<string, number>();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const totalTimer = setTimeout(abort, totalTimeoutMs);

  // Racing the deadline explicitly also bounds a stalled stream or adapter
  // which does not settle its promise when AbortSignal fires.
  const bounded = async <T>(operation: (attemptSignal: AbortSignal) => Promise<T>, delay: number): Promise<T> => {
    const attempt = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort!: (reason: Error) => void;
    const stop = () => {
      attempt.abort();
      rejectAbort(new Error("IPFS image read interrupted"));
    };
    const interrupted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    controller.signal.addEventListener("abort", stop, { once: true });
    try {
      const work = new Promise<T>((resolve, reject) => {
        start = setTimeout(() => {
          if (controller.signal.aborted) return stop();
          timer = setTimeout(stop, attemptTimeoutMs);
          operation(attempt.signal).then(resolve, reject);
        }, delay);
      });
      if (controller.signal.aborted) stop();
      return await Promise.race([work, interrupted]);
    } finally {
      clearTimeout(timer);
      clearTimeout(start);
      controller.signal.removeEventListener("abort", stop);
      attempt.abort();
    }
  };

  try {
    for (let round = 0; round < 3 && !controller.signal.aborted; round++) {
      const candidates = urls.filter((url) => !unavailable.has(url));
      if (!candidates.length) break;
      try {
        // The first configured gateway gets a head start. Fallbacks still run
        // concurrently; a blocked public gateway cannot hold up a healthy one.
        // oxlint-disable-next-line no-await-in-loop -- Retry read availability, never re-upload the image.
        return await Promise.any(
          candidates.map((url, index) =>
            bounded(
              async (attemptSignal) => {
                // CID content is immutable. Preserve normal HTTP caching so final
                // confirmation and rendering do not download the same image again.
                const response = await fetch(url, { signal: attemptSignal });
                if (!response.ok || !response.body) {
                  if ([400, 401, 403, 410].includes(response.status)) unavailable.add(url);
                  const seconds = Number(response.headers.get("Retry-After"));
                  if (response.status === 429 && Number.isFinite(seconds) && seconds > 0)
                    retryAfter.set(url, Date.now() + seconds * 1000);
                  void response.body?.cancel().catch(() => undefined);
                  throw new Error("Gateway chưa đọc được ảnh.");
                }
                const reader = response.body.getReader();
                let size = 0;
                let header = new Uint8Array();
                try {
                  while (true) {
                    // oxlint-disable-next-line no-await-in-loop -- Bound image bytes before accepting a gateway response.
                    const chunk = await reader.read();
                    if (chunk.done) break;
                    size += chunk.value.byteLength;
                    if (size > MAX_PRESENTATION_IMAGE_BYTES) throw new Error("Ảnh vượt giới hạn 5 MB.");
                    if (header.length < 12)
                      header = new Uint8Array([...header, ...chunk.value.slice(0, 12 - header.length)]);
                  }
                  if (!presentationImageMime(header)) {
                    unavailable.add(url);
                    throw new Error("CID không chứa ảnh PNG, JPEG hoặc WebP hợp lệ.");
                  }
                  return url;
                } finally {
                  void reader.cancel().catch(() => undefined);
                  reader.releaseLock();
                }
              },
              Math.max(
                index ? fallbackDelayMs : 0,
                (retryAfter.get(url) ?? 0) - Date.now(),
                round ? retryDelayMs * round : 0
              )
            )
          )
        );
      } catch {
        // Try the same CID again; freshly pinned content can be temporarily 404/5xx.
      }
    }
    throw new Error("Chưa đọc được ảnh từ các gateway IPFS. Ảnh cũ vẫn được giữ; hãy thử lại.");
  } finally {
    clearTimeout(totalTimer);
    signal?.removeEventListener("abort", abort);
    abort();
  }
}
