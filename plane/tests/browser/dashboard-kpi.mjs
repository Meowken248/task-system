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
const temp = path.resolve("tmp/dashboard-browser-20261103");
const output = path.resolve("docs/verification/dashboard-kpi-fix-2026-11-03");
fs.mkdirSync(temp, { recursive: true });
fs.mkdirSync(output, { recursive: true });
const fixture = path.resolve("tests/browser/dashboard-kpi.fixture.tsx");
await build({
  entryPoints: [fixture],
  bundle: true,
  outfile: path.join(temp, "app.js"),
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  nodePaths: [path.resolve("apps/web/node_modules")],
  define: { "process.env": "{}" },
  plugins: [
    {
      name: "explicit-test-adapters",
      setup(b) {
        const mocked = new Set([
          "@/services/project",
          "@/services/issue",
          "@/services/workspace.service",
          "@/services/issue/issue_comment.service",
          "@/services/issue/issue_attachment.service",
          "@/services/api.service",
          "@/hooks/store/user",
          "@plane/constants",
          "@/services/blockchain/plane-task-chain.service",
          "@/services/blockchain/metanode-wallet.service",
        ]);
        b.onResolve({ filter: /.*/ }, (args) => {
          if (mocked.has(args.path)) return { path: fixture };
          if (args.path === "@plane/services") return { path: "services-adapter", namespace: "fixture" };
          if (args.path === "../dapp/store" && args.importer.endsWith("asset-source.ts"))
            return { path: "store-adapter", namespace: "fixture" };
          if (args.path.startsWith("@/")) return { path: path.resolve("apps/web/core", args.path.slice(2) + ".ts") };
        });
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents:
            args.path === "services-adapter"
              ? `export { getStoredWalletAddress } from ${JSON.stringify(fixture)}; export { resolveAssetSource } from ${JSON.stringify(path.resolve("packages/services/src/file/asset-source.ts"))};`
              : `import { fixture } from ${JSON.stringify(fixture)}; export const localDB = fixture.localDB;`,
          loader: "ts",
          resolveDir: root,
        }));
      },
    },
  ],
});
const server = http.createServer((req, res) => {
  res.setHeader("content-type", req.url === "/app.js" ? "text/javascript" : "text/html");
  res.end(
    req.url === "/app.js"
      ? fs.readFileSync(path.join(temp, "app.js"))
      : '<!doctype html><html><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const profile = path.join(temp, "chrome-profile-" + Date.now());
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
  session;
const results = [],
  exceptions = [];
function send(method, params = {}, sessionId) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error("CDP timeout " + method));
    }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, session);
  if (result.exceptionDetails)
    throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression, label, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await pause(60);
  }
  throw Error("Timeout: " + label + "\n" + (await evaluate("document.body.innerText")));
}
const click = (text) =>
  evaluate(
    `(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)}));if(!button)throw Error('button missing');button.click()})()`
  );
