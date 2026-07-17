import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const parseEnv = (source) => {
  const values = {};
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
};

const loadEnvFile = async (path) => {
  try {
    return parseEnv(await readFile(resolve(path), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
};

const rootEnv = await loadEnvFile(".env");
const webEnv = await loadEnvFile("apps/web/.env");
const env = { ...rootEnv, ...webEnv, ...process.env };

if (env.RPC_ALLOW_INSECURE_TLS === "true") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const rpcUrl = env.RPC_URL || env.VITE_RPC_URL;
const walletAddress = env.WALLET_ADDRESS || env.VITE_METANODE_WALLET_ADDRESS;
const contractAddress = env.CONTRACT_ADDRESS || env.VITE_CONTRACT_ADDRESS;
const expectedChainId = env.CHAIN_ID || env.VITE_CHAIN_ID;

if (!rpcUrl) throw new Error("Missing VITE_RPC_URL (or RPC_URL) in apps/web/.env");
if (!/^0x[0-9a-fA-F]{40}$/u.test(walletAddress ?? "")) {
  throw new Error("VITE_METANODE_WALLET_ADDRESS is missing or invalid in apps/web/.env");
}

let requestId = 0;
const rpc = async (method, params = []) => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}: ${response.statusText}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`RPC ${method}: ${payload.error.message ?? JSON.stringify(payload.error)}`);
  return payload.result;
};

const [chainIdHex, balanceHex, nonceHex, gasPriceHex] = await Promise.all([
  rpc("eth_chainId"),
  rpc("eth_getBalance", [walletAddress, "latest"]),
  rpc("eth_getTransactionCount", [walletAddress, "latest"]),
  rpc("eth_gasPrice"),
]);

const formatEther = (weiHex) => {
  const wei = BigInt(weiHex);
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
};

const chainId = BigInt(chainIdHex).toString();
console.log("RPC: connected");
console.log("address:", walletAddress);
console.log("chainId:", chainId);
console.log("balance:", formatEther(balanceHex));
console.log("nonce:", Number(BigInt(nonceHex)));
console.log("gasPrice (wei):", BigInt(gasPriceHex).toString());

if (expectedChainId && chainId !== expectedChainId) {
  console.warn(`WARNING: expected chainId ${expectedChainId}, received ${chainId}`);
}

if (contractAddress) {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(contractAddress)) throw new Error("VITE_CONTRACT_ADDRESS is invalid");
  const code = await rpc("eth_getCode", [contractAddress, "latest"]);
  console.log("contract:", contractAddress);
  console.log("contract deployed:", code !== "0x");
}
