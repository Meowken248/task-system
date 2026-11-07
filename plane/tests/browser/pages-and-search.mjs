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
const temp = fs.mkdtempSync(path.join(tempRoot, "pages-search-browser-"));
const output = path.resolve("docs/verification/pages-and-search-2026-11-05");
fs.mkdirSync(output, { recursive: true });

// Real ProjectPageService, Axios interceptor, router, and isolated storage.
const fixture = `
import {localDB,defaultDB,setLoggedInUser,saveDB} from './packages/services/src/dapp/store.ts';
import {ProjectPageService} from './apps/web/core/services/page/project-page.service.ts';
import {setupDAppInterceptor} from './packages/services/src/dapp-interceptor.ts';
import axios from 'axios';

setupDAppInterceptor(axios);

window.probe={ready:false};
window.fetch=async()=>{throw Error('Unexpected external fetch in isolated fixture')};
const page=new ProjectPageService();
const check=(value,message)=>{if(!value)throw Error(message)};

const checkReload=async()=>{
 setLoggedInUser('member');
 const pages=await page.fetchAll('team','p1');
 check(!pages.some(p=>p.id==='page-priv'),'Private page hidden after reload');
 const res=await axios.get('/api/workspaces/team/search/?search=Secret');
 check(!res.data.results.page.some(p=>p.id==='page-priv'),'Search private page hidden after reload');
 return ['Page private protection reload','Search scope isolation reload'];
};

const run=async()=>{
 const checks=[];

 // 1. Owner can fetch private page description
 setLoggedInUser('owner');
 const desc=await page.fetchDescriptionBinary('team','p1','page-priv');
 check(typeof desc==='string'&&desc.includes('Top secret'),'Owner private description');
 checks.push('Owner read private description');

 // 2. Non-owner member denied reading private page description
 setLoggedInUser('member');
 let memberDenied=false;
 try {
  await page.fetchDescriptionBinary('team','p1','page-priv');
 } catch(err) {
  memberDenied=true;
 }
 check(memberDenied,'Non-owner denied reading private description');
 checks.push('Non-owner denied private description');

 // 3. Locked page rejects content update
 setLoggedInUser('owner');
 let lockedDenied=false;
 try {
  await page.updateDescription('team','p1','page-locked',{description_html:'<p>Hacked</p>'});
 } catch(err) {
  lockedDenied=true;
 }
 check(lockedDenied,'Locked page rejects content update');
 checks.push('Locked page content protection');

 // 4. Unlocking page allows content update
 await page.unlock('team','p1','page-locked');
 await page.updateDescription('team','p1','page-locked',{description_html:'<p>Unlocked edit</p>'});
 checks.push('Unlock and update content');

 // 5. Page list hides private page from non-owner
 setLoggedInUser('member');
 const memberPages=await page.fetchAll('team','p1');
 check(!memberPages.some(p=>p.id==='page-priv'),'Page list excludes private page for member');
 checks.push('Page list private filtering');

 // 6. Search in empty workspace does NOT leak tasks from other workspace
 setLoggedInUser('owner');
 const emptyWsSearch=await axios.get('/api/workspaces/team-empty/search/?search=Task');
 check(!emptyWsSearch.data.results.issue.some(i=>i.id==='i1'),'Empty workspace does not leak tasks');
 checks.push('Empty workspace search isolation');

 // 7. Search does NOT leak private page to non-owner
 setLoggedInUser('member');
 const secretSearch=await axios.get('/api/workspaces/team/search/?search=Secret');
 check(!secretSearch.data.results.page.some(p=>p.id==='page-priv'),'Search excludes private page');
 checks.push('Search private page exclusion');

 // 8. Search does NOT return triage tasks
 const triageSearch=await axios.get('/api/workspaces/team/search/?search=Triage');
 check(!triageSearch.data.results.issue.some(i=>i.id==='i-triage'),'Search excludes triage tasks');
 checks.push('Search triage task exclusion');

 localStorage.setItem('pages_search_completed','true');
 return checks;
};

try {
 if(!localStorage.getItem('pages_search_seeded')){
  Object.keys(localDB).forEach(key=>delete localDB[key]);
  Object.assign(localDB,structuredClone(defaultDB),{
   users:[{id:'owner',email:'owner@example.invalid'},{id:'member',email:'member@example.invalid'}],
   workspaces:[
    {id:'ws1',slug:'team',name:'Team A',created_by:'owner'},
    {id:'ws-empty',slug:'team-empty',name:'Team Empty',created_by:'owner'}
   ],
   workspace_members:[
    {id:'wm1',workspace:'ws1',member:'owner',role:20},
    {id:'wm2',workspace:'ws1',member:'member',role:15},
    {id:'wm-e',workspace:'ws-empty',member:'owner',role:20}
   ],
   projects:[
    {id:'p1',identifier:'ONE',workspace:'ws1',network:2,created_by:'owner'}
   ],
   project_members:[
    {id:'pm1',project:'p1',member:'owner',role:20},
    {id:'pm2',project:'p1',member:'member',role:15}
   ],
   pages:[
    {id:'page-pub',project:'p1',workspace:'ws1',name:'Public Page',created_by:'owner',owned_by:'owner',access:0,description_html:'<p>Public</p>',is_locked:false},
    {id:'page-priv',project:'p1',workspace:'ws1',name:'Secret Page',created_by:'owner',owned_by:'owner',access:1,description_html:'<p>Top secret</p>',is_locked:false},
    {id:'page-locked',project:'p1',workspace:'ws1',name:'Locked Page',created_by:'owner',owned_by:'owner',access:0,description_html:'<p>Locked</p>',is_locked:true}
   ],
   issues:[
    {id:'i1',project:'p1',workspace:'ws1',name:'Task 1',sequence_id:1,is_triage:false},
    {id:'i-triage',project:'p1',workspace:'ws1',name:'Triage Task',sequence_id:2,is_triage:true}
   ]
  });
  saveDB({localOnly:true});
  localStorage.setItem('pages_search_seeded','true');
 }
 setLoggedInUser('owner');
 document.querySelector('#run').onclick=async()=>{
  try {
   window.probe={ready:true,done:false};
   const checks=await run();
   window.probe={ready:true,done:true,checks};
   document.querySelector('#result').textContent=JSON.stringify(checks);
  } catch(error){
   console.error('PROBE ERROR:', error && error.message, error && error.response && error.response.status, error && error.response && error.response.data);
   window.probe={done:true,error: (error && error.config ? (error.config.method + ' ' + error.config.url + ': ') : '') + (error && error.response && error.response.data && error.response.data.message ? error.response.data.message : (error && error.message ? error.message : String(error)))};
  }
 };
 window.probe={ready:true};
 if(localStorage.getItem('pages_search_completed')){
  const checks=await checkReload();
  window.probe={ready:true,done:true,reloaded:true,checks};
 }
} catch(error){
 window.probe={done:true,error:error.message||String(error)};
}
`;

