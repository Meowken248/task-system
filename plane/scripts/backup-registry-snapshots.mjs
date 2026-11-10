/** Read-only IPFS backup. Snapshot contents stay under the ignored tmp directory. */
/* oxlint-disable no-await-in-loop -- Back up one workspace at a time to bound memory and finish its gateway race before starting another. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readDeploymentEnv, planeRoot, deploymentArgument as argument } from "./deployment-env.mjs";

async function main() {
  if (!argument("--manifest") || !argument("--status")) throw new Error("Provide --manifest and --status paths");
  const manifest = JSON.parse(readFileSync(resolve(planeRoot, argument("--manifest")), "utf8"));
  const config = readDeploymentEnv();
  if (
    manifest.chainId !== config.chainId ||
    manifest.sourceRegistry.toLowerCase() !== config.workspaceRegistry.toLowerCase()
  )
    throw new Error("Manifest and env configuration differ");
  const gateways = (config.values.VITE_IPFS_GATEWAYS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!gateways.length) throw new Error("Configure VITE_IPFS_GATEWAYS");
  const statusPath = resolve(planeRoot, argument("--status"));
  const inside = relative(planeRoot, statusPath);
  if (inside.startsWith("..") || isAbsolute(inside)) throw new Error("Backup status must stay inside Plane");
  const backupRoot = resolve(planeRoot, "tmp/registry-migration");
  mkdirSync(backupRoot, { recursive: true });
  const results = [];
  for (const workspace of manifest.workspaces) {
    const controllers = gateways.map(() => new AbortController());
    try {
      const downloaded = await Promise.any(
        gateways.map(async (base, index) => {
          const timer = setTimeout(() => controllers[index].abort(), 15000);
          try {
            const response = await fetch(`${base.replace(/\/?$/, "/")}${encodeURIComponent(workspace.cid)}`, {
              signal: controllers[index].signal,
            });
            if (!response.ok) throw new Error(`Gateway HTTP ${response.status}`);
            if (Number(response.headers.get("content-length") || 0) > 20_000_000)
              throw new Error("Snapshot exceeds backup size limit");
            const text = await response.text();
            if (Buffer.byteLength(text) > 20_000_000) throw new Error("Snapshot exceeds backup size limit");
            const data = JSON.parse(text);
            if (
              !Array.isArray(data.workspaces) ||
              !data.workspaces.some((entry) => entry.slug === workspace.slug || entry.id === workspace.slug)
            )
              throw new Error("Snapshot does not contain the reviewed workspace");
            return { text, data, gateway: new URL(base).origin };
          } finally {
            clearTimeout(timer);
          }
        })
      );
      const hash = createHash("sha256").update(downloaded.text).digest("hex");
      const path = resolve(backupRoot, `${hash}.snapshot.json`);
      writeFileSync(path, downloaded.text, { mode: 0o600 });
      results.push({
        slug: workspace.slug,
        cid: workspace.cid,
        backupPath: relative(planeRoot, path),
        bytes: Buffer.byteLength(downloaded.text),
        sha256: hash,
        gateway: downloaded.gateway,
        counts: {
          workspaces: downloaded.data.workspaces.length,
          projects: downloaded.data.projects?.length || 0,
          issues: downloaded.data.issues?.length || 0,
          attachments: downloaded.data.attachments?.length || 0,
        },
      });
    } finally {
      controllers.forEach((controller) => controller.abort());
    }
  }
  writeFileSync(
    statusPath,
    JSON.stringify(
      { backedUpAt: new Date().toISOString(), sourceRegistry: manifest.sourceRegistry, snapshots: results },
      null,
      2
    ) + "\n"
  );
  console.log(
    JSON.stringify({ snapshotBackups: results.map(({ slug, cid, bytes, counts }) => ({ slug, cid, bytes, counts })) })
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
