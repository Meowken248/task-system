/* oxlint-disable no-await-in-loop -- Journal and confirm each transaction before allocating another nonce. */
import fs from "node:fs";
import path from "node:path";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, getAddress, getCreateAddress, keccak256 } from "ethers";
import { planeRoot, readDeploymentEnv, readDeployerKey, deploymentArgument as arg } from "./deployment-env.mjs";

const names = ["PlaneWorkspaceRegistry", "OffchainDataRegistry", "PlaneTaskManager"];
const config = readDeploymentEnv();
const expected = getAddress(arg("--expected-deployer") || "");
const output = path.resolve(planeRoot, arg("--out") || "docs/verification/fresh-deployment/deployment.json");
const relative = path.relative(planeRoot, output);
if (relative.startsWith("..") || path.isAbsolute(relative)) throw Error("Deployment journal must stay inside Plane");
if (!config.defaultSlug || !config.values.VITE_DEFAULT_WORKSPACE_NAME)
  throw Error("Configure default workspace slug and name in the selected env file");
const provider = new JsonRpcProvider(config.rpc, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
provider.pollingInterval = 1000;
const artifacts = Object.fromEntries(
  names.map((name) => [
    name,
    JSON.parse(fs.readFileSync(path.join(planeRoot, "artifacts/contracts", `${name}.sol`, `${name}.json`), "utf8")),
  ])
);
let journal;
const persist = () => {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(journal, null, 2) + "\n");
};

