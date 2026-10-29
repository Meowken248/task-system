import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "ethers";

export const planeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function deploymentArgument(name, argv = process.argv) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`Missing value for ${name}`);
  return argv[index + 1];
}

export function readDeploymentEnv(path = process.env.PLANE_ENV_FILE || resolve(planeRoot, "apps/web/.env")) {
  const values = {};
  const allowed = new Set([
    "VITE_RPC_URL",
    "VITE_CHAIN_ID",
    "VITE_WORKSPACE_REGISTRY_ADDRESS",
    "VITE_REGISTRY_CONTRACT_ADDRESS",
    "VITE_CONTRACT_ADDRESS",
    "VITE_CONTRACT_GAS",
    "VITE_DEFAULT_WORKSPACE_SLUG",
    "VITE_IPFS_GATEWAYS",
  ]);
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*?)\s*$/);
    if (match && allowed.has(match[1])) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "").trim();
  }
  const rpc = new URL(values.VITE_RPC_URL);
  if (!["http:", "https:"].includes(rpc.protocol)) throw new Error("Invalid VITE_RPC_URL");
  const chainId = Number(values.VITE_CHAIN_ID);
  if (!Number.isSafeInteger(chainId) || chainId <= 0)
    throw new Error("Configure VITE_CHAIN_ID in the selected env file");
  return {
    values,
    rpc: rpc.href,
    chainId,
    workspaceRegistry: getAddress(values.VITE_WORKSPACE_REGISTRY_ADDRESS),
    gasLimit: values.VITE_CONTRACT_GAS ? BigInt(values.VITE_CONTRACT_GAS) : null,
    defaultSlug: values.VITE_DEFAULT_WORKSPACE_SLUG || null,
  };
}

/** Optional terminal input is raw/no-echo; the key is never written to a file. */
export async function readDeployerKey() {
  if (process.env.DEPLOYER_PRIVATE_KEY) return process.env.DEPLOYER_PRIVATE_KEY;
  if (!process.argv.includes("--private-key-stdin") || !process.stdin.isTTY)
    throw new Error("Provide DEPLOYER_PRIVATE_KEY in the process environment or use --private-key-stdin in a terminal");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write("PRIVATE_KEY_STDIN_READY\n");
  return new Promise((resolveKey, reject) => {
    let buffer = "";
    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    const onData = (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes("\u0003")) {
        cleanup();
        buffer = "";
        reject(new Error("Deployment cancelled"));
        return;
      }
      if (!/[\r\n]/.test(buffer)) return;
      const key = buffer.trim();
      buffer = "";
      cleanup();
      if (!/^(?:0x)?[0-9a-f]{64}$/i.test(key)) {
        reject(new Error("Invalid private key format"));
        return;
      }
      resolveKey(key.startsWith("0x") ? key : `0x${key}`);
    };
    process.stdin.on("data", onData);
  });
}
