import fs from "node:fs";
import path from "node:path";
import { AbiCoder, getAddress, keccak256 } from "ethers";

/** Immutable addresses are patched by Solidity at construction, not library links. */
export function expectedV3Runtime(artifact, references, registry) {
  let runtime = artifact.deployedBytecode.slice(2).toLowerCase();
  const address = getAddress(registry).slice(2).toLowerCase().padStart(64, "0");
  const slots = Object.values(references).flat();
  if (!slots.length) throw Error("Missing registry immutable references in compiler output");
  for (const slot of slots) {
    if (slot.length !== 32 || slot.start < 0 || (slot.start + slot.length) * 2 > runtime.length)
      throw Error("Unexpected registry immutable slot");
    runtime = runtime.slice(0, slot.start * 2) + address + runtime.slice((slot.start + slot.length) * 2);
  }
  return "0x" + runtime;
}

export function readV3Artifact(root) {
  const artifactDir = path.join(root, "artifacts/contracts/PlaneTaskManagerV3.sol");
  const artifact = JSON.parse(fs.readFileSync(path.join(artifactDir, "PlaneTaskManagerV3.json"), "utf8"));
  const debug = JSON.parse(fs.readFileSync(path.join(artifactDir, "PlaneTaskManagerV3.dbg.json"), "utf8"));
  const info = JSON.parse(fs.readFileSync(path.resolve(artifactDir, debug.buildInfo), "utf8"));
  // Refuse stale output even when Hardhat's cache happens to exist.
  for (const file of ["contracts/PlaneTaskManager.sol", "contracts/PlaneTaskManagerV3.sol"]) {
    if (info.input.sources[file]?.content !== fs.readFileSync(path.join(root, file), "utf8"))
      throw Error(`Compile the current source before deployment: ${file}`);
  }
  const compiled = info.output.contracts["contracts/PlaneTaskManagerV3.sol"].PlaneTaskManagerV3.evm;
  if ("0x" + compiled.bytecode.object !== artifact.bytecode) throw Error("Artifact differs from compiler output");
  return { artifact, immutableReferences: compiled.deployedBytecode.immutableReferences, bytecodeHash: keccak256(artifact.bytecode) };
}

const readValue = (source, key, file) => {
  const matches = [...source.matchAll(new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`, "gm"))];
  if (matches.length !== 1) throw Error(`Expected one ${key} in ${file}`);
  return matches[0][1].replace(/^['"]|['"]$/g, "").trim();
};

/** Only replace the task address; all other env bytes remain unchanged. */
export function planTaskEnvChange(source, file, config, oldAddress, newAddress) {
  if (new URL(readValue(source, "VITE_RPC_URL", file)).href !== new URL(config.rpc).href ||
      Number(readValue(source, "VITE_CHAIN_ID", file)) !== config.chainId ||
      getAddress(readValue(source, "VITE_WORKSPACE_REGISTRY_ADDRESS", file)) !== getAddress(config.workspaceRegistry))
    throw Error(`RPC, chain or workspace registry mismatch in ${file}`);
  const current = getAddress(readValue(source, "VITE_CONTRACT_ADDRESS", file));
  if (![getAddress(oldAddress), getAddress(newAddress)].includes(current))
    throw Error(`Unexpected existing task address in ${file}`);
  return source.replace(/^(\s*VITE_CONTRACT_ADDRESS\s*=\s*)[^\r\n]*/gm, `$1"${getAddress(newAddress)}"`);
}

export const taskEnvFiles = [".env", "apps/web/.env", "apps/web/.env.production", "apps/space/.env", "apps/space/.env.production"];

export function decodeOwnerCreateProbe(raw) {
  if (typeof raw === "string" && /^0x[0-9a-f]{64}$/i.test(raw) && BigInt(raw) === 0n)
    return { passed: true, unsupported: false };
  if (typeof raw === "string" && raw.startsWith("0x08c379a0")) {
    const [reason] = AbiCoder.defaultAbiCoder().decode(["string"], "0x" + raw.slice(10));
    if (reason === "Cant store stack from read only call") return { passed: false, unsupported: true, reason };
  }
  throw Error("Owner creation probe returned an unexpected result; do not switch env");
}

export function planFreshEnvChange(source, file, config, oldContracts, newContracts, deploymentId) {
  const currentRegistry = getAddress(readValue(source, "VITE_WORKSPACE_REGISTRY_ADDRESS", file));
  if (![oldContracts.workspace, newContracts.workspace].map(getAddress).includes(currentRegistry))
    throw Error(`Unexpected workspace registry in ${file}`);
  let next = planTaskEnvChange(source, file, { ...config, workspaceRegistry: currentRegistry }, oldContracts.task, newContracts.task);
  for (const [name, previous, replacement] of [
    ["VITE_WORKSPACE_REGISTRY_ADDRESS", oldContracts.workspace, newContracts.workspace],
    ["VITE_REGISTRY_CONTRACT_ADDRESS", oldContracts.offchain, newContracts.offchain],
  ]) {
    if (![previous, replacement].map(getAddress).includes(getAddress(readValue(source, name, file))))
      throw Error(`Unexpected ${name} in ${file}`);
    next = next.replace(new RegExp(`^(\\s*${name}\\s*=\\s*)[^\\r\\n]*`, "gm"), `$1"${getAddress(replacement)}"`);
  }
  next = next.replace(/^(\s*NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS\s*=\s*)[^\r\n]*/gm, `$1"${getAddress(newContracts.offchain)}"`);
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(deploymentId)) throw Error("Invalid fresh deployment ID");
  const epochMatches = next.match(/^\s*VITE_DAPP_DEPLOYMENT_ID\s*=/gm) || [];
  if (epochMatches.length > 1) throw Error(`Duplicate deployment ID in ${file}`);
  const epochLine = `VITE_DAPP_DEPLOYMENT_ID="${deploymentId}"`;
  if (epochMatches.length) next = next.replace(/^\s*VITE_DAPP_DEPLOYMENT_ID\s*=[^\r\n]*/gm, epochLine);
  else next += (next.endsWith("\n") ? "" : "\n") + epochLine + "\n";
  return next;
}
