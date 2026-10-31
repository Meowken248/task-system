/* oxlint-disable no-await-in-loop -- Browser polling and page diagnostics require ordered CDP responses. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { AbiCoder, id } from "ethers";
import { createUserObject } from "../../packages/services/src/dapp/auth.ts";

const root = process.cwd();
const output = path.resolve(root, process.env.PLANE_TEST_OUTPUT_DIR || "docs/verification/wallet-members-2026-10-29");
const built = process.env.PLANE_TEST_BUILD_DIR || path.resolve(root, "apps/web/build/client");
const profile = path.resolve(root, `tmp/wallet-member-chrome-${Date.now()}`);
for (const target of [output, profile]) {
  assert(target.startsWith(root + path.sep));
  fs.mkdirSync(target, { recursive: true });
}
const html = fs.readFileSync(path.join(built, "index.html"), "utf8");
const mount = (html.match(/(?:src|href)="([^"\s]*?)\/assets\//)?.[1] || "").replace(/\/$/, "");
const admin = "0x1111111111111111111111111111111111111111";
const recipient = "0x" + "2".repeat(38) + "ab";
const slug = "browser-wallet-team";
const workspace = {
  id: "browser-team-id",
  slug,
  name: "Browser Wallet Team",
  owner: admin,
  created_by: admin,
  role: 20,
  created_at: "2026-10-29T00:00:00.000Z",
  updated_at: "2026-10-29T00:00:00.000Z",
};
const owner = {
  ...createUserObject("browser-owner", "owner@example.invalid", "Wallet", "Admin", undefined, true),
  metanode_wallet_address: admin,
  last_workspace_slug: slug,
  last_workspace_id: workspace.id,
};
const person = {
  ...createUserObject("browser-recipient", "member@example.invalid", "Wallet", "Member"),
  metanode_wallet_address: recipient,
};
const instance = {
  id: "browser-instance",
  instance_id: "browser-instance",
  instance_name: "Plane",
  is_setup_done: true,
  is_activated: true,
  is_telemetry_enabled: false,
};
const shared = {
  users: [owner],
  workspaces: [workspace],
  workspace_members: [],
  invitations: [],
  projects: [
    {
      id: "browser-project",
      name: "Shared Wallet Project",
      identifier: "WAL",
      workspace: workspace.id,
      network: 2,
      created_at: workspace.created_at,
    },
  ],
  states: [],
  labels: [],
  issues: [],
  project_members: [],
  removed_members: {},
  instance,
};
const roles = new Map([[admin, 3]]);
let roleRpcUnavailable = false;
const transactions = [];
const issues = [];
const diagnostics = [];
const cases = [];
const traces = [];
const abi = AbiCoder.defaultAbiCoder();
const selectors = Object.fromEntries(
  [
    "getWorkspace(string)",
    "getMemberRole(string,address)",
    "getUserWorkspaces(address)",
    "getWorkspaceMembers(string)",
    "operator()",
    "workspacePolicyVersion()",
    "getInvitation(string,address)",
    "getCID(address,string)",
  ].map((signature) => [id(signature).slice(0, 10), signature])
);
function rpc(request) {
  if (request.method === "mtn_getAccountState") return { result: { lastHash: "0x" + "8".repeat(64) } };
  if (request.method === "eth_chainId") return { result: "0x3df" };
  if (request.method !== "eth_call") throw new Error(`Disallowed RPC method in isolated browser: ${request.method}`);
  const data = request.params[0].data;
  const signature = selectors[data.slice(0, 10)];
  const argumentsData = "0x" + data.slice(10);
  let result;
  if (signature === "getWorkspace(string)") {
    const [requested] = abi.decode(["string"], argumentsData);
    if (requested !== slug) return { error: { code: -32000, message: "WorkspaceNotFound" } };
    result = abi.encode(["string", "address", "string", "uint256"], [workspace.name, admin, "Qm" + "e".repeat(44), 1]);
  } else if (signature === "getMemberRole(string,address)") {
    if (roleRpcUnavailable) return { error: { code: -32000, message: "Fixture RPC unavailable" } };
    const [requested, wallet] = abi.decode(["string", "address"], argumentsData);
    result = abi.encode(["uint8"], [requested === slug ? roles.get(wallet.toLowerCase()) || 0 : 0]);
  } else if (signature === "getUserWorkspaces(address)") {
    const [wallet] = abi.decode(["address"], argumentsData);
    result = abi.encode(["string[]"], [roles.get(wallet.toLowerCase()) || 0 ? [slug] : []]);
  } else if (signature === "getWorkspaceMembers(string)")
    result = abi.encode(["address[]"], [[...roles].filter(([, role]) => role > 0).map(([wallet]) => wallet)]);
  else if (signature === "operator()") result = abi.encode(["address"], [admin]);
  else if (signature === "workspacePolicyVersion()") result = abi.encode(["uint256"], [2]);
  else if (signature === "getInvitation(string,address)") result = abi.encode(["uint8", "uint256"], [0, 0]);
  else if (signature === "getCID(address,string)") result = abi.encode(["string"], [""]);
  else throw new Error("Unhandled fixture selector " + data.slice(0, 10));
  return { result };
}

const server = http.createServer((request, response) => {
  let pathname = decodeURIComponent(new URL(request.url, "http://local").pathname);
  if (mount && pathname.startsWith(mount)) pathname = pathname.slice(mount.length);
  let file = path.resolve(built, "." + pathname);
  if (!file.startsWith(built + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.join(built, "index.html");
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".png": "image/png",
    ".woff2": "font/woff2",
  };
  response.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" }
);
let websocket;
const pending = new Map();
let counter = 0;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function send(method, params = {}, sessionId) {
  const key = ++counter;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(key);
      reject(new Error("CDP timeout: " + method));
    }, 20000);
    pending.set(key, { resolve, reject, timer });
    websocket.send(JSON.stringify({ id: key, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
const sessions = new Map();
async function fulfill(event, sessionId) {
  const url = new URL(event.request.url);
  const headers = [
    { name: "content-type", value: "application/json" },
    { name: "access-control-allow-origin", value: "*" },
    { name: "access-control-allow-methods", value: "GET, POST, OPTIONS" },
    { name: "access-control-allow-headers", value: "*" },
    { name: "access-control-allow-private-network", value: "true" },
  ];
  const respond = (value) =>
    send(
      "Fetch.fulfillRequest",
      {
        requestId: event.requestId,
        responseCode: 200,
        responseHeaders: headers,
        body: Buffer.from(JSON.stringify(value)).toString("base64"),
      },
      sessionId
    );
  let body;
  try {
    body = JSON.parse(event.request.postData || "null");
  } catch {
    body = null;
  }
  if (event.request.method === "OPTIONS") return respond({});
  if (url.origin === origin && url.pathname === "/__wallet_fixture") {
    assert.equal(body.from.toLowerCase(), admin);
    assert.equal(body.functionName, "addMember");
    const values = Object.fromEntries(body.inputs.map((input) => [input.name, input.value]));
    assert.equal(values.slug, slug);
    assert.equal(values.member.toLowerCase(), recipient);
    transactions.push({
      sender: body.from.toLowerCase(),
      functionName: body.functionName,
      recipient: values.member.toLowerCase(),
      role: Number(values.role),
      simulated: true,
    });
    roles.set(recipient, Number(values.role));
    return respond({ txHash: "0x" + "9".repeat(64) });
  }
  if (body?.method) {
    traces.push({
      context: sessions.get(sessionId)?.label,
      method: body.method,
      selector: body.params?.[0]?.data?.slice?.(0, 10),
    });
    return respond({ jsonrpc: "2.0", id: body.id, ...rpc(body) });
  }
  if (url.pathname.includes("/ipfs/")) return respond(shared);
  if (url.origin === origin) {
    if (url.pathname.includes("/api/")) {
      issues.push({ type: "unhandled-api", path: url.pathname });
      return respond({});
    }
    return send("Fetch.continueRequest", { requestId: event.requestId }, sessionId);
  }
  // No browser request reaches the real Vault/Bridge, a provider or a mailbox.
  if (url.pathname.includes("/api/"))
    traces.push({ context: sessions.get(sessionId)?.label, blockedApiPath: url.pathname });
  return send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" }, sessionId);
}
async function evaluate(sessionId, expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error("Browser evaluation failed: " + result.exceptionDetails.text);
  return result.result.value;
}
async function until(sessionId, expression, timeout = 35000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(sessionId, `Boolean(document.body && (${expression}))`)) return;
    } catch (error) {
      if (!/Cannot find context|Execution context was destroyed/.test(error.message)) throw error;
    }
    await pause(300);
  }
  throw new Error("Browser condition timeout: " + expression.slice(0, 140));
}
async function click(sessionId, expression) {
  await send("Page.bringToFront", {}, sessionId);
  let point;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    point = await evaluate(
      sessionId,
      `(()=>{const e=${expression};if(!e)return null; const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,visible:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e||e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`
    );
    if (point?.visible) break;
    await pause(100);
  }
  assert(point?.visible, "element must be visible and hit-testable");
  await send(
    "Input.dispatchMouseEvent",
    { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 },
    sessionId
  );
  await send(
    "Input.dispatchMouseEvent",
    { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 },
    sessionId
  );
}
async function screenshot(sessionId, filename) {
  await send("Page.bringToFront", {}, sessionId);
  const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId);
  fs.writeFileSync(path.join(output, filename), Buffer.from(result.data, "base64"));
}
async function page(user, wallet, suffix, label) {
  const context = await send("Target.createBrowserContext");
  const target = await send("Target.createTarget", { url: "about:blank", browserContextId: context.browserContextId });
  const attached = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  sessions.set(sessionId, { label });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Debugger.enable", {}, sessionId);
  await send("Debugger.setAsyncCallStackDepth", { maxDepth: 16 }, sessionId);
  await send("Network.enable", {}, sessionId);
  await send("Network.setBypassServiceWorker", { bypass: true }, sessionId);
  await send(
    "Emulation.setDeviceMetricsOverride",
    { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false },
    sessionId
  );
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
  const database = {
    users: [user],
    workspaces: wallet === admin ? [workspace] : [],
    projects: [],
    workspace_members: [],
    invitations: [],
    removed_members: {},
    instance,
  };
  const seed = `(()=>{const user=${JSON.stringify(user)},db=${JSON.stringify(database)},wallet=${JSON.stringify(wallet)},origin=${JSON.stringify(origin)};
    if(!sessionStorage.getItem('wallet_browser_seeded')){localStorage.clear();sessionStorage.clear();localStorage.setItem('plane_dapp_local_db',JSON.stringify(db));sessionStorage.setItem('plane_dapp_latest_db',JSON.stringify(db));sessionStorage.setItem('plane_dapp_auth_user',user.id);sessionStorage.setItem('plane_dapp_auth_email',user.email);localStorage.setItem('plane_dapp_auth_user',user.id);localStorage.setItem('plane_dapp_auth_email',user.email);localStorage.setItem('plane_active_wallet_address',wallet);sessionStorage.setItem('plane_active_wallet_address',wallet);sessionStorage.setItem('wallet_browser_seeded','1');}
    const sdk={interceptors:{request:[],response:[]},emit(){},destroy(){},request:async(action,p={})=>{if(action==='getAllWallets')return[{address:wallet}];if(action==='getVaultStatus')return{isLocked:false,isInitialized:true};if(action.startsWith('getActiveWallet'))return{address:wallet};if(action==='sendTransaction')return fetch(origin+'/__wallet_fixture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({from:p.from,functionName:p.functionName,inputs:p.inputArray})}).then(r=>r.json());return{};},on(){},off(){},registerHostAction(){},getStatus(){return{'crypto-vault':'ready','blockchain-bridge':'ready'};}};
    Object.defineProperty(window,'fiaiSDK',{configurable:true,get:()=>sdk,set:()=>{}});
  })();`;
  await send("Page.addScriptToEvaluateOnNewDocument", { source: seed }, sessionId);
  await send("Page.navigate", { url: `${origin}${mount}/${suffix}` }, sessionId);
  return sessionId;
}
try {
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100 && !fs.existsSync(portFile); attempt++) await pause(100);
  const [port, endpoint] = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/);
  websocket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await once(websocket, "open");
  websocket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const waiting = pending.get(message.id);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result);
    } else if (message.method === "Fetch.requestPaused")
      void fulfill(message.params, message.sessionId).catch((error) => {
        issues.push({ type: "interception", message: error.message });
        void send(
          "Fetch.failRequest",
          { requestId: message.params.requestId, errorReason: "Failed" },
          message.sessionId
        ).catch(() => {});
      });
    else if (message.method === "Network.loadingFailed")
      traces.push({
        context: sessions.get(message.sessionId)?.label,
        networkError: message.params.errorText,
        blockedReason: message.params.blockedReason,
        corsError: message.params.corsErrorStatus,
      });
    else if (message.method === "Runtime.consoleAPICalled" && traces.length < 1000) {
      const value = message.params.args?.map((a) => a.value ?? a.description ?? "").join(" ");
      if (typeof value === "string")
        traces.push({
          context: sessions.get(message.sessionId)?.label,
          console: value.replace(/(?:0x)?[0-9a-f]{64}/gi, "[redacted-32-bytes]").slice(0, 800),
        });
    } else if (message.method === "Runtime.exceptionThrown") {
      const issue = {
        type: "javascript",
        text: message.params.exceptionDetails.text,
        description: message.params.exceptionDetails.exception?.description,
        stack: message.params.exceptionDetails.stackTrace?.callFrames?.map(({ functionName, url, lineNumber }) => ({
          functionName,
          url,
          lineNumber,
        })),
        context: sessions.get(message.sessionId)?.label,
      };
      issues.push(issue);
      const objectId = message.params.exceptionDetails.exception?.objectId;
      if (objectId)
        diagnostics.push(
          send(
            "Runtime.callFunctionOn",
            {
              objectId,
              functionDeclaration:
                "function(){return {status:this.status,code:this.code,error:this.data?.error,url:this.config?.url,stack:this.stack}}",
              returnByValue: true,
            },
            message.sessionId
          )
            .then((result) => {
              issue.details = result.result.value;
              return result;
            })
            .catch(() => {})
        );
    }
  });
  const adminSession = await page(owner, admin, `${slug}/settings/members`, "admin");
  const memberSession = await page(person, recipient, "onboarding", "member");
  await until(
    adminSession,
    "Array.from(document.querySelectorAll('button')).some(e=>e.textContent.includes('Thêm bằng ví'))"
  );
  cases.push({ name: "Admin sees wallet entry action", passed: true });
  await click(
    adminSession,
    "Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('Thêm bằng ví'))"
  );
  await until(adminSession, "!!document.getElementById('workspace-member-wallet')");
  await screenshot(adminSession, "admin-wallet-form.png");
  await click(adminSession, "document.getElementById('workspace-member-wallet')");
  await send("Input.insertText", { text: "not-a-wallet" }, adminSession);
  await click(
    adminSession,
    "Array.from(document.querySelectorAll('[role=dialog] button')).find(e=>e.textContent.trim()==='Thêm thành viên')"
  );
  await until(adminSession, "!!document.querySelector('[role=alert]')");
  assert.equal(transactions.length, 0);
  cases.push({ name: "Invalid wallet retains form and sends no transaction", passed: true });
  await click(adminSession, "document.getElementById('workspace-member-wallet')");
  await evaluate(adminSession, "document.getElementById('workspace-member-wallet').select()");
  await send("Input.insertText", { text: recipient }, adminSession);
  assert.equal(await evaluate(adminSession, "document.getElementById('workspace-member-wallet').value"), recipient);
  await click(
    adminSession,
    "Array.from(document.querySelectorAll('[role=dialog] button')).find(e=>e.textContent.trim()==='Thêm thành viên')"
  );
  await until(adminSession, "!document.getElementById('workspace-member-wallet')");
  assert.equal(transactions.length, 1);
  assert.equal(roles.get(recipient), 1);
  await screenshot(adminSession, "admin-member-added.png");
  cases.push({ name: "Admin grants once and sees confirmed success", passed: true });
  await send("Page.bringToFront", {}, memberSession);
  await until(
    memberSession,
    `location.pathname.includes(${JSON.stringify(slug)}) && document.body.innerText.includes('Manage widgets')`,
    50000
  );
  await send("Page.navigate", { url: `${origin}${mount}/${slug}/projects/` }, memberSession);
  const visibleProject =
    "(()=>{const e=Array.from(document.querySelectorAll('a')).find(e=>e.textContent.includes('Shared Wallet Project'));if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()";
  await pause(1000);
  await until(memberSession, visibleProject, 50000);
  assert.equal(
    await evaluate(
      memberSession,
      "Array.from(document.querySelectorAll('button')).some(e=>e.textContent.includes('Thêm bằng ví'))"
    ),
    false
  );
  await screenshot(memberSession, "member-discovers-workspace.png");
  cases.push({ name: "Isolated logged-in Member discovers access without invitation or a signature", passed: true });
  await send("Page.reload", { ignoreCache: true }, memberSession);
  await pause(1000);
  await until(memberSession, visibleProject, 50000);
  assert.equal(transactions.length, 1);
  cases.push({ name: "Member refresh preserves access without another transaction", passed: true });
  await send("Page.navigate", { url: `${origin}${mount}/${slug}/settings/members` }, memberSession);
  await until(
    memberSession,
    "document.body.innerText.includes('Wallet Admin') && document.body.innerText.includes('Wallet Member')"
  );
  assert.equal(
    await evaluate(
      memberSession,
      "Array.from(document.querySelectorAll('button,a')).some(e=>e.textContent.includes('Thêm bằng ví'))"
    ),
    false
  );
  await screenshot(memberSession, "member-members-view.png");
  cases.push({ name: "Member can view the member list but cannot see the Admin provisioning action", passed: true });
  roleRpcUnavailable = true;
  await send("Page.reload", { ignoreCache: true }, memberSession);
  await until(memberSession, "document.body.innerText.includes('Chưa kiểm tra được quyền truy cập')");
  assert.equal(await evaluate(memberSession, "document.body.innerText.includes('Not Authorized!')"), false);
  roleRpcUnavailable = false;
  await click(
    memberSession,
    "Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Kiểm tra lại')"
  );
  await until(memberSession, "document.body.innerText.includes('Wallet Member')");
  assert.equal(transactions.length, 1);
  cases.push({
    name: "RPC outage shows a recoverable state and retry restores access without a signature",
    passed: true,
  });
  roles.delete(recipient);
  await send("Page.reload", { ignoreCache: true }, memberSession);
  await until(memberSession, "document.body.innerText.includes('Not Authorized!')");
  assert.equal(transactions.length, 1);
  cases.push({ name: "Revoked chain access rejects a stale local member cache without a transaction", passed: true });
  await Promise.allSettled(diagnostics);
  assert.deepEqual(issues, [], "no browser exception, escaped backend API or failed fixture interception is allowed");
  fs.writeFileSync(
    path.join(output, "browser-validation.json"),
    JSON.stringify(
      {
        isolatedBrowserContexts: 2,
        realTransactionsSent: 0,
        sdkAndRpcSimulated: true,
        sharedBrowserStorage: false,
        cases,
        transactions,
        issues,
      },
      null,
      2
    ) + "\n"
  );
  console.log(
    JSON.stringify({
      passed: cases.length,
      simulatedTransactions: transactions.length,
      realTransactions: 0,
      javascriptIssues: issues.filter((issue) => issue.type === "javascript").length,
    })
  );
} catch (error) {
  for (const [sessionId, meta] of sessions) {
    try {
      await screenshot(sessionId, `${meta.label}-failure.png`);
      fs.writeFileSync(
        path.join(output, `${meta.label}-failure.txt`),
        await evaluate(sessionId, "document.body.innerText")
      );
      fs.writeFileSync(
        path.join(output, `${meta.label}-state.json`),
        JSON.stringify(
          await evaluate(
            sessionId,
            "(()=>{let db;try{db=JSON.parse(localStorage.getItem('plane_dapp_local_db')||'{}')}catch{};return{path:location.pathname,user:sessionStorage.getItem('plane_dapp_auth_user'),wallet:sessionStorage.getItem('plane_active_wallet_address'),workspaces:db?.workspaces,members:db?.workspace_members,profiles:db?.users?.map(u=>({id:u.id,email:u.email,wallet:u.metanode_wallet_address,onboarded:u.is_onboarded}))}})()"
          ),
          null,
          2
        )
      );
    } catch {
      /* Preserve the original test failure. */
    }
  }
  fs.writeFileSync(
    path.join(output, "browser-failure.json"),
    JSON.stringify({ error: error.message, cases, issues, transactions, traces }, null, 2)
  );
  throw error;
} finally {
  if (websocket?.readyState === WebSocket.OPEN) {
    try {
      await send("Browser.close");
    } catch {
      /* Browser closes the transport. */
    }
    websocket.close();
  }
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error("Browser test closed"));
  }
  await new Promise((resolve) => server.close(resolve));
  await Promise.race([once(chrome, "exit"), pause(5000)]);
  if (chrome.exitCode === null) chrome.kill();
}
