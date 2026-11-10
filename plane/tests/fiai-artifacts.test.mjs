import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { inspectFiaiArtifacts, syncFiaiArtifacts, artifactHash } from "../scripts/fiai-artifacts.mjs";

function fixture(t, mode = "url") {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "plane-sdk-test-"));
  t.after(() => {
    const resolved = path.resolve(temporary);
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const sdk = path.join(temporary, "sdk"), plane = path.join(temporary, "plane");
  fs.mkdirSync(path.join(sdk, "src"), { recursive: true });
  fs.mkdirSync(path.join(sdk, "dist"));
  const source = `const productionWalletLoader: (runtime: unknown) => unknown = ${mode}WalletLoader\n`;
  fs.writeFileSync(path.join(sdk, "src/connect-wallet.di.ts"), source);
  fs.writeFileSync(path.join(sdk, "package.json"), JSON.stringify({ name: "@metanodejs/fiai-sdk", version: "test", main: "dist/index.cjs" }));
  for (const name of ["index.mjs", "index.cjs", "index.d.ts", "index.d.mts"]) fs.writeFileSync(path.join(sdk, "dist", name), `fixture ${name}`);
  for (const name of ["index.mjs.map", "index.cjs.map"]) fs.writeFileSync(path.join(sdk, "dist", name), JSON.stringify({ sources: ["../src/connect-wallet.di.ts"], sourcesContent: [source] }));
  const installed = [];
  for (const workspace of ["apps/web", "packages/services"]) {
    const target = path.join(plane, workspace, "node_modules/@metanodejs/fiai-sdk");
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(sdk, target, { recursive: true });
    fs.writeFileSync(path.join(target, "dist/wallet-runtime-sw.js"), "old worker");
    installed.push(target);
  }
  fs.mkdirSync(path.join(plane, "apps/web/public"), { recursive: true });
  fs.writeFileSync(path.join(plane, "apps/web/public/wallet-runtime-sw.js"), "old worker");
  return { sdk, plane, installed };
}

test("URL wallet verifies source and package artifacts and removes stale worker only inside Plane", (t) => {
  const { sdk, plane, installed } = fixture(t);
  const before = artifactHash(path.join(sdk, "dist/index.mjs"));
  const result = syncFiaiArtifacts(plane, sdk, { refresh: true });
  assert.equal(result.walletMode, "url");
  assert.equal(artifactHash(path.join(sdk, "dist/index.mjs")), before);
  for (const target of installed) assert(!fs.existsSync(path.join(target, "dist/wallet-runtime-sw.js")));
  assert(!fs.existsSync(path.join(plane, "apps/web/public/wallet-runtime-sw.js")));
  assert(fs.existsSync(path.join(plane, "apps/web/public/fiai-sdk-build.json")));
});

test("a source edit without corresponding artifacts blocks build even when both installed copies are old", (t) => {
  const { sdk } = fixture(t);
  fs.appendFileSync(path.join(sdk, "src/connect-wallet.di.ts"), "// newer source");
  assert.throws(() => inspectFiaiArtifacts(sdk), /Stale SDK artifact/);
});

test("a stale installed type declaration blocks verification, explicit Plane-only refresh corrects it", (t) => {
  const { sdk, plane, installed } = fixture(t);
  fs.writeFileSync(path.join(installed[0], "dist/index.d.ts"), "old type");
  assert.throws(() => syncFiaiArtifacts(plane, sdk), /Installed SDK is stale/);
  syncFiaiArtifacts(plane, sdk, { refresh: true });
  assert.equal(artifactHash(path.join(installed[0], "dist/index.d.ts")), artifactHash(path.join(sdk, "dist/index.d.ts")));
});

test("refresh replaces pnpm hard links without changing their source", (t) => {
  const { sdk, plane, installed } = fixture(t);
  const target = path.join(installed[0], "dist/index.mjs");
  const shared = path.join(sdk, "shared-old.mjs");
  fs.writeFileSync(shared, "shared old bytes");
  fs.unlinkSync(target);
  fs.linkSync(shared, target);
  syncFiaiArtifacts(plane, sdk, { refresh: true });
  assert.equal(fs.readFileSync(shared, "utf8"), "shared old bytes");
});

test("runtime mode cannot pass by silently using an old worker", (t) => {
  const { sdk } = fixture(t, "runtime");
  assert.throws(() => inspectFiaiArtifacts(sdk), /requires a matching SDK worker/);
});

test("SDK source path linked outside Plane cannot be used as refresh destination", (t) => {
  const { sdk } = fixture(t);
  // A fake workspace rooted at SDK has no installed Plane copies; fail before writes.
  const before = artifactHash(path.join(sdk, "dist/index.mjs"));
  assert.throws(() => syncFiaiArtifacts(sdk, sdk, { refresh: true }));
  assert.equal(artifactHash(path.join(sdk, "dist/index.mjs")), before);
});
