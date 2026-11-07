/* oxlint-disable no-await-in-loop -- Confirm and journal each nonce before signing another transaction. */
import fs from "node:fs";
import path from "node:path";
import { Contract, ContractFactory, FetchRequest, JsonRpcProvider, Wallet, ZeroAddress, getAddress, getCreateAddress, keccak256, toUtf8Bytes } from "ethers";
import { planeRoot, readDeploymentEnv, readDeployerKey, deploymentArgument as arg } from "./deployment-env.mjs";
import { expectedV3Runtime, readV3Artifact, planFreshEnvChange, taskEnvFiles, decodeOwnerCreateProbe } from "./task-v3-deployment.mjs";

const config = readDeploymentEnv();
const expected = getAddress(arg("--expected-deployer") || "");
const output = path.resolve(planeRoot, arg("--out") || "docs/verification/fresh-v3-deployment/deployment.json");
if (path.relative(planeRoot, output).startsWith("..") || path.isAbsolute(path.relative(planeRoot, output)))
  throw Error("Journal must stay inside Plane");
const request = new FetchRequest(config.rpc); request.timeout = 15000;
const provider = new JsonRpcProvider(request, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
provider.pollingInterval = 1000;
const v3 = readV3Artifact(planeRoot);
const names = ["PlaneWorkspaceRegistry", "OffchainDataRegistry", "PlaneTaskManagerV3"];
const artifacts = Object.fromEntries(names.map((name) => [name, name === "PlaneTaskManagerV3" ? v3.artifact :
  JSON.parse(fs.readFileSync(path.join(planeRoot, "artifacts/contracts", `${name}.sol`, `${name}.json`), "utf8"))]));
let journal;
const persist = () => {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(journal, (_, value) => typeof value === "bigint" ? String(value) : value, 2) + "\n");
};
const addresses = (plan) => ({ workspace: plan.predicted.PlaneWorkspaceRegistry, offchain: plan.predicted.OffchainDataRegistry, task: plan.predicted.PlaneTaskManagerV3 });
function envPlan(plan) {
  return taskEnvFiles.map((file) => {
    const original = fs.readFileSync(path.join(planeRoot, file), "utf8");
    return { file, original, next: planFreshEnvChange(original, file, config, plan.previousContracts, addresses(plan), plan.deploymentId) };
  });
}

async function preflight() {
  const network = await provider.getNetwork(), genesis = await provider.getBlock(0), block = await provider.getBlock("latest");
  if (Number(network.chainId) !== config.chainId) throw Error("RPC chain differs from selected env");
  const startNonce = await provider.getTransactionCount(expected, "pending");
  if (startNonce !== await provider.getTransactionCount(expected, "latest")) throw Error("Resolve pending deployer transactions first");
  const oldTasks = new Contract(config.values.VITE_CONTRACT_ADDRESS, artifacts.PlaneTaskManagerV3.abi, provider);
  const previousTaskCount = Number(await oldTasks.taskCount());
  for (const address of [config.workspaceRegistry, config.values.VITE_REGISTRY_CONTRACT_ADDRESS, config.values.VITE_CONTRACT_ADDRESS]) {
    if (await provider.getCode(address) === "0x") throw Error("An existing env contract has no bytecode");
  }
  const predicted = Object.fromEntries(names.map((name, index) => [name, getCreateAddress({ from: expected, nonce: startNonce + index })]));
  const gasPrice = BigInt(await provider.send("eth_gasPrice", []));
  if (gasPrice <= 0n) throw Error("RPC returned unusable gas price");
  const estimates = [];
  for (const name of names) {
    // The new registry does not exist yet. Estimate constructor against the
    // current registry, then estimate again with the real address before signing.
    const args = name === "PlaneTaskManagerV3" ? [config.workspaceRegistry] : [];
    const tx = await new ContractFactory(artifacts[name].abi, artifacts[name].bytecode).getDeployTransaction(...args);
    const estimate = await provider.estimateGas({ ...tx, from: expected });
    const gasLimit = estimate * 125n / 100n;
    if (gasLimit > block.gasLimit) throw Error(`${name} exceeds block gas limit`);
    estimates.push({ name, estimate: String(estimate), gasLimit: String(gasLimit), bytecodeHash: keccak256(artifacts[name].bytecode) });
  }
  const feeBudget = (estimates.reduce((sum, row) => sum + BigInt(row.gasLimit), 0n) + 1_000_000n) * gasPrice;
  const balance = await provider.getBalance(expected);
  if (balance < feeBudget) throw Error("Insufficient balance for fresh deployment budget");
  if (!config.defaultSlug || !config.values.VITE_DEFAULT_WORKSPACE_NAME) throw Error("Default workspace slug/name are required in env");
  const deploymentId = "fresh_" + keccak256(toUtf8Bytes(JSON.stringify({ genesis: genesis.hash, predicted }))).slice(2);
  const plan = { rpc: config.rpc, chainId: config.chainId, genesisHash: genesis.hash, deployer: expected, startNonce, gasPrice: String(gasPrice), feeBudget: String(feeBudget), balance: String(balance),
    previousContracts: { workspace: config.workspaceRegistry, offchain: config.values.VITE_REGISTRY_CONTRACT_ADDRESS, task: config.values.VITE_CONTRACT_ADDRESS }, previousTaskCount,
    workspace: { slug: config.defaultSlug, name: config.values.VITE_DEFAULT_WORKSPACE_NAME, cid: "" }, predicted, deploymentId, estimates };
  envPlan(plan); // Validate all five files before any transaction.
  console.log(JSON.stringify({ preflight: plan }, null, 2));
  return plan;
}

