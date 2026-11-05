// oxlint-disable-next-line import/no-unassigned-import -- Install isolated storage before DApp imports.
import "./browser.mjs";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { defaultDB, localDB, setLoggedInUser } from "../../packages/services/src/dapp/store.ts";
import { handleRoute } from "../../packages/services/src/dapp/routes.ts";
import { applyOffchainDB } from "../../packages/services/src/dapp/chain.ts";
import { planningCycleStatus } from "../../packages/services/src/dapp/planning-resources.ts";

const base = "/api/workspaces/team/projects/p1";
const call = (method, suffix, body = {}) => handleRoute(method, base + suffix, body);
const records = (response) => (Array.isArray(response.data) ? response.data : response.data.results);
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "";
  Object.keys(localDB).forEach((key) => delete localDB[key]);
  Object.assign(localDB, structuredClone(defaultDB), {
    users: [
      { id: "owner", email: "owner@example.invalid" },
      { id: "member", email: "member@example.invalid" },
    ],
    workspaces: [{ id: "ws", slug: "team", created_by: "owner" }],
    workspace_members: [
      { id: "wm", workspace: "ws", member: "owner", role: 20 },
      { id: "wm2", workspace: "ws", member: "member", role: 15 },
    ],
    projects: [
      { id: "p1", identifier: "ONE", workspace: "ws", network: 2, created_by: "owner" },
      { id: "p2", identifier: "TWO", workspace: "ws", network: 2 },
    ],
    states: [
      { id: "s1", project: "p1", group: "started", default: true },
      { id: "s2", project: "p1", group: "completed" },
    ],
    cycles: [
      { id: "c1", project: "p1", workspace: "ws", name: "First", start_date: "2026-02-01", end_date: "2026-02-10" },
    ],
    modules: [{ id: "m1", project: "p1", workspace: "ws", name: "Module" }],
    views: [{ id: "v1", project: "p1", workspace: "ws", created_by: "owner", query_data: { priority: ["high"] } }],
    pages: [{ id: "page1", project: "p1", workspace: "ws", created_by: "owner", access: 1 }],
    issues: [
      {
        id: "i1",
        project: "p1",
        workspace: "ws",
        name: "High",
        sequence_id: 4,
        state_id: "s1",
        priority: "high",
        cycle_id: "c1",
        module_ids: ["m1"],
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "i2",
        project: "p1",
        workspace: "ws",
        name: "Low",
        sequence_id: 7,
        state: "s2",
        priority: "low",
        cycle: "c1",
      },
      { id: "foreign", project: "p2", workspace: "ws", sequence_id: 80, priority: "high" },
    ],
    inbox_issues: [],
  });
  process.env.VITE_WORKSPACE_REGISTRY_ADDRESS = "";
  process.env.VITE_AUTO_COMMIT_ONCHAIN = "false";
  setLoggedInUser("owner");
});

test("Cycle list, detail and progress derive counts from the same active tasks and canonical states", async () => {
  localDB.issues.push(
    ...["triage", "archived", "deleted", "draft"].map((id) => ({
      id,
      project: "p1",
      cycle: "c1",
      state: "s2",
      is_triage: id === "triage",
      archived_at: id === "archived" ? "2026-01-01" : null,
      is_draft: id === "draft",
    }))
  );
  localDB._deleted_issue_ids = ["deleted"];
  const list = records(await call("get", "/cycles/"))[0];
  const detail = (await call("get", "/cycles/c1/")).data;
  const progress = (await call("get", "/cycles/c1/progress/")).data;
  for (const item of [list, detail, progress]) {
    assert.equal(item.total_issues, 2);
    assert.equal(item.started_issues, 1);
    assert.equal(item.completed_issues, 1);
  }
  assert.equal(list.progress_snapshot.total_issues, 2);
});

test("Cycle date check rejects reversed/invalid/overlapping dates and excludes itself", async () => {
  for (const dates of [
    { start_date: "2026-02-12", end_date: "2026-02-01" },
    { start_date: "2026-02-30", end_date: "2026-03-04" },
    { start_date: "2026-02-10", end_date: "2026-02-15" },
  ])
    // oxlint-disable-next-line no-await-in-loop -- Validate each independent response in readable test order.
    assert.equal((await call("post", "/cycles/date-check/", dates)).data.status, false);
  assert.equal(
    (await call("post", "/cycles/date-check/", { cycle_id: "c1", start_date: "2026-02-01", end_date: "2026-02-10" }))
      .data.status,
    true
  );
  assert.equal(
    (await call("post", "/cycles/date-check/", { start_date: "2026-02-11", end_date: "2026-02-11" })).data.status,
    true
  );
});

