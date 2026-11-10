import type { Config } from "@react-router/dev/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { appBasePath, readAppEnv, resolveAppMode } from "../../scripts/app-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mode = resolveAppMode();
const env = readAppEnv(__dirname, mode, loadEnv);
const basePath = appBasePath(env.VITE_SPACE_BASE_PATH, mode === "development" ? "/spaces" : "/plane/spaces");

export default {
  appDirectory: "app",
  basename: basePath,
  ssr: false,
} satisfies Config;
