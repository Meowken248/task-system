import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { planeRoot } from "./deployment-env.mjs";
const app = path.join(planeRoot, "apps/web");
const spec = JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf8")).dependencies["@metanodejs/fiai-sdk"];
if (!spec?.startsWith("file:")) throw Error("Expected the existing local FIAI SDK dependency");
const sdk = path.resolve(app, spec.slice(5));
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
for (const relative of ["dist/index.mjs", "dist/index.cjs", "dist/wallet-runtime-sw.js"]) {
  const sourceHash = hash(path.join(sdk, relative));
  for (const workspace of ["apps/web", "packages/services"])
    if (hash(path.join(planeRoot, workspace, "node_modules/@metanodejs/fiai-sdk", relative)) !== sourceHash)
      throw Error(
        "Installed SDK differs from local build. Refresh the existing file dependency before syncing the worker."
      );
}
const copied = [];
for (const name of ["wallet-runtime-sw.js", "wallet-runtime-sw.js.map"]) {
  const source = path.join(sdk, "dist", name);
  if (!fs.existsSync(source)) continue;
  fs.copyFileSync(source, path.join(app, "public", name));
  copied.push({ file: `apps/web/public/${name}`, sha256: hash(source) });
}
console.log(
  JSON.stringify(
    {
      sdkVersion: JSON.parse(fs.readFileSync(path.join(sdk, "package.json"), "utf8")).version,
      installedMatchesLocalBuild: true,
      copied,
    },
    null,
    2
  )
);