test("Cycle POST/PATCH validates dates independently of the UI preflight without mutation", async () => {
  const before = structuredClone(localDB.cycles);
  assert.equal(
    (await call("post", "/cycles/", { name: "Bad", start_date: "2026-03-15", end_date: "2026-03-01" })).status,
    400
  );
  assert.equal((await call("patch", "/cycles/c1/", { end_date: "2026-01-01" })).status, 400);
  assert.deepEqual(localDB.cycles, before);
  assert.equal((await call("post", "/cycles/", { name: "Draft", start_date: null, end_date: null })).status, 201);
});

test("Module unlink removes string/object legacy aliases while preserving other memberships", async () => {
  Object.assign(localDB.issues[0], { module_ids: ["m1", "m2"], modules: [{ id: "m1" }, "m2"], module: "m1" });
  assert.equal((await call("delete", "/modules/m1/module-issues/i1/")).status, 200);
  assert.equal(records(await call("get", "/modules/m1/module-issues/")).length, 0);
  assert.deepEqual(localDB.issues[0].module_ids, ["m2"]);
  assert.ok(!JSON.stringify(localDB.issues[0].modules).includes("m1"));
  assert.notEqual(localDB.issues[0].module, "m1");
  assert.equal(records(await call("get", "/modules/"))[0].total_issues, 0);
});

test("Module add deduplicates legacy IDs and all statistics agree", async () => {
  Object.assign(localDB.issues[1], { modules: ["m1"] });
  await call("post", "/modules/m1/module-issues/", { issues: ["i2", "i2"] });
  assert.deepEqual(localDB.issues[1].module_ids, ["m1"]);
  assert.equal(records(await call("get", "/modules/"))[0].total_issues, 2);
});

test("Relation changes validate the entire batch and survive an older snapshot", async () => {
  const before = structuredClone(localDB.issues);
  assert.equal((await call("post", "/modules/m1/module-issues/", { issues: ["i2", "foreign"] })).status, 404);
  assert.deepEqual(localDB.issues, before);
  Object.assign(localDB.issues[0], { cycle: null, cycle_id: null });
  const snapshot = structuredClone(localDB);
  await call("post", "/cycles/c1/cycle-issues/", { issues: ["i1"] });
  applyOffchainDB(snapshot);
  assert.equal(localDB.issues.find((issue) => issue.id === "i1").cycle_id, "c1");
});

test("View uses saved legacy filters and excludes triage/archived/deleted tasks", async () => {
  localDB.issues.push({ id: "hidden", project: "p1", priority: "high", is_triage: true });
  assert.deepEqual(
    records(await call("get", "/views/v1/issues/")).map((issue) => issue.id),
    ["i1"]
  );
});

test("View and normal issue listing support the actual serialized rich-filter payload", async () => {
  const filters = { and: [{ priority__in: "high,urgent" }, { state_id__exact: "s1" }] };
  localDB.views[0].query_data = {};
  localDB.views[0].rich_filters = filters;
  assert.deepEqual(
    records(await call("get", "/views/v1/issues/")).map((issue) => issue.id),
    ["i1"]
  );
  assert.deepEqual(
    records(await call("get", `/issues/?filters=${encodeURIComponent(JSON.stringify(filters))}&sub_issue=true`)).map(
      (issue) => issue.id
    ),
    ["i1"]
  );
});

test("View filters support AST groups and date ranges; unsupported filters fail explicitly", async () => {
  localDB.views[0].query_data = {};
  localDB.issues[0].target_date = "2026-02-05";
  localDB.views[0].rich_filters = {
    type: "group",
    logicalOperator: "and",
    children: [{ type: "condition", property: "target_date", operator: "range", value: ["2026-02-01", "2026-02-10"] }],
  };
  assert.deepEqual(
    records(await call("get", "/views/v1/issues/")).map((issue) => issue.id),
    ["i1"]
  );
  localDB.views[0].rich_filters = { unknown_field__exact: "something" };
  assert.equal((await call("get", "/views/v1/issues/")).status, 400);
});

