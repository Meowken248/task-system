import type { RouteResult } from "./types";
import {
  localDB,
  getLoggedInEmail,
  getLoggedInUserId,
  getStoredInvitations,
  saveStoredInvitations,
  saveDB,
  readInvitationTombstones,
  isInvitationDeleted,
  getInvitationWorkspaceKeys,
  dappSyncChannel,
} from "./store";
import {
  directRpcRead,
  decodeAbiWorkspace,
  abiEncodeGetWorkspace,
  getWorkspaceRegistryAddress,
  fetchFromIPFS,
  applyOffchainDB,
  assertVaultSigningAddress,
  joinWorkspaceOnChain,
  fetchMemberRoleOnChain,
  getStoredWalletAddress,
} from "./chain";
import { validateInvitation, withInvitationLock } from "./invitation-policy";
import { resolveInvitationWorkspace } from "./invitation-workspace";
import { effectiveInvitationTombstones } from "./invitation-tombstones";

const memberRoles = new Set([1, 2, 3]);
const invitationFailure = (status: number, code: string, error: string): RouteResult => ({
  status,
  data: { code, error },
});

/** A read never accepts an invitation or changes the authenticated account. */
export function respondToWorkspaceInvitation(
  method: string,
  wsSlug: string,
  invitationId: string,
  body: Record<string, any>,
  queryToken = ""
): Promise<RouteResult> {
  return withInvitationLock(`${wsSlug}:${invitationId}`, async () => {
    const fail = invitationFailure;
    if (!["get", "post"].includes(method)) return fail(405, "METHOD_NOT_ALLOWED", "Thao tác không được hỗ trợ.");
    const email = (getLoggedInEmail() || "").toLowerCase().trim();
    const userId = getLoggedInUserId();
    const user = (localDB.users || []).find((entry: any) => entry.id === userId);
    if (method === "post" && (!userId || !user))
      return fail(401, "AUTH_REQUIRED", "Vui lòng đăng nhập trước khi phản hồi lời mời.");
    if (method === "post" && ![true, false, "true", "false"].includes(body.accepted))
      return fail(400, "INVALID_RESPONSE", "Vui lòng chọn chấp nhận hoặc từ chối lời mời.");
    const token = typeof body.token === "string" ? body.token : queryToken;
    const chain = await readWorkspaceSnapshotFromChain(wsSlug, invitationId, token);
    let ws =
      (chain.available ? buildWorkspaceFromChainSnapshot(chain, wsSlug) : null) ||
      findLocalWorkspace(wsSlug) ||
      buildWorkspaceFromChainSnapshot(chain, wsSlug);
    if (!ws)
      return fail(
        chain.available ? 404 : 503,
        "WORKSPACE_UNAVAILABLE",
        "Chưa đọc được không gian làm việc. Hãy thử lại sau."
      );
    const keys = [wsSlug, ws.id, ws.slug].filter(Boolean);
    const keySet = new Set(keys);
    const matches = (entry: any) =>
      String(entry.id) === invitationId && getInvitationWorkspaceKeys(entry).some((key) => keySet.has(key));
    const cached = [...(localDB.invitations || []), ...getStoredInvitations()].find(matches);
    // Never synthesise a record from URL claims, even when IPFS/RPC is down.
    // On mutation require the latest shared snapshot to observe remote revocation.
    if (!chain.available && (method === "post" || !cached))
      return fail(
        503,
        "INVITATION_SOURCE_UNAVAILABLE",
        "Chưa kiểm tra được trạng thái mới nhất của lời mời. Dữ liệu chưa thay đổi, hãy thử lại sau."
      );
    let inv = chain.available ? chain.invitation : cached;
    if (cached?.status === "rejected" && cached.token === inv?.token)
      inv = { ...inv, status: "rejected", responded_at: cached.responded_at };
    if (!inv || !matches(inv))
      return fail(404, "INVITATION_NOT_FOUND", "Không tìm thấy lời mời đã được công bố hoặc lời mời đã bị thu hồi.");
    const invalid = validateInvitation(inv, {
      id: invitationId,
      workspaceKeys: keys,
      token,
      email,
      checkRecipient: method === "post",
    });
    if (invalid) return fail(invalid.status, invalid.code, invalid.error);
    const deleted = effectiveInvitationTombstones(
      inv,
      readInvitationTombstones(),
      chain.available ? chain.snapshot?._deleted_invitation_ids || [] : undefined
    );
    if (isInvitationDeleted(inv, deleted)) return fail(410, "INVITATION_REVOKED", "Lời mời đã bị thu hồi.");
    const invEmail = String(inv.email || "")
      .toLowerCase()
      .trim();
    const invWallet = String(inv.wallet_address || (/^0x[a-f0-9]{40}$/i.test(invEmail) ? invEmail : "")).toLowerCase();
    const removed = new Set(
      keys
        .flatMap(
          (key) => (chain.available ? chain.snapshot?.removed_members?.[key] : localDB.removed_members?.[key]) || []
        )
        .map((value: any) => String(value).toLowerCase().trim())
    );
    if ([invEmail, invWallet, invitationId.toLowerCase()].filter(Boolean).some((value) => removed.has(value)))
      return fail(410, "MEMBER_REMOVED", "Lời mời không còn hiệu lực. Hãy liên hệ quản trị viên để được mời lại.");
    const viewerWallet = (getStoredWalletAddress() || "").toLowerCase();
    const viewerRole =
      method === "get" && userId && invWallet === viewerWallet && (invEmail === email || invEmail === invWallet)
        ? await fetchMemberRoleOnChain(wsSlug, viewerWallet)
        : 0;
    const confirmedForViewer = memberRoles.has(viewerRole);
    const publicDetails = {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      wallet_address: invWallet,
      wallet_approval_required: !invWallet || Boolean(inv.wallet_approval_required || inv.chain_approval_failed),
      source_verified: chain.available,
      // The in-app path authenticates by account; do not expose the stored secret.
      accepted: confirmedForViewer,
      responded_at: confirmedForViewer ? inv.responded_at || new Date().toISOString() : null,
      workspace: { id: ws.id, name: ws.name, slug: ws.slug || wsSlug, logo_url: ws.logo_url || "" },
    };
    if (method === "get") return { status: 200, data: publicDetails };
    const accepted = body.accepted === true || body.accepted === "true";
    if (invEmail && !invWallet && !email)
      return fail(401, "AUTH_REQUIRED", "Vui lòng đăng nhập bằng email nhận lời mời.");
    if (!accepted) {
      if (inv.accepted)
        return fail(409, "INVITATION_ALREADY_ACCEPTED", "Bạn đã tham gia. Hãy dùng chức năng rời không gian làm việc.");
      inv = { ...inv, status: "rejected", accepted: false, responded_at: new Date().toISOString() };
    } else {
      const requestedWallet = typeof body.wallet_address === "string" ? body.wallet_address.trim().toLowerCase() : "";
      if (!/^0x[a-f0-9]{40}$/.test(requestedWallet) || /^0x0{40}$/.test(requestedWallet))
        return fail(400, "WALLET_REQUIRED", "Vui lòng chọn ví trước khi tham gia.");
      if (!invWallet || inv.wallet_approval_required || inv.chain_approval_failed)
        return fail(
          409,
          "WALLET_APPROVAL_REQUIRED",
          `Quản trị viên chưa xác nhận ví nhận lời mời. Hãy gửi địa chỉ ${requestedWallet} cho quản trị viên để xác nhận, rồi kiểm tra lại lời mời.`
        );
      const recipientError = validateInvitation(inv, {
        id: invitationId,
        workspaceKeys: keys,
        token,
        email,
        wallet: requestedWallet,
      });
      if (recipientError) return fail(recipientError.status, recipientError.code, recipientError.error);
      try {
        const signer = (await assertVaultSigningAddress(requestedWallet)).toLowerCase();
        if (signer !== requestedWallet)
          return fail(409, "SIGNING_WALLET_CHANGED", "Ví ký đã thay đổi. Hãy chọn lại đúng ví trước khi tham gia.");
        if (!(await joinWorkspaceOnChain(wsSlug, signer)))
          return fail(
            503,
            "MEMBERSHIP_UNCONFIRMED",
            "Chưa xác nhận được quyền thành viên. Vui lòng kiểm tra lại lịch sử ví."
          );
        const role = await fetchMemberRoleOnChain(wsSlug, signer);
        if (!memberRoles.has(role))
          return fail(
            503,
            "MEMBERSHIP_UNCONFIRMED",
            "Chưa đọc được quyền thành viên sau giao dịch. Hãy thử lại để đối soát."
          );
        // Read the source again after signing: the admin may revoke while the
        // user is entering the wallet password. Do not restore the old snapshot.
        const latest = await readWorkspaceSnapshotFromChain(wsSlug, invitationId, token);
        if (!latest.available)
          return fail(
            503,
            "INVITATION_SOURCE_UNAVAILABLE",
            "Giao dịch có thể đã hoàn tất nhưng chưa kiểm tra lại được lời mời. Hãy thử lại để đối soát."
          );
        const latestError = validateInvitation(latest.invitation, {
          id: invitationId,
          workspaceKeys: keys,
          token,
          email,
          wallet: signer,
        });
        const latestDeleted = effectiveInvitationTombstones(
          latest.invitation,
          readInvitationTombstones(),
          latest.snapshot?._deleted_invitation_ids || []
        );
        const latestRemoved = new Set(
          keys
            .flatMap((key) => latest.snapshot?.removed_members?.[key] || [])
            .map((value: any) => String(value).toLowerCase().trim())
        );
        if (
          latestError ||
          isInvitationDeleted(latest.invitation, latestDeleted) ||
          [email, signer, invitationId.toLowerCase()].filter(Boolean).some((value) => latestRemoved.has(value))
        )
          return fail(
            410,
            "INVITATION_REVOKED",
            "Lời mời đã thay đổi hoặc bị thu hồi trong lúc xác nhận. Hãy liên hệ quản trị viên."
          );
        // Apply only the shared source checked above. Restore the existing
        // signed-in user's profile; a snapshot must never switch accounts.
        if (latest.snapshot) applyOffchainDB(latest.snapshot);
        ws = buildWorkspaceFromChainSnapshot(latest, wsSlug) || ws;
        if (!(localDB.workspaces || []).some((entry: any) => entry.id === ws.id)) localDB.workspaces.push(ws);
        const profileIndex = (localDB.users || []).findIndex((entry: any) => entry.id === user.id);
        if (profileIndex < 0) localDB.users.push(user);
        else localDB.users[profileIndex] = { ...localDB.users[profileIndex], ...user };
        const memberRole = role === 1 ? Math.min(Number(inv.role), 15) : 20;
        upsertWorkspaceMemberRecord({
          workspace: ws,
          wsSlug,
          memberId: user.id,
          email,
          wallet: signer,
          role: memberRole,
          verifiedOnChain: true,
        });
        // A verified rejoin supersedes this device's old removal markers. Keep
        // invitation-id/token revocations and every other person's markers.
        const joinedKeys = new Set([...keys, ...getInvitationWorkspaceKeys(latest.invitation)]);
        const joinedIdentifiers = new Set(
          [email, signer, user.id, invitationId].map((value) => String(value).toLowerCase())
        );
        for (const key of joinedKeys) {
          if (localDB.removed_members?.[key])
            localDB.removed_members[key] = localDB.removed_members[key].filter(
              (value: string) => !joinedIdentifiers.has(String(value).toLowerCase().trim())
            );
        }
        const activeUser = localDB.users.find((entry: any) => entry.id === user.id);
        Object.assign(activeUser, {
          last_workspace_id: ws.id,
          last_workspace_slug: ws.slug || wsSlug,
          is_onboarded: true,
        });
        inv = {
          ...latest.invitation,
          accepted: true,
          verified_on_chain: true,
          wallet_address: signer,
          status: "accepted",
          responded_at: new Date().toISOString(),
        };
      } catch (error) {
        return fail(
          503,
          "MEMBERSHIP_UNCONFIRMED",
          error instanceof Error
            ? error.message
            : "Chưa xác nhận được quyền thành viên. Dữ liệu lời mời được giữ lại để thử lại."
        );
      }
    }
    if (!localDB.invitations) localDB.invitations = [];
    const index = localDB.invitations.findIndex(matches);
    if (index >= 0) localDB.invitations[index] = inv;
    else localDB.invitations.push(inv);
    saveStoredInvitations(localDB.invitations);
    saveDB();
    dappSyncChannel?.postMessage({
      type: "SYNC_STATE",
      members: localDB.workspace_members || [],
      invitations: localDB.invitations || [],
    });
    // No shared snapshot write here: an invitee cannot publish an admin's state
    // on behalf of everyone. The chain is authoritative for membership.
    return {
      status: 200,
      data: {
        ...publicDetails,
        accepted,
        verified_on_chain: accepted,
        message: accepted ? "Đã xác nhận quyền thành viên." : "Đã từ chối lời mời trên thiết bị này.",
      },
    };
  });
}

