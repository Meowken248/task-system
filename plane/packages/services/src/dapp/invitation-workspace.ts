/** Resolve an invitation's actual workspace before considering legacy slug placeholders. */
const clean = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .trim();

export function resolveInvitationWorkspace(workspaces: any[], slugOrId: string, invitation?: any): any | null {
  const key = clean(slugOrId);
  if (!key) return null;
  const candidates = workspaces.filter((workspace) => clean(workspace?.slug) === key || clean(workspace?.id) === key);
  const invitationId = clean(invitation?.workspace_id || invitation?.workspace?.id);
  return (
    candidates.find((workspace) => invitationId && clean(workspace.id) === invitationId) ||
    candidates.find((workspace) => clean(workspace.id) === key) ||
    candidates.find((workspace) => clean(workspace.id) !== `workspace-${key}`) ||
    candidates[0] ||
    null
  );
}
