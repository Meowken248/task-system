import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { test } from "node:test";
import { appBasePath, assertPublicBuildEnv, readAppEnv, resolveAppMode } from "../scripts/app-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "apps/web/package.json"));
const { loadEnv } = await import(pathToFileURL(require.resolve("vite")).href);

test("Vite mode precedence, empty production overrides and process isolation", () => {
  const tempRoot = path.join(root, "tmp");
  mkdirSync(tempRoot, { recursive: true });
  const dir = mkdtempSync(path.join(tempRoot, "build-env-test-"));
  const before = { ...process.env };
  try {
    writeFileSync(
      path.join(dir, ".env"),
      "VITE_TEST_ENDPOINT=dev\nVITE_BLS_PRIVATE_KEY=test-dev-key\nFIAI_TEST_URL=dev-frame\nUNRELATED_SECRET=hidden\n"
    );
    writeFileSync(path.join(dir, ".env.local"), "VITE_TEST_ENDPOINT=local\n");
    writeFileSync(
      path.join(dir, ".env.production"),
      'VITE_TEST_ENDPOINT=prod\nVITE_BLS_PRIVATE_KEY=""\nFIAI_TEST_URL=prod-frame\n'
    );
    writeFileSync(path.join(dir, ".env.production.local"), "VITE_TEST_ENDPOINT=prod-local\n");
    for (const key of ["VITE_TEST_ENDPOINT", "VITE_BLS_PRIVATE_KEY", "VITE_BREVO_API_KEY", "FIAI_TEST_URL"])
      delete process.env[key];
    const dev = readAppEnv(dir, "development", loadEnv);
    assert.equal(dev.VITE_TEST_ENDPOINT, "local");
    assert.equal(dev.VITE_BLS_PRIVATE_KEY, "test-dev-key");
    assert.equal(dev.UNRELATED_SECRET, undefined);
    const prod = readAppEnv(dir, "production", loadEnv);
    assert.equal(prod.VITE_TEST_ENDPOINT, "prod-local");
    assert.equal(prod.FIAI_TEST_URL, "prod-frame");
    assert.equal(prod.VITE_BLS_PRIVATE_KEY, "");
    assert.deepEqual(assertPublicBuildEnv(prod, false), []);
    assert.equal(process.env.VITE_BLS_PRIVATE_KEY, undefined);
    assert.equal(process.env.FIAI_TEST_URL, undefined);
    assert.equal(readAppEnv(dir, "development", loadEnv).VITE_TEST_ENDPOINT, "local");
    process.env.VITE_TEST_ENDPOINT = "cli";
    assert.equal(readAppEnv(dir, "production", loadEnv).VITE_TEST_ENDPOINT, "cli");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
    assert.equal(path.dirname(dir), tempRoot);
    assert.ok(path.basename(dir).startsWith("build-env-test-"));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI mode and default React Router build/dev mode agree", () => {
  assert.equal(resolveAppMode(["node", "react-router", "build"], ""), "production");
  assert.equal(resolveAppMode(["node", "react-router", "dev"], "dev"), "development");
  assert.equal(resolveAppMode(["node", "react-router", "typegen"], "check:types"), "development");
  assert.equal(resolveAppMode(["node", "react-router", "build", "--mode", "staging"], "build"), "staging");
  assert.equal(resolveAppMode(["node", "react-router", "build", "--mode=staging"], "build"), "staging");
  assert.throws(() => resolveAppMode(["node", "build", "--mode"], ""), /Missing/);
});

test("Web and Spaces mount paths stay consistent, invalid URLs are rejected", () => {
  assert.equal(appBasePath("/plane", "/"), "/plane/");
  assert.equal(appBasePath("//plane//spaces/", "/"), "/plane/spaces/");
  assert.equal(appBasePath(undefined, "/plane/spaces"), "/plane/spaces/");
  assert.equal(appBasePath("", "/plane"), "/");
  assert.throws(() => appBasePath("https://example.test/plane", "/"), /pathname/);
  assert.throws(() => appBasePath("/plane/../admin", "/"), /Invalid/);
});

test("public key guard requires opt-in and never includes values in its errors", () => {
  const env = { VITE_BLS_PRIVATE_KEY: "example-private-value", VITE_BREVO_API_KEY: "example-mail-value" };
  assert.throws(
    () => assertPublicBuildEnv(env, false),
    (error) => {
      assert.match(error.message, /VITE_BLS_PRIVATE_KEY/);
      assert.match(error.message, /VITE_BREVO_API_KEY/);
      assert.ok(!error.message.includes("example-private-value"));
      assert.ok(!error.message.includes("example-mail-value"));
      return true;
    }
  );
  assert.equal(assertPublicBuildEnv(env, true).length, 2);
  assert.deepEqual(assertPublicBuildEnv({ VITE_BLS_PRIVATE_KEY: " " }, false), []);
});
