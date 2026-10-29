/* oxlint-disable no-await-in-loop -- Each verified workspace hydration must finish before merging the next snapshot into the shared local cache. */
import type { RouteResult } from "./types";
import {
  localDB,
  saveDB,
  getLoggedInUserId,
  getEnvVar,
  saveStoredInvitations,
  getStoredInvitations as storedInvitations,
  dappSyncChannel,
} from "./store";
import {
  getWorkspaceRegistryAddress,
  getStoredWalletAddress,
  currentUserAddress,
  addWorkspaceWalletMemberOnChain,
  MembershipOperationError,
  directRpcRead,
  abiEncodeGetWorkspace,
  decodeAbiWorkspace,
  abiEncodeGetUserWorkspaces,
  decodeAbiStringArray,
  fetchMemberRoleOnChain,
  fetchFromIPFS,
  applyOffchainDB,
} from "./chain";
import { withInvitationLock } from "./invitation-policy";
import { resolveInvitationWorkspace } from "./invitation-workspace";
import { listWorkspaceMembers } from "./workspace-members";

const normalized = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");
const isWallet = (value: string) => /^0x[0-9a-f]{40}$/.test(value) && !/^0x0{40}$/.test(value);
const failure = (status: number, code: string, error: string): RouteResult => ({ status, data: { code, error } });
const keysOf = (workspace: any) => new Set([workspace?.slug, workspace?.id].filter(Boolean));
type WalletWorkspaceDiscovery = { available: boolean; slugs: Set<string>; roles: Map<string, number> };
const noDiscovery = (): WalletWorkspaceDiscovery => ({ available: false, slugs: new Set(), roles: new Map() });

/** Cache a chain-confirmed wallet, never bind an arbitrary email to that wallet. */
export function cacheVerifiedWalletMember(workspace: any, wallet: string, role: number): any {
  const keys = keysOf(workspace);
  let profile = (localDB.users || []).find((user: any) =>
    [user.wallet_address, user.metanode_wallet_address, user.id].some((value) => normalized(value) === wallet)
  );
  const ownProfile = (localDB.users || []).find((user: any) => user.id === getLoggedInUserId());
  if (
    !profile &&
    ownProfile &&
    normalized(getStoredWalletAddress() || currentUserAddress) === wallet &&
    !ownProfile.wallet_address &&
    !ownProfile.metanode_wallet_address
  ) {
    ownProfile.metanode_wallet_address = wallet;
    profile = ownProfile;
  }
  const memberId = profile?.id || wallet;
  const existing = (localDB.workspace_members || []).find(
    (member: any) =>
      (keys.has(member.workspace) || keys.has(member.workspace_id)) &&
      normalized(member.wallet_address || member.member?.metanode_wallet_address || member.member) === wallet
  );
  const record = {
    ...existing,
    id: existing?.id || `wallet-member:${workspace.id}:${wallet}`,
    workspace: workspace.id,
    workspace_id: workspace.id,
    workspace_slug: workspace.slug,
    member: memberId,
    wallet_address: wallet,
    email: profile?.email || "",
    role: role >= 2 ? 20 : 15,
    on_chain_role: role,
    verified_on_chain: true,
    is_active: true,
    chain_sync_pending: false,
    created_at: existing?.created_at || new Date().toISOString(),
  };
  if (!localDB.workspace_members) localDB.workspace_members = [];
  if (existing) Object.assign(existing, record);
  else localDB.workspace_members.push(record);
  // Only live chain evidence can clear these scoped stale cache tombstones.
  const identities = new Set(
    [wallet, normalized(memberId), normalized(profile?.email), normalized(existing?.id)].filter(Boolean)
  );
  for (const key of keys) {
    if (Array.isArray(localDB.removed_members?.[key])) {
      localDB.removed_members[key] = localDB.removed_members[key].filter(
        (identity: string) => !identities.has(normalized(identity))
      );
    }
  }
  return record;
}

