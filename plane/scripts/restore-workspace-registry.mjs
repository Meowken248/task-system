/** Default: read-only. Execution requires explicit approval and an in-memory key. */
/* oxlint-disable no-await-in-loop -- Verify/journal each operation and await its receipt before allocating the next nonce; stop on the first failure. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, getAddress, getCreateAddress, keccak256 } from "ethers";
import { planWorkspaceMigration } from "./preview-workspace-registry-migration.mjs";
import {
  planeRoot as root,
  readDeploymentEnv,
  readDeployerKey,
  deploymentArgument as argument,
} from "./deployment-env.mjs";

const sourceAbi = [
  "function getWorkspace(string) view returns (string,address,string,uint256)",
  "function getWorkspaceMembers(string) view returns (address[])",
  "function getMemberRole(string,address) view returns (uint8)",
  "function operator() view returns (address)",
];

export async function restoreWorkspaceOnRegistry(registry, plan, send) {
  const signer = getAddress(await registry.runner.getAddress());
  let current;
  try {
    current = await registry.getWorkspace(plan.slug);
  } catch (error) {
    const selector = registry.interface.getError("WorkspaceNotFound").selector;
    if (!String(error?.message).includes("WorkspaceNotFound") && !String(error?.data || "").startsWith(selector))
      throw error;
    await send(`create:${plan.slug}`, "createWorkspace", [plan.slug, plan.name, plan.cid]);
    current = await registry.getWorkspace(plan.slug);
  }
  if (current[0] !== plan.name || current[2] !== plan.cid)
    throw new Error(`Target data differs for ${plan.slug}; stop for review`);
  const currentOwner = getAddress(current[1]);
  if (currentOwner !== signer && currentOwner !== getAddress(plan.owner))
    throw new Error(`Unexpected target owner for ${plan.slug}`);
  if (currentOwner !== getAddress(plan.owner))
    await send(`owner:${plan.slug}`, "setWorkspaceOwner", [plan.slug, plan.owner]);
  for (const member of plan.members) {
    if (getAddress(member.address) === getAddress(plan.owner)) continue;
    if (Number(await registry.getMemberRole(plan.slug, member.address)) !== member.role)
      await send(`member:${plan.slug}:${member.address}`, "addMember", [plan.slug, member.address, member.role]);
  }
  const expected = new Map(plan.members.map((member) => [getAddress(member.address), member.role]));
  for (const address of await registry.getWorkspaceMembers(plan.slug))
    if (!expected.has(getAddress(address))) {
      if (getAddress(address) !== signer) throw new Error(`Unexpected target member ${address}`);
      await send(`cleanup-deployer:${plan.slug}`, "removeMember", [plan.slug, address]);
    }
  const actual = await registry.getWorkspaceMembers(plan.slug);
  if (actual.length !== expected.size || new Set(actual.map(getAddress)).size !== actual.length)
    throw new Error("Target member list is incomplete or duplicated");
  for (const member of plan.members)
    if (Number(await registry.getMemberRole(plan.slug, member.address)) !== member.role)
      throw new Error(`Role verification failed for ${member.address}`);
  return { slug: plan.slug, members: actual.length, verified: true };
}

const sortedMembers = (members) => members.map((member) => `${getAddress(member.address)}:${member.role}`).sort();

async function assertSourceUnchanged(source, manifest) {
  for (const plan of manifest.workspaces) {
    const [name, owner, cid, updatedAt] = await source.getWorkspace(plan.slug);
    const members = [];
    for (const address of await source.getWorkspaceMembers(plan.slug))
      members.push({ address, role: Number(await source.getMemberRole(plan.slug, address)) });
    const fresh = planWorkspaceMigration({ slug: plan.slug, name, owner, cid, members });
    if (
      name !== plan.name ||
      getAddress(owner) !== getAddress(plan.owner) ||
      cid !== plan.cid ||
      Number(updatedAt) !== plan.sourceUpdatedAt ||
      JSON.stringify(sortedMembers(fresh.members)) !== JSON.stringify(sortedMembers(plan.members))
    )
      throw new Error(`Source ${plan.slug} changed; regenerate the preview before continuing`);
  }
}

async function main() {
  const manifestArgument = argument("--manifest");
  if (!manifestArgument) throw new Error("Provide --manifest <reviewed-preview.json>");
  const manifestPath = resolve(root, manifestArgument);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const config = readDeploymentEnv();
  if (
    !manifest.readOnly ||
    manifest.chainId !== config.chainId ||
    getAddress(manifest.sourceRegistry) !== config.workspaceRegistry ||
    !Array.isArray(manifest.workspaces) ||
    !manifest.workspaces.length
  )
    throw new Error("Manifest does not match the selected env configuration");
  if (!process.argv.includes("--execute")) {
    console.log(
      JSON.stringify({
        dryRun: true,
        sourceRegistry: manifest.sourceRegistry,
        chainId: config.chainId,
        workspaces: manifest.workspaces.map((workspace) => ({
          slug: workspace.slug,
          members: workspace.members.length,
        })),
      })
    );
    return;
  }
  if (getAddress(argument("--approve-source-registry") || "") !== config.workspaceRegistry)
    throw new Error("Explicit approval of the source registry is required");
  if (!config.gasLimit || config.gasLimit <= 0n)
    throw new Error("Configure a positive VITE_CONTRACT_GAS in the selected env file");
  const provider = new JsonRpcProvider(config.rpc, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
  provider.pollingInterval = 1000;
  try {
    let key = await readDeployerKey();
    const signer = new Wallet(key, provider);
    key = "";
    if (Number((await provider.getNetwork()).chainId) !== config.chainId) throw new Error("Wrong network");
    if (keccak256(await provider.getCode(config.workspaceRegistry)) !== manifest.sourceBytecodeHash)
      throw new Error("Source bytecode changed");
    const source = new Contract(config.workspaceRegistry, sourceAbi, provider);
    if (
      getAddress(await source.operator()) !== getAddress(manifest.sourceOperator) ||
      getAddress(signer.address) !== getAddress(manifest.sourceOperator)
    )
      throw new Error("Signer is not the reviewed source operator");
    await assertSourceUnchanged(source, manifest);

    const journalPath = resolve(dirname(manifestPath), "registry-migration-journal.json");
    const inside = relative(root, journalPath);
    if (inside.startsWith("..") || isAbsolute(inside)) throw new Error("Journal must stay inside Plane");
    let journal = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath, "utf8")) : null;
    const resume = argument("--resume-address");
    if (
      journal &&
      (!resume ||
        getAddress(resume) !== getAddress(journal.targetRegistry) ||
        getAddress(journal.sourceRegistry) !== config.workspaceRegistry ||
        journal.chainId !== config.chainId)
    )
      throw new Error("Existing journal requires its exact --resume-address; do not deploy twice");
    if (resume && !journal) throw new Error("Cannot resume without the original journal");
    const artifact = JSON.parse(
      readFileSync(resolve(root, "artifacts/contracts/PlaneWorkspaceRegistry.sol/PlaneWorkspaceRegistry.json"), "utf8")
    );
    const persist = () => writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n");

    // Hash, nonce and predicted deployment address are journalled BEFORE broadcast.
    // A lost RPC response therefore cannot cause an unrecorded second deployment.
    const broadcast = async (operation, unsigned) => {
      const pending = await provider.getTransactionCount(signer.address, "pending");
      const latest = await provider.getTransactionCount(signer.address, "latest");
      if (pending !== latest) throw new Error("Operator has a pending transaction; resolve it before continuing");
      const fee = await provider.getFeeData();
      if (fee.gasPrice === null || fee.gasPrice <= 0n) throw new Error("RPC did not provide a usable legacy gas price");
      const request = {
        ...unsigned,
        from: signer.address,
        nonce: pending,
        chainId: config.chainId,
        type: 0,
        gasPrice: fee.gasPrice,
        gasLimit: config.gasLimit,
        value: 0n,
      };
      const estimate = await provider.estimateGas(request);
      if (estimate <= 0n || estimate > config.gasLimit)
        throw new Error("Estimated gas exceeds VITE_CONTRACT_GAS; review env before sending");
      if ((await provider.getBalance(signer.address)) < config.gasLimit * fee.gasPrice)
        throw new Error("Operator balance cannot cover the configured gas limit");
      const signed = await signer.signTransaction(request);
      const hash = keccak256(signed);
      const deployment = operation === "deploy";
      if (!journal)
        journal = {
          sourceRegistry: config.workspaceRegistry,
          targetRegistry: getCreateAddress({ from: signer.address, nonce: pending }),
          chainId: config.chainId,
          transactions: [],
          complete: false,
        };
      const entry = {
        operation,
        hash,
        nonce: pending,
        estimatedGas: estimate.toString(),
        gasPrice: fee.gasPrice.toString(),
        submittedAt: new Date().toISOString(),
        confirmed: false,
      };
      journal.transactions.push(entry);
      persist();
      console.log(
        JSON.stringify({
          operation,
          phase: "prepared",
          hash,
          ...(deployment ? { targetRegistry: journal.targetRegistry } : {}),
        })
      );
      const response = await provider.broadcastTransaction(signed);
      if (response.hash.toLowerCase() !== hash.toLowerCase())
        throw new Error("RPC transaction hash differs from the signed transaction; stop for reconciliation");
      console.log(JSON.stringify({ operation, phase: "submitted", hash }));
      const receipt = await provider.waitForTransaction(hash, 1, 180000);
      if (!receipt || receipt.status !== 1) throw new Error(`Transaction ${hash} was not confirmed successfully`);
      if (deployment && getAddress(receipt.contractAddress) !== getAddress(journal.targetRegistry))
        throw new Error("Unexpected deployed address");
      Object.assign(entry, {
        confirmed: true,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        status: receipt.status,
      });
      persist();
      console.log(JSON.stringify({ operation, phase: "confirmed", hash, blockNumber: receipt.blockNumber }));
    };

    if (journal) {
      for (const entry of journal.transactions) {
        const receipt = await provider.getTransactionReceipt(entry.hash);
        if (!receipt) throw new Error(`Transaction ${entry.hash} is unresolved; do not resend`);
        Object.assign(entry, {
          confirmed: receipt.status === 1,
          blockNumber: receipt.blockNumber,
          status: receipt.status,
          gasUsed: receipt.gasUsed.toString(),
        });
      }
      persist();
    } else {
      const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
      await broadcast("deploy", await factory.getDeployTransaction());
    }
    const target = new Contract(journal.targetRegistry, artifact.abi, signer);
    if (
      Number(await target.workspacePolicyVersion()) !== 2 ||
      keccak256(await provider.getCode(journal.targetRegistry)) !== keccak256(artifact.deployedBytecode)
    )
      throw new Error("Unexpected target code or policy");
    const send = async (operation, method, args) =>
      broadcast(operation, await target.getFunction(method).populateTransaction(...args));
    for (const plan of manifest.workspaces) await restoreWorkspaceOnRegistry(target, plan, send);
    if (getAddress(await target.operator()) !== getAddress(manifest.sourceOperator))
      await send("operator", "setOperator", [manifest.sourceOperator]);
    if (process.argv.includes("--qa-invitations")) {
      const plan = manifest.workspaces[0];
      if (!journal.qa)
        journal.qa = { recipient: Wallet.createRandom().address, outsider: Wallet.createRandom().address, checks: [] };
      persist();
      const { recipient, outsider } = journal.qa;
      const rejectCall = async (name, from, method, args, errorName) => {
        const selector = target.interface.getError(errorName).selector;
        try {
          await provider.call({
            from,
            to: journal.targetRegistry,
            data: target.interface.encodeFunctionData(method, args),
            gasLimit: config.gasLimit,
          });
        } catch (error) {
          const data = error.data || error.info?.error?.data;
          if (typeof data !== "string" || !data.startsWith(selector))
            throw new Error(`Unexpected rejection during ${name}`, { cause: error });
          journal.qa.checks.push({ name, passed: true, expectedError: errorName });
          persist();
          return;
        }
        throw new Error(`Expected ${errorName} during ${name}`);
      };
      await rejectCall("uninvited-wallet-cannot-join", recipient, "joinWorkspace", [plan.slug], "InvitationRequired");
      await rejectCall(
        "non-admin-cannot-invite",
        outsider,
        "inviteMember",
        [plan.slug, recipient, 1, Math.floor(Date.now() / 1000) + 900],
        "Unauthorized"
      );
      const invitation = await target.getInvitation(plan.slug, recipient);
      if (Number(invitation[0]) === 0)
        await send("qa:invite-wallet", "inviteMember", [plan.slug, recipient, 1, Math.floor(Date.now() / 1000) + 900]);
      const pending = await target.getInvitation(plan.slug, recipient);
      if (Number(pending[0]) !== 1 || Number(await target.getMemberRole(plan.slug, recipient)) !== 0)
        throw new Error("An invitation must not grant active membership");
      journal.qa.checks.push({ name: "confirmed-wallet-invitation-remains-pending", passed: true });
      persist();
      await rejectCall("invitation-is-wallet-bound", outsider, "joinWorkspace", [plan.slug], "InvitationRequired");
      await send("qa:revoke-wallet-invitation", "revokeInvitation", [plan.slug, recipient]);
      if (Number((await target.getInvitation(plan.slug, recipient))[0]) !== 0)
        throw new Error("Invitation revocation was not verified");
      await rejectCall("revoked-wallet-cannot-join", recipient, "joinWorkspace", [plan.slug], "InvitationRequired");
      await rejectCall(
        "owner-cannot-be-demoted",
        signer.address,
        "addMember",
        [plan.slug, plan.owner, 1],
        "Unauthorized"
      );
      await rejectCall(
        "stale-cid-write-is-rejected",
        signer.address,
        "updateWorkspaceCIDIfMatches",
        [plan.slug, "", plan.cid],
        "CIDConflict"
      );
      for (const workspace of manifest.workspaces) await restoreWorkspaceOnRegistry(target, workspace, send);
      journal.qa.complete = true;
      persist();
    }
    await assertSourceUnchanged(source, manifest);
    journal.complete = true;
    journal.verifiedAt = new Date().toISOString();
    persist();
    console.log(
      JSON.stringify({
        verified: true,
        targetRegistry: journal.targetRegistry,
        appConfigurationChanged: false,
        oldRegistryChanged: false,
      })
    );
  } finally {
    provider.destroy();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.shortMessage || error.code || error.message || "Migration failed");
    process.exitCode = 1;
  });
