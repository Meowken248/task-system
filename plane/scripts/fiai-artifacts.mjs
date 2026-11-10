import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const artifactHash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
};

/** Read-only inspection of the already-built SDK. Never runs its build/install scripts. */
export function inspectFiaiArtifacts(sdkRoot) {
  const sourceRoot = fs.realpathSync(path.join(sdkRoot, "src"));
  const files = ["index.mjs", "index.cjs", "index.d.ts", "index.d.mts", "index.mjs.map", "index.cjs.map"];
  let walletMode;
  for (const format of ["mjs", "cjs"]) {
    const map = JSON.parse(fs.readFileSync(path.join(sdkRoot, "dist", `index.${format}.map`), "utf8"));
    if (!map.sources?.length || map.sources.length !== map.sourcesContent?.length) throw Error("SDK source map is incomplete");
    let matched = 0;
    let di;
    for (let index = 0; index < map.sources.length; index++) {
      const source = fs.realpathSync(path.resolve(sdkRoot, "dist", map.sources[index]));
      if (!inside(sourceRoot, source)) continue;
      if (fs.readFileSync(source, "utf8") !== map.sourcesContent[index]) throw Error(`Stale SDK artifact: ${map.sources[index]}`);
      matched++;
      if (source.endsWith(`${path.sep}connect-wallet.di.ts`)) di = map.sourcesContent[index];
    }
    if (!matched || !di) throw Error("Cannot verify SDK wallet loader against its source map");
    const mode = /const productionWalletLoader[^\n]*=\s*urlWalletLoader\b/.test(di) ? "url" :
      /const productionWalletLoader[^\n]*=\s*runtimeWalletLoader\b/.test(di) ? "runtime" : null;
    if (!mode || (walletMode && mode !== walletMode)) throw Error("Unknown or inconsistent SDK wallet loader");
    walletMode = mode;
  }
  if (walletMode === "runtime") {
    if (!fs.existsSync(path.join(sdkRoot, "dist/wallet-runtime-sw.js"))) throw Error("Runtime wallet requires a matching SDK worker");
    files.push("wallet-runtime-sw.js");
    if (fs.existsSync(path.join(sdkRoot, "dist/wallet-runtime-sw.js.map"))) files.push("wallet-runtime-sw.js.map");
  }
  const hashes = Object.fromEntries(files.map((name) => [name, artifactHash(path.join(sdkRoot, "dist", name))]));
  return { sdkVersion: JSON.parse(fs.readFileSync(path.join(sdkRoot, "package.json"), "utf8")).version, walletMode, hashes };
}

/** Only the dependency copies inside Plane are writable. Source SDK is read-only. */
export function syncFiaiArtifacts(planeRoot, sdkRoot, { refresh = false } = {}) {
  const root = fs.realpathSync(planeRoot);
  const source = fs.realpathSync(sdkRoot);
  const manifest = inspectFiaiArtifacts(source);
  const installedRoots = new Set(["apps/web", "packages/services"].map((workspace) => {
    const installed = fs.realpathSync(path.join(root, workspace, "node_modules/@metanodejs/fiai-sdk"));
    if (!inside(root, installed) || installed === source) throw Error("Refusing to write SDK outside Plane");
    return installed;
  }));
  const packageInfo = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
  for (const installed of installedRoots) {
    const info = JSON.parse(fs.readFileSync(path.join(installed, "package.json"), "utf8"));
    for (const key of ["name", "version", "main", "module", "types", "exports", "dependencies"]) {
      if (JSON.stringify(info[key]) !== JSON.stringify(packageInfo[key])) throw Error(`SDK package metadata changed (${key}); review dependency refresh first`);
    }
    for (const [name, expected] of Object.entries(manifest.hashes)) {
      const target = path.join(installed, "dist", name);
      if (refresh) {
        // Replace the directory entry; never overwrite a pnpm hard link in place.
        const temporary = `${target}.plane-refresh`;
        try {
          fs.copyFileSync(path.join(source, "dist", name), temporary);
          fs.renameSync(temporary, target);
        } finally { fs.rmSync(temporary, { force: true }); }
      }
      if (!fs.existsSync(target) || artifactHash(target) !== expected) throw Error("Installed SDK is stale. Run node scripts/sync-fiai-runtime.mjs --refresh inside Plane.");
    }
    if (refresh && manifest.walletMode === "url") {
      for (const name of ["wallet-runtime-sw.js", "wallet-runtime-sw.js.map"]) fs.rmSync(path.join(installed, "dist", name), { force: true });
    }
  }
  const publicDir = path.join(root, "apps/web/public");
  for (const name of ["wallet-runtime-sw.js", "wallet-runtime-sw.js.map"]) {
    const target = path.join(publicDir, name);
    if (manifest.walletMode === "runtime" && manifest.hashes[name]) fs.copyFileSync(path.join(source, "dist", name), target);
    else fs.rmSync(target, { force: true });
  }
  fs.writeFileSync(path.join(publicDir, "fiai-sdk-build.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
