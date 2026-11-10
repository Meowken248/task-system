import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedV3Runtime, planTaskEnvChange, planFreshEnvChange, readV3Artifact, decodeOwnerCreateProbe } from "../../scripts/task-v3-deployment.mjs";
import { AbiCoder } from "ethers";

const oldAddress = "0x" + "1".repeat(40), address = "0x" + "2".repeat(40), registry = "0x" + "3".repeat(40);
const config = { rpc: "https://rpc.fixture/", chainId: 991, workspaceRegistry: registry };
const env = `VITE_RPC_URL="https://rpc.fixture"\r\nVITE_CHAIN_ID=991\r\nVITE_WORKSPACE_REGISTRY_ADDRESS="${registry}"\r\nVITE_CONTRACT_ADDRESS="${oldAddress}"\r\nUNRELATED_VALUE="keep-every-byte"\r\n`;
test("RPC read-only write limitation is reported as unsupported, never as a successful write", () => {
  assert.deepEqual(decodeOwnerCreateProbe("0x" + "00".repeat(32)), { passed: true, unsupported: false });
  const error = (message) => "0x08c379a0" + AbiCoder.defaultAbiCoder().encode(["string"], [message]).slice(2);
  const result = decodeOwnerCreateProbe(error("Cant store stack from read only call"));
  assert.equal(result.passed, false); assert.equal(result.unsupported, true);
  assert.throws(() => decodeOwnerCreateProbe(error("Unauthorized")));
  assert.throws(() => decodeOwnerCreateProbe("0x" + "01".repeat(32)));
  assert.throws(() => decodeOwnerCreateProbe("0x"));
});
test("env update changes only the task address and can finish an interrupted update", () => {
  const next = planTaskEnvChange(env, "fixture.env", config, oldAddress, address);
  assert.equal(next, env.replace(oldAddress, address));
  assert.equal(planTaskEnvChange(next, "fixture.env", config, oldAddress, address), next);
});
test("env update rejects mismatched chain, RPC, registry, duplicate or unrelated task address", () => {
  for (const source of [env.replace("991", "992"), env.replace("rpc.fixture", "other.fixture"),
    env.replace(registry, address), env + `VITE_CONTRACT_ADDRESS="${oldAddress}"\n`, env.replace(oldAddress, registry)]) {
    assert.throws(() => planTaskEnvChange(source, "fixture.env", config, oldAddress, address));
  }
});
test("runtime verification inserts the immutable registry at exact compiler positions", () => {
  const artifact = { deployedBytecode: "0x6000" + "00".repeat(32) + "5b" };
  assert.equal(expectedV3Runtime(artifact, { 1: [{ start: 2, length: 32 }] }, registry), "0x6000" + "00".repeat(12) + registry.slice(2) + "5b");
  assert.throws(() => expectedV3Runtime(artifact, {}, registry), /Missing/);
  assert.throws(() => expectedV3Runtime(artifact, { 1: [{ start: 2, length: 20 }] }, registry), /Unexpected/);
});
test("the deployment artifact corresponds to current contract sources and has registry immutables", () => {
  const result = readV3Artifact(process.cwd());
  assert.equal(result.artifact.contractName, "PlaneTaskManagerV3");
  const runtime = expectedV3Runtime(result.artifact, result.immutableReferences, registry);
  assert.equal(runtime.length, result.artifact.deployedBytecode.length);
  assert(runtime.includes(registry.slice(2)));
});
test("fresh env plan replaces all three addresses and its epoch, preserving unrelated values", () => {
  const oldContracts = { task: oldAddress, workspace: registry, offchain: "0x" + "4".repeat(40) };
  const newContracts = { task: address, workspace: "0x" + "5".repeat(40), offchain: "0x" + "6".repeat(40) };
  const original = env + `VITE_REGISTRY_CONTRACT_ADDRESS="${oldContracts.offchain}"\nNEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS="${oldContracts.offchain}"\n`;
  const next = planFreshEnvChange(original, "fixture.env", config, oldContracts, newContracts, "fresh-fixture");
  assert(next.includes(`VITE_CONTRACT_ADDRESS="${newContracts.task}"`));
  assert(next.includes(`VITE_WORKSPACE_REGISTRY_ADDRESS="${newContracts.workspace}"`));
  assert(next.includes(`VITE_REGISTRY_CONTRACT_ADDRESS="${newContracts.offchain}"`));
  assert(next.includes('VITE_DAPP_DEPLOYMENT_ID="fresh-fixture"'));
  assert(next.includes('UNRELATED_VALUE="keep-every-byte"'));
  assert.equal(planFreshEnvChange(next, "fixture.env", config, oldContracts, newContracts, "fresh-fixture"), next);
});
