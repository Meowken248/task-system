/** Read-only upgrade preview. No signer, private key or transaction submission. */
/* oxlint-disable no-await-in-loop -- Read workspace/member records in order at the pinned block and stop on the first failed source read. */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { Interface, keccak256, getAddress } from "ethers";
import { readDeploymentEnv, deploymentArgument as argument } from "./deployment-env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registryAbi = new Interface([
  "function operator() view returns (address)",
  "function workspacePolicyVersion() view returns (uint256)",
  "function getWorkspace(string) view returns (string,address,string,uint256)",
  "function getWorkspaceMembers(string) view returns (address[])",
  "function getMemberRole(string,address) view returns (uint8)",
]);

export function planWorkspaceMigration(workspace) {
  const owner = getAddress(workspace.owner);
  const unique = new Map();
  for (const member of workspace.members) {
    const address = getAddress(member.address);
    if (![1, 2, 3].includes(member.role)) throw new Error(`Invalid source role for ${address}`);
    unique.set(address, { address, role: address === owner ? 3 : Math.min(member.role, 2) });
  }
  unique.set(owner, { address: owner, role: 3 });
  return {
    slug: workspace.slug,
    name: workspace.name,
    owner,
    cid: workspace.cid,
    sourceMemberEntries: workspace.members.length,
    members: [...unique.values()],
    normalizations: workspace.members
      .filter((member) => member.role === 3 && getAddress(member.address) !== owner)
      .map((member) => ({
        address: getAddress(member.address),
        from: 3,
        to: 2,
        reason: "Canonical owner is the workspace owner field",
      })),
    operations: [
      { method: "createWorkspace", args: [workspace.slug, workspace.name, workspace.cid] },
      { method: "setWorkspaceOwner", args: [workspace.slug, owner] },
      ...[...unique.values()]
        .filter((member) => member.address !== owner)
        .map((member) => ({ method: "addMember", args: [workspace.slug, member.address, member.role] })),
    ],
  };
}

async function main() {
  const config = readDeploymentEnv();
  const slugs = [
    ...new Set(
      (argument("--slugs") || config.defaultSlug || "")
        .split(",")
        .map((slug) => slug.trim())
        .filter(Boolean)
    ),
  ];
  if (!slugs.length) throw new Error("Provide --slugs or configure VITE_DEFAULT_WORKSPACE_SLUG");
  if (!argument("--output")) throw new Error("Provide --output <preview.json>");
  const output = resolve(root, argument("--output"));
  const inside = relative(root, output);
  if (!inside || inside.startsWith("..") || isAbsolute(inside))
    throw new Error("Preview output must stay inside the Plane workspace");
  const address = config.workspaceRegistry;
  const rpc = async (method, params = []) => {
    const response = await fetch(config.rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const body = await response.json();
    if (body.error || typeof body.result !== "string") throw new Error(body.error?.message || "Invalid RPC result");
    return body.result;
  };
  const chainId = Number(BigInt(await rpc("eth_chainId")));
  if (chainId !== config.chainId) throw new Error("Configured chain ID does not match the connected RPC");
  const block = await rpc("eth_blockNumber");
  const call = async (method, args = []) =>
    registryAbi.decodeFunctionResult(
      method,
      await rpc("eth_call", [{ to: address, data: registryAbi.encodeFunctionData(method, args) }, block])
    );
  const operator = (await call("operator"))[0];
  const policyVersion = await call("workspacePolicyVersion")
    .then((values) => Number(values[0]))
    .catch(() => null);
  const code = await rpc("eth_getCode", [address, block]);
  if (code === "0x") throw new Error("Source registry has no bytecode");
  const workspaces = [];
  for (const slug of slugs) {
    const [name, owner, cid, updatedAt] = await call("getWorkspace", [slug]);
    const addresses = (await call("getWorkspaceMembers", [slug]))[0];
    const ownerRole = Number((await call("getMemberRole", [slug, owner]))[0]);
    const members = [];
    for (const member of addresses)
      members.push({ address: member, role: Number((await call("getMemberRole", [slug, member]))[0]) });
    workspaces.push({
      ...planWorkspaceMigration({ slug, name, owner, cid, members }),
      sourceUpdatedAt: Number(updatedAt),
      sourceCanonicalOwnerRole: ownerRole,
      sourceOwnerListed: addresses.some((member) => member.toLowerCase() === owner.toLowerCase()),
    });
  }
  const preview = {
    readOnly: true,
    observedAt: new Date().toISOString(),
    chainId,
    blockNumber: Number(BigInt(block)),
    sourceRegistry: address,
    sourceBytecodeHash: keccak256(code),
    sourcePolicyVersion: policyVersion,
    sourceOperator: operator,
    coverage: "Only explicitly supplied workspace slugs; not a complete chain-wide discovery or backup of file bytes",
    workspaces,
    requiredReview: [
      "Source member/owner list and normalizations",
      "Backup and retrieve all snapshot CIDs and attachment bytes",
      "Deploy a new registry; this contract is not a proxy",
      "Restore memberships and remove any extra deployer membership",
      "Set operator deliberately after restoration",
      "Change app registry address only after post-deploy verification",
      "Reissue pending wallet-bound invitations; email-only invitations need administrator wallet approval",
      "Retain the old registry and configuration for rollback",
    ],
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(preview, null, 2) + "\n");
  console.log(
    JSON.stringify({
      readOnly: true,
      chainId,
      blockNumber: preview.blockNumber,
      sourcePolicyVersion: policyVersion,
      workspaces: workspaces.map((workspace) => ({
        slug: workspace.slug,
        members: workspace.members.length,
        normalizations: workspace.normalizations.length,
      })),
      output: relative(root, output),
    })
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
