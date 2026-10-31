/** Build current web sources without changing the user's environment files or
 * disabling the public-secret check. The isolated output is for verification. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const root = process.cwd();
const app = path.resolve(root, "apps/web");
const fixture = path.resolve(root, `tmp/upload-safe-build-${Date.now()}`);
const target = path.join(fixture, "apps/web");
if (!fixture.startsWith(path.resolve(root, "tmp") + path.sep)) throw new Error("Unsafe verification path");
const requireFromApp = createRequire(path.join(app, "package.json"));
const { parse } = requireFromApp("dotenv");
const privateName = /(?:PRIVATE.*KEY|API.*KEY|TOKEN|SECRET|PASSWORD|JWT)/i;
const environment = {};
const forbiddenValues = new Set();
for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  const file = path.join(app, name);
  if (!fs.existsSync(file)) continue;
  for (const [key, value] of Object.entries(parse(fs.readFileSync(file)))) {
    if (privateName.test(key)) {
      if (value.length >= 12) forbiddenValues.add(value);
      continue;
    }
    if (!key.startsWith("VITE_")) continue;
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      if (url.username || url.password || [...url.searchParams.keys()].some((param) => privateName.test(param)))
        continue;
    }
    environment[key] = value;
  }
}

const ignored = new Set(["node_modules", "build", "dist", ".react-router", ".next", ".turbo", ".git"]);
fs.cpSync(app, target, {
  recursive: true,
  filter: (source) =>
    !path
      .relative(app, source)
      .split(path.sep)
      .some((segment) => ignored.has(segment) || segment === ".env" || segment.startsWith(".env.")),
});
for (const [destination, source] of [
  [path.join(target, "node_modules"), path.join(app, "node_modules")],
  [path.join(fixture, "packages"), path.join(root, "packages")],
  [path.join(fixture, "node_modules"), path.join(root, "node_modules")],
]) {
  fs.symlinkSync(source, destination, "junction");
}
fs.mkdirSync(path.join(fixture, "scripts"), { recursive: true });
for (const name of ["check-public-env-secrets.mjs", "sync-space-build.mjs"])
  fs.copyFileSync(path.join(root, "scripts", name), path.join(fixture, "scripts", name));
fs.copyFileSync(path.join(root, "package.json"), path.join(fixture, "package.json"));
fs.writeFileSync(
  path.join(target, ".env.production"),
  Object.entries(environment)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n") + "\n"
);
const childEnv = { ...process.env };
delete childEnv.ALLOW_PUBLIC_SIGNING_SECRETS;
for (const key of Object.keys(childEnv)) if (key.startsWith("VITE_")) delete childEnv[key];
const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "pnpm.cmd build"], {
  cwd: target,
  env: childEnv,
  windowsHide: true,
  stdio: "inherit",
});
const code = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
});
if (code !== 0) throw new Error(`Isolated web build failed with exit code ${code}`);
const built = path.join(target, "build/client");
let scannedFiles = 0;
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(file);
    else {
      const bytes = fs.readFileSync(file);
      for (const value of forbiddenValues)
        if (bytes.includes(Buffer.from(value)))
          throw new Error("A forbidden source secret was found in the verification bundle");
      scannedFiles++;
    }
  }
}
scan(built);
const evidence = path.resolve(root, process.env.PLANE_TEST_OUTPUT_DIR || "docs/verification/uploads-2026-10-31");
if (!evidence.startsWith(root + path.sep)) throw new Error("Unsafe verification output path");
fs.mkdirSync(evidence, { recursive: true });
const proof = {
  clientDate: "2026-10-31",
  isolatedBuild: true,
  sourceEnvironmentFilesChanged: false,
  publicSecretGuardEnabled: true,
  signingSecretOverrideUsed: false,
  matchingSecretValues: 0,
  scannedFiles,
  buildDirectory: built,
  sourceConfigSha256: createHash("sha256")
    .update(fs.readFileSync(path.join(app, "vite.config.ts")))
    .digest("hex"),
};
fs.writeFileSync(path.join(evidence, "safe-build.json"), JSON.stringify(proof, null, 2) + "\n");
console.log(JSON.stringify({ buildDirectory: built, scannedFiles, matchingSecretValues: 0 }));
