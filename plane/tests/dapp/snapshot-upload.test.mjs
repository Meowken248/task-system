import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  publishSnapshot,
  snapshotUploadPolicy,
  SnapshotUploadError,
  subscribeSnapshotUploadState,
} from "../../packages/services/src/dapp/snapshot-upload.ts";
const cid = "Qm" + "a".repeat(44);
const policy = { timeoutMs: 100, totalTimeoutMs: 500, maxAttempts: 2, retryDelayMs: 0 };
let calls;
beforeEach(() => {
  calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ cid });
  };
});
afterEach(() => {
  delete navigator.onLine;
});
const publish = (options = {}) =>
  publishSnapshot("https://storage.test/", JSON.stringify({ snapshot: true }), { ...policy, ...options });
test("accepts a delayed valid storage response", async () => {
  globalThis.fetch = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return Response.json({ cid });
  };
  assert.equal(await publish(), cid);
  assert.equal(calls, 1);
});
test("retries a transient 503 with the exact same bytes", async () => {
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(options.body);
    calls++;
    return calls === 1 ? new Response("busy", { status: 503 }) : Response.json({ cid });
  };
  assert.equal(await publish(), cid);
  assert.equal(calls, 2);
  assert.equal(bodies[0], bodies[1]);
});
for (const status of [400, 401, 403, 413, 422])
  test(`does not retry permanent HTTP ${status}`, async () => {
    globalThis.fetch = async () => {
      calls++;
      return new Response("private upstream details", { status });
    };
    await assert.rejects(
      publish(),
      (error) => error instanceof SnapshotUploadError && error.status === status && !error.message.includes("private")
    );
    assert.equal(calls, 1);
  });
test("does not retry explicit Worker authentication failure even when HTTP is 503", async () => {
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ code: "STORAGE_UPSTREAM_AUTH" }, { status: 503 });
  };
  await assert.rejects(publish(), { code: "CONFIGURATION" });
  assert.equal(calls, 1);
});
test("offline is detected before making a request", async () => {
  Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
  await assert.rejects(publish(), { code: "OFFLINE" });
  assert.equal(calls, 0);
});
test("a network failure retries only within the attempt budget", async () => {
  globalThis.fetch = async () => {
    calls++;
    throw new TypeError("network");
  };
  await assert.rejects(publish(), { code: "NETWORK" });
  assert.equal(calls, 2);
});
test("an unresponsive fetch is bounded even if it ignores AbortSignal", async () => {
  globalThis.fetch = () => {
    calls++;
    return new Promise(() => {});
  };
  await assert.rejects(publish({ timeoutMs: 10 }), { code: "TIMEOUT" });
  assert.equal(calls, 2);
});
test("timeout covers reading the response body as well as headers", async () => {
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, status: 200, headers: new Headers(), json: () => new Promise(() => {}) };
  };
  await assert.rejects(publish({ timeoutMs: 10 }), { code: "TIMEOUT" });
  assert.equal(calls, 2);
});
test("does not accept success HTML or a fabricated CID", async () => {
  for (const response of [new Response("<html>not storage</html>"), Response.json({ cid: "local-fake-value" })]) {
    globalThis.fetch = async () => {
      calls++;
      return response;
    };
    await assert.rejects(publish(), { code: "INVALID_RESPONSE" });
  }
  assert.equal(calls, 2);
});
test("honours a Retry-After that exceeds the remaining budget without an early retry", async () => {
  globalThis.fetch = async () => {
    calls++;
    return new Response("busy", { status: 429, headers: { "Retry-After": "60" } });
  };
  await assert.rejects(publish(), (error) => error.code === "RATE_LIMIT" && error.retryAfterMs === 60000);
  assert.equal(calls, 1);
});
test("does not publish into a different user or workspace context", async () => {
  let current = true;
  globalThis.fetch = async () => {
    calls++;
    current = false;
    return Response.json({ cid });
  };
  await assert.rejects(
    publishSnapshot("https://storage.test/", "{}", policy, () => current),
    { code: "CONTEXT_CHANGED" }
  );
  assert.equal(calls, 1);
});
test("an already changed context makes no request", async () => {
  await assert.rejects(
    publishSnapshot("https://storage.test/", "{}", policy, () => false),
    { code: "CONTEXT_CHANGED" }
  );
  assert.equal(calls, 0);
});
test("invalid endpoints fail immediately without contacting a network", async () => {
  for (const url of [null, "invalid", "file:///snapshot"])
    await assert.rejects(publishSnapshot(url, "{}", policy), { code: "CONFIGURATION" });
  assert.equal(calls, 0);
});
test("progress follows attempt, retry, second attempt and completion", async () => {
  const phases = [];
  const unsubscribe = subscribeSnapshotUploadState((value) => phases.push(value.phase));
  phases.length = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1 ? new Response("busy", { status: 503 }) : Response.json({ cid });
  };
  try {
    await publish();
    assert.deepEqual(phases, ["uploading", "retrying", "uploading", "complete"]);
  } finally {
    unsubscribe();
  }
});
test("configured policy has safe bounds and does not turn invalid values into infinite waits", () => {
  const defaults = snapshotUploadPolicy(() => undefined);
  assert.equal(defaults.timeoutMs, 45000);
  assert.equal(defaults.maxAttempts, 2);
  const configured = snapshotUploadPolicy((key) =>
    key.includes("MAX_ATTEMPTS") ? "999" : key.includes("TIMEOUT") ? "NaN" : "-10"
  );
  assert.equal(configured.maxAttempts, 3);
  assert.equal(configured.timeoutMs, 45000);
  assert.equal(configured.retryDelayMs, 0);
});
