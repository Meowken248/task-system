/** Local recovery markers only. They never establish membership or grant a role. */
const memory = new Set<string>();
export function walletMemberOperationPending(key: string): boolean {
  if (memory.has(key)) return true;
  for (const store of stores()) {
    try {
      if (store.getItem(key)) return true;
    } catch {
      /* Continue to another local store. */
    }
  }
  return false;
}
function stores(): Storage[] {
  const available: Storage[] = [];
  try {
    if (typeof localStorage !== "undefined") available.push(localStorage);
  } catch {
    /* Storage may be blocked. */
  }
  try {
    if (typeof sessionStorage !== "undefined") available.push(sessionStorage);
  } catch {
    /* Storage may be blocked. */
  }
  return available;
}
export function setWalletMemberOperationPending(key: string): void {
  let durable = false;
  for (const store of stores()) {
    try {
      store.setItem(key, "pending");
      durable = true;
    } catch {
      /* Try the other local store. */
    }
  }
  if (!durable)
    throw new Error("Không lưu được tiến trình trên trình duyệt. Chưa gửi giao dịch; hãy kiểm tra dung lượng lưu trữ.");
  memory.add(key);
}
export function clearWalletMemberOperationPending(key: string): void {
  memory.delete(key);
  for (const store of stores()) {
    try {
      store.removeItem(key);
    } catch {
      /* A stale marker only blocks a retry; it cannot grant rights. */
    }
  }
}
