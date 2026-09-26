import fs from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

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

dotenv.config({ path: path.resolve(__dirname, ".env") });
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8080";

const isBuild = process.argv.includes("build") || process.env.npm_lifecycle_event === "build";
const defaultBasename = isBuild ? "/plane" : "";
const routerBasename = (process.env.VITE_ROUTER_BASENAME ?? defaultBasename).replace(/\/+$/, "");
const basePublicPath = routerBasename ? `${routerBasename}/` : "/";

// Expose only vars starting with VITE_
const viteEnv = Object.keys(process.env)
  .filter((k) => k.startsWith("VITE_"))
  .reduce<Record<string, string>>((a, k) => {
    a[k] = process.env[k] ?? "";
    return a;
  }, {});
viteEnv.VITE_ROUTER_BASENAME = routerBasename;

export default defineConfig(() => ({
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
    tsconfigPaths({ projects: [path.resolve(__dirname, "tsconfig.json")] }),
  ],
  optimizeDeps: {
    exclude: ["@metanodejs/fiai-sdk"],
  },
  resolve: {
    alias: {
      // Next.js compatibility shims used within web
      "next/link": path.resolve(__dirname, "app/compat/next/link.tsx"),
      "next/navigation": path.resolve(__dirname, "app/compat/next/navigation.ts"),
      "next/script": path.resolve(__dirname, "app/compat/next/script.tsx"),
      "@plane/services": path.resolve(__dirname, "../../packages/services/src/index.ts"),
      "@plane/constants": path.resolve(__dirname, "../../packages/constants/src/index.ts"),
      // nanoid: "C:/metanode-sdk/node_modules/.pnpm/nanoid@5.1.16/node_modules/nanoid",
    },
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
    },
  },
  // No SSR-specific overrides needed; alias resolves to ESM build
}));

