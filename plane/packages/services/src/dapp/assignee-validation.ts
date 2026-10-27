/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Work item assignee validation (D-B), browser-free and unit testable.
 *
 * Business rule: a work item assignee must belong to the project, and that
 * project member must already belong to the workspace (enforced when the
 * project membership is created).
 */

export type AssigneeValidationSource = {
  projects?: any[];
  projectMembers?: any[];
  users?: any[];
};

const normalize = (value: any): string => String(value ?? "").toLowerCase().trim();

/**
 * Returns the assignee ids that are NOT members of the given project.
 *
 * Only ids that are being newly assigned are validated (`alreadyAssigned` is
 * skipped) so editing an existing work item whose assignee later left the
 * project still saves.
 *
 * An empty array means "valid" (or not verifiable, e.g. no project_members).
 */
export function findNonProjectAssignees(
  projectId: string | undefined | null,
  assigneeIds: any[],
  alreadyAssigned: any[] = [],
  source: AssigneeValidationSource = {}
): string[] {
  if (!projectId || !Array.isArray(assigneeIds) || assigneeIds.length === 0) return [];
  const projects = source.projects || [];
  const projectMembers = source.projectMembers || [];
  const users = source.users || [];

  const project = projects.find(
    (p: any) => p?.id === projectId || (p?.identifier && normalize(p.identifier) === normalize(projectId))
  );
  const canonicalProjectId = project?.id || projectId;

  const allowed = new Set<string>();
  projectMembers
    .filter((pm: any) => pm?.project === canonicalProjectId || pm?.project_id === canonicalProjectId)
    .forEach((pm: any) => {
      const member = typeof pm?.member === "object" && pm?.member?.id ? pm.member.id : pm?.member;
      if (member) allowed.add(normalize(member));
      [pm?.member?.email, pm?.member_detail?.id, pm?.member_detail?.email, pm?.email]
        .filter(Boolean)
        .forEach((k: any) => allowed.add(normalize(k)));
    });
  if (project?.created_by) allowed.add(normalize(project.created_by));

  // No membership data (legacy project) - nothing to validate against.
  if (allowed.size === 0) return [];

  const already = new Set(alreadyAssigned.map(normalize));
  return assigneeIds
    .map((x) => String(typeof x === "object" && x?.id ? x.id : x))
    .filter((id) => {
      const key = normalize(id);
      if (!key || already.has(key)) return false;
      if (allowed.has(key)) return false;
      const user = users.find((u: any) => normalize(u?.id) === key);
      if (user?.email && allowed.has(normalize(user.email))) return false;
      return true;
    });
}

/** Human readable labels for the assignees that were rejected. */
export function describeInvalidAssignees(invalidIds: string[], source: AssigneeValidationSource = {}): string[] {
  const users = source.users || [];
  return invalidIds.map((id) => {
    const key = normalize(id);
    const user = users.find((u: any) => normalize(u?.id) === key || normalize(u?.email) === key);
    return user?.display_name || user?.email || id;
  });
}
