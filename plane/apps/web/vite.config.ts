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

const targetConnectWalletDomain = (process.env.VITE_URL_CONNECT_WALLET || "https://connect-wallet-web.iqnb.com")
  .trim()
  .replace(/^https?:\/\//i, "");
const targetConnectWalletUrl = `https://${targetConnectWalletDomain}`;

const fixFiaiConnectWalletUrl = () => ({
  name: "fix-fiai-connect-wallet-url",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.includes("@metanodejs")) return null;
    let transformed = code;
    transformed = transformed.replaceAll("https://connect-wallet-web.fi.ai", targetConnectWalletUrl);
    transformed = transformed.replaceAll("connect-wallet-web.fi.ai", targetConnectWalletUrl);
    transformed = transformed.replaceAll(
      'urlConnectWallet:"connect-wallet-web.iqnb.com"',
      `urlConnectWallet:"${targetConnectWalletUrl}"`
    );
    transformed = transformed.replaceAll("https://img.fi.ai", "https://img.iqnb.com");
    transformed = transformed.replaceAll("img.fi.ai", "img.iqnb.com");
    return transformed;
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