/**
 * Everything an invitee's browser can learn about a workspace without having
 * ever opened the admin's local database: the registry entry plus the snapshot
 * pinned through IPFS.
 */
export type ChainWorkspaceSnapshot = {
  /** Invitation record from the snapshot (`null` when the snapshot has none). */
  invitation: any | null;
  /** Snapshot payload (`null` when it could not be read). */
  snapshot: Record<string, any> | null;
  /** IPFS CID the payload was read from. */
  cid: string;
  /** Block timestamp (seconds) of the registry entry pointing at `cid`; `0` when unknown. */
  chainUpdatedAt: number;
  /** Registry entry exists and carries a payload CID. */
  available: boolean;
  /** `true` when the registry knows the workspace (even without a payload CID). */
  registered: boolean;
  /** Workspace name stored in the registry (typed by the owner). */
  name: string;
  /** Owner address stored in the registry. */
  owner: string;
};

/**
 * Read the authoritative on-chain snapshot of a workspace.
 *
 * Invitation links are opened on the invitee's browser, which has no local copy
 * of the admin's database. Instead of synthesising records (which used to
 * fabricate workspaces/owners), we read the workspace CID from the registry and
 * use that payload as the source of truth.
 */
export async function readWorkspaceSnapshotFromChain(
  wsSlug: string,
  invitationId = "",
  token = ""
): Promise<ChainWorkspaceSnapshot> {
  const empty: ChainWorkspaceSnapshot = {
    invitation: null,
    snapshot: null,
    cid: "",
    chainUpdatedAt: 0,
    available: false,
    registered: false,
    name: "",
    owner: "",
  };
  try {
    if (!wsSlug) return empty;
    const registryAddress = getWorkspaceRegistryAddress();
    if (!registryAddress) return empty;

    const raw = await directRpcRead(registryAddress, abiEncodeGetWorkspace(wsSlug), 5000);
    const info = decodeAbiWorkspace(raw);
    const cid = String(info?.ipfsCID || "").trim();
    const chainUpdatedAt = Number(info?.updatedAt || 0);
    const registry = {
      name: String(info?.name || "").trim(),
      owner: String(info?.owner || "").trim(),
      registered: Boolean(info?.name && info?.name !== "" && info?.name !== "undefined"),
    };
    if (!cid) return { ...empty, chainUpdatedAt, ...registry };

    const snapshot = await fetchFromIPFS(cid);
    if (!snapshot) return { ...empty, cid, chainUpdatedAt, ...registry };

    const invitations: any[] = Array.isArray(snapshot.invitations) ? snapshot.invitations : [];
    const wsKey = String(wsSlug).toLowerCase().trim();
    const invitation =
      invitations.find((inv: any) => {
        const invWsKeys = getInvitationWorkspaceKeys(inv);
        if (invWsKeys.length > 0 && !invWsKeys.includes(wsKey)) return false;
        const idHit = Boolean(invitationId) && String(inv.id) === String(invitationId);
        const tokenHit = Boolean(token) && String(inv.token) === String(token);
        return idHit || tokenHit;
      }) || null;

    return { ...registry, invitation, snapshot, cid, chainUpdatedAt, available: true };
  } catch (err) {
    console.warn("[DApp Routes] Unable to read the on-chain workspace snapshot:", err);
    return empty;
  }
}

