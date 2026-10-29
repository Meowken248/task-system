/** Race configured replicas; the deadline includes reading and parsing the body. */
export async function readIPFSSnapshot(
  gateways: string[],
  timeoutMs = 15000
): Promise<{ data: Record<string, any>; text: string } | null> {
  const controllers = gateways.map(() => new AbortController());
  try {
    return await Promise.any(
      gateways.map(async (url, index) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            (async () => {
              const response = await fetch(url, {
                signal: controllers[index].signal,
                headers: { Accept: "application/json" },
              });
              if (!response.ok) throw new Error("Snapshot gateway unavailable");
              const text = await response.text();
              const data = JSON.parse(text);
              if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid snapshot");
              return { data, text };
            })(),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => {
                controllers[index].abort();
                reject(new Error("Snapshot gateway deadline exceeded"));
              }, timeoutMs);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      })
    );
  } catch {
    return null;
  } finally {
    controllers.forEach((controller) => controller.abort());
  }
}