async function main() {
  if (Number((await provider.getNetwork()).chainId) !== config.chainId) throw Error("RPC chain ID differs from env");
  const genesis = await provider.getBlock(0);
  const gasPrice = BigInt(await provider.send("eth_gasPrice", []));
  const startNonce = await provider.getTransactionCount(expected, "pending");
  const balance = await provider.getBalance(expected);
  const block = await provider.getBlock("latest");
  const estimates = [];
  for (const name of names) {
    const artifact = artifacts[name];
    const gas = await provider.estimateGas({ from: expected, data: artifact.bytecode });
    const limit = (gas * 125n) / 100n;
    if (limit > block.gasLimit) throw Error(`${name} exceeds the latest block gas limit`);
    estimates.push({
      name,
      estimate: String(gas),
      gasLimit: String(limit),
      bytecodeHash: keccak256(artifact.bytecode),
    });
  }
  const maxDeploymentFee = estimates.reduce((total, item) => total + BigInt(item.gasLimit) * gasPrice, 0n);
  if (balance < maxDeploymentFee) throw Error("Deployer balance is insufficient for the deployment estimates");
  const plan = {
    rpc: config.rpc,
    chainId: config.chainId,
    genesisHash: genesis.hash,
    deployer: expected,
    startNonce,
    balance: String(balance),
    gasPrice: String(gasPrice),
    maxDeploymentFee: String(maxDeploymentFee),
    workspace: { slug: config.defaultSlug, name: config.values.VITE_DEFAULT_WORKSPACE_NAME, initialCid: "" },
    estimates,
  };
  console.log(JSON.stringify({ preflight: plan }, null, 2));
  if (!process.argv.includes("--execute")) return;
  if (fs.existsSync(output))
    throw Error("Journal already exists. Inspect its receipts before any new deployment; no automatic redeployment");
  let key = await readDeployerKey();
  const signer = new Wallet(key, provider);
  key = "";
  if (getAddress(signer.address) !== expected) throw Error("Signing key does not belong to the expected deployer");
  journal = { ...plan, startedAt: new Date().toISOString(), transactions: [], contracts: {}, verified: false };
  persist();
  let nonce = startNonce;
  async function send(label, request, gasLimit) {
    const currentNonce = await provider.getTransactionCount(expected, "pending");
    if (currentNonce !== nonce)
      throw Error(`Nonce changed before ${label}; stop without replacing another transaction`);
    const tx = await signer.sendTransaction({ ...request, type: 0, gasPrice, gasLimit, nonce });
    const entry = { label, hash: tx.hash, nonce, submittedAt: new Date().toISOString() };
    journal.transactions.push(entry);
    persist();
    console.log(JSON.stringify({ submitted: label, hash: tx.hash, nonce }));
    const receipt = await provider.waitForTransaction(tx.hash, 1, 120000);
    if (!receipt || receipt.status !== 1)
      throw Error(`${label} not confirmed successful; inspect the journal before retrying`);
    Object.assign(entry, {
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      gasUsed: String(receipt.gasUsed),
      contractAddress: receipt.contractAddress,
    });
    persist();
    nonce++;
    return receipt;
  }
  for (const item of estimates) {
    const artifact = artifacts[item.name];
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
    const request = await factory.getDeployTransaction();
    const plannedAddress = getCreateAddress({ from: expected, nonce });
    const receipt = await send(`deploy:${item.name}`, request, BigInt(item.gasLimit));
    const address = getAddress(receipt.contractAddress || plannedAddress);
    const code = await provider.getCode(address);
    if (code === "0x") throw Error(`${item.name} has no code at its deployment address`);
    // These contracts have no libraries or immutable arguments: runtime bytes must match exactly.
    if (code.toLowerCase() !== artifact.deployedBytecode.toLowerCase())
      throw Error(`${item.name} deployed bytecode differs from the tested artifact`);
    journal.contracts[item.name] = { address, runtimeCodeHash: keccak256(code) };
    persist();
    console.log(JSON.stringify({ deployed: item.name, address }));
  }
  const registry = new Contract(
    journal.contracts.PlaneWorkspaceRegistry.address,
    artifacts.PlaneWorkspaceRegistry.abi,
    signer
  );
  const taskManager = new Contract(
    journal.contracts.PlaneTaskManager.address,
    artifacts.PlaneTaskManager.abi,
    provider
  );
  const request = await registry.createWorkspace.populateTransaction(plan.workspace.slug, plan.workspace.name, "");
  const initGas = await provider.estimateGas({ ...request, from: expected });
  await send("initialize:workspace", request, (initGas * 125n) / 100n);
  const workspace = await registry.getWorkspace(plan.workspace.slug);
  const role = Number(await registry.getMemberRole(plan.workspace.slug, expected));
  if (role !== 3 || getAddress(workspace[1]) !== expected || workspace[2] !== "")
    throw Error("Fresh workspace verification failed");
  if (
    getAddress(await registry.operator()) !== expected ||
    getAddress(await taskManager.owner()) !== expected ||
    !(await taskManager.admins(expected))
  )
    throw Error("Contract owner/admin verification failed");
  if (Number(await taskManager.taskCount()) !== 0) throw Error("Unexpected tasks in the fresh contract");
  journal.verification = {
    workspaceExists: await registry.workspaceExists(plan.workspace.slug),
    ownerRole: role,
    initialCid: workspace[2],
    taskCount: 0,
    taskManagerVersion: Number(await taskManager.contractVersion()),
    workspacePolicyVersion: Number(await registry.workspacePolicyVersion()),
  };
  journal.verified = true;
  journal.verifiedAt = new Date().toISOString();
  persist();
  if (process.argv.includes("--write-env")) {
    const updates = {
      VITE_WORKSPACE_REGISTRY_ADDRESS: journal.contracts.PlaneWorkspaceRegistry.address,
      VITE_REGISTRY_CONTRACT_ADDRESS: journal.contracts.OffchainDataRegistry.address,
      VITE_CONTRACT_ADDRESS: journal.contracts.PlaneTaskManager.address,
    };
    const files = [".env", "apps/web/.env", "apps/web/.env.production"];
    const pending = files
      .filter((file) => fs.existsSync(path.join(planeRoot, file)))
      .map((file) => {
        const original = fs.readFileSync(path.join(planeRoot, file), "utf8");
        const rpcMatch = original.match(/^\s*VITE_RPC_URL\s*=\s*["']?([^"'\r\n]+)/m);
        if (!rpcMatch || new URL(rpcMatch[1].trim()).href !== new URL(config.rpc).href)
          throw Error(`RPC mismatch in ${file}; env files have not been changed`);
        let next = original;
        for (const [name, value] of Object.entries(updates)) {
          const pattern = new RegExp(`^\\s*${name}\\s*=.*$`, "gm");
          if ((next.match(pattern) || []).length !== 1) throw Error(`Expected one ${name} in ${file}`);
          next = next.replace(pattern, `${name}="${value}"`);
        }
        next = next.replace(
          /^\s*NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS\s*=.*$/gm,
          `NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS="${updates.VITE_REGISTRY_CONTRACT_ADDRESS}"`
        );
        return { file, next };
      });
    for (const item of pending) fs.writeFileSync(path.join(planeRoot, item.file), item.next);
    journal.envFilesUpdated = pending.map((item) => item.file);
    persist();
  }
  console.log(
    JSON.stringify(
      {
        verified: journal.verified,
        contracts: journal.contracts,
        verification: journal.verification,
        envFilesUpdated: journal.envFilesUpdated,
      },
      null,
      2
    )
  );
}
try {
  await main();
} catch (error) {
  console.error(`Deployment stopped: ${String(error?.message || error).slice(0, 900)}`);
  process.exitCode = 1;
} finally {
  provider.destroy();
}
