#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { assertPublicBuildEnv, readAppEnv } from "./app-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.env.npm_execpath;
if (!pnpm || !/pnpm\.(?:c?js|mjs)$/.test(pnpm)) throw new Error("Run with pnpm run build:plane");

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Build stopped: code=${code}, signal=${signal}`));
    });
  });
}

// Fail before building any dependency when an internal secret opt-in is missing.
await Promise.all(
  ["space", "web"].map(async (name) => {
    const appDir = path.join(root, "apps", name);
    const require = createRequire(path.join(appDir, "package.json"));
    const { loadEnv } = await import(pathToFileURL(require.resolve("vite")).href);
    const exposed = assertPublicBuildEnv(readAppEnv(appDir, "production", loadEnv));
    console.log(
      `[build-plane] ${name}: production${exposed.length ? `, internal opt-in (${exposed.map(({ key }) => key).join(", ")})` : ""}`
    );
  })
);

// Verify source maps, installed SDK and actual wallet mode. Never build/write the SDK.
await run(process.execPath, [path.join(root, "scripts/sync-fiai-runtime.mjs")]);
// Spaces must finish before Web's post-build copies its output. Force fresh output
// because the existing external file: SDK dist is outside Turbo's source hashes.
await run(process.execPath, [pnpm, "exec", "turbo", "run", "build", "--filter=space...", "--force"]);
await run(process.execPath, [pnpm, "exec", "turbo", "run", "build", "--filter=web...", "--force"]);

const client = path.join(root, "apps/web/build/client");
const spaces = path.join(root, "apps/space/build/client");
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
for (const relative of ["index.html", "spaces/index.html", "fiai-sdk-build.json"]) {
  if (!fs.statSync(path.join(client, relative)).isFile()) throw new Error(`Build output missing: ${relative}`);
}
const sdkManifest = JSON.parse(fs.readFileSync(path.join(client, "fiai-sdk-build.json"), "utf8"));
if (hash(path.join(client, "fiai-sdk-build.json")) !== hash(path.join(root, "apps/web/public/fiai-sdk-build.json"))) throw new Error("Built SDK manifest differs");
if (sdkManifest.walletMode === "runtime") {
  if (hash(path.join(client, "wallet-runtime-sw.js")) !== sdkManifest.hashes["wallet-runtime-sw.js"]) throw new Error("Built wallet worker differs from verified SDK");
} else if (fs.existsSync(path.join(client, "wallet-runtime-sw.js"))) {
  throw new Error("URL wallet build contains a stale runtime worker");
}
let spaceFiles = 0;
function verifySpaces(dir, relative = "") {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = path.join(relative, item.name);
    if (item.isDirectory()) verifySpaces(path.join(dir, item.name), next);
    else {
      if (hash(path.join(spaces, next)) !== hash(path.join(client, "spaces", next))) {
        throw new Error(`Spaces copy differs: ${next}`);
      }
      spaceFiles++;
    }
  }
}
verifySpaces(spaces);
console.log(`[build-plane] Verified: Web HTML, SDK manifest (${sdkManifest.walletMode} wallet) and ${spaceFiles} matching Spaces files.`);
console.log("[build-plane] Finished: apps/web/build/client (including fresh spaces bundle).");
