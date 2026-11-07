import "./browser.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

test("independent module queues coordinate through the browser origin lock", async () => {
  const first = await import("../../packages/services/src/dapp/tx-gateway.ts?tab=first");
  const second = await import("../../packages/services/src/dapp/tx-gateway.ts?tab=second");
  const prior = window.navigator;
  let shared = Promise.resolve();
  window.navigator = { locks: { request: (_name, _options, callback) => {
    const next = shared.then(callback); shared = next.catch(() => undefined); return next;
  } } };
  let release, entered;
  const held = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const events = [];
  try {
    const a = first.runExclusiveChainTx("first", async () => { events.push("first-enter"); entered(); await held; events.push("first-exit"); });
    await started;
    const b = second.runExclusiveChainTx("second", async () => { events.push("second-enter"); });
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(events, ["first-enter"]);
    release(); await Promise.all([a, b]);
    assert.deepEqual(events, ["first-enter", "first-exit", "second-enter"]);
  } finally { window.navigator = prior; }
});

test("a real browser without origin locking fails before sending a transaction", async () => {
  const { runExclusiveChainTx } = await import("../../packages/services/src/dapp/tx-gateway.ts");
  const prior = window.navigator; window.navigator = {};
  let sent = false;
  try { await assert.rejects(runExclusiveChainTx("blocked", async () => { sent = true; }), /HTTPS/); assert.equal(sent, false); }
  finally { window.navigator = prior; }
});
