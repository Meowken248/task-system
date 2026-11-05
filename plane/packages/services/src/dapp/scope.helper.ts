/**
 * Scope & Merge Helpers for Decentralized Plane DApp
 * Handles deterministic object serialization, LWW tie-breaking,
 * legacy/current scope resolution, and active work item guards.
 */

import { localDB } from "./store";

const scopeId = (value: unknown): string => typeof value === "string" ? value.trim() : "";

/**
 * Deterministically serialize any JavaScript value by sorting object keys recursively.
 * Guarantees identical JSON strings for objects with identical contents regardless of key order.
 */
export function canonicalStringify(value: any): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalStringify(item)).join(",") + "]";
  }
  const keys = Object.keys(value).toSorted();
  const pairs = keys
    .filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`);
  return "{" + pairs.join(",") + "}";
}

/**
 * Extract epoch milliseconds from a record's updated_at or created_at timestamp.
 */
export function getRecordTimestamp(record: any): number {
  if (!record || typeof record !== "object") return 0;
  const raw = record.updated_at || record.created_at;
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Preserve causal ordering for consecutive writes, even within one millisecond. */
export function nextRecordTimestamp(record: any): string {
  return new Date(Math.max(Date.now(), getRecordTimestamp(record) + 1)).toISOString();
}

/**
 * Compares two records using Last-Write-Wins (LWW).
 * If timestamps are strictly equal (or both missing), breaks the tie deterministically
 * using canonical JSON comparison.
 * Note: Canonical string tie-breaking guarantees eventual consistency across all peers,
 * but does not reconstruct true wall-clock ordering in the presence of uncoordinated clock skew.
 */
export function mergeRecordLWW<T extends Record<string, any>>(localRecord: T, incomingRecord: T): T {
  if (!localRecord) return incomingRecord;
  if (!incomingRecord) return localRecord;

  const localTime = getRecordTimestamp(localRecord);
  const incomingTime = getRecordTimestamp(incomingRecord);

  if (localTime > incomingTime) {
    return localRecord;
  }
  if (incomingTime > localTime) {
    return incomingRecord;
  }

  // Deterministic tie-breaker
  const localStr = canonicalStringify(localRecord);
  const incomingStr = canonicalStringify(incomingRecord);
  return localStr >= incomingStr ? localRecord : incomingRecord;
}

/**
 * Validates that an entity belongs to a specified project and/or workspace.
 * Normalizes both current and legacy property naming:
 * - Project: entity.project_id || entity.project, or entity.project_ids (for Pages)
 * - Workspace: entity.workspace_id || entity.workspace || entity.workspace_slug
 *
 * Strict safety rules:
 * 1. Both target and entity identifiers must be non-empty strings.
 * 2. Missing target criteria cannot match missing entity fields (no `undefined === undefined`).
 * 3. Returns false if no scope criteria were provided.
 */
export function isValidScope(
  entity: any,
  targetProjectId?: string | null,
  targetWorkspaceIdOrSlug?: string | null
): boolean {
  if (!entity || typeof entity !== "object") return false;

  const cleanTargetProj = typeof targetProjectId === "string" ? targetProjectId.trim() : "";
  const cleanTargetWs = typeof targetWorkspaceIdOrSlug === "string" ? targetWorkspaceIdOrSlug.trim() : "";

  // If no target scope is specified, reject
  if (!cleanTargetProj && !cleanTargetWs) {
    return false;
  }

  const projects = localDB.projects || [];
  const projectByKey = (key: string) => projects.find((p: any) => p.id === key || p.identifier === key);
  const projectKey = (key: string): string => projectByKey(key)?.id || key;
  const projectIds = [entity.project_id, entity.project, ...(Array.isArray(entity.project_ids) ? entity.project_ids : [])]
    .map(scopeId).filter(Boolean);
  const targetProject = cleanTargetProj ? projectKey(cleanTargetProj) : "";
  if (targetProject && !projectIds.some((key) => projectKey(key) === targetProject)) return false;

  if (!cleanTargetWs) return true;
  const workspaceByKey = (key: string) => (localDB.workspaces || []).find(
    (ws: any) => ws.id === key || ws.slug === key
  );
  const targetWorkspace = workspaceByKey(cleanTargetWs);
  const workspaceMatches = (key: string): boolean => {
    const workspace = workspaceByKey(key);
    return targetWorkspace ? workspace?.id === targetWorkspace.id : key === cleanTargetWs;
  };
  const directWorkspaceKeys = [entity.workspace_id, entity.workspace, entity.workspace_slug].map(scopeId).filter(Boolean);
  if (directWorkspaceKeys.length && !directWorkspaceKeys.every(workspaceMatches)) return false;

  // Verify project ownership when available, including secondary Page projects.
  const relevantProjects = projectIds.filter((key) => !targetProject || projectKey(key) === targetProject)
    .map(projectByKey).filter(Boolean);
  const projectWorkspaceKeys = relevantProjects.flatMap((p: any) =>
    [p.workspace_id, p.workspace, p.workspace_slug].map(scopeId).filter(Boolean)
  );
  if (projectWorkspaceKeys.length && !projectWorkspaceKeys.every(workspaceMatches)) return false;
  // Missing ownership evidence must never be treated as permission to match.
  return directWorkspaceKeys.length > 0 || projectWorkspaceKeys.length > 0;
}

/**
 * Universal active work issue filter:
 * Returns true if an issue is an active, visible work item:
 * - NOT a triage issue (issue.is_triage === true)
 * - NOT archived (issue.archived_at)
 * - NOT deleted (in deletedIssueIds set)
 * - NOT a draft (issue.is_draft)
 * - Matches target project / workspace scope if provided
 */
export function isActiveWorkIssue(
  issue: any,
  targetProjectId?: string | null,
  targetWorkspaceIdOrSlug?: string | null,
  deletedIssueIds?: Set<string> | string[]
): boolean {
  if (!issue || typeof issue !== "object") return false;
  if (issue.is_triage === true) return false;
  if (issue.archived_at) return false;
  if (issue.is_draft) return false;

  if (deletedIssueIds) {
    const set = deletedIssueIds instanceof Set ? deletedIssueIds : new Set(deletedIssueIds);
    if (set.has(issue.id)) return false;
  }

  if (targetProjectId || targetWorkspaceIdOrSlug) {
    return isValidScope(issue, targetProjectId, targetWorkspaceIdOrSlug);
  }

  return true;
}

/**
 * Mandatory Triage Migration:
 * - Only initializes `is_triage` when `issue.is_triage === undefined`.
 * - Never overwrites an existing boolean value (true or false).
 * - Matches against inbox_issues: if matching inbox issue has status === 1 (accepted), is_triage = false.
 *   Otherwise (unapproved inbox or no inbox), if an unapproved inbox exists => is_triage = true.
 *   If no inbox record exists and is_triage is undefined, sets is_triage = false.
 */
export function ensureIssueTriageMigration(db: any = localDB): void {
  if (!db || !Array.isArray(db.issues)) return;
  const inboxList = Array.isArray(db.inbox_issues) ? db.inbox_issues : [];
  for (const issue of db.issues) {
    if (issue && issue.is_triage === undefined) {
      const matchedInbox = inboxList.find(
        (ib: any) => ib.issue_id === issue.id || ib.issue?.id === issue.id
      );
      if (matchedInbox) {
        issue.is_triage = matchedInbox.status !== 1;
      } else {
        issue.is_triage = false;
      }
    }
  }
}

