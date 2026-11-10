import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const walletA = "0x" + "1".repeat(40);
const walletB = "0x" + "2".repeat(40);
const origin = "https://wallet.fixture";
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function harness() {
  let clock = 0, timerId = 0, active = walletA, writes = 0;
  let acknowledge = true, confirm = true, throwing = false, initOptions;
  let preflight;
  const timers = new Map(), events = new Map(), frames = [];
  const observers = new Set();
  const picker = deferred();
  const storage = () => {
    const values = new Map();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
  };
  const win = {
    location: { hostname: "plane.fixture", origin: "https://plane.fixture", href: "https://plane.fixture/plane/" },
    localStorage: storage(), sessionStorage: storage(), isSecureContext: true,
    addEventListener: (name, callback) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(callback); },
    removeEventListener: (name, callback) => events.get(name)?.delete(callback),
    dispatchEvent: (event) => { for (const callback of [...(events.get(event.type) || [])]) callback(event); },
    setTimeout: (callback, delay = 0) => { const id = ++timerId; timers.set(id, { callback, at: clock + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  const sdkEvents = new Map();
  const sdk = {
    isDestroyed: false, interceptors: { request: [], response: [] },
    on(name, callback) { if (!sdkEvents.has(name)) sdkEvents.set(name, new Set()); sdkEvents.get(name).add(callback); return () => sdkEvents.get(name).delete(callback); },
    emit(name, data) { for (const callback of [...(sdkEvents.get(name) || [])]) callback(data); },
    getStatus: () => ({ "blockchain-bridge": "ready", "crypto-vault": "ready", "file-processor": "ready" }),
    destroy() { this.isDestroyed = true; },
    async request(action, params) {
      if (action === "getAllWallets") return [{ address: walletA }, { address: walletB }];
      if (action === "getActiveWalletDapp") return { address: active };
      if (action === "setActiveWalletDapp") {
        writes++;
        if (throwing) throw new Error("Vault unavailable");
        if (acknowledge && confirm) active = params.address;
        return acknowledge;
      }
      throw new Error(`Unexpected action: ${action}`);
    },
  };
  let init = async (options) => { initOptions = options; return sdk; };
  const modules = {
    "@metanodejs/fiai-sdk": { FiaiSDK: { init: (options) => init(options) } },
    "@plane/services": { invalidateAllSigningSessions() {}, invalidateVaultWalletCache() {}, registerChainSigningPreflight(check) { preflight = check; }, getVaultWalletsDetailed: async () => [{ address: walletA }, { address: walletB }], VaultSigningError: Error },
    "@/services/user.service": { UserService: class { async updateUser() {} } },
    "./wallet-center-events": { openWalletCenter() {}, notifyWalletChanged() {} },
    "@metanodejs/system-core": { connectWallet: () => picker.promise, closeSelectPaymentWallet() {} },
  };
  const env = { VITE_RPC_URL: "https://rpc.fixture/", VITE_WS_URL: "wss://rpc.fixture/ws", VITE_CHAIN_ID: "991",
    VITE_FIAI_BLOCKCHAIN_BRIDGE_URL: "https://bridge.fixture/", VITE_FIAI_CRYPTO_VAULT_URL: "https://vault.fixture/",
    VITE_FIAI_FILE_PROCESSOR_URL: "https://files.fixture/", VITE_URL_CONNECT_WALLET: origin, VITE_ROUTER_BASENAME: "/plane", VITE_FIAI_TIMEOUT: "1000" };
  const document = { body: {}, querySelectorAll: () => frames, dispatchEvent: (event) => win.dispatchEvent(event), getElementById: () => null };
  const sandbox = { window: win, document, console: { log() {}, warn() {}, error() {} }, process: { env },
    setTimeout: win.setTimeout, clearTimeout: win.clearTimeout,
    Date: class extends Date { static now() { return clock; } },
    KeyboardEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe() { observers.add(this); } disconnect() { observers.delete(this); } },
    URL, Map, Set, Promise };
  function load(name) {
    const filename = path.resolve("apps/web/core/services/blockchain", name + ".ts");
    const source = fs.readFileSync(filename, "utf8").replaceAll("import.meta", "({env: {}})");
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, { ...sandbox, exports, require: (specifier) => {
      if (!(specifier in modules)) throw new Error(`Unmocked import: ${specifier}`);
      return modules[specifier];
    } }, { filename });
    return exports;
  }
  const bridge = load("fiai-sdk.service");
  modules["./fiai-sdk.service"] = bridge;
  const wallet = load("metanode-wallet.service");
  modules["./metanode-wallet.service"] = wallet;
  const vault = load("wallet-vault.service");
  wallet.configureMetanodeWalletUser("person");
  async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
  async function step() {
    await flush();
    const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    if (next) { timers.delete(next[0]); clock = next[1].at; next[1].callback(); }
    await flush();
  }
  async function settle(promise) {
    let done = false, value, error;
    promise.then((result) => { done = true; value = result; }, (failure) => { done = true; error = failure; });
    for (let i = 0; i < 270 && !done; i++) await step();
    assert(done, "operation must settle");
    if (error) throw error;
    return value;
  }
  function select(address, { eventOrigin = origin, source, removedBeforeMessage = false } = {}) {
    const contentWindow = {};
    frames.push({ src: `${origin}/`, contentWindow });
    observers.forEach((observer) => observer.callback());
    if (removedBeforeMessage) {
      frames.pop();
      observers.forEach((observer) => observer.callback());
    }
    win.dispatchEvent({ type: "message", origin: eventOrigin, source: source ?? contentWindow, data: { type: "wallet-selected", data: { address } } });
  }
  return { bridge, wallet, vault, sdk, win, picker, events, frames, flush, step, settle, select,
    get writes() { return writes; }, get initOptions() { return initOptions; },
    get preflight() { return preflight; },
    set acknowledge(value) { acknowledge = value; }, set confirm(value) { confirm = value; }, set throwing(value) { throwing = value; },
    set init(value) { init = value; }, set active(value) { active = value; } };
}

for (const failure of ["false", "exception", "wrong-readback"]) test(`activation rejects ${failure} and preserves linked wallet`, async () => {
  const h = harness();
  await h.bridge.initFiaiSDK();
  assert(await h.wallet.linkMetanodeWalletAddress(walletA));
  if (failure === "false") h.acknowledge = false;
  if (failure === "exception") h.throwing = true;
  if (failure === "wrong-readback") h.confirm = false;
  assert.equal(await h.wallet.linkMetanodeWalletAddress(walletB), false);
  assert.equal(h.wallet.getLinkedMetanodeWalletAddress(), walletA);
  assert.equal(h.win.localStorage.getItem("plane_active_wallet_address"), walletA);
});

test("activation requires acknowledged set and matching per-domain readback", async () => {
  const h = harness();
  assert(await h.wallet.linkMetanodeWalletAddress(walletB));
  assert.equal(h.writes, 1);
  assert.equal(h.wallet.getLinkedMetanodeWalletAddress(), walletB);
  assert.deepEqual(Object.keys(h.initOptions.frameUrls).sort(), ["blockchainBridge", "cryptoVault", "fileProcessor"]);
  assert.equal(h.initOptions.basePath, "/plane");
});

test("Wallet Center surfaces a rejected activation instead of reporting success", async () => {
  const h = harness();
  h.acknowledge = false;
  await assert.rejects(h.vault.selectVaultWallet(walletB), /chưa xác nhận/);
  assert.equal(h.wallet.getLinkedMetanodeWalletAddress(), null);
});

test("missing wallet recovery opens Wallet Center without picking an unrelated existing wallet", async () => {
  const h = harness();
  assert.equal(await h.wallet.promptForMetanodeWalletImport("0x" + "3".repeat(40)), false);
  assert.equal(h.wallet.getLinkedMetanodeWalletAddress(), null);
  assert.equal(h.writes, 0);
});

test("picker does not accept an old active wallet or a newly available wallet without selection", async () => {
  const h = harness();
  let done = false;
  const pending = h.wallet.resolveMetanodeWalletAddress({ forceSelect: true }).finally(() => { done = true; });
  for (let i = 0; i < 8; i++) await h.step();
  assert.equal(done, false);
  assert.equal(h.writes, 0);
  assert.equal(h.wallet.getLinkedMetanodeWalletAddress(), null);
  h.picker.resolve({ success: false });
  await assert.rejects(h.settle(pending), /hủy/);
});

for (const address of [walletA, walletB]) test(`explicit picker selection accepts ${address === walletA ? "the same" : "a different"} wallet`, async () => {
  const h = harness();
  const pending = h.wallet.resolveMetanodeWalletAddress({ forceSelect: true });
  await h.flush();
  h.select(address);
  assert.equal(await h.settle(pending), address);
  assert.equal(h.wallet.getLinkedMetanodeWalletAddress(), address);
  assert.equal(h.events.get("keydown")?.size, 0);
});

test("wrong-origin and wrong-window messages are ignored; reset removes listeners and interceptors", async () => {
  const h = harness();
  await h.bridge.initFiaiSDK();
  h.select(walletB, { eventOrigin: "https://untrusted.fixture" });
  h.select(walletB, { source: {} });
  assert.equal(h.bridge.getLastSelectedMetanodeWallet(), null);
  h.select(walletA);
  assert.equal(h.bridge.getLastSelectedMetanodeWallet().address, walletA);
  assert.equal(h.events.get("message").size, 1);
  h.bridge.disposeFiaiSDK();
  assert.equal(h.events.get("message").size, 0);
  assert.equal(h.sdk.interceptors.request.length, 0);
  assert.equal(h.sdk.interceptors.response.length, 0);
  h.select(walletB);
  assert.equal(h.bridge.getLastSelectedMetanodeWallet(), null);
});

test("outgoing activation request does not emit a successful selection", async () => {
  const h = harness();
  await h.bridge.initFiaiSDK();
  for (const intercept of h.sdk.interceptors.request) await intercept({ action: "setActiveWalletDapp", params: { address: walletB } });
  assert.equal(h.bridge.getLastSelectedMetanodeWallet(), null);
});

test("changing Plane account during selection cancels profile changes", async () => {
  const h = harness();
  const pending = h.wallet.resolveMetanodeWalletAddress({ forceSelect: true });
  await h.flush();
  h.wallet.configureMetanodeWalletUser("another-person");
  h.select(walletB);
  await assert.rejects(h.settle(pending), /thay đổi/);
  assert.equal(h.wallet.getLinkedMetanodeWalletAddress(), null);
});

test("late SDK initialization after dispose is destroyed instead of becoming current", async () => {
  const h = harness(), init = deferred();
  h.init = () => init.promise;
  const pending = h.bridge.initFiaiSDK();
  h.bridge.disposeFiaiSDK();
  init.resolve(h.sdk);
  await assert.rejects(pending, /hết hạn/);
  assert.equal(h.sdk.isDestroyed, true);
  assert.equal(h.bridge.getFiaiSDK(), null);
});

test("missing signing frame blocks signing with its configured endpoint", async () => {
  const h = harness();
  h.sdk.getStatus = () => ({ "blockchain-bridge": "ready", "crypto-vault": "error" });
  await assert.rejects(h.settle(h.bridge.ensureFiaiFramesReady(1)), /https:\/\/vault.fixture/);
});

test("shared signing preflight blocks an unavailable frame before the transaction body", async () => {
  const h = harness();
  await h.bridge.initFiaiSDK();
  h.sdk.getStatus = () => ({ "blockchain-bridge": "error", "crypto-vault": "ready" });
  await assert.rejects(h.settle(h.preflight()), /bridge.fixture/);
});

test("simultaneous force-select calls share one decision", async () => {
  const h = harness();
  const first = h.wallet.resolveMetanodeWalletAddress({ forceSelect: true });
  const second = h.wallet.resolveMetanodeWalletAddress({ forceSelect: true });
  await h.flush();
  h.select(walletB);
  const results = await h.settle(Promise.all([first, second]));
  assert.deepEqual([...results], [walletB, walletB]);
  assert.equal(h.writes, 1);
});

test("SDK success alone is not a decision; a trusted picker message still works after SDK hides the iframe", async () => {
  const h = harness();
  const pending = h.wallet.resolveMetanodeWalletAddress({ forceSelect: true });
  await h.flush();
  h.active = walletB;
  h.picker.resolve({ success: true });
  await h.step();
  assert.equal(h.wallet.getLinkedMetanodeWalletAddress(), null);
  h.select(walletB, { removedBeforeMessage: true });
  assert.equal(await h.settle(pending), walletB);
  assert.equal(h.writes, 0);
});

test("timeout rejects initialization and late completion cannot replace the current SDK", async () => {
  const h = harness(), init = deferred();
  h.init = () => init.promise;
  await assert.rejects(h.settle(h.bridge.initFiaiSDK()), /quá/);
  await assert.rejects(h.bridge.initFiaiSDK(), /kết thúc phiên/);
  init.resolve(h.sdk);
  await h.flush();
  assert.equal(h.sdk.isDestroyed, true);
  assert.equal(h.bridge.getFiaiSDK(), null);
  assert.equal(h.events.get("message")?.size ?? 0, 0);
});
