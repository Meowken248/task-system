import "./browser.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const wallet = "0x" + "1".repeat(40);
const fixture = globalThis.__taskClientFixture = { wallet, sends: [], reads: [], version: 3, parentWorkspace: "team", db: {} };
const moduleUrl = (source) => ({ url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true });
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@plane/services") return moduleUrl(`
    const f=globalThis.__taskClientFixture;
    export const localDB=f.db;
    export const assertVaultSigningAddress=async()=>f.wallet;
    export const isVaultSigningError=()=>false;
    export const runExclusiveChainTx=async(_label,callback)=>callback();
  `);
  if (specifier === "@metanodejs/mtn-contract") return moduleUrl(`
    export class MtnContract { async sendTransaction(request) {
      const f=globalThis.__taskClientFixture; f.reads.push(request);
      if(request.functionName==='contractVersion')return {result:f.version};
      if(request.functionName==='getTaskId')return 7;
      if(request.functionName==='getTaskWorkspace')return {data:{output:[f.parentWorkspace]}};
      throw Error('Unmocked contract read '+request.functionName);
    }}
  `);
  if (specifier.endsWith("/metanode-wallet.service") || specifier === "./metanode-wallet.service") return moduleUrl(`
    const f=globalThis.__taskClientFixture;
    export const isMetanodeWalletRuntimeSupported=()=>true;
    export const isWalletAddress=value=>/^0x[0-9a-f]{40}$/i.test(value);
    export const promptForMetanodeWalletImport=async()=>false;
    export const rememberSigningWalletAddress=()=>{};
    export const resolveMetanodeWalletAddress=async()=>f.wallet;
  `);
  if (specifier === "./fiai-sdk.service") return moduleUrl(`
    const f=globalThis.__taskClientFixture;
    const sdk={request:async(action,request)=>{
      if(action==='sendTransaction'){f.sends.push(request);return {transactionHash:'0x'+'a'.repeat(64)}}
      if(action==='getAllWallets')return [{address:f.wallet}];
      if(action==='getActiveWalletDapp')return {address:f.wallet};
      throw Error('Unmocked SDK action '+action);
    }};
    export const getFiaiSDK=()=>sdk;
    export const initFiaiSDK=async()=>sdk;
    export const ensureFiaiFramesReady=async()=>{if(f.framesReady===false)throw Error('fixture signing frames unavailable');return sdk;};
    export const resetFiaiSDK=async()=>sdk;
    export const getLatestCapturedWalletTxHash=()=>null;
  `);
  if (specifier.startsWith("@/")) return next(new URL(`../../apps/web/core/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });
const { createIssueOnChain } = await import("../../apps/web/core/services/blockchain/plane-task-chain.service.ts");
let serial = 0;
beforeEach(() => {
  fixture.framesReady = true;
  fixture.sends = []; fixture.reads = []; fixture.version = 3; fixture.parentWorkspace = "team";
  Object.assign(fixture.db, { projects: [{ id: "p1", workspace: "ws" }], workspaces: [{ id: "ws", slug: "team" }] });
  process.env.VITE_CONTRACT_ADDRESS = "0x" + (++serial).toString(16).padStart(40, "0");
  process.env.VITE_RPC_URL = "https://task-rpc.fixture";
  process.env.VITE_BLS_PRIVATE_KEY = "";
  globalThis.fetch = async (url) => {
    assert.equal(url, process.env.VITE_RPC_URL, "No real RPC access");
    return Response.json({ result: {} });
  };
});
const issue = { id: "issue-1", project_id: "p1", name: "Task", description_html: "<p>Work</p>" };
const values = (request) => Object.fromEntries(request.inputArray.map((input) => [input.name, input.value]));

test("V3 creates a root with its real local workspace and signing assignee", async () => {
  const result = await createIssueOnChain(issue);
  assert.equal(result.assigneeWallet, wallet);
  assert.equal(fixture.sends.length, 1);
  assert.equal(fixture.sends[0].functionName, "createWorkspaceTask");
  assert.equal(values(fixture.sends[0]).slug, "team");
  assert.equal(values(fixture.sends[0]).assignee, wallet);
});

test("unavailable signing frames prevent task creation before requesting any signature", async () => {
  fixture.framesReady = false;
  await assert.rejects(createIssueOnChain(issue), /signing frames unavailable/);
  assert.equal(fixture.sends.length, 0);
});
test("V3 child unwraps a decoded SDK workspace response and links to its parent", async () => {
  await createIssueOnChain({ ...issue, parent_id: "parent" });
  assert.equal(fixture.sends.length, 1);
  assert.equal(fixture.sends[0].functionName, "createChildTask");
  assert.equal(values(fixture.sends[0]).parentTaskId, 7);
});
test("V3 refuses a child outside the parent workspace without requesting a signature", async () => {
  fixture.parentWorkspace = "other";
  await assert.rejects(createIssueOnChain({ ...issue, parent_id: "parent" }), /không thuộc cùng/);
  assert.equal(fixture.sends.length, 0);
});
test("V3 refuses an unresolved project workspace and V2 keeps its legacy create ABI", async () => {
  fixture.db.projects = [];
  await assert.rejects(createIssueOnChain(issue), /Chưa xác định được/);
  assert.equal(fixture.sends.length, 0);
  process.env.VITE_CONTRACT_ADDRESS = "0x" + "f".repeat(40);
  fixture.version = 2;
  await createIssueOnChain(issue);
  assert.equal(fixture.sends[0].functionName, "createTask");
  assert.equal(values(fixture.sends[0]).slug, undefined);
});
