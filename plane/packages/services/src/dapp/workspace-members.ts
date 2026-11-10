const normalized = (value: unknown): string => (typeof value === "string" ? value.toLowerCase().trim() : "");
const walletOf = (...values: unknown[]): string =>
  values.map(normalized).find((value) => /^0x[0-9a-f]{40}$/.test(value)) || "";
const usableId = (value: unknown): string =>
  typeof value === "string" && !["user-default", "owner-default"].includes(value) ? value : "";

/** One presentation row per identity. Invitations are never membership evidence. */
export function listWorkspaceMembers(db: Record<string, any>, slug: string, workspaceId?: string): any[] {
  const workspaces: any[] = db.workspaces || [];
  const users: any[] = db.users || [];
  const candidates = workspaces.filter(
    (ws) => ws.slug === slug || ws.id === slug || (workspaceId && ws.id === workspaceId)
  );
  const ws =
    candidates.find((entry) => workspaceId && entry.id === workspaceId) ||
    candidates.find((entry) => entry.id !== `workspace-${slug}`) ||
    candidates[0];
  if (!ws) return [];
  const keys = new Set([slug, workspaceId, ws.slug, ws.id].filter(Boolean));
  const legacyKey = `workspace-${ws.slug}`;
  if (!workspaces.some((entry) => entry.id === legacyKey && entry.slug !== ws.slug)) keys.add(legacyKey);
  const removed = new Set([...keys].flatMap((key) => db.removed_members?.[key] || []).map(normalized));
  const owner = typeof ws.owner === "object" && ws.owner ? ws.owner : {};
  const ownerId = usableId(owner.id) || usableId(ws.created_by);
  const ownerWallet = walletOf(
    ws.owner,
    ws.owner_wallet,
    ws.created_by_wallet,
    owner.wallet_address,
    owner.metanode_wallet_address,
    owner.id,
    ws.created_by
  );
  const rows = new Map<string, any>();
  const rolePriority = new Map<string, number>();

  const add = (record: any, isOwner = false) => {
    if (
      record.is_active === false ||
      record.verified_on_chain === false ||
      record.chain_sync_pending === true ||
      record.role === 0
    )
      return;
    const detail = typeof record.member === "object" && record.member ? record.member : {};
    const memberId = usableId(detail.id) || usableId(record.member);
    const directWallet = walletOf(
      record.wallet_address,
      record.metanode_wallet_address,
      detail.wallet_address,
      detail.metanode_wallet_address,
      memberId
    );
    const email = normalized(record.email || detail.email);
    const profile = users.find((user) => {
      const profileWallet = walletOf(user.wallet_address, user.metanode_wallet_address, user.id);
      if (directWallet) return directWallet === profileWallet;
      return user.id === memberId || Boolean(email && normalized(user.email) === email);
    });
    const wallet = directWallet || walletOf(profile?.wallet_address, profile?.metanode_wallet_address);
    const id = usableId(profile?.id) || wallet || memberId;
    const profileEmail = normalized(profile?.email || email);
    const identifiers = [normalized(record.id), normalized(memberId), profileEmail, wallet].filter(Boolean);
    if (!isOwner && identifiers.some((value) => removed.has(value))) return;
    if (profile?.is_bot || detail.is_bot || record.is_bot) return;
    const key = wallet ? `wallet:${wallet}` : id ? `user:${id}` : profileEmail ? `email:${profileEmail}` : "";
    if (!key) return;
    const displayEmail = /@(metanode\.chain|fiai\.network)$/.test(profileEmail) ? "" : profileEmail;
    const shortWallet = wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "Member";
    const member = Object.assign({}, detail, profile || {}, {
      id: id || `email:${profileEmail}`,
      email: displayEmail,
      first_name: profile?.first_name || detail.first_name || record.first_name || shortWallet,
      last_name: profile?.last_name || detail.last_name || record.last_name || "",
      display_name: profile?.display_name || detail.display_name || record.display_name || shortWallet,
      avatar_url: profile?.avatar_url || detail.avatar_url || "",
      is_active: true,
      ...(wallet ? { metanode_wallet_address: wallet } : {}),
    });
    const existing = rows.get(key);
    const hasChainRole = record.verified_on_chain === true && [1, 2, 3].includes(record.on_chain_role);
    const priority = isOwner ? 2 : hasChainRole ? 1 : 0;
    const candidateRole = isOwner
      ? 20
      : hasChainRole
        ? record.on_chain_role >= 2
          ? 20
          : 15
        : Number(record.role) || 15;
    const previousPriority = rolePriority.get(key) ?? -1;
    const role =
      !existing || priority > previousPriority
        ? candidateRole
        : priority < previousPriority
          ? existing.role
          : Math.min(existing.role, candidateRole);
    rolePriority.set(key, Math.max(priority, previousPriority));
    rows.set(key, {
      id: existing?.id || record.id || `ws-member-${member.id}`,
      member: existing?.member.email && !member.email ? existing.member : member,
      role,
      workspace: ws.id,
      wallet_address: wallet || undefined,
      is_active: true,
      created_at: existing?.created_at || record.created_at || ws.created_at,
    });
  };

  if (ownerId || ownerWallet)
    add({ member: Object.assign({}, owner, { id: ownerId }), wallet_address: ownerWallet, role: 20 }, true);
  for (const record of db.workspace_members || []) {
    if (keys.has(record.workspace) || keys.has(record.workspace_id)) add(record);
  }
  return [...rows.values()];
}
