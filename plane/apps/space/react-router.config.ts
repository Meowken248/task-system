import type { Config } from "@react-router/dev/config";
import * as dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { joinUrlPath } from "@plane/utils";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isBuild = process.argv.includes("build") || process.env.npm_lifecycle_event === "build";
dotenv.config({ path: path.resolve(__dirname, ".env") });
if (isBuild && fs.existsSync(path.resolve(__dirname, ".env.production"))) {
  dotenv.config({ path: path.resolve(__dirname, ".env.production"), override: true });
}

const defaultBasePath = isBuild ? "/plane/spaces" : "/spaces";
const rawBasePath = process.env.VITE_SPACE_BASE_PATH ?? defaultBasePath;
const basePath = joinUrlPath(rawBasePath, "/") ?? "/";

export default {
  appDirectory: "app",
  basename: basePath,
  ssr: false,
} satisfies Config;
