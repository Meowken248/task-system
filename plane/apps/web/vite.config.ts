import path from "node:path";
import * as dotenv from "dotenv";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

dotenv.config({ path: path.resolve(__dirname, ".env") });
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8080";

// Expose only vars starting with VITE_
const viteEnv = Object.keys(process.env)
  .filter((k) => k.startsWith("VITE_"))
  .reduce<Record<string, string>>((a, k) => {
    a[k] = process.env[k] ?? "";
    return a;
  }, {});

export default defineConfig(() => ({
  define: {
    "process.env": JSON.stringify(viteEnv),
  },
  build: {
    assetsInlineLimit: 0,
  },
  plugins: [
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
    allowedHosts: ["*"],
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