const has = (text) => `document.body.textContent.includes(${JSON.stringify(text)})`;
try {
  const portFile = path.join(profile, "DevToolsActivePort");
  let address = [];
  for (let i = 0; i < 100; i++) {
    try {
      address = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/);
    } catch {
      /* Chrome may still be writing this file on Windows. */
    }
    if (address.length === 2 && /^\d+$/.test(address[0]) && address[1].startsWith("/devtools/browser/")) break;
    await pause(100);
  }
  const [port, endpoint] = address;
  if (!port || !endpoint) throw Error("Chrome debugging endpoint did not become ready");
  socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await once(socket, "open");
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error) request.reject(Error(message.error.message));
      else request.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
  });
  const target = await send("Target.createTarget", { url: "about:blank" });
  session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
  await send("Page.enable", {}, session);
  await send("Runtime.enable", {}, session);
  await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` }, session);
  await waitFor(has("RootTask"), "initial task load");
  await waitFor(
    "!![...document.querySelectorAll('button')].find(b=>b.textContent==='Làm mới'&&!b.disabled)",
    "initial reads complete"
  );
  assert.equal(await evaluate("dashboardFixture.posts"), 0);
  results.push("Dashboard initial load does not post or flush tracking writes");
  await click("LeafTask");
  await waitFor(
    "!!document.querySelector('img')?.complete && document.querySelector('img')?.naturalWidth===3",
    "original image decoded"
  );
  assert.equal(await evaluate("document.querySelector('img').src === dashboardFixture.originalImage"), true);
  results.push("Authorized evidence resolves actual 3x2 PNG bytes from IndexedDB and decodes");
  const readsBeforeSave = await evaluate("dashboardFixture.reads");
  await evaluate("dashboardFixture.report()");
  await waitFor(has("Live report from actual tracking save"), "live report without reselection");
  assert.equal(await evaluate("dashboardFixture.posts"), 1);
  await waitFor(
    "!![...document.querySelectorAll('button')].find(b=>b.textContent==='Làm mới'&&!b.disabled)",
    "save read complete"
  );
  await pause(100);
  assert.equal(
    await evaluate("dashboardFixture.reads"),
    readsBeforeSave + 1,
    "same-tab BroadcastChannel notification must not duplicate the read"
  );
  results.push("Actual recordOfflineDailyReport save updates selected dashboard without F5 or reselection");
  await evaluate("dashboardFixture.confirm()");
  await waitFor(has("Nội dung khớp contract"), "canonical report content verification");
  assert.equal(await evaluate("document.querySelector('article dl').textContent.includes('Actual difficulty')"), true);
  results.push("Canonical report hydrates all original fields after matching three hashes");
  await waitFor(
    "!![...document.querySelectorAll('button')].find(b=>b.textContent==='Làm mới'&&!b.disabled)",
    "confirmation read complete"
  );
  const readsBeforeBroadcast = await evaluate("dashboardFixture.reads");
  await evaluate(
    "(()=>{const c=new BroadcastChannel('plane-dashboard-updates');c.postMessage({workspaceSlug:'team',projectId:'p',source:'external-fixture'});c.close()})()"
  );
  await waitFor(`dashboardFixture.reads === ${readsBeforeBroadcast + 1}`, "external broadcast refresh");
  await waitFor(
    "!![...document.querySelectorAll('button')].find(b=>b.textContent==='Làm mới'&&!b.disabled)",
    "broadcast read complete"
  );
  await evaluate(
    "(()=>{const c=new BroadcastChannel('plane-dashboard-updates');c.postMessage({workspaceSlug:'unrelated',projectId:'p',source:'external-fixture'});c.close()})()"
  );
  await pause(150);
  assert.equal(await evaluate("dashboardFixture.reads"), readsBeforeBroadcast + 1);
  results.push("External BroadcastChannel refreshes matching scope only; own save does not duplicate reads");
  await evaluate("dashboardFixture.offlineHundred()");
  await waitFor(has("Báo cáo local: 100%"), "pending 100 beside contract zero");
  await waitFor(
    "!![...document.querySelectorAll('button')].find(b=>b.textContent==='Làm mới'&&!b.disabled)",
    "pending hundred read complete"
  );
  assert.equal(await evaluate(has("Tiến độ contract và KPI đã xác nhận chưa bao gồm các báo cáo này.")), true);
  results.push("Offline 100% is visible alongside confirmed zero and is not presented as completed on-chain");
  await evaluate("dashboardFixture.confirm()");
  await waitFor(has("Nội dung khớp contract"), "restore canonical fixture");
  await evaluate("dashboardFixture.failReports=true; dashboardFixture.update()");
  await waitFor(has("chưa đọc đủ contract"), "RPC failure visible");
  assert.equal(await evaluate(has("Chưa có báo cáo trong dữ liệu đã đọc cho task này.")), false);
  results.push("Report RPC failure displays unknown contract count, never a fabricated empty report list");
  await evaluate("dashboardFixture.failReports=false; dashboardFixture.update()");
  await waitFor(has("Nội dung khớp contract"), "RPC recovery");
  await evaluate("dashboardFixture.block(); dashboardFixture.update()");
  await pause(100);
  await evaluate("dashboardFixture.setWorkspace('other')");
  await waitFor(has("ProjectTwo"), "new workspace catalog");
  await evaluate("dashboardFixture.release()");
  await waitFor(has("NewWorkspaceTask"), "new workspace task load");
  assert.equal(await evaluate(has("LeafTask")), false);
  assert.equal(await evaluate(has("Live report from actual tracking save")), false);
  results.push("Late results from previous workspace cannot restore previous tasks or report content");
  assert.equal(exceptions.length, 0);
  fs.writeFileSync(
    path.join(output, "browser-dashboard.png"),
    Buffer.from((await send("Page.captureScreenshot", { format: "png" }, session)).data, "base64")
  );
} finally {
  fs.writeFileSync(
    path.join(output, "browser-results.json"),
    JSON.stringify(
      {
        method:
          "Headless Chrome, actual React widget/hooks/calculation/tracking notifications/IndexedDB and asset resolver; project/API/RPC adapters are fixtures, no real blockchain transaction",
        results,
        exceptions,
      },
      null,
      2
    )
  );
  if (socket?.readyState === WebSocket.OPEN) {
    await send("Browser.close").catch(() => {});
    socket.close();
  }
  await Promise.race([once(chrome, "exit"), pause(3000)]);
  if (chrome.exitCode === null) chrome.kill();
  server.close();
}
console.log(JSON.stringify({ passed: results.length, results }, null, 2));