test("Page owner can toggle private/public including access=0; invalid values do not mutate", async () => {
  assert.equal((await call("post", "/pages/page1/access/", { access: 0 })).status, 200);
  assert.equal(localDB.pages[0].access, 0);
  assert.equal((await call("post", "/pages/page1/access/", { access: 1 })).status, 200);
  for (const access of [false, 2, "0", null]) {
    // oxlint-disable-next-line no-await-in-loop -- Assert the state immediately after every rejected mutation.
    assert.equal((await call("post", "/pages/page1/access/", { access })).status, 400);
    assert.equal(localDB.pages[0].access, 1);
  }
});

test("Page visibility mutation requires its real scope and owner/admin", async () => {
  setLoggedInUser("member");
  assert.equal((await call("post", "/pages/page1/access/", { access: 0 })).status, 403);
  assert.equal(localDB.pages[0].access, 1);
  setLoggedInUser("owner");
  localDB.pages[0].project = "p2";
  assert.equal((await call("post", "/pages/page1/access/", { access: 0 })).status, 404);
});

test("Intake nested updates persist name/description/priority and keep identity immutable", async () => {
  const created = await call("post", "/inbox-issues/", { issue: { name: "Original" } });
  const path = `/inbox-issues/${created.data.id}/`;
  const updated = await call("patch", path, {
    issue: { name: "Renamed", description_html: "<p>new</p>", priority: "high" },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.issue.name, "Renamed");
  assert.equal(updated.data.issue.description_html, "<p>new</p>");
  assert.equal(localDB.issues.find((issue) => issue.id === created.data.issue_id).priority, "high");
  const before = structuredClone(localDB);
  assert.equal((await call("patch", path, { issue: { project_id: "p2" } })).status, 400);
  assert.deepEqual(localDB, before);
});

test("Intake and ordinary issue creation share project numbering, including simultaneous submissions", async () => {
  const results = await Promise.all(
    Array.from({ length: 3 }, (_, index) => call("post", "/inbox-issues/", { issue: { name: `Request ${index}` } }))
  );
  assert.deepEqual(
    results.map((response) => response.data.issue.sequence_id),
    [8, 9, 10]
  );
  const normal = await call("post", "/issues/", { name: "Normal" });
  assert.equal(normal.data.sequence_id, 11);
  const accepted = await call("patch", `/inbox-issues/${results[0].data.id}/`, { status: 1 });
  assert.equal(accepted.data.issue.sequence_id, 8);
});

test("Concurrent overlapping Cycle creates are rechecked at the actual write", async () => {
  const result = await Promise.all(
    [1, 2].map((id) =>
      call("post", "/cycles/", { name: `Cycle ${id}`, start_date: "2026-04-01", end_date: "2026-04-05" })
    )
  );
  assert.deepEqual(result.map((r) => r.status).toSorted(), [201, 400]);
  assert.equal(localDB.cycles.filter((cycle) => cycle.start_date === "2026-04-01").length, 1);
});

test("Cycle and Module lists apply rich filters and return grouped/subgrouped envelopes for the UI", async () => {
  const result = await call("get", "/cycles/c1/cycle-issues/?group_by=state&sub_group_by=priority");
  assert.equal(result.data.results.s1.results.high.results[0].id, "i1");
  assert.equal(result.data.results.s2.results.low.total_results, 1);
  const filters = encodeURIComponent(JSON.stringify({ priority__exact: "high" }));
  const module = await call("get", `/modules/m1/issues/?filters=${filters}`);
  assert.deepEqual(
    records(module).map((issue) => issue.id),
    ["i1"]
  );
  assert.equal(records(module)[0].state_detail.group, "started");
});

test("Generic issue Module patches clear all legacy aliases and reject invalid batches before mutation", async () => {
  Object.assign(localDB.issues[0], { module: "m1", modules: ["m1"] });
  const before = structuredClone(localDB.issues);
  assert.equal(
    (await call("patch", "/issues/i1/", { module_ids: ["foreign-module"], name: "must not write" })).status,
    404
  );
  assert.deepEqual(localDB.issues, before);
  assert.equal((await call("patch", "/issues/i1/", { module_ids: [] })).status, 200);
  assert.equal(records(await call("get", "/modules/m1/issues/")).length, 0);
});

test("Per-issue Module endpoint removes legacy-only membership and bumps revision", async () => {
  Object.assign(localDB.issues[0], { module_ids: [], module: "m1", modules: [{ id: "m1" }] });
  await call("post", "/issues/i1/modules/", { modules: [], removed_modules: ["m1"] });
  assert.equal(records(await call("get", "/modules/m1/issues/")).length, 0);
  assert.ok(Date.parse(localDB.issues[0].updated_at) > Date.parse("2026-01-01"));
});

test("Clearing saved View filters does not resurrect a stale legacy query after reload", async () => {
  localDB.views[0].query = { priority: ["high"] };
  assert.equal((await call("patch", "/views/v1/", { rich_filters: {} })).status, 200);
  assert.equal(records(await call("get", "/views/v1/issues/")).length, 2);
  const saved = JSON.parse(localStorage.getItem("plane_dapp_local_db"));
  applyOffchainDB(saved);
  assert.equal(records(await call("get", "/views/v1/issues/")).length, 2);
});

test("Malformed/unsupported filters reject even when the result set is empty", async () => {
  localDB.issues = [];
  assert.equal((await call("get", "/issues/?filters=%7Bbroken")).status, 400);
  localDB.views[0].query_data = {};
  localDB.views[0].rich_filters = { assignee_id__unsupported: "owner" };
  assert.equal((await call("get", "/views/v1/issues/")).status, 400);
});

test("Intake nested state and metadata persist; invalid nested fields do not partially write", async () => {
  const created = await call("post", "/inbox-issues/", { issue: { name: "Original" } });
  const path = `/inbox-issues/${created.data.id}/`;
  const before = structuredClone(localDB);
  assert.equal((await call("patch", path, { issue: { name: "No", module_ids: ["missing"] } })).status, 404);
  assert.deepEqual(localDB, before);
  const result = await call("patch", path, { issue: { state_id: "s2", name: "Completed request" } });
  assert.equal(result.data.issue.state, "s2");
  assert.equal(result.data.issue.state_detail.group, "completed");
  const snapshot = JSON.parse(localStorage.getItem("plane_dapp_local_db"));
  assert.equal(snapshot.issues.find((issue) => issue.id === result.data.issue_id).name, "Completed request");
});

test("Existing Intake records get stable numbers and removed high numbers are not reused after snapshot merge", async () => {
  localDB.issues.push({ id: "legacy", name: "Legacy", project: "p1", workspace: "ws", is_triage: true });
  localDB.inbox_issues.push({ id: "ib-legacy", issue_id: "legacy", project: "p1", workspace: "ws", status: -2 });
  const read = await call("get", "/inbox-issues/ib-legacy/");
  assert.equal(read.data.issue.sequence_id, 8);
  const old = structuredClone(localDB);
  const next = await call("post", "/inbox-issues/", { issue: { name: "Next" } });
  assert.equal(next.data.issue.sequence_id, 9);
  localDB.issues = localDB.issues.filter((issue) => issue.id !== next.data.issue_id);
  old.projects[0].updated_at = "2099-01-01T00:00:00Z";
  applyOffchainDB(old);
  const result = await call("post", "/inbox-issues/", { issue: { name: "After restore" } });
  assert.equal(result.data.issue.sequence_id, 10);
});

test("Cycle remains current through its final calendar day in the project's timezone", () => {
  assert.equal(planningCycleStatus(localDB.cycles[0], Date.parse("2026-02-10T23:59:59Z")), "current");
  assert.equal(planningCycleStatus(localDB.cycles[0], Date.parse("2026-02-11T00:00:00Z")), "completed");
  localDB.projects[0].timezone = "Asia/Ho_Chi_Minh";
  assert.equal(planningCycleStatus(localDB.cycles[0], Date.parse("2026-01-31T18:00:00Z")), "current");
});

test("Page visibility guards also apply to generic PATCH and cannot be bypassed with a scope change", async () => {
  setLoggedInUser("member");
  const before = structuredClone(localDB.pages);
  assert.equal((await call("patch", "/pages/page1/", { access: 0 })).status, 403);
  assert.deepEqual(localDB.pages, before);
  setLoggedInUser("owner");
  assert.equal((await call("patch", "/pages/page1/", { access: 0, project: "p2" })).status, 400);
  assert.deepEqual(localDB.pages, before);
  assert.equal((await call("patch", "/pages/page1/", { access: 0 })).status, 200);
  assert.equal(localDB.pages[0].access, 0);
});