export function addWorkspaceWalletMember(slug: string, body: Record<string, unknown>): Promise<RouteResult> {
  const wallet = normalized(body?.wallet_address);
  const operation = () =>
    withInvitationLock(`direct-member:${getWorkspaceRegistryAddress()}:${slug}:${wallet}`, async () => {
      if (!getLoggedInUserId()) return failure(401, "AUTH_REQUIRED", "Vui lòng đăng nhập.");
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some((key) => !["wallet_address", "role", "retry_after_review"].includes(key)) ||
        (body.retry_after_review !== undefined && typeof body.retry_after_review !== "boolean") ||
        !isWallet(wallet) ||
        ![15, 20].includes(Number(body.role ?? 15))
      ) {
        return failure(400, "INVALID_MEMBER", "Nhập đúng địa chỉ ví và chọn quyền Member hoặc Admin.");
      }
      const workspace = resolveInvitationWorkspace(localDB.workspaces || [], slug);
      if (!workspace) return failure(404, "WORKSPACE_NOT_FOUND", "Không tìm thấy workspace.");
      const signer = getStoredWalletAddress() || currentUserAddress;
      if (!signer) return failure(409, "WALLET_REQUIRED", "Hãy kết nối ví quản trị trước khi thêm thành viên.");
      try {
        const info = decodeAbiWorkspace(
          await directRpcRead(getWorkspaceRegistryAddress(), abiEncodeGetWorkspace(workspace.slug), 5000)
        );
        if (!info)
          return failure(
            503,
            "WORKSPACE_UNAVAILABLE",
            "Chưa kiểm tra được workspace trên chain. Chưa thêm thành viên."
          );
        const result = await addWorkspaceWalletMemberOnChain(
          workspace.slug,
          wallet,
          Number(body.role ?? 15),
          signer,
          body.retry_after_review === true
        );
        cacheVerifiedWalletMember(workspace, wallet, result.role);
        // An old pending wallet invitation is now satisfied by direct provisioning.
        const belongs = (inv: any) =>
          keysOf(workspace).has(inv.workspace_slug || inv.workspace?.slug || inv.workspace?.id || inv.workspace_id);
        const finish = (invitations: any[]) =>
          invitations.map((inv) =>
            belongs(inv) && normalized(inv.wallet_address || inv.email) === wallet
              ? {
                  ...inv,
                  accepted: true,
                  status: "accepted",
                  responded_at: inv.responded_at || new Date().toISOString(),
                }
              : inv
          );
        localDB.invitations = finish(localDB.invitations || []);
        saveStoredInvitations(finish(storedInvitations()));
        workspace.total_members = listWorkspaceMembers(localDB, workspace.slug, workspace.id).length;
        saveDB({ localOnly: true });
        dappSyncChannel?.postMessage({ type: "MEMBERSHIP_HINT", workspaceSlug: workspace.slug });
        if (typeof window !== "undefined")
          window.dispatchEvent(
            new CustomEvent("plane_dapp_members_synced", { detail: { workspaceSlug: workspace.slug } })
          );
        return {
          status: 200,
          data: {
            member: listWorkspaceMembers(localDB, workspace.slug, workspace.id).find(
              (member) => member.wallet_address === wallet
            ),
            wallet_address: wallet,
            role: result.role >= 2 ? 20 : 15,
            already_member: result.alreadyMember,
            chain_confirmed: true,
            workspace_slug: workspace.slug,
          },
        };
      } catch (error) {
        const code = error instanceof MembershipOperationError ? error.code : "MEMBERSHIP_UNCONFIRMED";
        return failure(
          code === "NOT_AUTHORIZED"
            ? 403
            : ["INVALID_WALLET", "UNSUPPORTED_ROLE"].includes(code)
              ? 400
              : ["WALLET_REQUIRED", "SIGNING_WALLET_CHANGED", "MEMBERSHIP_PENDING"].includes(code)
                ? 409
                : 503,
          code,
          error instanceof Error
            ? error.message
            : "Chưa xác nhận được giao dịch. Hãy kiểm tra lịch sử ví trước khi thử lại."
        );
      }
    });
  // Web Locks serialize this same grant across tabs; local markers preserve
  // uncertainty after a refresh. Neither is accepted as a membership proof.
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request(`plane-wallet-member:${getWorkspaceRegistryAddress()}:${slug}:${wallet}`, operation);
  return operation();
}

/** Discovery is read-only. No invitation, OTP, recipient signature or shared
 * browser storage is required to find a wallet's already granted workspaces. */
const discoveries = new Map<
  string,
  { expires: number; pending: boolean; context: any[]; task: Promise<WalletWorkspaceDiscovery> }
