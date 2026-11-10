/* oxlint-disable no-await-in-loop -- Browser readiness and teardown are ordered. */
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
const tempRoot = path.resolve("tmp");
fs.mkdirSync(tempRoot, { recursive: true });
const temp = fs.mkdtempSync(path.join(tempRoot, "release-runtime-browser-"));
const output = path.resolve(process.env.PLANE_RUNTIME_TEST_OUTPUT || "docs/verification/release-readiness-2026-11-07/runtime");
fs.mkdirSync(output, { recursive: true });

// Native browser storage/locks and Yjs with isolated storage and blocked network.
const fixture = fs.readFileSync(path.resolve("tests/browser/release-runtime.fixture.ts"), "utf8");

const env = {
  VITE_WORKSPACE_REGISTRY_ADDRESS: "",
  VITE_AUTO_COMMIT_ONCHAIN: "false",
  VITE_CHAIN_ID: "991",
  VITE_ROUTER_BASENAME: "",
  VITE_RPC_URL: "https://fixture.invalid",
  VITE_DEFAULT_WORKSPACE_SLUG: "team",
  VITE_DAPP_DEPLOYMENT_ID: "runtime-fresh-fixture",
};
const aliases = Object.fromEntries(
  ["services", "types", "constants", "utils", "i18n"].map((name) => [
    `@plane/${name}`,
    path.resolve("packages", name, "src/index.ts"),
  ])
);

let server, chrome, socket, session, serial = 0;
const pending = new Map(), external = [], exceptions = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function send(method, params = {}, sessionId = session) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error(`CDP timeout ${method}`));
    }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression) {
  for (let i = 0; i < 200; i++) {
    if (await evaluate(expression)) return;
    await pause(100);
  }
  throw Error("Browser fixture timed out");
}

try {
  await build({
    stdin: { contents: fixture, resolveDir: path.resolve("tests/browser"), sourcefile: "release-runtime.fixture.ts", loader: "ts" },
    bundle: true,
    outfile: path.join(temp, "app.js"),
    platform: "browser",
    format: "esm",
    nodePaths: [path.resolve("apps/web/node_modules")],
    tsconfig: path.resolve("apps/web/tsconfig.json"),
    alias: { ...aliases, yjs: createRequire(path.resolve("packages/editor/package.json")).resolve("yjs") },
    define: { "process.env": JSON.stringify(env), "import.meta.env": JSON.stringify(env) },
  });

  server = http.createServer((req, res) => {
    res.setHeader("content-type", req.url === "/app.js" ? "text/javascript" : "text/html");
    res.end(
      req.url === "/app.js"
        ? fs.readFileSync(path.join(temp, "app.js"))
        : '<!doctype html><button id="run">Run storage, lock and editor checks</button><pre id="result"></pre><script type="module" src="/app.js"></script>'
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  chrome = spawn(
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    [
      "--headless=new",
      "--no-first-run",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-gpu",
      "--remote-debugging-port=0",
      `--user-data-dir=${path.join(temp, "profile")}`,
      "about:blank",
    ],
    { windowsHide: true, stdio: "ignore" }
  );

  const active = path.join(temp, "profile/DevToolsActivePort");
  for (let i = 0; i < 100 && !fs.existsSync(active); i++) await pause(100);
  const [port, endpoint] = fs.readFileSync(active, "utf8").trim().split(/\r?\n/);
  socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await once(socket, "open");

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(Error(message.error.message));
      else item.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled") console.log('CHROME CONSOLE:', ...message.params.args.map(a => a.value));
    if (message.method === "Fetch.requestPaused") {
      if (message.params.request.url.startsWith(origin + "/"))
        void send("Fetch.continueRequest", { requestId: message.params.requestId }).catch(() => {});
      else {
        external.push(message.params.request.url);
        void send("Fetch.failRequest", { requestId: message.params.requestId, errorReason: "BlockedByClient" }).catch(
          () => {}
        );
      }
    }
  });

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  ({ sessionId: session } = await send("Target.attachToTarget", { targetId, flatten: true }));
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Page.navigate", { url: origin });
  await waitFor("window.probe?.ready || window.probe?.error");
  assert.equal(await evaluate("window.probe.error || null"), null);

  await evaluate("document.querySelector('#run').click()");
  await waitFor("window.probe?.done");
  const first = await evaluate("window.probe");
  assert.equal(first.error, undefined);

  await send("Page.reload", { ignoreCache: true });
  await waitFor("window.probe?.reloaded || window.probe?.error");
  const reloaded = await evaluate("window.probe");
  assert.equal(reloaded.error, undefined);
  assert.equal(reloaded.reloaded, true);

  assert.deepEqual(external, []);
  assert.deepEqual(exceptions, []);

  const result = {
    fixture: "real Chromium IndexedDB, native Web Locks in independent frames, Yjs binary; no chain/mail/IPFS writes",
    first,
    reloaded,
    externalRequests: external,
    uncaughtExceptions: exceptions,
  };
  fs.writeFileSync(path.join(output, "browser.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await send("Browser.close", {}, undefined).catch(() => {});
    socket.close();
  }
  for (let i = 0; i < 50; i++) {
    if (!chrome || chrome.exitCode !== null) break;
    await pause(100);
  }
  if (chrome && chrome.exitCode === null) chrome.kill();
  server?.close();
  for (const item of pending.values()) clearTimeout(item.timer);
  assert.equal(path.dirname(temp), tempRoot);
  assert.ok(path.basename(temp).startsWith("release-runtime-browser-"));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
