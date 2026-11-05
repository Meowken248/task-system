import assert from "node:assert/strict";
import { test } from "node:test";
import { readIpfsImage } from "../../packages/services/src/file/ipfs-image-reader.ts";

const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64"
);
const policy = { totalTimeoutMs: 250, attemptTimeoutMs: 35, fallbackDelayMs: 5, retryDelayMs: 1 };

test("the preferred healthy gateway completes without requesting blocked fallbacks", async () => {
  const reads = [];
  globalThis.fetch = async (url) => {
    reads.push(url);
    return new Response(image);
  };
  assert.equal(await readIpfsImage(["preferred", "blocked"], undefined, policy), "preferred");
  assert.deepEqual(reads, ["preferred"]);
});

test("403 and CORS failures do not prevent another gateway confirming the image", async () => {
  globalThis.fetch = async (url) => {
    if (url === "forbidden") return new Response("forbidden", { status: 403 });
    if (url === "cors") throw new TypeError("Failed to fetch");
    return new Response(image);
  };
  assert.equal(await readIpfsImage(["forbidden", "cors", "healthy"], undefined, policy), "healthy");
});

test("a new CID is retried after 404/503 propagation failures without another upload", async () => {
  let reads = 0;
  globalThis.fetch = async (_url, options) => {
    assert.notEqual(options.method, "POST");
    return ++reads < 3 ? new Response("not ready", { status: reads === 1 ? 404 : 503 }) : new Response(image);
  };
  assert.equal(await readIpfsImage(["warming"], undefined, policy), "warming");
  assert.equal(reads, 3);
});

test("a forbidden gateway is not retried while another replica warms up", async () => {
  let denied = 0,
    reads = 0;
  globalThis.fetch = async (url) => {
    if (url === "blocked") {
      denied++;
      return new Response("denied", { status: 403 });
    }
    return ++reads === 1 ? new Response("warming", { status: 503 }) : new Response(image);
  };
  assert.equal(await readIpfsImage(["blocked", "warming"], undefined, policy), "warming");
  assert.equal(denied, 1);
});

test("a stalled primary cannot block a healthy fallback and its request is aborted", async () => {
  let primarySignal;
  globalThis.fetch = async (url, options) => {
    if (url === "stalled") {
      primarySignal = options.signal;
      return new Promise(() => {});
    }
    return new Response(image);
  };
  assert.equal(await readIpfsImage(["stalled", "healthy"], undefined, policy), "healthy");
  assert.equal(primarySignal.aborted, true);
});

test("the deadline bounds a response body which ignores AbortSignal", async () => {
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        pull() {
          return new Promise(() => {});
        },
      })
    );
  const started = Date.now();
  await assert.rejects(readIpfsImage(["stalled-body"], undefined, policy), /IPFS/);
  assert(Date.now() - started < 1000);
});

test("cancellation rejects promptly even if a gateway ignores its signal", async () => {
  let enter;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  globalThis.fetch = async () => {
    enter();
    return new Promise(() => {});
  };
  const controller = new AbortController();
  const pending = readIpfsImage(["stalled"], controller.signal, policy);
  await entered;
  controller.abort();
  await assert.rejects(pending, /IPFS/);
});

test("HTML gateway responses never count as a successful image and are not retried", async () => {
  let reads = 0;
  globalThis.fetch = async () => {
    reads++;
    return new Response("<html>temporarily unavailable</html>");
  };
  await assert.rejects(readIpfsImage(["html"], undefined, policy), /IPFS/);
  assert.equal(reads, 1);
});

test("Retry-After cannot cause a read to escape the total deadline", async () => {
  let reads = 0;
  globalThis.fetch = async () => {
    reads++;
    return new Response("busy", { status: 429, headers: { "Retry-After": "30" } });
  };
  await assert.rejects(readIpfsImage(["rate-limited"], undefined, { ...policy, totalTimeoutMs: 30 }), /IPFS/);
  assert.equal(reads, 1);
});