async function verifyContract(name, plan, receipt) {
  const address = getAddress(plan.predicted[name]);
  if (receipt && getAddress(receipt.contractAddress) !== address) throw Error(`Unexpected ${name} deployment address`);
  const code = await provider.getCode(address);
  const expectedCode = name === "PlaneTaskManagerV3" ? expectedV3Runtime(artifacts[name], v3.immutableReferences, plan.predicted.PlaneWorkspaceRegistry) : artifacts[name].deployedBytecode;
  if (code.toLowerCase() !== expectedCode.toLowerCase()) throw Error(`${name} runtime differs from compiled bytecode/immutables`);
  journal.contracts[name] = { address, runtimeCodeHash: keccak256(code) }; persist();
}
async function requireRevert(work, selector) {
  try { await work(); } catch (error) {
    const data = error?.data || error?.info?.error?.data;
    if (typeof data === "string" && data.startsWith(selector)) return;
    throw Error("Read-only policy probe did not return the expected contract error");
  }
  throw Error("Read-only policy probe unexpectedly allowed the operation");
}
async function verifyFresh(plan) {
  const registry = new Contract(plan.predicted.PlaneWorkspaceRegistry, artifacts.PlaneWorkspaceRegistry.abi, provider);
  const tasks = new Contract(plan.predicted.PlaneTaskManagerV3, artifacts.PlaneTaskManagerV3.abi, provider);
  const data = new Contract(plan.predicted.OffchainDataRegistry, artifacts.OffchainDataRegistry.abi, provider);
  const workspace = await registry.getWorkspace(plan.workspace.slug);
  if (getAddress(await registry.operator()) !== expected || Number(await registry.getMemberRole(plan.workspace.slug, expected)) !== 3 ||
      getAddress(workspace[1]) !== expected || workspace[2] !== "" || Number(await tasks.taskCount()) !== 0 ||
      getAddress(await tasks.owner()) !== expected || !(await tasks.admins(expected)) ||
      getAddress(await tasks.workspaceRegistry()) !== getAddress(plan.predicted.PlaneWorkspaceRegistry) ||
      Number(await tasks.contractVersion()) !== 3 || Number(await registry.workspacePolicyVersion()) !== 3 ||
      await data.getCID(expected, "plane_dapp_db") !== "") throw Error("Fresh contract state verification failed");
  const probe = keccak256(toUtf8Bytes(`deployment-probe:${plan.deploymentId}`));
  const createData = tasks.interface.encodeFunctionData("createWorkspaceTask", [plan.workspace.slug, probe, probe, expected, 0, 0]);
  const ownerSimulation = decodeOwnerCreateProbe(await provider.send("eth_call", [{ from: expected, to: plan.predicted.PlaneTaskManagerV3, data: createData }, "latest"]));
  await requireRevert(() => tasks.createTask.staticCall(probe, probe, expected, 0, 0, { from: expected }), tasks.interface.getError("WorkspaceRequired").selector);
  await requireRevert(() => tasks.createWorkspaceTask.staticCall(plan.workspace.slug, probe, probe, expected, 0, 0, { from: ZeroAddress }), tasks.interface.getError("Unauthorized").selector);
  const userWorkspaces = await registry.getUserWorkspaces(expected);
  if (userWorkspaces.length !== 1 || userWorkspaces[0] !== plan.workspace.slug) throw Error("Unexpected workspace membership after fresh deployment");
  journal.verification = { taskVersion: 3, workspacePolicyVersion: 3, ownerRole: 3, taskCount: 0, initialCid: "", registryImmutableMatches: true,
    runtimeBytecodeMatches: true, ownerCreateSimulationPassed: ownerSimulation.passed, ownerCreateSimulationUnsupported: ownerSimulation.unsupported,
    ...(ownerSimulation.reason ? { simulationLimitation: ownerSimulation.reason } : {}), unscopedCreateDenied: true, nonMemberCreateDenied: true,
    probesAreReadOnly: true, blockNumber: await provider.getBlockNumber() };
  journal.verified = true; journal.verifiedAt = new Date().toISOString(); persist();
}

