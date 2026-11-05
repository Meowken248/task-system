/* oxlint-disable no-await-in-loop -- Poll a dedicated Chrome profile while exercising actual IPFS requests. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(path.resolve("apps/web/package.json"));
const { build } = createRequire(require.resolve("vite"))("esbuild");
const sourceEnv = require("dotenv").parse(fs.readFileSync("apps/web/.env"));
const config = {
  VITE_PINATA_PROXY_URL: sourceEnv.VITE_PINATA_PROXY_URL,
  VITE_IPFS_GATEWAYS: sourceEnv.VITE_IPFS_GATEWAYS,
};
assert(config.VITE_PINATA_PROXY_URL && config.VITE_IPFS_GATEWAYS);
const temp = path.resolve("tmp/cover-live-browser");
const output = path.resolve(process.env.PLANE_TEST_OUTPUT_DIR || "docs/verification/cover-upload-2026-11-03");
assert(output.startsWith(root + path.sep));
fs.mkdirSync(temp, { recursive: true });
fs.mkdirSync(output, { recursive: true });
const presetKey = process.env.PLANE_TEST_PRESET_KEY || null;
assert(!presetKey || /^IMAGE_([1-9]|1\d|2\d)$/.test(presetKey));
const jpeg = fs.readFileSync(`apps/web/app/assets/cover-images/image_${presetKey?.slice(6) || "1"}.jpg`);
const contents = `import {pinPresentationImage,verifyIpfsImage} from './packages/services/src/file/ipfs-image.ts';
import {getPresetPin,COVER_PRESET_SHA256} from './packages/services/src/file/cover-presets.ts';
window.__env__=${JSON.stringify(config)};
window.probe={done:false};
(async()=>{const started=Date.now();try{
const presetKey=${JSON.stringify(presetKey)};
const original=await(await fetch('/fixture.jpg')).arrayBuffer();
const result=await pinPresentationImage(new File([original],'plane-cover-live-check.jpg',{type:'image/jpeg'}),undefined,presetKey?{assetId:'live-preset',presetKey}:undefined);
const receipt=presetKey?getPresetPin('live-preset',result.cid,presetKey):undefined;
if(presetKey&&receipt?.sha256!==COVER_PRESET_SHA256[presetKey])throw Error('Preset pin acknowledgement missing');
const confirmed=presetKey?'/fixture.jpg':await verifyIpfsImage(result.cid);
const read=await fetch(confirmed);if(!read.ok)throw Error('Image read failed: '+read.status);
const bytes=new Uint8Array(await read.arrayBuffer());const expected=new Uint8Array(original);
const image=new Image();image.src=confirmed;document.body.append(image);await image.decode();
window.probe={done:true,cid:result.cid,url:result.url,presetKey,presetVerified:!!receipt,bytes:bytes.length,bytesEqual:bytes.length===expected.length&&bytes.every((v,i)=>v===expected[i]),width:image.naturalWidth,height:image.naturalHeight,ms:Date.now()-started};
}catch(error){window.probe={done:true,error:String(error?.message||error),ms:Date.now()-started}}})();`;
await build({
  stdin: { contents, resolveDir: root, sourcefile: "live-cover.ts" },
  bundle: true,
  platform: "browser",
  format: "esm",
  outfile: path.join(temp, "probe.js"),
  define: { "process.env": "{}", "import.meta.env": "{}" },
  logLevel: "silent",
});
const server = http.createServer((req, res) => {
  if (req.url === "/fixture.jpg") {
    res.setHeader("content-type", "image/jpeg");
    res.end(jpeg);
  } else if (req.url === "/probe.js") {
    res.setHeader("content-type", "text/javascript");
    res.end(fs.readFileSync(path.join(temp, "probe.js")));
  } else {
    res.setHeader("content-type", "text/html");
    res.end('<html><body><script type="module" src="/probe.js"></script></body></html>');
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const profile = path.join(temp, "profile-" + Date.now());
const chrome = spawn(
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  [
    "--headless=new",
    "--no-first-run",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-gpu",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" }
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket,
  session,
  serial = 0,
  result;
const pending = new Map();
const requests = new Map();
const network = [];
function send(method, params = {}, sessionId) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error("CDP timeout"));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
try {
  let address = [];
  for (let i = 0; i < 100; i++) {
    try {
      address = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").trim().split(/\r?\n/);
    } catch {}
    if (address.length === 2) break;
    await pause(100);
  }
  socket = new WebSocket(`ws://127.0.0.1:${address[0]}${address[1]}`);
  await once(socket, "open");
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data),
      request = pending.get(message.id);
    if (message.method === "Network.requestWillBeSent")
      requests.set(message.params.requestId, message.params.request.url);
    if (message.method === "Network.responseReceived") {
      const r = message.params.response;
      network.push({
        url: r.url.split("?")[0],
        status: r.status,
        cors: r.headers["access-control-allow-origin"],
        mime: r.mimeType,
      });
    }
    if (message.method === "Network.loadingFailed")
      network.push({
        url: requests.get(message.params.requestId)?.split("?")[0],
        error: message.params.errorText,
        cors: message.params.corsErrorStatus,
      });
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(Error(message.error.message));
    else request.resolve(message.result);
  });
  const target = await send("Target.createTarget", { url: "about:blank" });
  session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
  await send("Page.enable", {}, session);
  await send("Runtime.enable", {}, session);
  await send("Network.enable", {}, session);
  await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` }, session);
  for (let i = 0; i < 130; i++) {
    result = (await send("Runtime.evaluate", { expression: "window.probe", returnByValue: true }, session)).result
      .value;
    if (result?.done) break;
    await pause(1000);
  }
  const record = {
    actualChrome: true,
    actualProxy: true,
    actualIpfsGateway: !presetKey,
    mocks: false,
    sourceBytes: jpeg.length,
    realChainTransactions: 0,
    result,
    network,
  };
  fs.writeFileSync(path.join(output, "live-browser.json"), JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record, null, 2));
  assert.equal(result?.bytesEqual, true, result?.error || "Live IPFS test did not finish");
  assert(result.width > 0 && result.height > 0);
  if (presetKey) {
    assert.equal(result.presetVerified, true);
    assert.equal(network.filter(entry => entry.url?.includes('/ipfs/')).length, 0);
  }
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await send("Browser.close").catch(() => {});
    socket.close();
  }
  await Promise.race([once(chrome, "exit"), pause(3000)]);
  if (chrome.exitCode === null) chrome.kill();
  server.close();
}
