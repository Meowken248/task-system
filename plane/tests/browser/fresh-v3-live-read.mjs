/** Opt-in read-only integration against the verified deployment, no SDK/signing or user browser storage. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readDeploymentEnv, deploymentArgument } from "../../scripts/deployment-env.mjs";

const journalFile = deploymentArgument("--journal");
if (!journalFile) throw Error("Pass --journal for the confirmed fresh deployment");
const journal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
assert(journal.verified && journal.transactions.length === 4 && journal.transactions.every((tx) => tx.confirmed && tx.status === 1));
const config = readDeploymentEnv();
assert.equal(config.values.VITE_CONTRACT_ADDRESS, journal.contracts.PlaneTaskManagerV3.address);
assert.equal(config.workspaceRegistry, journal.contracts.PlaneWorkspaceRegistry.address);
for (const [key, value] of Object.entries(config.values)) process.env[key] = value;
process.env.VITE_AUTO_COMMIT_ONCHAIN = "false";
const realFetch = globalThis.fetch;
await import("../dapp/browser.mjs");
const calls = [];
globalThis.fetch = async (url, options) => {
  assert.equal(new URL(url).href, config.rpc, "Only the configured RPC may be read");
  const body = JSON.parse(options?.body || "{}");
  assert(["eth_call", "eth_chainId", "eth_getCode", "eth_blockNumber"].includes(body.method), "No transaction or storage upload permitted");
  calls.push(body.method);
  return realFetch(url, options);
};
const { localDB, defaultDB, setLoggedInUser, requireWorkspaceAccess, handleRoute } = await import("../../packages/services/dist/index.js");
Object.keys(localDB).forEach((key) => delete localDB[key]);
Object.assign(localDB, structuredClone(defaultDB));
const owner = journal.plan.deployer.toLowerCase();
const slug = journal.plan.workspace.slug;
localDB.users = [{ id: "live-read-owner", email: "", metanode_wallet_address: owner }];
setLoggedInUser("live-read-owner");
sessionStorage.setItem("plane_active_wallet_address", owner);
localStorage.setItem("plane_active_wallet_address", owner);
const access = await requireWorkspaceAccess(slug);
assert.equal(access.role, 20, "Owner role is read from the new live registry");
const projects = await handleRoute("get", `/api/workspaces/${slug}/projects/`, {});
assert.equal(projects.status, 200);
assert.equal((Array.isArray(projects.data) ? projects.data : projects.data.results).length, 0);
// A valid address with no membership must not inherit the owner's cached role.
const outsider = "0x0000000000000000000000000000000000000001";
localDB.users.push({ id: "live-read-outsider", email: "", metanode_wallet_address: outsider });
setLoggedInUser("live-read-outsider");
sessionStorage.setItem("plane_active_wallet_address", outsider);
localStorage.setItem("plane_active_wallet_address", outsider);
await assert.rejects(requireWorkspaceAccess(slug), (error) => error.status === 403 && error.code === "NOT_AUTHORIZED");
const result = { rpc: config.rpc, chainId: config.chainId, fixtureIdentityOnly: true, realRpcReads: calls.length,
  ownerRole: access.role, projects: 0, nonMemberDenied: true, transactionsSent: 0, uploads: 0,
  limitation: "Service/router integration uses fixture login and isolated in-memory browser storage; this does not test the real SDK wallet UI." };
fs.writeFileSync(path.join(path.dirname(journalFile), "live-service-read.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
