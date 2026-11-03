"use strict";
(() => {
  // src/host/runtime/wallet-runtime-sw.ts
  var sw = self;
  var RUNTIME_CACHE_PREFIX = "fiai-runtime-";
  var RUNTIME_VERSION_KEY = "__version__";
  function getRuntimePathPrefix() {
    const pathname = new URL(sw.registration.scope).pathname;
    return pathname.endsWith("/") ? pathname : `${pathname}/`;
  }
  sw.addEventListener("install", () => {
    void sw.skipWaiting();
  });
  sw.addEventListener("activate", (event) => {
    event.waitUntil(sw.clients.claim());
  });
  sw.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    const runtimePrefix = getRuntimePathPrefix();
    if (!url.pathname.startsWith(runtimePrefix)) return;
    event.respondWith(handleRuntimeFetch(url, runtimePrefix));
  });
  async function handleRuntimeFetch(url, runtimePrefix) {
    const pathAfterRuntime = url.pathname.substring(runtimePrefix.length);
    console.log("[Wallet Runtime SW] pathAfterRuntime", pathAfterRuntime);
    const slashIndex = pathAfterRuntime.indexOf("/");
    if (slashIndex === -1) {
      return new Response("Not Found", { status: 404, statusText: "Not Found" });
    }
    const appId = pathAfterRuntime.substring(0, slashIndex);
    const filePath = pathAfterRuntime.substring(slashIndex + 1);
    if (!appId || !filePath) {
      return new Response("Not Found", { status: 404, statusText: "Not Found" });
    }
    const cacheName = RUNTIME_CACHE_PREFIX + appId;
    try {
      const cache = await caches.open(cacheName);
      const cacheKey = `/${filePath}`;
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        return cachedResponse;
      }
      if (!filePath.includes(".")) {
        const indexResponse = await cache.match("/index.html");
        if (indexResponse) {
          return indexResponse;
        }
      }
      return new Response(`File not found: ${filePath}`, {
        status: 404,
        statusText: "Not Found"
      });
    } catch {
      return new Response("Cache error", { status: 500, statusText: "Internal Error" });
    }
  }
  sw.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data.type !== "string") return;
    const port = event.ports[0];
    if (!port) return;
    switch (data.type) {
      case "install":
        void handleInstall(data, port);
        break;
      case "delete":
        void handleDelete(data, port);
        break;
      case "has-app":
        void handleHasApp(data, port);
        break;
      default:
        port.postMessage({ type: "error", message: `Unknown message type: ${data.type}` });
    }
  });
  async function handleInstall(msg, port) {
    try {
      const { appId, version, files } = msg;
      const cacheName = RUNTIME_CACHE_PREFIX + appId;
      await caches.delete(cacheName);
      const cache = await caches.open(cacheName);
      const puts = [];
      for (const file of files) {
        const normalizedPath = file.path.startsWith("/") ? file.path : `/${file.path}`;
        const response = new Response(file.content, {
          status: 200,
          statusText: "OK",
          headers: {
            "Content-Type": file.mimeType,
            "Content-Length": String(file.content.byteLength),
            "Cache-Control": "no-cache",
            // SW controls caching, not HTTP cache
            "X-Runtime-Version": version
          }
        });
        puts.push(cache.put(normalizedPath, response));
      }
      const versionResponse = new Response(version, {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
      puts.push(cache.put(`/${RUNTIME_VERSION_KEY}`, versionResponse));
      await Promise.all(puts);
      port.postMessage({ type: "installed", appId });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      port.postMessage({ type: "error", message: `Install failed: ${errorMessage}` });
    }
  }
  async function handleDelete(msg, port) {
    try {
      const cacheName = RUNTIME_CACHE_PREFIX + msg.appId;
      await caches.delete(cacheName);
      port.postMessage({ type: "deleted", appId: msg.appId });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      port.postMessage({ type: "error", message: `Delete failed: ${errorMessage}` });
    }
  }
  async function handleHasApp(msg, port) {
    try {
      const cacheName = RUNTIME_CACHE_PREFIX + msg.appId;
      const exists = await caches.has(cacheName);
      let version;
      if (exists) {
        const cache = await caches.open(cacheName);
        const versionResp = await cache.match(`/${RUNTIME_VERSION_KEY}`);
        if (versionResp) {
          version = await versionResp.text();
        }
      }
      port.postMessage({
        type: "app-status",
        appId: msg.appId,
        exists,
        version
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      port.postMessage({ type: "error", message: `Has-app check failed: ${errorMessage}` });
    }
  }
})();
//# sourceMappingURL=wallet-runtime-sw.js.map