>();
const hydratedCids = new Map<string, string>();
export function discoverWalletWorkspaces(wallet: string): Promise<WalletWorkspaceDiscovery> {
  const key = `${getEnvVar("VITE_RPC_URL")}:${getWorkspaceRegistryAddress()}:${getLoggedInUserId()}:${normalized(wallet)}`;
  const existing = discoveries.get(key);
  if (existing && (existing.pending || existing.expires > Date.now()) && existing.context === localDB.workspaces)
    return existing.task;
  const task = discoverWalletWorkspacesOnce(wallet).catch(noDiscovery);
  const entry = { expires: Date.now() + 10000, pending: true, context: localDB.workspaces, task };
  discoveries.set(key, entry);
  void task
    .then((result) => {
      entry.pending = false;
      entry.expires = Date.now() + 10000;
      entry.context = localDB.workspaces;
      if (!result.available && discoveries.get(key) === entry) discoveries.delete(key);
      if (
        (localDB.workspaces || []).some(
          (workspace: any) => result.slugs.has(workspace.slug) && workspace.is_snapshot_available === false
        )
      )
        entry.expires = Date.now();
      return result;
    })
    .catch(() => {
      if (discoveries.get(key) === entry) discoveries.delete(key);
    });
  return task;
}

async function discoverWalletWorkspacesOnce(wallet: string): Promise<WalletWorkspaceDiscovery> {
  wallet = normalized(wallet);
  if (!isWallet(wallet) || !getLoggedInUserId() || !getWorkspaceRegistryAddress()) return noDiscovery();
  const session = getLoggedInUserId();
  const unchanged = () =>
    session === getLoggedInUserId() && normalized(getStoredWalletAddress() || currentUserAddress) === wallet;
  const raw = await directRpcRead(getWorkspaceRegistryAddress(), abiEncodeGetUserWorkspaces(wallet), 5000);
  if (!raw || !/^0x[0-9a-f]+$/i.test(raw) || raw.length < 130 || BigInt(`0x${raw.slice(2, 66)}`) !== 32n)
    return noDiscovery();
  const names = decodeAbiStringArray(raw);
  if (BigInt(`0x${raw.slice(66, 130)}`) !== BigInt(names.length)) return noDiscovery();
  const slugs = new Set<string>();
  const roles = new Map<string, number>();
  let changed = false;
  for (const slug of names) {
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(slug)) continue;
    const [infoRaw, role] = await Promise.all([
      directRpcRead(getWorkspaceRegistryAddress(), abiEncodeGetWorkspace(slug), 5000),
      fetchMemberRoleOnChain(slug, wallet),
    ]);
    const info = decodeAbiWorkspace(infoRaw);
    if (!unchanged()) return noDiscovery();
    if (!info || role < 0) return noDiscovery();
    if (![1, 2, 3].includes(role)) continue;
    const snapshot = info.ipfsCID ? await fetchFromIPFS(info.ipfsCID) : null;
    if (!unchanged()) return noDiscovery();
    const hydrationKey = `${getEnvVar("VITE_RPC_URL")}:${getWorkspaceRegistryAddress()}:${wallet}:${slug}`;
    if (
      snapshot &&
      (hydratedCids.get(hydrationKey) !== info.ipfsCID || !resolveInvitationWorkspace(localDB.workspaces || [], slug))
    ) {
      applyOffchainDB(snapshot);
      hydratedCids.set(hydrationKey, info.ipfsCID);
    }
    const canonical = resolveInvitationWorkspace(snapshot?.workspaces || [], slug);
    let workspace = resolveInvitationWorkspace(localDB.workspaces || [], slug);
    if (!workspace || (canonical && workspace.id !== canonical.id)) {
      workspace = {
        ...canonical,
        id: canonical?.id || slug,
        slug,
        name: info.name,
        owner: info.owner,
        created_by: info.owner,
        created_at: canonical?.created_at || new Date(info.updatedAt * 1000).toISOString(),
      };
      const index = (localDB.workspaces || []).findIndex((item: any) => item.slug === slug);
      if (!localDB.workspaces) localDB.workspaces = [];
      if (index >= 0) localDB.workspaces[index] = workspace;
      else localDB.workspaces.push(workspace);
    }
    workspace.name = info.name;
    workspace.owner = info.owner;
    workspace.created_by = info.owner;
    workspace.role = role >= 2 ? 20 : 15;
    workspace.is_snapshot_available = !info.ipfsCID || Boolean(snapshot);
    cacheVerifiedWalletMember(workspace, wallet, role);
    const ownProfile = (localDB.users || []).find((user: any) => user.id === session);
    if (ownProfile) {
      ownProfile.is_onboarded = true;
      ownProfile.onboarding_step = {
        ...ownProfile.onboarding_step,
        workspace_join: true,
        workspace_create: true,
        workspace_invite: true,
      };
      if (!ownProfile.last_workspace_slug) {
        ownProfile.last_workspace_slug = slug;
        ownProfile.last_workspace_id = workspace.id;
      }
    }
    slugs.add(slug);
    roles.set(slug, role >= 2 ? 20 : 15);
    changed = true;
  }
  if (changed) saveDB({ localOnly: true });
  return { available: true, slugs, roles };
}
