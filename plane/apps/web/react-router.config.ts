import type { Config } from "@react-router/dev/config";
import * as dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env") });

const isBuild = process.argv.includes("build") || process.env.npm_lifecycle_event === "build";
const defaultBasename = isBuild ? "/plane" : "/";
const rawBasename = (process.env.VITE_ROUTER_BASENAME ?? defaultBasename).trim();
const cleanBasename = rawBasename.replace(/^\/+|\/+$/g, "");
// Must start and end with / so it matches Vite's normalized base (`/plane/`) in dev server
const basename = cleanBasename ? `/${cleanBasename}/` : undefined;

export default {
  appDirectory: "app",
  // Web runs as a client-side app; build a static client bundle only
  ssr: false,
  basename,
} satisfies Config;
