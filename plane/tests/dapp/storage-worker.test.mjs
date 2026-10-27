import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
const { default: worker } = await import(process.env.PLANE_WORKER_ARTIFACT || "../../pinata-worker.ts");
const cid = "Qm" + "a".repeat(44);
const env = { PINATA_JWT: "private-test-value" };
const request = (body) =>
  new Request("https://worker.test/", { method: "POST", headers: { "Content-Type": "application/json" }, body });
let calls;
beforeEach(() => {
  calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ IpfsHash: cid });
  };
});
const run = (body = "{}", bindings = env) => worker.fetch(request(body), bindings, {});
test("Worker preflight and method responses include CORS", async () => {
  const options = await worker.fetch(new Request("https://worker.test/", { method: "OPTIONS" }), env, {});
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("Access-Control-Allow-Origin"), "*");
  const get = await worker.fetch(new Request("https://worker.test/"), env, {});
  assert.equal(get.status, 405);
  assert.equal(calls, 0);
});
test("Worker returns a real provider CID without exposing a credential", async () => {
  const response = await run();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { cid });
  assert.equal(calls, 1);
});
test("Worker accepts legitimate JSON snapshots beyond the old 200 KB limit", async () => {
  const response = await run(JSON.stringify({ text: "x".repeat(220 * 1024) }));
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});
test("Worker enforces UTF-8 bytes rather than character count", async () => {
  const response = await run(JSON.stringify({ text: "🚀".repeat(400) }), { ...env, MAX_SNAPSHOT_BYTES: "1024" });
  assert.equal(response.status, 413);
  assert.equal(calls, 0);
});
test("Worker rejects invalid JSON or a non-object snapshot without a provider call", async () => {
  for (const input of ["{", "null", "[]"]) {
    const response = await run(input);
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
});
test("missing Worker credentials are an explicit configuration error", async () => {
  const response = await run("{}", {});
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, "STORAGE_CONFIGURATION");
  assert.equal(calls, 0);
});
test("upstream authorization failure is sanitized and distinguishable from transient 503", async () => {
  globalThis.fetch = async () => new Response("private-test-value", { status: 401 });
  const response = await run();
  assert.equal(response.status, 503);
  const body = await response.text();
  assert(body.includes("STORAGE_UPSTREAM_AUTH"));
  assert(!body.includes("private-test-value"));
});
test("Worker preserves Retry-After for the browser to respect", async () => {
  globalThis.fetch = async () => new Response("busy", { status: 429, headers: { "Retry-After": "30" } });
  const response = await run();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "30");
  assert.equal(response.headers.get("Access-Control-Expose-Headers"), "Retry-After");
});
test("Worker never returns a provider error body or an invalid success CID", async () => {
  globalThis.fetch = async () => Response.json({ IpfsHash: "not-a-cid", secret: "private-test-value" });
  const response = await run();
  assert.equal(response.status, 502);
  const text = await response.text();
  assert(!text.includes("private-test-value"));
  assert(text.includes("STORAGE_BAD_RESPONSE"));
});
test("Worker bounds an unresponsive provider with a structured 504", async () => {
  globalThis.fetch = () => new Promise(() => {});
  const response = await run("{}", { ...env, PINATA_TIMEOUT_MS: "1000" });
  assert.equal(response.status, 504);
  assert.equal((await response.json()).code, "STORAGE_UPSTREAM_TIMEOUT");
});
