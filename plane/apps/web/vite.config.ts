import path from "node:path";
import * as dotenv from "dotenv";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

dotenv.config({ path: path.resolve(__dirname, ".env") });
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000";

// Expose only vars starting with VITE_
const viteEnv = Object.keys(process.env)
  .filter((k) => k.startsWith("VITE_"))
  .reduce<Record<string, string>>((a, k) => {
    a[k] = process.env[k] ?? "";
    return a;
  }, {});

// fiai-sdk@1.0.0 was published with a scheme-less Connect Wallet URL.
// Keep the workaround at the bundler boundary until the upstream package is fixed.
const fixFiaiConnectWalletUrl = () => ({
  name: "fix-fiai-connect-wallet-url",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.includes("@metanodejs/fiai-sdk")) return null;
    return code.replaceAll(
      'urlConnectWallet:"connect-wallet-web.fi.ai"',
      'urlConnectWallet:"https://connect-wallet-web.fi.ai"'
    );
  },
});
export default defineConfig(() => ({
  define: {
    "process.env": JSON.stringify(viteEnv),
  },
  build: {
    assetsInlineLimit: 0,
  },
  plugins: [
    fixFiaiConnectWalletUrl(),
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
    },
    dedupe: ["react", "react-dom", "@headlessui/react"],
  },
  server: {
    host: "0.0.0.0",
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
