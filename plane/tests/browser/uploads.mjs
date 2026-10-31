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
const output = path.resolve(root, process.env.PLANE_TEST_OUTPUT_DIR || "docs/verification/uploads-2026-10-31");
const built = process.env.PLANE_TEST_BUILD_DIR || process.env.UPLOAD_TEST_BUILD_DIR || path.resolve(root, "apps/web/build/client");
const profile = path.resolve(root, `tmp/upload-chrome-${Date.now()}`);
for (const target of [output, profile]) {
  assert(target.startsWith(root + path.sep));
  fs.mkdirSync(target, { recursive: true });
}
const html = fs.readFileSync(path.join(built, "index.html"), "utf8");
const mount = (html.match(/(?:src|href)="([^"\s]*?)\/assets\//)?.[1] || "").replace(/\/$/, "");
const admin = "0x1111111111111111111111111111111111111111";
const recipient = "0x" + "2".repeat(38) + "ab";
const slug = "fiai";
const workspace = {
  id: "browser-team-id",
  slug,
  name: "Upload Test Workspace",
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
const instance = {
  id: "browser-instance",
  instance_id: "browser-instance",
  instance_name: "Plane",
  is_setup_done: true,
  is_activated: true,
  is_telemetry_enabled: false,
};
const projectId = "33333333-3333-4333-8333-333333333333";
const issueId = "44444444-4444-4444-8444-444444444444";
const stateId = "55555555-5555-4555-8555-555555555555";
const project = {
  id: projectId,
  name: "Upload Test Project",
  identifier: "UPL",
  workspace: workspace.id,
  network: 2,
  created_at: workspace.created_at,
  updated_at: workspace.created_at,
  created_by: owner.id,
  project_lead: null,
  cover_image: "",
  logo_props: { in_use: "icon", icon: { name: "folder", color: "#3f3f46" } },
  default_assignee: null,
  estimate: null,
};
const workItem = {
  id: issueId,
  name: "Upload regression issue",
  sequence_id: 1,
  project: projectId,
  project_id: projectId,
  project_detail: { id: projectId, identifier: "UPL", name: project.name },
  workspace: workspace.id,
  state: stateId,
  state_id: stateId,
  state_detail: { id: stateId, name: "Todo", group: "unstarted", color: "#999999" },
  description_html: "<p>Upload test description</p>",
  description_json: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Upload test description" }] }],
  },
  description_stripped: "Upload test description",
  priority: "none",
  assignees: [],
  assignee_ids: [],
  label_ids: [],
  labels: [],
  module_ids: [],
  parent_id: null,
  cycle_id: null,
  attachment_count: 0,
  issue_attachments: [],
  created_by: owner.id,
  updated_by: owner.id,
  created_at: workspace.created_at,
  updated_at: workspace.created_at,
  archived_at: null,
  deleted_at: null,
  is_draft: false,
};
const shared = {
  users: [owner],
  workspaces: [workspace],
  workspace_members: [
    {
      id: "upload-admin-member",
      workspace: workspace.id,
      workspace_id: workspace.id,
      member: owner.id,
      wallet_address: admin,
      role: 20,
      is_active: true,
      verified_on_chain: true,
    },
  ],
  projects: [project],
  issues: [workItem],
  states: [
    {
      id: stateId,
      project: projectId,
      workspace: workspace.id,
      name: "Todo",
      group: "unstarted",
      color: "#999999",
      sequence: 1,
    },
  ],
  labels: [],
  project_members: [{ id: "upload-project-admin", project: projectId, member: owner.id, role: 20, is_active: true }],
  invitations: [],
  assets: [],
  attachments: [],
  removed_members: {},
  instance,
};
const roles = new Map([[admin, 3]]);
let roleRpcUnavailable = false;
const transactions = [];
const issues = [];
const diagnostics = [];
const cases = [];
const downloads = [];
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
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-gpu",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
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
let mailAccepted = false;
let mailRequests = 0;
let mailGate;
const testPresentationMedia = process.env.PLANE_TEST_PRESENTATION_MEDIA === "1";
const pinnedImages = new Map();
let failImagePin = false;
let imageUploadRequests = 0;
let imageGatewayReads = 0;
const mediaPixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
const decodedCover = (url) => `(()=>{const image=document.querySelector('form img.h-44');return image?.src===${JSON.stringify(url)}&&image.complete&&image.naturalWidth>0})()`;
const decodedAvatar = (url) => `(()=>{const image=document.querySelector('button[aria-label="Change profile picture"] img');return image?.src===${JSON.stringify(url)}&&image.complete&&image.naturalWidth>0})()`;
const decodedLogo = (url) => `(()=>{const image=document.querySelector('img[alt="Workspace Logo"]');return image?.src===${JSON.stringify(url)}&&image.complete&&image.naturalWidth>0})()`;
async function fulfill(event, sessionId) {
  const url = new URL(event.request.url);
  const headers = [
    { name: "content-type", value: "application/json" },
    { name: "access-control-allow-origin", value: "*" },
    { name: "access-control-allow-methods", value: "GET, POST, OPTIONS" },
    { name: "access-control-allow-headers", value: "*" },
    { name: "access-control-allow-private-network", value: "true" },
  ];
  const respond = (value, status = 200) =>
    send(
      "Fetch.fulfillRequest",
      {
        requestId: event.requestId,
        responseCode: status,
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
  const requestHeaders = Object.fromEntries(Object.entries(event.request.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
  if (testPresentationMedia && event.request.method === "POST" && String(requestHeaders["content-type"]).startsWith("multipart/form-data")) {
    imageUploadRequests++;
    if (failImagePin) return respond({ code: "STORAGE_TEMPORARY" }, 503);
    const cid = "Qm" + "2".repeat(44); // All three pickers upload the same pixel: one immutable CID.
    pinnedImages.set(cid, mediaPixel);
    return respond({ cid });
  }
  const image = pinnedImages.get(url.pathname.split("/").pop());
  if (image) {
    imageGatewayReads++;
    return send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200,
      responseHeaders: headers.map((header) => header.name === "content-type" ? { name: header.name, value: "image/png" } : header), body: image }, sessionId);
  }
  if (url.origin === origin && url.pathname === "/__mail_fixture") {
    assert.equal(body.to?.[0]?.email, "browser-otp@example.invalid");
    mailRequests++;
    if (mailGate) await mailGate;
    return respond(mailAccepted ? { messageId: "fixture-accepted" } : { error: "fixture mail unavailable" }, mailAccepted ? 201 : 503);
  }
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
      `(()=>{const e=${expression};if(!e)return null;e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,visible:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e||e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`
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
  const result = await send(
    "Page.captureScreenshot",
    { format: "png", fromSurface: true, captureBeyondViewport: false },
    sessionId
  );
  fs.writeFileSync(path.join(output, filename), Buffer.from(result.data, "base64"));
}
async function page(user, wallet, suffix, label, signedOut = false) {
  const context = await send("Target.createBrowserContext");
  await send("Browser.setDownloadBehavior", {
    behavior: "allow",
    browserContextId: context.browserContextId,
    downloadPath: path.resolve(root, "tmp/upload-downloads"),
    eventsEnabled: true,
  });
  const target = await send("Target.createTarget", { url: "about:blank", browserContextId: context.browserContextId });
  const attached = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  sessions.set(sessionId, { label });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Network.enable", {}, sessionId);
  await send("Network.setBypassServiceWorker", { bypass: true }, sessionId);
  await send(
    "Emulation.setDeviceMetricsOverride",
    { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false },
    sessionId
  );
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
  const database = structuredClone(shared);
  const seed = `(()=>{const user=${JSON.stringify(user)},db=${JSON.stringify(database)},wallet=${JSON.stringify(wallet)},origin=${JSON.stringify(origin)};
    if(!sessionStorage.getItem('wallet_browser_seeded')){localStorage.clear();sessionStorage.clear();localStorage.setItem('plane_dapp_local_db',JSON.stringify(db));sessionStorage.setItem('plane_dapp_latest_db',JSON.stringify(db));sessionStorage.setItem('plane_dapp_auth_user',user.id);sessionStorage.setItem('plane_dapp_auth_email',user.email);localStorage.setItem('plane_dapp_auth_user',user.id);localStorage.setItem('plane_dapp_auth_email',user.email);localStorage.setItem('plane_active_wallet_address',wallet);sessionStorage.setItem('plane_active_wallet_address',wallet);sessionStorage.setItem('wallet_browser_seeded','1');}
    if(${JSON.stringify(signedOut)}){sessionStorage.setItem('plane_dapp_signed_out','1');window.__env__={VITE_MAIL_PROXY_URL:origin+'/__mail_fixture'};}
    const sdk={interceptors:{request:[],response:[]},emit(){},destroy(){},request:async(action,p={})=>{if(action==='getAllWallets')return[{address:wallet}];if(action==='getVaultStatus')return{isLocked:false,isInitialized:true};if(action.startsWith('getActiveWallet'))return{address:wallet};if(action==='sendTransaction'){if(p.isReadOnly)return{returnValue:-1};throw Error('Fixture blocks signing transactions');}return{};},on(){},off(){},registerHostAction(){},getStatus(){return{'crypto-vault':'ready','blockchain-bridge':'ready'};}};
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
    } else if (message.method === "Browser.downloadWillBegin" || message.method === "Browser.downloadProgress")
      downloads.push({
        event: message.method,
        filename: message.params.suggestedFilename,
        state: message.params.state,
      });
    else if (message.method === "Fetch.requestPaused")
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
  const fixturePath = path.resolve(root, "tmp/upload-fixture.txt");
  fs.writeFileSync(fixturePath, "Plane upload fixture: durable bytes after reload.");
  const downloadDir = path.resolve(root, "tmp/upload-downloads");
  fs.mkdirSync(downloadDir, { recursive: true });
  fs.rmSync(path.join(downloadDir, "upload-fixture.txt"), { force: true });
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir, eventsEnabled: true });
  const session = await page(owner, admin, `${slug}/projects/${projectId}/issues/${issueId}/`, "upload");
  await until(
    session,
    "document.body.innerText.includes('Upload test description') || Array.from(document.querySelectorAll('textarea,input')).some(e=>e.value==='Upload regression issue')",
    60000
  );
  await until(session, "location.pathname.endsWith('/browse/UPL-1')");
  cases.push({ name: "UUID work item URL redirects to the correct browse URL", passed: true });
  await pause(1200);
  await send("Page.bringToFront", {}, session);
  const documentNode = await send("DOM.getDocument", {}, session);
  const attachmentInput = await send(
    "DOM.querySelector",
    { nodeId: documentNode.root.nodeId, selector: "input[type=file]" },
    session
  );
  assert(attachmentInput.nodeId, "attachment picker must exist");
  await send("DOM.setFileInputFiles", { nodeId: attachmentInput.nodeId, files: [fixturePath] }, session);
  await until(
    session,
    "JSON.parse(localStorage.getItem('plane_dapp_local_db')||'{}').attachments?.some(a=>a.attributes?.name==='upload-fixture.txt')"
  );
  cases.push({ name: "Actual attachment picker saves file bytes and updates the work item", passed: true });
  const imageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
  const pasteImage = async (index) =>
    evaluate(
      session,
      `(()=>{const e=document.querySelectorAll('[contenteditable=true]')[${index}];if(!e)throw Error('Editor missing');e.focus();const transfer=new DataTransfer();const bytes=Uint8Array.from(atob(${JSON.stringify(imageBase64)}),c=>c.charCodeAt(0));transfer.items.add(new File([bytes],'upload-pixel.png',{type:'image/png'}));e.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));return true})()`
    );
  await pasteImage(0);
  const goodImages =
    "Array.from(document.querySelectorAll('img.image-component')).filter(e=>e.complete&&e.naturalWidth>0&&e.src.startsWith('data:image/')).length";
  await until(session, goodImages + ">=1", 45000);
  cases.push({ name: "Pasting into the description uploads and renders decoded image bytes locally", passed: true });
  await pasteImage(1);
  await until(session, goodImages + ">=2", 45000);
  await click(session, "Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Comment')");
  await until(
    session,
    "JSON.parse(localStorage.getItem('plane_dapp_local_db')||'{}').comments?.some(c=>c.comment_html?.includes('image-component'))"
  );
  await until(
    session,
    "JSON.parse(localStorage.getItem('plane_dapp_local_db')||'{}').issues?.find(i=>i.id==='44444444-4444-4444-8444-444444444444')?.description_html?.includes('image-component')",
    15000
  );
  const expectedImageBlocks = await evaluate(
    session,
    "(()=>{const d=JSON.parse(localStorage.getItem('plane_dapp_local_db'));const ids=html=>Array.from(new DOMParser().parseFromString(html||'', 'text/html').querySelectorAll('image-component')).map(e=>e.getAttribute('id')).filter(Boolean);return{description:ids(d.issues.find(i=>i.id==='44444444-4444-4444-8444-444444444444').description_html),comment:ids(d.comments.find(c=>c.comment_html?.includes('image-component')).comment_html)}})()"
  );
  assert(
    expectedImageBlocks.description.length && expectedImageBlocks.comment.length,
    "both persisted editors must contain image blocks"
  );
  const expectedIds = [...new Set([...expectedImageBlocks.description, ...expectedImageBlocks.comment])];
  const decodedBlocks = `(${JSON.stringify(expectedIds)}).every(id=>{const e=document.getElementById('editor-image-block-'+id)?.querySelector('img.image-component');return e?.complete&&e.naturalWidth>0&&e.src.startsWith('data:image/')})`;
  await until(session, decodedBlocks, 45000);
  cases.push({ name: "Comment images use the same local asset resolver and render after submission", passed: true });
  await pause(2000);

  const before = await evaluate(
    session,
    "(()=>{const d=JSON.parse(localStorage.getItem('plane_dapp_local_db'));return{description:d.issues?.find(i=>i.id==='44444444-4444-4444-8444-444444444444')?.description_html,comments:d.comments?.length,attachments:d.attachments?.length}})()"
  );
  fs.writeFileSync(path.join(output, "saved-content-proof.json"), JSON.stringify(before, null, 2));
  await send("Page.reload", { ignoreCache: true }, session);
  await until(session, decodedBlocks, 60000);
  cases.push({ name: "Description and comment image IDs survive a full page reload", passed: true });

  const attachmentLabel =
    "Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('upload-fixture'))";
  await until(session, `Boolean(${attachmentLabel})`);
  await click(session, attachmentLabel);
  const downloaded = path.join(downloadDir, "upload-fixture.txt");
  for (let attempt = 0; attempt < 100 && !fs.existsSync(downloaded); attempt++) await pause(100);
  assert.equal(fs.readFileSync(downloaded, "utf8"), "Plane upload fixture: durable bytes after reload.");
  cases.push({ name: "Downloading the attachment after reload returns the original file contents", passed: true });
  assert(
    !issues.some((i) => i.type === "unhandled-api" && i.path?.includes("/api/assets/")),
    "no asset request may escape to the backend proxy"
  );
  assert.deepEqual(issues, [], "no unhandled browser exception or failed fixture interception");
  const screenshotDiagnostics = [];
  try {
    await screenshot(session, "images-after-reload.png");
  } catch (error) {
    screenshotDiagnostics.push({ error: error.message });
  }
  if (testPresentationMedia) {
    const imagePath = path.resolve(root, "tmp/profile-media-pixel.png");
    fs.writeFileSync(imagePath, Buffer.from(mediaPixel, "base64"));
    const profileUrl = `${origin}${mount}/settings/profile/general`;
    const logoUrl = `${origin}${mount}/${slug}/settings`;
    const setImageFile = async (selector) => {
      const doc = await send("DOM.getDocument", {}, session);
      const input = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector }, session);
      assert(input.nodeId, "image picker must expose a file input");
      await send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [imagePath] }, session);
    };
    const uploadModalImage = async () => {
      await until(session, "!!document.querySelector('[role=dialog] input[type=file]')");
      await setImageFile("[role=dialog] input[type=file]");
      await click(session, "Array.from(document.querySelectorAll('[role=dialog] button')).find(e=>e.textContent.trim()==='Upload & Save')");
    };
    const currentMedia = () => evaluate(session, `(()=>{const db=JSON.parse(localStorage.getItem('plane_dapp_local_db')||'{}');const user=db.users?.find(u=>u.id===${JSON.stringify(owner.id)});const workspace=db.workspaces?.find(w=>w.id===${JSON.stringify(workspace.id)});return{avatar:user?.avatar_url,cover:user?.cover_image_url,logo:workspace?.logo_url,assets:(db.assets||[]).filter(a=>['USER_AVATAR','USER_COVER','WORKSPACE_LOGO'].includes(a.entity_type))}})()`);
    await send("Network.setCacheDisabled", { cacheDisabled: true }, session);
    await send("Page.navigate", { url: profileUrl }, session);
    await until(session, "!!document.querySelector('button[aria-label=\"Change profile picture\"]')");
    await click(session, "document.querySelector('button[aria-label=\"Change profile picture\"]')");
    await uploadModalImage();
    await until(session, "!document.querySelector('[role=dialog] input[type=file]')");
    const avatarState = await currentMedia();
    assert(avatarState.avatar?.includes("/ipfs/"));
    await send("Page.reload", { ignoreCache: true }, session);
    await until(session, decodedAvatar(avatarState.avatar), 60000);
    assert.equal((await currentMedia()).avatar, avatarState.avatar);
    cases.push({ name: "Avatar uploaded through the real modal remains a decoded IPFS image after F5", passed: true });

    await click(session, "Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim().toLowerCase()==='change cover')");
    await until(session, "Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='Upload image') || Array.from(document.querySelectorAll('[role=tab]')).some(e=>e.textContent.trim()==='Upload')");
    if (!await evaluate(session, "Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='Upload image')"))
      await click(session, "Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent.trim()==='Upload')");
    await send("Page.setInterceptFileChooserDialog", { enabled: true }, session);
    await click(session, "Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Upload image')");
    await setImageFile("body > input[type=file]");
    await until(session, "JSON.parse(localStorage.getItem('plane_dapp_local_db')||'{}').assets?.some(a=>a.entity_type==='USER_COVER'&&a.is_uploaded)");
    await click(session, "document.querySelector('form button[type=submit]')");
    const coverState = await currentMedia();
    assert(coverState.cover?.includes("/ipfs/"));
    await send("Page.reload", { ignoreCache: true }, session);
    await until(session, decodedCover(coverState.cover), 60000);
    cases.push({ name: "Profile cover is saved as an IPFS URL and renders after F5", passed: true });

    await send("Page.navigate", { url: logoUrl }, session);
    await until(session, "!!document.querySelector('button[aria-label=\"Change workspace logo\"]')");
    await click(session, "document.querySelector('button[aria-label=\"Change workspace logo\"]')");
    await uploadModalImage();
    await until(session, "!document.querySelector('[role=dialog] input[type=file]')");
    const logoState = await currentMedia();
    assert(logoState.logo?.includes("/ipfs/"));
    for (const asset of logoState.assets) {
      assert.equal(asset.storage, "ipfs"); assert(asset.ipfs_cid); assert(!asset.asset_url.startsWith("data:"));
      assert.equal(asset.base64, undefined);
    }
    const readsBeforeReload = imageGatewayReads;
    await send("Storage.clearDataForOrigin", { origin, storageTypes: "indexeddb,cache_storage" }, session);
    await send("Page.reload", { ignoreCache: true }, session);
    await until(session, decodedLogo(logoState.logo), 60000);
    assert(imageGatewayReads > readsBeforeReload, "the image is fetched from the IPFS gateway after clearing local byte caches");
    cases.push({ name: "Workspace logo survives F5 with IndexedDB cleared and is read from IPFS", passed: true });
    await screenshot(session, "workspace-logo-after-f5.png");

    await send("Page.navigate", { url: profileUrl }, session);
    await until(session, decodedAvatar(avatarState.avatar), 60000);
    await until(session, decodedCover(coverState.cover), 60000);
    await screenshot(session, "profile-images-after-f5.png");
    failImagePin = true;
    await click(session, "document.querySelector('button[aria-label=\"Change profile picture\"]')");
    await uploadModalImage();
    await until(session, "document.body.innerText.includes('IPFS') && !Array.from(document.querySelectorAll('[role=dialog] button')).some(e=>e.textContent.trim()==='Uploading')");
    assert.equal((await currentMedia()).avatar, avatarState.avatar);
    assert.deepEqual(issues, [], "a handled upload failure must not become an uncaught UI exception");
    cases.push({ name: "An IPFS upload error keeps the previous avatar and does not throw an uncaught UI error", passed: true });
    failImagePin = false;
    await click(session, "Array.from(document.querySelectorAll('[role=dialog] button')).find(e=>e.textContent.trim()==='Remove')");
    await until(session, "!document.querySelector('[role=dialog] input[type=file]')");
    await send("Page.reload", { ignoreCache: true }, session);
    await until(session, decodedCover(coverState.cover), 60000);
    const afterAvatarRemoval = await currentMedia();
    assert(!afterAvatarRemoval.avatar);
    assert.equal(afterAvatarRemoval.cover, coverState.cover);
    assert.equal(afterAvatarRemoval.logo, logoState.logo);
    assert.equal(await evaluate(session, "!!document.querySelector('button[aria-label=\"Change profile picture\"] img')"), false);
    cases.push({ name: "Removing an avatar preserves cover/logo with the same CID and remains removed after F5", passed: true });
    fs.writeFileSync(path.join(output, "profile-media-proof.json"), JSON.stringify({ ...logoState, afterAvatarRemoval, imageGatewayReads, simulatedPins: pinnedImages.size, imageUploadRequests }, null, 2));
  }
  const authSession = await page(owner, admin, "sign-up", "otp", true);
  await until(authSession, "!!document.getElementById('email')");
  await click(authSession, "document.getElementById('email')");
  await send("Input.insertText", { text: "browser-otp@example.invalid" }, authSession);
  let releaseMail;
  mailGate = new Promise((resolve) => { releaseMail = resolve; });
  await click(authSession, "document.querySelector('form button[type=submit]')");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (mailRequests > 0) break;
    await pause(50);
  }
  assert.equal(mailRequests, 1);
  assert.equal(await evaluate(authSession, "!!document.getElementById('unique-code')"), false);
  assert.equal(await evaluate(authSession, "document.querySelector('form button[type=submit]').disabled"), true);
  cases.push({ name: "OTP form waits for provider acceptance before opening the code step", passed: true });
  releaseMail();
  mailGate = undefined;
  await until(authSession, "document.body.innerText.includes('Chưa gửi được mã xác nhận')");
  assert.equal(await evaluate(authSession, "!!document.getElementById('unique-code')"), false);
  assert.equal(await evaluate(authSession, "document.querySelector('form button[type=submit]').disabled"), false);
  cases.push({ name: "OTP delivery failure shows a retryable message and retains the email form", passed: true });
  mailAccepted = true;
  await click(authSession, "document.querySelector('form button[type=submit]')");
  await until(authSession, "!!document.getElementById('unique-code')");
  assert.equal(mailRequests, 2);
  assert.equal(await evaluate(authSession, "!!JSON.parse(localStorage.getItem('plane_dapp_otp_cache')||'{}')['browser-otp@example.invalid']?.codeHash"), true);
  cases.push({ name: "Retry after mail recovers opens the OTP step with a stored code hash", passed: true });
  await screenshot(authSession, "otp-after-retry.png");
  assert.deepEqual(issues, [], "OTP browser checks must not introduce uncaught exceptions");
  fs.writeFileSync(
    path.join(output, "browser-validation.json"),
    JSON.stringify(
      {
        cases,
        expectedImageBlocks,
        issues,
        realTransactionsSent: 0,
        sdkAndRpcSimulated: true,
        screenshotDiagnostics,
        downloads,
        actualIndexedDB: true,
        actualFileInput: true,
        actualImageDecoding: true,
        assetProxyRequests: 0,
      },
      null,
      2
    ) + "\n"
  );
  console.log(JSON.stringify({ passed: cases.length, realTransactions: 0, assetProxyRequests: 0 }));
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
            "(()=>{let db;try{db=JSON.parse(localStorage.getItem('plane_dapp_local_db')||'{}')}catch{};return{path:location.pathname,user:sessionStorage.getItem('plane_dapp_auth_user'),wallet:sessionStorage.getItem('plane_active_wallet_address'),workspaces:db?.workspaces,members:db?.workspace_members,comments:db?.comments,assets:db?.assets,issues:db?.issues,images:Array.from(document.querySelectorAll('img.image-component')).map(e=>({src:e.src,width:e.naturalWidth,complete:e.complete})),profiles:db?.users?.map(u=>({id:u.id,email:u.email,wallet:u.metanode_wallet_address,onboarded:u.is_onboarded}))}})()"
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
