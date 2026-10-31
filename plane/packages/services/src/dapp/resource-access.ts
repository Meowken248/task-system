import { localDB, getLoggedInUserId } from "./store";
import {
  getWorkspaceRegistryAddress,
  getStoredWalletAddress,
  assertVaultSigningAddress,
  fetchMemberRoleOnChain,
  canManageWorkspaceOnChain,
} from "./chain";
import { listWorkspaceMembers } from "./workspace-members";

export class ResourceAccessError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const deny = () => new ResourceAccessError(403, "NOT_AUTHORIZED", "Bạn không có quyền thực hiện thao tác này.");
const normalized = (value: unknown) => typeof value === "string" ? value.toLowerCase().trim() : "";

export function authenticatedResourceUser(): any {
  const id = getLoggedInUserId();
  if (!id) throw new ResourceAccessError(401, "AUTH_REQUIRED", "Vui lòng đăng nhập.");
  const user = (localDB.users || []).find((entry: any) => entry.id === id);
  if (!user) throw new ResourceAccessError(401, "AUTH_REQUIRED", "Vui lòng đăng nhập lại.");
  return user;
}

export function resourceWorkspace(key: string): any {
  const ws = (localDB.workspaces || []).find((entry: any) => entry.id === key || entry.slug === key);
  if (!ws || (localDB._deleted_workspace_ids || []).includes(ws.id) || (localDB._deleted_workspace_slugs || []).includes(ws.slug))
    throw new ResourceAccessError(404, "NOT_FOUND", "Không tìm thấy không gian làm việc.");
  return ws;
}

export function resourceProject(ws: any, key: string): any {
  const candidates = (localDB.projects || []).filter((entry: any) => entry.id === key || entry.identifier === key);
  const project = candidates.find((entry: any) => [ws.id, ws.slug].includes(entry.workspace || entry.workspace_id)) || candidates[0];
  if (!project || (localDB._deleted_project_ids || []).includes(project.id))
    throw new ResourceAccessError(404, "NOT_FOUND", "Không tìm thấy dự án.");
  if (![ws.id, ws.slug].includes(project.workspace || project.workspace_id)) throw deny();
  return project;
}

/** Chain roles take precedence over cached profiles whenever a registry is configured. */
export async function requireWorkspaceAccess(key: string, manage = false): Promise<{ user: any; workspace: any; role: number }> {
  const user = authenticatedResourceUser();
  const workspace = resourceWorkspace(key);
  const wallet = normalized(getStoredWalletAddress());
  let role = 0;
  if (getWorkspaceRegistryAddress()) {
    if (!/^0x[0-9a-f]{40}$/.test(wallet))
      throw new ResourceAccessError(409, "WALLET_REQUIRED", "Hãy chọn ví để kiểm tra quyền truy cập.");
    try {
      if (manage) {
        const signer = await assertVaultSigningAddress(wallet);
        if (normalized(signer) !== wallet)
          throw new ResourceAccessError(409, "SIGNING_WALLET_CHANGED", "Ví đã thay đổi. Hãy chọn lại ví rồi thử lại.");
        role = await canManageWorkspaceOnChain(workspace.slug, signer) ? 20 : 0;
      } else {
        const chainRole = await fetchMemberRoleOnChain(workspace.slug, wallet);
        if (chainRole < 0) throw new Error("Không đọc được quyền trên chain.");
        role = chainRole >= 2 ? 20 : chainRole === 1 ? 15 : 0;
      }
      if (normalized(getStoredWalletAddress()) !== wallet)
        throw new ResourceAccessError(409, "SIGNING_WALLET_CHANGED", "Ví đã thay đổi. Hãy thử lại.");
    } catch (error) {
      if (error instanceof ResourceAccessError) throw error;
      throw new ResourceAccessError(503, "PERMISSION_UNAVAILABLE", "Chưa kiểm tra được quyền truy cập. Hãy thử lại sau.");
    }
  } else {
    // Local-only installations still need an explicit session and canonical membership.
    const member = listWorkspaceMembers(localDB, workspace.slug, workspace.id).find((entry: any) =>
      wallet ? normalized(entry.wallet_address || entry.member?.metanode_wallet_address) === wallet : entry.member?.id === user.id
    );
    role = Number(member?.role) || 0;
  }
  if (getLoggedInUserId() !== user.id)
    throw new ResourceAccessError(401, "AUTH_REQUIRED", "Phiên đăng nhập đã thay đổi. Hãy thử lại.");
  if (role < (manage ? 20 : 5)) throw deny();
  return { user, workspace, role };
}

export async function requireProjectAccess(workspaceKey: string, projectKey: string, write = false) {
  const access = await requireWorkspaceAccess(workspaceKey);
  const project = resourceProject(access.workspace, projectKey);
  const wallet = normalized(getStoredWalletAddress());
  const member = (localDB.project_members || []).find((entry: any) =>
    (entry.project || entry.project_id) === project.id && entry.is_active !== false && Number(entry.role) !== 0 &&
    (wallet ? normalized(entry.wallet_address || entry.member?.metanode_wallet_address || entry.member) === wallet ||
      ((entry.member?.id || entry.member) === access.user.id && normalized(access.user.metanode_wallet_address || access.user.wallet_address) === wallet)
      : (entry.member?.id || entry.member) === access.user.id)
  );
  const creator = project.created_by || project.owner?.id || project.owner;
  const profileMatchesWallet = !wallet || normalized(access.user.metanode_wallet_address || access.user.wallet_address) === wallet;
  const isCreator = Boolean((wallet && normalized(creator) === wallet) || (profileMatchesWallet && creator === access.user.id));
  if (access.role < 20 && project.network === 0 && !member && !isCreator) throw deny();
  // Workspace Admin wins over stale project rows. A workspace guest cannot
  // gain write access merely because a cached project row claims Admin.
  const projectRole = access.role >= 20 ? 20 : access.role >= 15
    ? isCreator ? 20 : Number(member?.role) || 15
    : Math.min(access.role, Number(member?.role) || access.role);
  if (write && projectRole < 15) throw deny();
  return { ...access, project, projectRole };
}

export async function requireIssueAccess(workspaceKey: string, projectKey: string, issueKey: string, write = false) {
  const access = await requireProjectAccess(workspaceKey, projectKey, write);
  const issue = (localDB.issues || []).find((entry: any) => entry.id === issueKey);
  if (!issue || (localDB._deleted_issue_ids || []).includes(issue.id))
    throw new ResourceAccessError(404, "NOT_FOUND", "Không tìm thấy công việc.");
  if ((issue.project || issue.project_id) !== access.project.id) throw deny();
  return { ...access, issue };
}
