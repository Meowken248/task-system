import { localDB, saveDB } from "./store";
import { ResourceAccessError, requireProjectAccess } from "./resource-access";
import { isActiveWorkIssue, isValidScope, nextRecordTimestamp } from "./scope.helper";
import type { RouteResult } from "./types";

type RecordData = Record<string, any>;
const invalid = (message: string) => new ResourceAccessError(400, "INVALID_PLANNING_DATA", message);
const missing = () => new ResourceAccessError(404, "NOT_FOUND", "Không tìm thấy tài nguyên trong dự án này.");
const ok = (data: any): RouteResult => ({ status: 200, data });
const idOf = (value: any): string => (typeof value === "string" ? value : value?.id || "");
const ids = (value: any): string[] => (Array.isArray(value) ? value : [value]).map(idOf).filter(Boolean);
export const issueModuleIds = (issue: RecordData): string[] => [
  ...new Set([...ids(issue.module_ids), ...ids(issue.modules), ...ids(issue.module)]),
];

/** Write every supported legacy alias so a removed membership cannot reappear. */
export function setIssueModules(issue: RecordData, values: string[]): void {
  const normalized = [...new Set(values)];
  issue.module_ids = normalized;
  issue.modules = [...normalized];
  issue.module = normalized[0] ?? null;
  issue.updated_at = nextRecordTimestamp(issue);
}

export function issueStateGroup(issue: RecordData): string {
  const state = (localDB.states || []).find((entry: any) => entry.id === idOf(issue.state_id || issue.state));
  const group = state?.group || issue.state_detail?.group || issue.state_group || issue.state;
  return ["backlog", "unstarted", "started", "completed", "cancelled"].includes(group) ? group : "backlog";
}

export function planningIssues(kind: "cycles" | "modules", resource: RecordData): RecordData[] {
  const project = resource.project_id || resource.project;
  return (localDB.issues || []).filter(
    (issue: any) =>
      isActiveWorkIssue(
        issue,
        project,
        resource.workspace_id || resource.workspace,
        localDB._deleted_issue_ids || []
      ) &&
      (kind === "cycles"
        ? idOf(issue.cycle_id ?? issue.cycle) === resource.id
        : issueModuleIds(issue).includes(resource.id))
  );
}

export function planningStats(kind: "cycles" | "modules", resource: RecordData): Record<string, number> {
  const issues = planningIssues(kind, resource);
  const stats: Record<string, number> = {
    total_issues: issues.length,
    backlog_issues: 0,
    unstarted_issues: 0,
    started_issues: 0,
    completed_issues: 0,
    cancelled_issues: 0,
  };
  for (const issue of issues) stats[`${issueStateGroup(issue)}_issues`]++;
  return stats;
}

/** Date fields are calendar dates, independent of the machine's timezone. */
function day(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.+)?$/.test(value)) return null;
  const [year, month, date] = value.slice(0, 10).split("-").map(Number);
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== date)
    return null;
  if (value.length > 10 && !Number.isFinite(Date.parse(value))) return null;
  return parsed.getTime();
}

export function checkCycleDates(
  project: string,
  data: RecordData,
  excludeId?: string
): { status: boolean; error?: string } {
  if (data.start_date == null && data.end_date == null) return { status: true };
  const start = day(data.start_date),
    end = day(data.end_date);
  if (start === null || end === null) return { status: false, error: "Cần ngày bắt đầu và kết thúc hợp lệ." };
  if (start > end) return { status: false, error: "Ngày kết thúc phải từ ngày bắt đầu trở đi." };
  const deleted = new Set(localDB._deleted_cycle_ids || []);
  const overlap = (localDB.cycles || []).some((cycle: any) => {
    if (cycle.id === excludeId || deleted.has(cycle.id) || cycle.archived_at || !isValidScope(cycle, project))
      return false;
    const first = day(cycle.start_date),
      last = day(cycle.end_date);
    return first !== null && last !== null && first <= end && start <= last;
  });
  return overlap ? { status: false, error: "Khoảng ngày bị trùng với một Cycle khác trong dự án." } : { status: true };
}

