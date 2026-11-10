import assert from "node:assert/strict";
import { test } from "node:test";
import { saveFallbackDocument } from "../../apps/web/core/helpers/page-fallback.ts";
import { decodePageBinary } from "../../packages/services/src/dapp/page-binary.ts";

function fixture() {
  let doc = { binary: new Uint8Array([0, 0]), html: "<p></p>", json: {} };
  let revision = 0, current = true;
  const applied = [], saved = [];
  const args = {
    editor: { getDocument: () => doc, setProviderDocument: (bytes) => { applied.push(bytes); } },
    knownHtml: "<p></p>", hydrate: true, revision: () => revision, isCurrent: () => current,
    fetchBinary: async () => new ArrayBuffer(0), fromHtml: () => new Uint8Array([0, 0]),
    encode: (bytes) => Buffer.from(bytes).toString("base64"), save: async (payload) => { saved.push(payload); },
  };
  return { args, applied, saved, type: () => { revision++; doc = { ...doc, html: "<p>new typing</p>", binary: new Uint8Array([1, 2]) }; }, leave: () => { current = false; } };
}
test("binary decoding returns exact bytes and rejects malformed content", () => {
  assert.deepEqual([...new Uint8Array(decodePageBinary("AAECAw=="))], [0, 1, 2, 3]);
  assert.equal(decodePageBinary(undefined).byteLength, 0);
  assert.throws(() => decodePageBinary("<p>HTML</p>"));
});
test("typing while a fallback fetch is pending is preserved and saved", async () => {
  const f = fixture(); let resolve;
  f.args.fetchBinary = () => new Promise((done) => { resolve = done; });
  const pending = saveFallbackDocument(f.args);
  f.type(); resolve(new Uint8Array([9, 9]).buffer); await pending;
  assert.equal(f.applied.length, 0);
  assert.equal(f.saved[0].description_html, "<p>new typing</p>");
});
test("already dirty content is saved without fetching or replacing it", async () => {
  const f = fixture(); f.type();
  f.args.fetchBinary = async () => { throw Error("Dirty editor must not fetch old content"); };
  await saveFallbackDocument(f.args);
  assert.equal(f.applied.length, 0); assert.equal(f.saved.length, 1);
});
test("leaving a page during a fallback fetch neither applies nor saves old content", async () => {
  const f = fixture(); let resolve;
  f.args.fetchBinary = () => new Promise((done) => { resolve = done; });
  const pending = saveFallbackDocument(f.args); f.leave(); resolve(new ArrayBuffer(0)); await pending;
  assert.equal(f.applied.length, 0); assert.equal(f.saved.length, 0);
});
test("pristine legacy documents can hydrate once from HTML before saving", async () => {
  const f = fixture(); await saveFallbackDocument(f.args);
  assert.equal(f.applied.length, 1); assert.equal(f.saved.length, 1);
});
