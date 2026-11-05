import type { Config } from "@react-router/dev/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { appBasePath, readAppEnv, resolveAppMode } from "../../scripts/app-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mode = resolveAppMode();
const env = readAppEnv(__dirname, mode, loadEnv);
const base = appBasePath(env.VITE_ROUTER_BASENAME, mode === "development" ? "/" : "/plane");
const basename = base === "/" ? undefined : base;

export default {
  appDirectory: "app",
  // Web runs as a client-side app; build a static client bundle only
  ssr: false,
  basename,
} satisfies Config;
