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
const temp = fs.mkdtempSync(path.join(tempRoot, "planning-browser-"));
const output = path.resolve("docs/verification/planning-resources-2026-11-05");
fs.mkdirSync(output, { recursive: true });

// Real services, Axios interceptor, router, persistence and BaseIssuesStore methods.
// The small root-store adapter holds a separate UI cache to detect stale counts.
const fixture = `
import {localDB,defaultDB,setLoggedInUser,saveDB} from './packages/services/src/dapp/store.ts';
import {CycleService} from './apps/web/core/services/cycle.service.ts';
import {ModuleService} from './apps/web/core/services/module.service.ts';
import {ViewService} from './apps/web/core/services/view.service.ts';
import {InboxIssueService} from './apps/web/core/services/inbox/inbox-issue.service.ts';
import {ProjectPageService} from './apps/web/core/services/page/project-page.service.ts';
import {IssueService} from './apps/web/core/services/issue/issue.service.ts';
import {BaseIssuesStore} from './apps/web/core/store/issue/helpers/base-issues.store.ts';
window.probe={ready:false};
window.fetch=async()=>{throw Error('Unexpected external fetch in isolated fixture')};
const cycle=new CycleService(),module=new ModuleService(),view=new ViewService(),inbox=new InboxIssueService(),page=new ProjectPageService();
const check=(value,message)=>{if(!value)throw Error(message)};
const checkReload=async()=>{
 const cycles=await cycle.getCyclesWithParams('team','p1');
 const modules=await module.getModules('team','p1');
 check(cycles[0].total_issues===2,'Cycle count after reload');
 check(modules[0].total_issues===0,'Module unlink after reload');
 check(localDB.pages[0].access===0,'Page visibility after reload');
 const row=localDB.inbox_issues[0];
 const read=await inbox.retrieve('team','p1',row.issue_id);
 check(read.issue.name==='Renamed'&&read.issue.sequence_id===3,'Intake content/number after reload');
 return ['Cycle reload','Module reload','Page reload','Intake reload'];
};
const run=async()=>{
 const checks=[];
 const uiMap=Object.fromEntries(localDB.issues.map(issue=>[issue.id,structuredClone(issue)]));
 const cache={cycles:{},modules:{}};
 const root={rootStore:{cycle:{fetchCycleDetails:async(w,p,id)=>cache.cycles[id]=await cycle.getCycleDetails(w,p,id)},module:{fetchModuleDetails:async(w,p,id)=>cache.modules[id]=await module.getModuleDetails(w,p,id)}},issues:{getIssueById:id=>uiMap[id],issuesMap:uiMap}};
 const store=Object.create(BaseIssuesStore.prototype);
 Object.assign(store,{rootIssueStore:root,issueService:new IssueService(),moduleService:module,fetchParentStats:()=>{},issueUpdate:(_w,_p,id,patch)=>Object.assign(uiMap[id],patch)});
 const dates=await cycle.cycleDateCheck('team','p1',{start_date:'2026-12-20',end_date:'2026-12-01'});
 check(dates.status===false&&!!dates.error,'Cycle reversed date');checks.push('Cycle date validation');
 await store.addIssueToCycle('team','p1','c1',['i2'],false);
 check(cache.cycles.c1.total_issues===2,'Cycle UI cache refresh');checks.push('Cycle count without refresh');
 const grouped=await cycle.getCycleIssues('team','p1','c1',{group_by:'state'});
 check(grouped.results.s1.results[0].id==='i1'&&grouped.results.s2.results[0].id==='i2','Cycle grouped shape');checks.push('Cycle grouped response');
 await store.removeIssuesFromModule('team','p1','m1',['i1']);
 check(cache.modules.m1.total_issues===0&&uiMap.i1.module_ids.length===0,'Module UI cache/unlink');checks.push('Module legacy unlink and UI count');
 const high=await view.getViewIssues('team','p1','v1');check(high.results.length===1&&high.results[0].id==='i1','View high filter');checks.push('View saved filters');
 const screen=await store.issueService.getIssues('team','p1',{filters:JSON.stringify({priority__exact:'high'}),sub_issue:true,group_by:'priority'});
 check(screen.results.high.results.length===1&&screen.results.high.results[0].id==='i1'&&(!screen.results.low||screen.results.low.total_results===0),'View screen serialized filter');checks.push('View screen filter through Axios');
 await page.updateAccess('team','p1','page1',{access:0});check(localDB.pages[0].access===0,'Page public');
 setLoggedInUser('member');let denied=false;try{await page.updateAccess('team','p1','page1',{access:1})}catch(error){denied=error.code==='NOT_AUTHORIZED'}
 check(denied&&localDB.pages[0].access===0,'Page permission denial');setLoggedInUser('owner');checks.push('Page visibility and rejected change');
 const created=await inbox.create('team','p1',{name:'Original'});
 const updated=await inbox.updateIssue('team','p1',created.issue_id,{name:'Renamed',priority:'high'});
 check(updated.issue.name==='Renamed'&&updated.issue.sequence_id===3,'Intake nested payload/sequence');checks.push('Intake update and numbering');
 localStorage.setItem('planning_completed','true');
 return checks;
};
try {
 if(!localStorage.getItem('planning_seeded')){
  Object.keys(localDB).forEach(key=>delete localDB[key]);Object.assign(localDB,structuredClone(defaultDB),{
   users:[{id:'owner',email:'owner@example.invalid'},{id:'member',email:'member@example.invalid'}],
   workspaces:[{id:'ws',slug:'team',created_by:'owner'}],workspace_members:[{id:'wm1',workspace:'ws',member:'owner',role:20},{id:'wm2',workspace:'ws',member:'member',role:15}],
   projects:[{id:'p1',identifier:'ONE',workspace:'ws',network:2,created_by:'owner'}],
   states:[{id:'s1',project:'p1',group:'started',default:true},{id:'s2',project:'p1',group:'completed'}],
   cycles:[{id:'c1',project:'p1',workspace:'ws',name:'Cycle'}],modules:[{id:'m1',project:'p1',workspace:'ws',name:'Module'}],
   views:[{id:'v1',project:'p1',workspace:'ws',created_by:'owner',rich_filters:{priority__exact:'high'}}],
   pages:[{id:'page1',project:'p1',workspace:'ws',created_by:'owner',access:1}],inbox_issues:[],
   issues:[{id:'i1',project:'p1',workspace:'ws',name:'High',sequence_id:1,state:'s1',cycle:'c1',module:'m1',modules:['m1'],module_ids:['m1'],priority:'high'},{id:'i2',project:'p1',workspace:'ws',name:'Low',sequence_id:2,state:'s2',priority:'low'}]
  });saveDB({localOnly:true});localStorage.setItem('planning_seeded','true');
 }
 setLoggedInUser('owner');
 document.querySelector('#run').onclick=async()=>{try{window.probe={ready:true,done:false};const checks=await run();window.probe={ready:true,done:true,checks};document.querySelector('#result').textContent=JSON.stringify(checks)}catch(error){window.probe={done:true,error:error.message||error.error||String(error)}}};
 window.probe={ready:true};
 if(localStorage.getItem('planning_completed')){const checks=await checkReload();window.probe={ready:true,done:true,reloaded:true,checks};}
}catch(error){window.probe={done:true,error:error.message||String(error)}}
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
let server,
  chrome,
  socket,
  session,
  serial = 0;
const pending = new Map(),
  external = [],
  exceptions = [];
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
    stdin: { contents: fixture, resolveDir: root, sourcefile: "planning.fixture.ts", loader: "ts" },
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
        : '<!doctype html><button id="run">Run five planning flows</button><pre id="result"></pre><script type="module" src="/app.js"></script>'
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
    fixture: "real source services/router and store methods; isolated local data, no chain/mail/IPFS writes",
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
  assert.ok(path.basename(temp).startsWith("planning-browser-"));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
