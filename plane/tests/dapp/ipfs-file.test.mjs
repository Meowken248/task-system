import "./browser.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { beforeEach, test } from "node:test";
import { pinSharedFile, readSharedFile } from "../../packages/services/src/file/ipfs-file.ts";
import { resolveAssetSource } from "../../packages/services/src/file/asset-source.ts";
import { localDB } from "../../packages/services/src/dapp/store.ts";
let pinned;
beforeEach(() => {
  pinned = new Map();
  process.env.VITE_PINATA_PROXY_URL = "https://storage.fixture/pin";
  process.env.VITE_IPFS_GATEWAYS = "https://files.fixture/ipfs/";
  globalThis.fetch = async (url, options = {}) => {
    if (url === "https://storage.fixture/pin") {
      assert.equal(options.method, "POST");
      const cid = "Qm" + createHash("sha256").update(options.body).digest("hex").slice(0, 44).replaceAll("0", "A");
      pinned.set(cid, JSON.parse(options.body));
      return Response.json({ cid });
    }
    assert(String(url).startsWith("https://files.fixture/ipfs/"), "No real gateway access");
    const data = pinned.get(String(url).split("/").at(-1));
    return data ? Response.json(data) : new Response("missing", { status: 404 });
  };
});
test("a file is shared as bounded chunks with exact verified bytes on another device", async () => {
  const bytes = new Uint8Array(600_000); bytes.fill(57); bytes[3] = 0;
  const file = new File([bytes], "report.pdf", { type: "application/pdf" });
  const result = await pinSharedFile(file);
  assert.equal(pinned.get(result.cid).kind, "plane-file-v1");
  assert.equal(pinned.get(result.cid).chunks.length, 2);
  const secondDevice = await import("../../packages/services/src/file/ipfs-file.ts?device=second");
  const read = await secondDevice.readSharedFile(result.cid, undefined, result.sha256);
  assert.deepEqual(read.bytes, bytes);
  localDB.assets = [{ id: "shared-file", storage: "ipfs-file", is_uploaded: true, ipfs_cid: result.cid, content_hash: result.sha256 }];
  assert((await resolveAssetSource("shared-file")).startsWith("data:application/pdf;base64,"));
  assert.equal(localDB.assets[0].base64, undefined, "Shared snapshots store the reference, not file bytes");
});
test("a corrupt gateway chunk never becomes a successful download", async () => {
  const result = await pinSharedFile(new File(["original bytes"], "integrity.txt", { type: "text/plain" }));
  const chunkCid = pinned.get(result.cid).chunks[0].cid;
  pinned.get(chunkCid).base64 = Buffer.from("tampered bytes").toString("base64");
  const secondDevice = await import("../../packages/services/src/file/ipfs-file.ts?device=tampered");
  await assert.rejects(secondDevice.readSharedFile(result.cid), /không khớp/);
});
test("cancellation and invalid size do not report upload success", async () => {
  await assert.rejects(pinSharedFile(new File([], "empty")), /nội dung/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(pinSharedFile(new File(["cancel"], "cancel.txt"), controller.signal), /hủy/);
  assert.equal(pinned.size, 0);
});
