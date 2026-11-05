import path from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { appBasePath, assertPublicBuildEnv, readAppEnv, resolveAppMode } from "../../scripts/app-env.mjs";
import { workspaceSourceAliases } from "../../scripts/workspace-source-aliases.mjs";

export default defineConfig(({ command, mode }) => {
  // React Router typegen probes this config with command=build but emits no bundle.
  const isTypegen = process.argv[2] === "typegen";
  const env = readAppEnv(__dirname, isTypegen ? resolveAppMode() : mode, loadEnv);
  if (command === "build" && !isTypegen) assertPublicBuildEnv(env);
  const basePath = appBasePath(env.VITE_SPACE_BASE_PATH, command === "build" ? "/plane/spaces" : "/spaces");
  const viteEnv = Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith("VITE_")));
  viteEnv.VITE_SPACE_BASE_PATH = basePath;
  return {
    base: basePath,
    define: {
      "process.env": JSON.stringify(viteEnv),
    },
    build: {
      assetsInlineLimit: 0,
    },
    plugins: [
      reactRouter(),
      tsconfigPaths({
        projects: [
          path.resolve(__dirname, "tsconfig.json"),
          ...(command === "serve" ? [path.resolve(__dirname, "../../packages/editor/tsconfig.json")] : []),
        ],
      }),
    ],
    resolve: {
      alias: [
        ...(command === "serve" ? workspaceSourceAliases(path.resolve(__dirname, "../..")) : []),
        ...Object.entries({
          // Next.js compatibility shims used within space
          "next/navigation": path.resolve(__dirname, "app/compat/next/navigation.ts"),
          // Runtime enums must remain available while workspace builds regenerate dist.
          "@plane/types": path.resolve(__dirname, "../../packages/types/src/index.ts"),
          "@plane/services": path.resolve(__dirname, "../../packages/services/src/index.ts"),
          "@plane/constants": path.resolve(__dirname, "../../packages/constants/src/index.ts"),
        }).map(([find, replacement]) => ({ find, replacement })),
      ],
      dedupe: ["react", "react-dom"],
    },
    server: {
      host: "127.0.0.1",
    },
  };
});
