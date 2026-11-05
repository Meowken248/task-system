import fs from "node:fs";
import path from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { appBasePath, assertPublicBuildEnv, readAppEnv, resolveAppMode } from "../../scripts/app-env.mjs";
import { workspaceSourceAliases } from "../../scripts/workspace-source-aliases.mjs";

function rootServiceWorkerPlugin(): Plugin {
  const handler = (req: any, res: any, next: any) => {
    const rawUrl = req.url ? req.url.split("?")[0] : "";
    if (rawUrl === "/wallet-runtime-sw.js" || rawUrl === "/sw.js") {
      const filePath = path.resolve(__dirname, "public", rawUrl.slice(1));
      if (fs.existsSync(filePath)) {
        res.setHeader("Content-Type", "application/javascript");
        res.setHeader("Service-Worker-Allowed", "/");
        res.writeHead(200);
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }
    if (rawUrl.startsWith("/emojibase/")) {
      const filePath = path.resolve(__dirname, "public", rawUrl.slice(1));
      if (fs.existsSync(filePath)) {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }
    next();
  };

  return {
    name: "serve-root-service-worker",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig(({ command, mode }) => {
  // React Router typegen probes this config with command=build but emits no bundle.
  const isTypegen = process.argv[2] === "typegen";
  const env = readAppEnv(__dirname, isTypegen ? resolveAppMode() : mode, loadEnv);
  if (command === "build" && !isTypegen) assertPublicBuildEnv(env);
  const basePublicPath = appBasePath(env.VITE_ROUTER_BASENAME, command === "build" ? "/plane" : "/");
  const routerBasename = basePublicPath === "/" ? "" : basePublicPath.slice(0, -1);
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8080";
  const viteEnv = Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith("VITE_")));
  viteEnv.VITE_ROUTER_BASENAME = routerBasename;
  return {
    base: basePublicPath,
    define: {
      "process.env": JSON.stringify(viteEnv),
      "process.env.VITE_ROUTER_BASENAME": JSON.stringify(routerBasename),
      "import.meta.env.VITE_ROUTER_BASENAME": JSON.stringify(routerBasename),
    },
    build: {
      assetsInlineLimit: 0,
    },
    plugins: [
      rootServiceWorkerPlugin(),
      reactRouter(),
      tsconfigPaths({
        projects: [
          path.resolve(__dirname, "tsconfig.json"),
          ...(command === "serve" ? [path.resolve(__dirname, "../../packages/editor/tsconfig.json")] : []),
        ],
      }),
    ],
    optimizeDeps: {
      exclude: ["@metanodejs/fiai-sdk"],
    },
    resolve: {
      alias: [
        // Dev must not import dist files that another workspace build can clean.
        ...(command === "serve" ? workspaceSourceAliases(path.resolve(__dirname, "../..")) : []),
        ...Object.entries({
          // Next.js compatibility shims used within web
          "next/link": path.resolve(__dirname, "app/compat/next/link.tsx"),
          "next/navigation": path.resolve(__dirname, "app/compat/next/navigation.ts"),
          "next/script": path.resolve(__dirname, "app/compat/next/script.tsx"),
          // Runtime enums must remain available while workspace builds regenerate dist.
          "@plane/types": path.resolve(__dirname, "../../packages/types/src/index.ts"),
          "@plane/services": path.resolve(__dirname, "../../packages/services/src/index.ts"),
          "@plane/constants": path.resolve(__dirname, "../../packages/constants/src/index.ts"),
          "@plane/utils": path.resolve(__dirname, "../../packages/utils/src/index.ts"),
          "@plane/i18n": path.resolve(__dirname, "../../packages/i18n/src/index.ts"),
          // nanoid: "C:/metanode-sdk/node_modules/.pnpm/nanoid@5.1.16/node_modules/nanoid",
        }).map(([find, replacement]) => ({ find, replacement })),
      ],
      dedupe: ["react", "react-dom", "@headlessui/react"],
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: true as const,
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        "/auth": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        "/plane/spaces": {
          target: "http://127.0.0.1:3002",
          rewrite: (p: string) => p.replace(/^\/plane\/spaces/, "/spaces"),
          changeOrigin: true,
        },
        "/spaces": {
          target: "http://127.0.0.1:3002",
          changeOrigin: true,
        },
      },
    },
    // No SSR-specific overrides needed; alias resolves to ESM build
  };
});