const env = {
  VITE_WORKSPACE_REGISTRY_ADDRESS: "",
  VITE_AUTO_COMMIT_ONCHAIN: "false",
  VITE_CHAIN_ID: "991",
  VITE_ROUTER_BASENAME: "",
  VITE_RPC_URL: "https://fixture.invalid",
  VITE_DEFAULT_WORKSPACE_SLUG: "team",
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
    stdin: { contents: fixture, resolveDir: root, sourcefile: "pages-search.fixture.ts", loader: "ts" },
    bundle: true,
    outfile: path.join(temp, "app.js"),
    platform: "browser",
    format: "esm",
    nodePaths: [path.resolve("apps/web/node_modules")],
    tsconfig: path.resolve("apps/web/tsconfig.json"),
    alias: aliases,
    define: { "process.env": JSON.stringify(env), "import.meta.env": JSON.stringify(env) },
  });

  server = http.createServer((req, res) => {
    res.setHeader("content-type", req.url === "/app.js" ? "text/javascript" : "text/html");
    res.end(
      req.url === "/app.js"
        ? fs.readFileSync(path.join(temp, "app.js"))
        : '<!doctype html><button id="run">Run pages and search flows</button><pre id="result"></pre><script type="module" src="/app.js"></script>'
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
    fixture: "real ProjectPageService, Axios interceptor, router; isolated local data, no chain/mail/IPFS writes",
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
  assert.ok(path.basename(temp).startsWith("pages-search-browser-"));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
