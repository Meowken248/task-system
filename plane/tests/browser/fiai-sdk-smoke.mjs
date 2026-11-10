/* oxlint-disable no-await-in-loop -- Ordered Chrome startup and SDK readiness polling. */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(path.resolve("apps/web/package.json"));
const { build } = createRequire(require.resolve("vite"))("esbuild");
const env = require("dotenv").parse(fs.readFileSync("apps/web/.env"));
const journal = JSON.parse(fs.readFileSync("docs/verification/fresh-deploy-2026-11-03/deployment.json"));
const settings = {
  rpcUrl: env.VITE_RPC_URL,
  wsUrl: env.VITE_WS_URL,
  chainId: Number(env.VITE_CHAIN_ID),
  frameUrls: {
    blockchainBridge: env.VITE_FIAI_BLOCKCHAIN_BRIDGE_URL,
    cryptoVault: env.VITE_FIAI_CRYPTO_VAULT_URL,
    fileProcessor: env.VITE_FIAI_FILE_PROCESSOR_URL,
    urlConnectWallet: env.VITE_URL_CONNECT_WALLET,
  },
  owner: journal.deployer,
  registry: env.VITE_WORKSPACE_REGISTRY_ADDRESS,
  tasks: env.VITE_CONTRACT_ADDRESS,
  slug: env.VITE_DEFAULT_WORKSPACE_SLUG,
};
const output = path.resolve("docs/verification/fresh-deploy-2026-11-03");
const temp = path.resolve("tmp/fiai-sdk-smoke-20261103");
fs.mkdirSync(temp, { recursive: true });
const workspaceAbi = JSON.parse(
  fs.readFileSync("artifacts/contracts/PlaneWorkspaceRegistry.sol/PlaneWorkspaceRegistry.json")
).abi;
const taskAbi = JSON.parse(fs.readFileSync("artifacts/contracts/PlaneTaskManager.sol/PlaneTaskManager.json")).abi;
const source = `import {FiaiSDK} from '@metanodejs/fiai-sdk';import {MtnContract} from '@metanodejs/mtn-contract';
window.probe={done:false};
(async()=>{try{const c=await(await fetch('/settings')).json();
const sdk=await FiaiSDK.init({container:document.body,timeout:25000,chainConfig:{rpcUrl:c.rpcUrl,wsUrl:c.wsUrl,chainId:c.chainId},frameUrls:c.frameUrls});window.fiaiSDK=sdk;
const registry=new MtnContract({from:c.owner,to:c.registry});
const role=await registry.sendTransaction({from:c.owner,to:c.registry,abiData:c.workspaceAbi.filter(a=>a.name==='getMemberRole'),functionName:'getMemberRole',feeType:'read',inputArray:[{name:'slug',type:'string',value:c.slug},{name:'member',type:'address',value:c.owner}],isReadOnly:true,gas:'3000000',amount:'0',value:'0',type:'transaction',bundleId:''});
const task=new MtnContract({from:c.owner,to:c.tasks});const count=await task.sendTransaction({from:c.owner,to:c.tasks,abiData:[{name:'taskCount',type:'function',stateMutability:'view',inputs:[],outputs:[{name:'',type:'uint256'}]}],functionName:'taskCount',feeType:'read',inputArray:[],isReadOnly:true,gas:'3000000',amount:'0',value:'0',type:'transaction',bundleId:''});
window.probe={done:true,initialized:true,role,taskCount:count};document.title='SDK verified';
}catch(e){window.probe={done:true,error:String(e?.message||e)};document.title='SDK read failed';}})();`;
await build({
  stdin: { contents: source, resolveDir: path.resolve("apps/web"), sourcefile: "sdk-smoke.ts" },
  bundle: true,
  platform: "browser",
  format: "esm",
  outfile: path.join(temp, "smoke.js"),
  define: { "process.env": "{}" },
});
const server = http.createServer((req, res) => {
  if (req.url === "/settings") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ...settings, workspaceAbi, taskAbi }));
  } else if (req.url === "/smoke.js") {
    res.setHeader("content-type", "text/javascript");
    res.end(fs.readFileSync(path.join(temp, "smoke.js")));
  } else {
    res.setHeader("content-type", "text/html");
    res.end(
      '<html><body><h1>Read-only FIAI SDK verification</h1><script type="module" src="/smoke.js"></script></body></html>'
    );
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
const pending = new Map();
let serial = 0,
  socket,
  session,
  result;
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
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(Error(message.error.message));
    else request.resolve(message.result);
  });
  const target = await send("Target.createTarget", { url: "about:blank" });
  session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
  await send("Runtime.enable", {}, session);
  await send("Page.enable", {}, session);
  await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` }, session);
  for (let i = 0; i < 80; i++) {
    const evaluation = await send("Runtime.evaluate", { expression: "window.probe", returnByValue: true }, session);
    result = evaluation.result.value;
    if (result?.done) break;
    await pause(1000);
  }
  const record = {
    method:
      "Actual current local FIAI SDK build and MtnContract in Chrome; actual localhost SDK frames; real configured RPC. Read-only, no wallet import, signing or transactions.",
    result,
  };
  fs.writeFileSync(path.join(output, "sdk-browser-read.json"), JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record, null, 2));
  assert.equal(result?.initialized, true, result?.error || "SDK read did not finish");
  assert.equal(Number(result.role), 3);
  assert.equal(Number(result.taskCount), 0);
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await send("Browser.close").catch(() => {});
    socket.close();
  }
  await Promise.race([once(chrome, "exit"), pause(3000)]);
  if (chrome.exitCode === null) chrome.kill();
  server.close();
}
