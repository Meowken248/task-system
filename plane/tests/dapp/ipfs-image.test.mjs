// oxlint-disable-next-line import/no-unassigned-import -- Install the isolated browser first.
import "./browser.mjs";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { pinPresentationImage } from "../../packages/services/src/file/ipfs-image.ts";
import { imageIpfsFixture } from "./ipfs-image-fixture.mjs";
const png = () => new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64")], "pixel.png", { type: "image/png" });
let fixture;
beforeEach(() => { fixture = imageIpfsFixture(); globalThis.fetch = fixture.fetch; });
test("IPFS receives exact original file bytes, not JSON or base64", async () => {
  const image = png();
  const result = await pinPresentationImage(image);
  assert.deepEqual(fixture.files.get(result.cid).bytes, new Uint8Array(await image.arrayBuffer()));
  assert.equal(result.url, `https://image-gateway.fixture/ipfs/${result.cid}`);
});
test("unsupported content and oversized images do not reach the proxy", async () => {
  await assert.rejects(pinPresentationImage(new File(["not an image"], "fake.png", { type: "image/png" })), /PNG/);
  await assert.rejects(pinPresentationImage(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })), /5 MB/);
  assert.equal(fixture.requests.length, 0);
});
test("invalid provider CID and gateway content are not successful uploads", async () => {
  globalThis.fetch = async () => Response.json({ cid: "invalid" });
  await assert.rejects(pinPresentationImage(png()), /CID/);
  globalThis.fetch = fixture.fetch; fixture.badGateway = true;
  await assert.rejects(pinPresentationImage(png()), /IPFS/);
});
test("cancellation aborts an ongoing pin request", async () => {
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    started();
  });
  const controller = new AbortController();
  const pending = pinPresentationImage(png(), controller.signal);
  await entered; controller.abort();
  await assert.rejects(pending);
});