async function main() {
  let plan;
  if (fs.existsSync(output)) {
    if (!process.argv.includes("--resume")) throw Error("Journal exists; review and use --resume instead of redeploying");
    journal = JSON.parse(fs.readFileSync(output, "utf8")); plan = journal.plan;
    if (plan.rpc !== config.rpc || plan.chainId !== config.chainId || getAddress(plan.deployer) !== expected ||
        (await provider.getBlock(0)).hash !== plan.genesisHash || v3.bytecodeHash !== plan.estimates.find((row) => row.name === "PlaneTaskManagerV3").bytecodeHash)
      throw Error("Journal does not match network/deployer/current artifact");
  } else {
    if (process.argv.includes("--resume")) throw Error("No journal to resume");
    plan = await preflight();
  }
  if (!process.argv.includes("--execute")) return;
  if (arg("--task-state") !== "fresh") throw Error("Explicit --task-state fresh is required to start completely new contracts/data");
  if (!journal) { journal = { plan, startedAt: new Date().toISOString(), transactions: [], contracts: {}, verified: false }; persist(); }
  let signer;
  const send = async (label, tx, index) => {
    let entry = journal.transactions[index];
    if (entry && (entry.label !== label || entry.nonce !== plan.startNonce + index)) throw Error("Journal operation sequence differs");
    if (!entry) {
      if (!signer) {
        let key = await readDeployerKey(); signer = new Wallet(key, provider); key = "";
        if (getAddress(signer.address) !== expected) throw Error("Key does not match expected deployer");
      }
      const nonce = await provider.getTransactionCount(expected, "pending");
      if (nonce !== plan.startNonce + index || nonce !== await provider.getTransactionCount(expected, "latest")) throw Error("Nonce changed; stop without replacing another transaction");
      const estimate = await provider.estimateGas({ ...tx, from: expected });
      const gasLimit = estimate * 125n / 100n;
      if (gasLimit > (await provider.getBlock("latest")).gasLimit) throw Error("Gas exceeds current block limit");
      const signed = await signer.signTransaction({ ...tx, nonce, gasLimit, gasPrice: BigInt(plan.gasPrice), chainId: plan.chainId, type: 0, value: 0n });
      entry = { label, nonce, hash: keccak256(signed), estimatedGas: String(estimate), gasLimit: String(gasLimit), signedAt: new Date().toISOString(), confirmed: false };
      journal.transactions.push(entry); persist(); // Persist hash before broadcast, never private key or signed bytes.
      console.log(JSON.stringify({ submitting: label, nonce, hash: entry.hash }));
      await provider.broadcastTransaction(signed);
    }
    const receipt = await provider.waitForTransaction(entry.hash, 1, 120000);
    if (!receipt || receipt.status !== 1) throw Error(`${label} has no successful receipt; do not blindly resubmit`);
    Object.assign(entry, { confirmed: true, status: receipt.status, blockNumber: receipt.blockNumber, gasUsed: String(receipt.gasUsed), contractAddress: receipt.contractAddress });
    persist(); console.log(JSON.stringify({ confirmed: label, hash: entry.hash, blockNumber: receipt.blockNumber }));
    return receipt;
  };
  for (const [index, name] of names.entries()) {
    const args = name === "PlaneTaskManagerV3" ? [plan.predicted.PlaneWorkspaceRegistry] : [];
    const tx = await new ContractFactory(artifacts[name].abi, artifacts[name].bytecode).getDeployTransaction(...args);
    await verifyContract(name, plan, await send(`deploy:${name}`, tx, index));
  }
  const registry = new Contract(plan.predicted.PlaneWorkspaceRegistry, artifacts.PlaneWorkspaceRegistry.abi, provider);
  await send("initialize:workspace", await registry.createWorkspace.populateTransaction(plan.workspace.slug, plan.workspace.name, ""), 3);
  await verifyFresh(plan);
  if (process.argv.includes("--write-env")) {
    const changes = envPlan(plan);
    const written = [];
    try {
      for (const item of changes) { fs.writeFileSync(path.join(planeRoot, item.file), item.next); written.push(item); }
    } catch (error) {
      for (const item of written) fs.writeFileSync(path.join(planeRoot, item.file), item.original);
      throw error;
    }
    journal.envFilesUpdated = changes.map((item) => item.file); persist();
  }
  console.log(JSON.stringify({ verified: journal.verified, contracts: journal.contracts, verification: journal.verification, envFilesUpdated: journal.envFilesUpdated }, null, 2));
}
try { await main(); } catch (error) {
  console.error(`Deployment stopped: ${String(error?.shortMessage || error?.message || error).slice(0, 500)}`);
  process.exitCode = 1;
} finally { provider.destroy(); }
