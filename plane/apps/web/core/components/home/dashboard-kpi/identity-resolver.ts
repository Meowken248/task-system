export type ResolvedIdentity = {
  displayName: string;
  email?: string;
  wallet?: string;
  shortWallet?: string;
  avatarUrl?: string;
  isCurrentUser: boolean;
};

export function normalizeWallet(wallet?: string): string | undefined {
  if (!wallet) return undefined;
  const trimmed = wallet.trim().toLowerCase();
  if (/^0x[0-9a-f]{40}$/.test(trimmed)) return trimmed;
  if (/^[0-9a-f]{40}$/.test(trimmed)) return `0x${trimmed}`;
  return undefined;
}

export function formatShortWallet(wallet?: string): string {
  const norm = normalizeWallet(wallet);
  if (!norm) return wallet && wallet.length > 12 ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : wallet || "";
  return `${norm.slice(0, 6)}...${norm.slice(-4)}`;
}

export function resolveMemberIdentity(
  target: {
    assignee_wallet?: string;
    assignee_id?: string;
    assignee_name?: string;
    reporter_id?: string;
    reporter_name?: string;
    wallet_address?: string;
  },
  workspaceMembers: any[] = [],
  currentUser?: { id?: string; display_name?: string; first_name?: string; email?: string; wallet_address?: string }
): ResolvedIdentity {
  const targetWallet = normalizeWallet(target.assignee_wallet || target.wallet_address);
  const targetId = target.assignee_id || target.reporter_id;
  const explicitName = (target.assignee_name || target.reporter_name || "").trim();

  // 1. So khớp với currentUser: CHỈ khớp khi ví trùng (hoặc không có ví và ID trùng)
  const currentWallet = normalizeWallet(currentUser?.wallet_address);
  let isMatchCurrent = false;

  if (targetWallet && currentWallet) {
    isMatchCurrent = targetWallet === currentWallet;
  } else if (!targetWallet && targetId && currentUser?.id) {
    isMatchCurrent = targetId === currentUser.id;
  }

  // 2. So khớp trong danh sách thành viên workspace
  let matchedMember: any = undefined;
  for (const m of workspaceMembers) {
    const memDetail = typeof m.member === "object" && m.member ? m.member : m;
    const memWallet = normalizeWallet(
      memDetail.wallet_address || memDetail.metanode_wallet_address || m.wallet_address || m.metanode_wallet_address
    );
    const memId = memDetail.id || m.id;

    if (targetWallet) {
      // Khi CÓ targetWallet: CHỈ khớp nếu thành viên này có ví trùng với targetWallet!
      if (memWallet && targetWallet === memWallet) {
        matchedMember = memDetail;
        break;
      }
      // Nếu ID trùng nhưng ví thành viên khác targetWallet -> BỎ QUA (xung đột ví)
    } else if (targetId && memId && targetId === memId) {
      // Khi KHÔNG có targetWallet: so khớp theo ID
      matchedMember = memDetail;
      break;
    }
  }

  // 3. Nếu tìm thấy member khớp và phù hợp ví
  if (matchedMember) {
    const name =
      matchedMember.display_name?.trim() ||
      [matchedMember.first_name, matchedMember.last_name].filter(Boolean).join(" ").trim() ||
      matchedMember.email ||
      (targetWallet ? formatShortWallet(targetWallet) : "Chưa xác định");

    return {
      displayName: name,
      email: matchedMember.email,
      wallet: targetWallet || normalizeWallet(matchedMember.wallet_address),
      shortWallet: formatShortWallet(targetWallet || matchedMember.wallet_address),
      avatarUrl: matchedMember.avatar,
      isCurrentUser: isMatchCurrent,
    };
  }

  // 4. Nếu khớp với tài khoản đang đăng nhập (đã xác nhận ví trùng khớp)
  if (isMatchCurrent && currentUser) {
    const name =
      currentUser.display_name?.trim() ||
      currentUser.first_name?.trim() ||
      currentUser.email ||
      (currentWallet ? formatShortWallet(currentWallet) : "Chưa xác định");

    return {
      displayName: name,
      email: currentUser.email,
      wallet: currentWallet,
      shortWallet: formatShortWallet(currentWallet),
      isCurrentUser: true,
    };
  }

  // 5. Nếu có tên hiển thị rõ ràng và không bị xung đột với targetWallet
  // (Nếu có targetWallet mà explicitName là tên của người khác thì không dùng bừa)
  if (explicitName && explicitName !== "Nhân viên được giao" && explicitName !== "Nhân viên" && !targetWallet) {
    return {
      displayName: explicitName,
      wallet: targetWallet,
      shortWallet: targetWallet ? formatShortWallet(targetWallet) : undefined,
      isCurrentUser: false,
    };
  }

  // 6. Fallback về ví rút gọn
  if (targetWallet) {
    return {
      displayName: formatShortWallet(targetWallet),
      wallet: targetWallet,
      shortWallet: formatShortWallet(targetWallet),
      isCurrentUser: false,
    };
  }

  // 7. Hoàn toàn không xác định được
  return {
    displayName: "Chưa xác định",
    isCurrentUser: false,
  };
}
