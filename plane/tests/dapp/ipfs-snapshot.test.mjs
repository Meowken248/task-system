import { test } from "node:test";
import assert from "node:assert/strict";
import { readIPFSSnapshot } from "../../packages/services/src/dapp/ipfs-snapshot.ts";

test("a slow first gateway does not delay a healthy replica", async () => {
  let slowSignal;
  globalThis.fetch = async (url, options) => {
    if (url === "slow") {
      slowSignal = options.signal;
      return new Promise(() => {});
    }
    return Response.json({ invitations: [{ id: "published" }] });
  };
  const result = await readIPFSSnapshot(["slow", "healthy"], 50);
  assert.equal(result.data.invitations[0].id, "published");
  assert.equal(slowSignal.aborted, true);
});

test("the deadline also bounds a stalled response body", async () => {
  globalThis.fetch = async () => ({ ok: true, text: () => new Promise(() => {}) });
  assert.equal(await readIPFSSnapshot(["stalled"], 15), null);
});

test("HTTP errors and malformed snapshots do not override a valid replica", async () => {
  globalThis.fetch = async (url) =>
    url === "http-error"
      ? new Response("down", { status: 503 })
      : url === "html"
        ? new Response("<html>error</html>")
        : url === "array"
          ? Response.json([])
          : Response.json({ invitations: [] });
  const result = await readIPFSSnapshot(["http-error", "html", "array", "valid"]);
  assert.deepEqual(result.data, { invitations: [] });
  assert.equal(await readIPFSSnapshot(["html", "array"]), null);
});
