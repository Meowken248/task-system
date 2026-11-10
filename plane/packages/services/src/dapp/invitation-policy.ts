/** Rules shared by link and bulk invitation responses. */
import { isInvitationTokenExpired } from "./invitation-tokens";
import { getInvitationWorkspaceKeys } from "./invitation-tombstones";

const clean = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase();

export function invitationLink(slug: string, id: string, token: string): string {
  return `/workspace-invitations?${new URLSearchParams({ invitation_id: id, slug, token })}`;
}

export function validateInvitation(
  record: any,
  input: {
    id: string;
    workspaceKeys: string[];
    token?: string;
    email?: string;
    wallet?: string;
    now?: number;
    checkRecipient?: boolean;
  }
): { code: string; status: number; error: string } | null {
  if (
    !record ||
    String(record.id) !== input.id ||
    !getInvitationWorkspaceKeys(record).some((key) => input.workspaceKeys.map(clean).includes(key))
  ) {
    return {
      code: "INVITATION_NOT_FOUND",
      status: 404,
      error: "Không tìm thấy lời mời trong không gian làm việc này.",
    };
  }
  if (
    ["revoked", "rejected"].includes(record.status) ||
    record.revoked_at ||
    (record.responded_at && !record.accepted)
  ) {
    return { code: "INVITATION_REVOKED", status: 410, error: "Lời mời đã bị thu hồi hoặc từ chối." };
  }
  if (isInvitationTokenExpired(record, input.now))
    return {
      code: "INVITATION_EXPIRED",
      status: 410,
      error: "Lời mời đã hết hạn. Hãy liên hệ quản trị viên để được mời lại.",
    };
  const recipient = clean(record.email);
  const wallet = clean(record.wallet_address || (/^0x[a-f0-9]{40}$/i.test(recipient) ? recipient : ""));
  const email = wallet && recipient === wallet ? "" : recipient;
  if (record.token && (input.token ? input.token !== record.token : !email || clean(input.email) !== email)) {
    return {
      code: "INVITATION_TOKEN_MISMATCH",
      status: 403,
      error: "Liên kết mời không hợp lệ hoặc bạn chưa đăng nhập đúng tài khoản.",
    };
  }
  if (!record.token && record.token_version === 2)
    return { code: "INVITATION_TOKEN_MISMATCH", status: 403, error: "Lời mời chưa có liên kết hợp lệ." };
  if (input.checkRecipient !== false && input.email && email && clean(input.email) !== email)
    return {
      code: "INVITATION_EMAIL_MISMATCH",
      status: 403,
      error: "Vui lòng đăng nhập bằng đúng email nhận lời mời.",
    };
  if (input.wallet && wallet && clean(input.wallet) !== wallet)
    return { code: "INVITATION_WALLET_MISMATCH", status: 403, error: "Vui lòng chọn đúng ví nhận lời mời." };
  if (![5, 10, 15, 20].includes(Number(record.role)))
    return { code: "INVITATION_ROLE_INVALID", status: 403, error: "Quyền trong lời mời không hợp lệ." };
  return null;
}

const invitationQueues = new Map<string, Promise<unknown>>();

/** Separate lock: calling the transaction gateway from its own lock would deadlock. */
export function withInvitationLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (invitationQueues.get(key) || Promise.resolve()).catch(() => undefined).then(task);
  invitationQueues.set(key, run);
  void run
    .finally(() => {
      if (invitationQueues.get(key) === run) invitationQueues.delete(key);
    })
    .catch(() => undefined);
  return run;
}