/**
 * Recover an invitation from the workspace snapshot pinned on-chain.
 *
 * Returns `null` when the registry/snapshot is unavailable OR when the snapshot
 * simply does not contain this invitation — callers must not fall back to
 * inventing a record (see `readWorkspaceSnapshotFromChain` for the raw state).
 */
export async function recoverInvitationFromChainSnapshot(
  wsSlug: string,
  invitationId: string,
  token: string
): Promise<any | null> {
  if (!wsSlug || (!invitationId && !token)) return null;
  const chainSnapshot = await readWorkspaceSnapshotFromChain(wsSlug, invitationId, token);
  return chainSnapshot.invitation;
}

/** Local workspace record for a slug or id (never synthesised). */
export function findLocalWorkspace(slugOrId: string | null | undefined): any | null {
  const key = String(slugOrId || "")
    .toLowerCase()
    .trim();
  if (!key) return null;
  return resolveInvitationWorkspace(localDB.workspaces || [], key);
}

/**
 * Build the missing workspace record out of *real* on-chain data (the name and
 * owner the admin typed into `createWorkspace`, plus the on-chain `updatedAt`).
 *
 * Used when an invitee opens a link on a browser that has never seen the
 * workspace. It deliberately does not invent an organisation size, owner email
 * or "Admin" profile — the snapshot (when available) or the registry win.
 */
