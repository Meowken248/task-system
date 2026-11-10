#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertPublicBuildEnv, publicSecretKeys, readAppEnv, resolveAppMode } from "./app-env.mjs";

// Inspect exactly the effective Vite environment, including mode/local/CLI overrides.
// Never log values or even partial values of signing or mail keys.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = existsSync(path.join(process.cwd(), "vite.config.ts")) ? process.cwd() : path.join(root, "apps/web");
const require = createRequire(path.join(appDir, "package.json"));
const { loadEnv } = await import(pathToFileURL(require.resolve("vite")).href);
const mode = resolveAppMode(process.argv, "prebuild");
const env = readAppEnv(appDir, mode, loadEnv);
try {
  const exposed = assertPublicBuildEnv(env);
  if (exposed.length) {
    console.warn(`[env-guard] Internal build opt-in: ${exposed.map(({ key }) => key).join(", ")} will be public.`);
  } else {
    console.log(`[env-guard] ${path.basename(appDir)} mode=${mode}: passed.`);
  }
} catch (error) {
  console.error(`[env-guard] ${path.basename(appDir)} mode=${mode}: ${error.message}`);
  for (const item of publicSecretKeys(env)) console.error(`  ${item.key}: ${item.reason}`);
  process.exitCode = 1;
}