export function planningCycleStatus(cycle: RecordData, now = Date.now()): string {
  const first = day(cycle.start_date),
    last = day(cycle.end_date);
  if (first === null || last === null || first > last) return "draft";
  const project = (localDB.projects || []).find((entry: any) => entry.id === (cycle.project_id || cycle.project));
  let today = new Date(now).toISOString().slice(0, 10);
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: project?.timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(now));
    const part = (key: string) => parts.find((entry) => entry.type === key)!.value;
    today = `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    /* Legacy invalid timezone falls back to UTC. */
  }
  const current = day(today)!;
  return current < first ? "upcoming" : current > last ? "completed" : "current";
}

/** The allocator runs synchronously before inserting a record in this runtime. */
export function nextIssueSequence(projectKey: string): number {
  const project = (localDB.projects || []).find(
    (entry: any) => entry.id === projectKey || entry.identifier === projectKey
  );
  const watermark = Number(project?.issue_sequence);
  let max = Number.isSafeInteger(watermark) && watermark > 0 ? watermark : 0;
  for (const issue of localDB.issues || []) {
    const sequence = Number(issue.sequence_id);
    if (isValidScope(issue, project?.id || projectKey) && Number.isSafeInteger(sequence) && sequence > max)
      max = sequence;
  }
  if (max >= Number.MAX_SAFE_INTEGER) throw invalid("Đã vượt giới hạn mã số công việc.");
  if (project) {
    project.issue_sequence = max + 1;
  }
  return max + 1;
}

const fieldAliases: Record<string, string> = {
  priority: "priority",
  state: "state_id",
  state_id: "state_id",
  state_group: "state_group",
  assignees: "assignee_id",
  assignee_id: "assignee_id",
  assignee_ids: "assignee_id",
  mentions: "mention_id",
  mention_id: "mention_id",
  created_by: "created_by_id",
  created_by_id: "created_by_id",
  subscriber: "subscriber_id",
  subscriber_id: "subscriber_id",
  labels: "label_id",
  label_id: "label_id",
  label_ids: "label_id",
  cycle: "cycle_id",
  cycle_id: "cycle_id",
  module: "module_id",
  module_id: "module_id",
  project: "project_id",
  project_id: "project_id",
  team_project: "project_id",
  issue_type: "type_id",
  type: "type_id",
  type_id: "type_id",
  start_date: "start_date",
  target_date: "target_date",
  created_at: "created_at",
  updated_at: "updated_at",
};
const dateFields = new Set(["start_date", "target_date", "created_at", "updated_at"]);
function issueValues(issue: RecordData, field: string): any[] {
  switch (field) {
    case "state_group":
      return [issueStateGroup(issue)];
    case "state_id":
      return [idOf(issue.state_id || issue.state)];
    case "module_id":
      return issueModuleIds(issue);
    case "cycle_id":
      return [idOf(issue.cycle_id ?? issue.cycle)];
    case "assignee_id":
      return ids(issue.assignee_ids ?? issue.assignees);
    case "mention_id":
      return ids(issue.mention_ids ?? issue.mentions);
    case "subscriber_id":
      return ids(issue.subscriber_ids ?? issue.subscribers);
    case "label_id":
      return ids(issue.label_ids ?? issue.labels);
    case "created_by_id":
      return [idOf(issue.created_by_id || issue.created_by)];
    case "project_id":
      return [idOf(issue.project_id || issue.project)];
    case "type_id":
      return [idOf(issue.type_id || issue.type)];
    default:
      return [issue[field]];
  }
}
function condition(property: string, operator: string, raw: any): (issue: RecordData) => boolean {
  const field = Object.hasOwn(fieldAliases, property) ? fieldAliases[property] : undefined;
  if (!field || !["exact", "in", "range"].includes(operator))
    throw invalid(`Bộ lọc không được hỗ trợ: ${property}__${operator}.`);
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [raw];
  if (operator === "range") {
    if (!dateFields.has(field) || values.length !== 2) throw invalid("Khoảng ngày bộ lọc không hợp lệ.");
    const start = day(values[0]),
      end = day(values[1]);
    if (start === null || end === null || start > end) throw invalid("Khoảng ngày bộ lọc không hợp lệ.");
    return (issue) => {
      const value = day(issue[field]);
      return value !== null && start <= value && value <= end;
    };
  }
  if (!values.length || values.some((value) => typeof value === "object" && value !== null))
    throw invalid("Giá trị bộ lọc không hợp lệ.");
  const normalize = (value: any) => {
    if (value === null || value === undefined || value === "" || String(value).toLowerCase() === "null") return null;
    if (dateFields.has(field)) {
      const parsed = day(value);
      if (parsed === null) throw invalid("Ngày trong bộ lọc không hợp lệ.");
      return parsed;
    }
    return String(value).trim().toLowerCase();
  };
  const expected = new Set(values.map(normalize));
  return (issue) => {
    const actual = issueValues(issue, field);
    return (actual.length ? actual : [null]).some((value) => {
      if (dateFields.has(field) && value != null && value !== "" && day(value) === null) return false;
      return expected.has(normalize(value));
    });
  };
}

/** Supports the serialized API expression and the editor's condition/group tree. */
function expression(raw: any, depth = 0): (issue: RecordData) => boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || depth > 20)
    throw invalid("Cấu trúc bộ lọc không hợp lệ.");
  if (raw.type === "condition") return condition(raw.property, raw.operator, raw.value);
  if (raw.type === "group") {
    if (raw.logicalOperator !== "and" || !Array.isArray(raw.children)) throw invalid("Nhóm bộ lọc không hợp lệ.");
    const predicates = raw.children.map((node: any) => expression(node, depth + 1));
    return (issue) => predicates.every((predicate: (issue: RecordData) => boolean) => predicate(issue));
  }
  const predicates = Object.entries(raw).map(([key, value]) => {
    if (key === "and") {
      if (!Array.isArray(value)) throw invalid("Nhóm bộ lọc không hợp lệ.");
      const children = value.map((node) => expression(node, depth + 1));
      return (issue: RecordData) => children.every((predicate) => predicate(issue));
    }
    const parts = key.split("__");
    if (parts.length !== 2) throw invalid(`Bộ lọc không hợp lệ: ${key}.`);
    return condition(parts[0], parts[1], value);
  });
  return (issue) => predicates.every((predicate) => predicate(issue));
}

export function filterPlanningIssues(list: RecordData[], filters: any, rich = false): RecordData[] {
  let predicate: (issue: RecordData) => boolean;
  if (rich) predicate = expression(filters ?? {});
  else {
    if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw invalid("Bộ lọc không hợp lệ.");
    const predicates = Object.entries(filters)
      .filter(
        ([, value]) => value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length)
      )
      .map(([key, value]) => condition(key, "in", value));
    predicate = (issue) => predicates.every((item) => item(issue));
  }
  return list.filter(predicate);
}

export function filterIssueRequest(list: RecordData[], params: URLSearchParams): RecordData[] {
  let filtered = list;
  if (params.has("filters")) {
    let value;
    try {
      value = JSON.parse(params.get("filters") || "{}");
    } catch {
      throw invalid("JSON bộ lọc không hợp lệ.");
    }
    filtered = filterPlanningIssues(filtered, value, true);
  }
  const simple = Object.fromEntries([...params].filter(([key]) => Object.hasOwn(fieldAliases, key)));
  return filterPlanningIssues(filtered, simple);
}

export function filterViewIssues(list: RecordData[], view: RecordData): RecordData[] {
  if (view.rich_filters && Object.keys(view.rich_filters).length)
    return filterPlanningIssues(list, view.rich_filters, true);
  const filters = [view.query_data, view.query, view.filters].find((value) => value && Object.keys(value).length) || {};
  return filterPlanningIssues(list, filters);
}

export function normalizeViewFilters(body: RecordData): RecordData {
  if (Object.hasOwn(body, "rich_filters")) {
    filterPlanningIssues([], body.rich_filters, true);
    return { ...body, query: {}, query_data: {}, filters: {} };
  }
  const key = ["query_data", "query", "filters"].find((candidate) => Object.hasOwn(body, candidate));
  if (!key) return body;
  const filters = body[key] ?? {};
  filterPlanningIssues([], filters);
  return { ...body, rich_filters: {}, query: filters, query_data: filters, filters };
}

export function validateModuleIds(values: any, project: string, workspace?: string): string[] {
  const result = stringIds(values);
  for (const id of result) {
    const module = (localDB.modules || []).find((entry: any) => entry.id === id);
    if (!module || !isValidScope(module, project, workspace) || (localDB._deleted_module_ids || []).includes(id))
      throw missing();
  }
  return result;
}

function requireRecord(collection: string, id: string, project: string, workspace: string): RecordData {
  const record = (localDB[collection] || []).find((entry: any) => entry.id === id);
  if (
    !record ||
    (
      localDB[
        `_deleted_${collection === "cycles" ? "cycle" : collection === "modules" ? "module" : collection === "views" ? "view" : "page"}_ids`
      ] || []
    ).includes(id) ||
    !isValidScope(record, project, workspace)
  )
    throw missing();
  return record;
}

export function isPlanningAction(url: string): boolean {
  return /^\/api\/workspaces\/[^/]+\/projects\/[^/]+\/(?:cycles\/[^/]+\/(?:progress|cycle-progress|transfer-issues)|cycles\/[^/]+\/cycle-issues(?:\/[^/]+)?|cycles\/date-check|modules\/[^/]+\/(?:issues|module-issues)(?:\/[^/]+)?|views\/[^/]+\/issues|pages\/[^/]+\/access|(?:issues|work-items|epics)\/[^/]+\/modules)\/?$/.test(
    url.split("?")[0]
  );
}

/** Validate every item before writing any item. Async access checks precede the mutation. */
export async function handlePlanningAction(method: string, url: string, body: RecordData): Promise<RouteResult> {
  const path = new URL(url, "http://dapp.invalid").pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const access = await requireProjectAccess(path[2], path[4], method !== "get");
  const project = access.project.id,
    workspace = access.workspace.id;
  const kind = path[5],
    resourceId = path[6],
    action = path[7],
    relatedId = path[8];
  if (kind === "cycles" && resourceId === "date-check" && method === "post") {
    if (body.cycle_id) requireRecord("cycles", body.cycle_id, project, workspace);
    return ok(checkCycleDates(project, body, body.cycle_id));
  }
  if (kind === "pages" && action === "access" && method === "post") {
    const page = requireRecord("pages", resourceId, project, workspace);
    if (page.created_by !== access.user.id && access.projectRole < 20)
      throw new ResourceAccessError(403, "NOT_AUTHORIZED", "Chỉ chủ sở hữu hoặc quản trị viên được đổi quyền trang.");
    if (body.access !== 0 && body.access !== 1) throw invalid("Quyền trang phải là 0 hoặc 1.");
    page.access = body.access;
    page.updated_at = nextRecordTimestamp(page);
    saveDB();
    return ok({ ...page });
  }
  if (kind === "views" && action === "issues" && method === "get") {
    const view = requireRecord("views", resourceId, project, workspace);
    const list = (localDB.issues || []).filter((issue: any) =>
      isActiveWorkIssue(issue, project, workspace, localDB._deleted_issue_ids || [])
    );
    return ok(
      planningIssueResponse(
        filterIssueRequest(filterViewIssues(list, view), new URL(url, "http://dapp.invalid").searchParams),
        new URL(url, "http://dapp.invalid").searchParams
      )
    );
  }
  if (["issues", "work-items", "epics"].includes(kind)) {
    const issue = (localDB.issues || []).find((entry: any) => entry.id === resourceId);
    if (!issue || !isValidScope(issue, project, workspace) || (localDB._deleted_issue_ids || []).includes(issue.id))
      throw missing();
    if (method === "get")
      return ok(
        (localDB.modules || []).filter(
          (module: any) =>
            issueModuleIds(issue).includes(module.id) &&
            isValidScope(module, project, workspace) &&
            !(localDB._deleted_module_ids || []).includes(module.id)
        )
      );
    if (method === "post") {
      const add = stringIds(body.modules ?? []),
        remove = stringIds(body.removed_modules ?? []);
      add.forEach((id) => requireRecord("modules", id, project, workspace));
      setIssueModules(issue, [
        ...issueModuleIds(issue).filter((id) => !remove.includes(id)),
        ...add.filter((id) => !remove.includes(id)),
      ]);
      saveDB();
      return ok({ ...issue });
    }
  }
  const collection = kind === "cycles" ? "cycles" : "modules";
  const resource = requireRecord(collection, resourceId, project, workspace);
  if (kind === "cycles" && ["progress", "cycle-progress"].includes(action) && method === "get")
    return ok(planningStats("cycles", resource));
  if (kind === "cycles" && action === "transfer-issues" && method === "post") {
    const target = requireRecord("cycles", body.new_cycle_id, project, workspace);
    const list = planningIssues("cycles", resource);
    for (const issue of list) setIssueCycle(issue, target.id);
    saveDB();
    return ok({ message: "Issues transferred", issues: list.map((issue) => issue.id) });
  }
  if (["issues", "module-issues", "cycle-issues"].includes(action)) {
    if (method === "get") {
      const params = new URL(url, "http://dapp.invalid").searchParams;
      return ok(planningIssueResponse(filterIssueRequest(planningIssues(collection, resource), params), params));
    }
    if (method === "post" || method === "delete") {
      const selected = method === "post" ? stringIds(body.issues) : relatedId ? [relatedId] : [];
      if (method === "delete" && !relatedId) throw invalid("Thiếu mã công việc cần gỡ.");
      const issues = selected.map((id) => {
        const issue = (localDB.issues || []).find((entry: any) => entry.id === id);
        if (!issue || !isValidScope(issue, project, workspace) || (localDB._deleted_issue_ids || []).includes(id))
          throw missing();
        return issue;
      });
      for (const issue of issues) {
        if (kind === "cycles") {
          if (method === "post" || idOf(issue.cycle_id ?? issue.cycle) === resource.id)
            setIssueCycle(issue, method === "post" ? resource.id : null);
        } else
          setIssueModules(
            issue,
            method === "post"
              ? [...issueModuleIds(issue), resource.id]
              : issueModuleIds(issue).filter((id) => id !== resource.id)
          );
      }
      saveDB();
      return ok({ message: "Issue memberships updated", issues: selected });
    }
  }
  return { status: 405, data: { code: "METHOD_NOT_ALLOWED", error: "Thao tác không được hỗ trợ." } };
}

export function setIssueCycle(issue: RecordData, cycle: string | null): void {
  issue.cycle = cycle;
  issue.cycle_id = cycle;
  issue.updated_at = nextRecordTimestamp(issue);
}
function stringIds(value: any): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id.trim()))
    throw invalid("Danh sách mã công việc không hợp lệ.");
  return [...new Set(value)];
}
function envelope(results: RecordData[]) {
  return {
    results,
    count: results.length,
    total_count: results.length,
    total_results: results.length,
    next_cursor: null,
    prev_cursor: null,
    next_page_results: false,
    prev_page_results: false,
    total_pages: 1,
  };
}

function planningIssueResponse(issues: RecordData[], params: URLSearchParams) {
  const list = issues.map((issue) => ({
    ...issue,
    project_id: issue.project_id || issue.project,
    workspace_id: issue.workspace_id || issue.workspace,
    state_id: idOf(issue.state_id || issue.state),
    state_detail:
      (localDB.states || []).find((entry: any) => entry.id === idOf(issue.state_id || issue.state)) ||
      issue.state_detail,
    module_ids: issueModuleIds(issue),
    cycle_id: issue.cycle_id ?? issue.cycle ?? null,
    assignee_ids: ids(issue.assignee_ids ?? issue.assignees),
    label_ids: ids(issue.label_ids ?? issue.labels),
    project_detail: (localDB.projects || []).find((entry: any) => entry.id === (issue.project_id || issue.project)),
  }));
  const order = params.get("order_by");
  if (order) {
    const key = order.replace(/^-/, "");
    const priorities = ["urgent", "high", "medium", "low", "none"];
    list.sort((a: any, b: any) => {
      const valueA = key === "priority" ? priorities.indexOf(a.priority || "none") : a[key];
      const valueB = key === "priority" ? priorities.indexOf(b.priority || "none") : b[key];
      if (valueA == null || valueB == null) return valueA == null ? (valueB == null ? 0 : 1) : -1;
      const compared =
        typeof valueA === "number" && typeof valueB === "number"
          ? valueA - valueB
          : String(valueA).localeCompare(String(valueB));
      return order.startsWith("-") ? -compared : compared;
    });
  }
  const groupBy = params.get("group_by"),
    subGroupBy = params.get("sub_group_by");
  if (!groupBy) return { ...envelope(list), grouped_by: null, sub_grouped_by: null };
  const keys = (issue: RecordData, field: string): string[] => {
    if (["state__group", "state_detail.group", "state_group"].includes(field)) return [issueStateGroup(issue)];
    const actualField = fieldAliases[field] || field;
    const values = issueValues(issue, actualField).filter((value) => value != null && value !== "");
    return values.length ? [...new Set(values.map(String))] : ["None"];
  };
  const groups: Record<string, { results: any; total_results: number }> = Object.create(null);
  for (const issue of list)
    for (const group of keys(issue, groupBy)) {
      groups[group] ??= { results: subGroupBy ? Object.create(null) : [], total_results: 0 };
      groups[group].total_results++;
      if (!subGroupBy) groups[group].results.push(issue);
      else
        for (const subGroup of keys(issue, subGroupBy)) {
          groups[group].results[subGroup] ??= { results: [], total_results: 0 };
          groups[group].results[subGroup].results.push(issue);
          groups[group].results[subGroup].total_results++;
        }
    }
  return { ...envelope(list), results: groups, grouped_by: groupBy, sub_grouped_by: subGroupBy };
}

export function validateIntakeIssuePatch(issue: RecordData, raw: any, project: string, workspace: string): RecordData {
  if (raw === undefined) return {};
  const allowed = new Set([
    "id",
    "name",
    "description",
    "description_html",
    "description_json",
    "description_binary",
    "priority",
    "state",
    "state_id",
    "start_date",
    "target_date",
    "assignees",
    "assignee_ids",
    "labels",
    "label_ids",
    "cycle",
    "cycle_id",
    "module_ids",
    "modules",
    "sort_order",
  ]);
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some((key) => !allowed.has(key)) ||
    (raw.id !== undefined && raw.id !== issue.id)
  )
    throw invalid("Không được thay đổi định danh hoặc phạm vi của công việc Intake.");
  const patch = { ...raw };
  delete patch.id;
  if (patch.name !== undefined && (typeof patch.name !== "string" || !patch.name.trim()))
    throw invalid("Tên công việc không được để trống.");
  if (patch.priority !== undefined && !["none", "low", "medium", "high", "urgent"].includes(patch.priority))
    throw invalid("Mức ưu tiên không hợp lệ.");
  for (const key of ["description", "description_html", "description_binary"])
    if (patch[key] !== undefined && patch[key] !== null && typeof patch[key] !== "string")
      throw invalid("Nội dung công việc không hợp lệ.");
  for (const key of ["start_date", "target_date"])
    if (patch[key] !== undefined && patch[key] !== null && day(patch[key]) === null)
      throw invalid("Ngày công việc không hợp lệ.");
  if (patch.state !== undefined && patch.state_id !== undefined && patch.state !== patch.state_id)
    throw invalid("Hai trường trạng thái không thống nhất.");
  if (patch.state_id !== undefined || patch.state !== undefined) {
    const state = (localDB.states || []).find(
      (entry: any) => entry.id === (patch.state_id ?? patch.state) && isValidScope(entry, project)
    );
    if (!state) throw invalid("Trạng thái không thuộc dự án này.");
    patch.state = state.id;
    patch.state_id = state.id;
    patch.state_detail = state;
  }
  for (const [primary, alias] of [
    ["assignee_ids", "assignees"],
    ["label_ids", "labels"],
  ]) {
    if (patch[primary] === undefined && patch[alias] === undefined) continue;
    const values = stringIds(patch[primary] ?? patch[alias]);
    if (primary === "label_ids")
      values.forEach((id) => {
        const label = (localDB.labels || []).find((entry: any) => entry.id === id && isValidScope(entry, project));
        if (!label) throw invalid("Nhãn không thuộc dự án này.");
      });
    patch[primary] = values;
    patch[alias] = [...values];
  }
  if (patch.cycle_id !== undefined || patch.cycle !== undefined) {
    const cycle = Object.hasOwn(patch, "cycle_id") ? patch.cycle_id : patch.cycle;
    if (cycle !== null) requireRecord("cycles", cycle, project, workspace);
    patch.cycle_id = cycle;
    patch.cycle = cycle;
  }
  if (patch.module_ids !== undefined || patch.modules !== undefined) {
    const modules = stringIds(patch.module_ids ?? patch.modules);
    modules.forEach((id) => requireRecord("modules", id, project, workspace));
    patch.module_ids = modules;
    patch.modules = [...modules];
    patch.module = modules[0] ?? null;
  }
  return patch;
}

export async function validateCycleWrite(method: string, url: string, body: RecordData): Promise<void> {
  const match = url.split("?")[0].match(/^\/api\/workspaces\/([^/]+)\/projects\/([^/]+)\/cycles(?:\/([^/]+))?\/?$/);
  if (!match || !["post", "patch", "put"].includes(method)) return;
  const access = await requireProjectAccess(decodeURIComponent(match[1]), decodeURIComponent(match[2]), true);
  const current = match[3]
    ? requireRecord("cycles", decodeURIComponent(match[3]), access.project.id, access.workspace.id)
    : undefined;
  const result =
    current && !Object.hasOwn(body, "start_date") && !Object.hasOwn(body, "end_date")
      ? { status: true }
      : checkCycleDates(access.project.id, { ...current, ...body }, current?.id);
  for (const key of ["project", "project_id"])
    if (body[key] !== undefined && ![access.project.id, access.project.identifier].includes(body[key]))
      throw invalid("Không được chuyển Cycle sang dự án khác bằng thao tác này.");
  for (const key of ["workspace", "workspace_id"])
    if (body[key] !== undefined && ![access.workspace.id, access.workspace.slug].includes(body[key]))
      throw invalid("Không được chuyển Cycle sang workspace khác.");
  if (current && body.id !== undefined && body.id !== current.id) throw invalid("Không được thay đổi định danh Cycle.");
  if (!result.status) throw invalid(result.error!);
}

export async function validatePageVisibilityWrite(url: string, body: RecordData): Promise<void> {
  const match = url.split("?")[0].match(/^\/api\/workspaces\/([^/]+)\/projects\/([^/]+)\/(?:v2\/)?pages\/([^/]+)\/?$/);
  if (!match) return;
  const access = await requireProjectAccess(decodeURIComponent(match[1]), decodeURIComponent(match[2]), true);
  const page = requireRecord("pages", decodeURIComponent(match[3]), access.project.id, access.workspace.id);
  if (page.created_by !== access.user.id && access.projectRole < 20)
    throw new ResourceAccessError(403, "NOT_AUTHORIZED", "Chỉ chủ sở hữu hoặc quản trị viên được đổi quyền trang.");
  if (body.access !== 0 && body.access !== 1) throw invalid("Quyền trang phải là 0 hoặc 1.");
  for (const key of [
    "id",
    "project",
    "project_id",
    "workspace",
    "workspace_id",
    "created_by",
    "owned_by",
    "project_ids",
  ]) {
    if (Object.hasOwn(body, key) && JSON.stringify(body[key]) !== JSON.stringify(page[key]))
      throw invalid("Không được đổi phạm vi hoặc chủ sở hữu đồng thời với quyền trang.");
  }
}