export function buildWorkspaceFromChainSnapshot(chain: ChainWorkspaceSnapshot, wsSlug: string): any | null {
  const slug = String(wsSlug || "")
    .toLowerCase()
    .trim();
  if (!slug) return null;

  const snapshotWorkspaces = chain.snapshot?.workspaces;
  const fromSnapshot = resolveInvitationWorkspace(
    Array.isArray(snapshotWorkspaces) ? snapshotWorkspaces : [],
    slug,
    chain.invitation
  );
  if (fromSnapshot) return { ...fromSnapshot };

  if (!chain.registered && !chain.name) return null;

  const timestamp =
    chain.chainUpdatedAt > 0 ? new Date(chain.chainUpdatedAt * 1000).toISOString() : new Date().toISOString();
  return {
    id: slug,
    slug,
    name: chain.name || slug,
    owner: chain.owner || "",
    created_by: chain.owner || "",
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/**
 * Upsert a workspace member record keyed by *every* identifier the app matches
 * membership on.
 *
 * The previous implementation stored the placeholder id (`workspace-<slug>`)
 * whenever the invitee's browser had no local copy of the workspace. As soon as
 * the real workspace record arrived (snapshot hydration / registry read) the
 * membership no longer matched any key, so the freshly joined member was locked
 * out of the workspace they had just accepted.
 */
export function upsertWorkspaceMemberRecord(input: {
  workspace: any | null;
  wsSlug: string;
  memberId: string;
  email: string;
  wallet?: string;
  role?: number;
  verifiedOnChain?: boolean;
  createdAt?: string;
}): any {
  const wsSlug = String(input.wsSlug || "")
    .toLowerCase()
    .trim();
  const wsId = String(input.workspace?.id || wsSlug);
  const email = String(input.email || "")
    .toLowerCase()
    .trim();
  const wallet = String(input.wallet || "")
    .toLowerCase()
    .trim();
  const memberId = String(input.memberId || email || wallet);
  const workspaceKeys = new Set([
    wsId,
    wsSlug,
    String(input.workspace?.slug || "")
      .toLowerCase()
      .trim(),
  ]);
  workspaceKeys.delete("");

  if (!localDB.workspace_members) localDB.workspace_members = [];

  const matchesWorkspace = (m: any) => {
    const keys = [
      m?.workspace,
      m?.workspace_id,
      m?.workspace_slug,
      typeof m?.workspace === "object" ? m?.workspace?.id : null,
      typeof m?.workspace === "object" ? m?.workspace?.slug : null,
    ]
      .filter(Boolean)
      .map((v: any) => String(v).toLowerCase().trim());
    return keys.some((k) => workspaceKeys.has(k));
  };
  const matchesMember = (m: any) =>
    (memberId && String(m?.member || "") === memberId) ||
    (email &&
      String(m?.email || "")
        .toLowerCase()
        .trim() === email) ||
    (wallet &&
      (String(m?.wallet_address || "")
        .toLowerCase()
        .trim() === wallet ||
        String(m?.member || "")
          .toLowerCase()
          .trim() === wallet));

  const existingIdx = localDB.workspace_members.findIndex((m: any) => matchesWorkspace(m) && matchesMember(m));
  const previous = existingIdx >= 0 ? localDB.workspace_members[existingIdx] : null;
  const hasExplicitRole = input.role !== undefined && input.role !== null && Number(input.role) > 0;

  const record: any = {
    id: previous?.id || `ws-member-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    workspace: wsId,
    workspace_id: wsId,
    workspace_slug: wsSlug,
    member: memberId,
    email,
    role: hasExplicitRole ? Number(input.role) : Number(previous?.role || 15),
    is_active: true,
    verified_on_chain: Boolean(previous?.verified_on_chain || input.verifiedOnChain),
    created_at: previous?.created_at || input.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (wallet) record.wallet_address = wallet;

  if (previous) {
    record.wallet_address = record.wallet_address || previous.wallet_address;
    localDB.workspace_members[existingIdx] = { ...previous, ...record, is_active: true };
    return localDB.workspace_members[existingIdx];
  }

  localDB.workspace_members.push(record);
  return record;
}
