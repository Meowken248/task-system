// oxlint-disable-next-line import/no-unassigned-import -- Install browser fixtures before importing DApp modules.
import "./browser.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { localDB, defaultDB } from "../../packages/services/src/dapp/store.ts";
import { applyOffchainDB } from "../../packages/services/src/dapp/chain.ts";
import { handleRoute } from "../../packages/services/src/dapp/routes.ts";
import {
  isValidScope,
  isActiveWorkIssue,
  mergeRecordLWW,
} from "../../packages/services/src/dapp/scope.helper.ts";

function signIn(id = "user-test") {
  sessionStorage.setItem("plane_dapp_auth_user", id);
  if (!localDB.users.some((user) => user.id === id)) localDB.users.push({ id, email: `${id}@example.invalid` });
  const workspace = localDB.workspaces[0];
  if (!localDB.workspace_members.some((member) => member.workspace === workspace.id && member.member === id)) {
    localDB.workspace_members.push({ workspace: workspace.id, member: id, role: 20, is_active: true });
  }
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "";
  Object.keys(localDB).forEach((key) => delete localDB[key]);
  Object.assign(localDB, structuredClone(defaultDB));
  localDB.workspaces = [{ id: "workspace-fiai", slug: "fiai" }];
  localDB.projects = [{ id: "p1", identifier: "PRJ", workspace: "workspace-fiai" }];
  signIn();
});

// ════════════════════════════════════════════════════════════════════════════
// 1. SCOPE GUARD TESTS
// ════════════════════════════════════════════════════════════════════════════

test("scope guard: rejects undefined matching (undefined === undefined)", () => {
  const entityNoProject = { name: "No Project Task" };
  // Target project is undefined/empty -> MUST return false
  assert.equal(isValidScope(entityNoProject, undefined, undefined), false);
  assert.equal(isValidScope(entityNoProject, "", ""), false);
  assert.equal(isValidScope(entityNoProject, null, null), false);
  assert.equal(isValidScope({}, "p1", undefined), false);
});

test("scope guard: supports legacy project/workspace field formats", () => {
  // Legacy entity with .project and .workspace instead of .project_id and .workspace_id
  const legacyEntity = { id: "leg-1", project: "proj-alpha", workspace: "fiai" };
  assert.equal(isValidScope(legacyEntity, "proj-alpha", "fiai"), true);
  assert.equal(isValidScope(legacyEntity, "proj-beta", "fiai"), false);
  assert.equal(isValidScope(legacyEntity, "proj-alpha", "other-ws"), false);

  // Current entity format
  const modernEntity = { id: "mod-1", project_id: "proj-alpha", workspace_id: "fiai" };
  assert.equal(isValidScope(modernEntity, "proj-alpha", "fiai"), true);
  assert.equal(isValidScope(modernEntity, "proj-beta", "fiai"), false);
});

test("scope guard: supports Pages multi-project relations (project_ids array)", () => {
  const multiProjectPage = {
    id: "page-1",
    name: "Cross-project Doc",
    project_id: "proj-primary",
    project_ids: ["proj-primary", "proj-secondary", "proj-tertiary"],
    workspace_id: "fiai",
  };

  assert.equal(isValidScope(multiProjectPage, "proj-primary", "fiai"), true);
  assert.equal(isValidScope(multiProjectPage, "proj-secondary", "fiai"), true);
  assert.equal(isValidScope(multiProjectPage, "proj-tertiary", "fiai"), true);
  assert.equal(isValidScope(multiProjectPage, "proj-unrelated", "fiai"), false);
});

test("scope guard: isActiveWorkIssue correctly filters triage, archived, and deleted", () => {
  const normalIssue = { id: "iss-1", name: "Normal", project_id: "p1", is_triage: false };
  const triageIssue = { id: "iss-2", name: "Triage", project_id: "p1", is_triage: true };
  const archivedIssue = { id: "iss-3", name: "Archived", project_id: "p1", is_triage: false, archived_at: "2026-11-01T00:00:00Z" };
  const deletedSet = new Set(["iss-4"]);
  const deletedIssue = { id: "iss-4", name: "Deleted", project_id: "p1", is_triage: false };

  assert.equal(isActiveWorkIssue(normalIssue, "p1"), true);
  assert.equal(isActiveWorkIssue(triageIssue, "p1"), false);
  assert.equal(isActiveWorkIssue(archivedIssue, "p1"), false);
  assert.equal(isActiveWorkIssue(deletedIssue, "p1", undefined, deletedSet), false);
  assert.equal(isActiveWorkIssue(normalIssue, "p2"), false); // Wrong project
});

// ════════════════════════════════════════════════════════════════════════════
// 2. TOMBSTONE & MERGE TESTS (DELETE-WINS, LWW, TIE-BREAKING)
// ════════════════════════════════════════════════════════════════════════════

test("tombstone: deleting entities via handleRoute records tombstone and Delete-Wins against older snapshots", async () => {
  // Setup cycle, module, view, page in localDB
  localDB.cycles = [{ id: "c-1", name: "Sprint 1", project: "p1", project_id: "p1", updated_at: "2026-11-01T00:00:00Z" }];
  localDB.modules = [{ id: "m-1", name: "Auth Module", project: "p1", project_id: "p1", updated_at: "2026-11-01T00:00:00Z" }];
  localDB.views = [{ id: "v-1", name: "Custom View", project: "p1", project_id: "p1", updated_at: "2026-11-01T00:00:00Z" }];
  localDB.pages = [{ id: "pg-1", name: "Doc Page", project: "p1", project_id: "p1", updated_at: "2026-11-01T00:00:00Z" }];

  // Delete via handleRoute
  await handleRoute("delete", "/api/workspaces/fiai/projects/p1/cycles/c-1/", {});
  await handleRoute("delete", "/api/workspaces/fiai/projects/p1/modules/m-1/", {});
  await handleRoute("delete", "/api/workspaces/fiai/projects/p1/views/v-1/", {});
  await handleRoute("delete", "/api/workspaces/fiai/projects/p1/pages/pg-1/", {});

  // Tombstones must be recorded
  assert.ok(localDB._deleted_cycle_ids.includes("c-1"));
  assert.ok(localDB._deleted_module_ids.includes("m-1"));
  assert.ok(localDB._deleted_view_ids.includes("v-1"));
  assert.ok(localDB._deleted_page_ids.includes("pg-1"));

  // Apply older remote snapshot containing those items
  applyOffchainDB({
    cycles: [{ id: "c-1", name: "Sprint 1 Resurrected", project: "p1", project_id: "p1" }],
    modules: [{ id: "m-1", name: "Auth Module Resurrected", project: "p1", project_id: "p1" }],
    views: [{ id: "v-1", name: "Custom View Resurrected", project: "p1", project_id: "p1" }],
    pages: [{ id: "pg-1", name: "Doc Page Resurrected", project: "p1", project_id: "p1" }],
    workspaces: [],
    projects: [],
  });

  // Delete-Wins: None of them must resurrect
  assert.equal(localDB.cycles.length, 0);
  assert.equal(localDB.modules.length, 0);
  assert.equal(localDB.views.length, 0);
  assert.equal(localDB.pages.length, 0);
});

test("merge: deterministic tie-breaking ensures symmetry and idempotency when timestamps equal or missing", () => {
  const versionA = { id: "rec-1", title: "Alpha", updated_at: "2026-11-01T12:00:00Z" };
  const versionB = { id: "rec-1", title: "Beta", updated_at: "2026-11-01T12:00:00Z" };

  // Merge A with B vs B with A
  const mergedAB = mergeRecordLWW(versionA, versionB);
  const mergedBA = mergeRecordLWW(versionB, versionA);

  // Both directions must produce the exact same deterministic winner
  assert.equal(mergedAB.title, mergedBA.title);

  // Missing timestamps: canonical string tie-breaking applies deterministically
  const noTimeA = { id: "rec-2", note: "Zebra" };
  const noTimeB = { id: "rec-2", note: "Apple" };
  const mergedNoTimeAB = mergeRecordLWW(noTimeA, noTimeB);
  const mergedNoTimeBA = mergeRecordLWW(noTimeB, noTimeA);
  assert.equal(mergedNoTimeAB.note, mergedNoTimeBA.note);
});

test("merge: order invariance across 3 sessions (A, B, C)", () => {
  const docSession1 = {
    pages: [{ id: "p-shared", name: "Title from 1", updated_at: "2026-11-01T10:00:00Z", project: "p1", project_id: "p1" }],
    workspaces: [],
    projects: [],
  };
  const docSession2 = {
    pages: [{ id: "p-shared", name: "Title from 2 (Latest)", updated_at: "2026-11-01T15:00:00Z", project: "p1", project_id: "p1" }],
    workspaces: [],
    projects: [],
  };
  const docSession3 = {
    pages: [{ id: "p-shared", name: "Title from 3 (Oldest)", updated_at: "2026-11-01T08:00:00Z", project: "p1", project_id: "p1" }],
    workspaces: [],
    projects: [],
  };

  // Merge order 1 -> 2 -> 3
  localDB.pages = [];
  applyOffchainDB(docSession1);
  applyOffchainDB(docSession2);
  applyOffchainDB(docSession3);
  const result123 = localDB.pages[0]?.name;

  // Merge order 3 -> 1 -> 2
  localDB.pages = [];
  applyOffchainDB(docSession3);
  applyOffchainDB(docSession1);
  applyOffchainDB(docSession2);
  const result312 = localDB.pages[0]?.name;

  assert.equal(result123, "Title from 2 (Latest)");
  assert.equal(result312, "Title from 2 (Latest)");
});

// ════════════════════════════════════════════════════════════════════════════
// 3. FAVORITES LIFECYCLE & ISOLATION TESTS
// ════════════════════════════════════════════════════════════════════════════

test("favorites: user isolation prevents User A from seeing User B favorites", async () => {
  localDB.cycles = [{ id: "c-100", name: "Sprint 100", project: "p1", project_id: "p1" }];
  localDB.workspaces = [{ id: "workspace-fiai", slug: "fiai", name: "FIAI" }];

  // User A adds favorite
  signIn("user-A");
  await handleRoute("post", "/api/workspaces/fiai/projects/p1/user-favorite-cycles/", { cycle: "c-100" });

  const resUserA = await handleRoute("get", "/api/workspaces/fiai/user-favorites/", {});
  assert.equal(resUserA.data.length, 1);
  assert.equal(resUserA.data[0].entity_data.id, "c-100");

  // User B queries favorites in the same workspace
  signIn("user-B");
  const resUserB = await handleRoute("get", "/api/workspaces/fiai/user-favorites/", {});
  assert.equal(resUserB.data.length, 0); // Isolated!
});

test("favorites: remove then re-add works, and removing protects against older snapshot restore", async () => {
  localDB.modules = [{ id: "m-200", name: "Payments", project: "p1", project_id: "p1" }];
  localDB.workspaces = [{ id: "workspace-fiai", slug: "fiai", name: "FIAI" }];
  signIn();

  // 1. Add favorite
  const addRes = await handleRoute("post", "/api/workspaces/fiai/projects/p1/user-favorite-modules/", { module: "m-200" });
  const favId = addRes.data.id;
  assert.ok(favId);

  // 2. Remove favorite
  await handleRoute("delete", `/api/workspaces/fiai/projects/p1/user-favorite-modules/${favId}/`, {});
  const listAfterDel = await handleRoute("get", "/api/workspaces/fiai/user-favorites/", {});
  assert.equal(listAfterDel.data.length, 0);
  assert.ok(localDB._deleted_favorite_ids.includes(favId));

  // 3. Restore old snapshot containing the deleted favorite
  applyOffchainDB({
    favorites: [{ id: favId, user_id: "user-test", workspace_id: "workspace-fiai", entity_type: "module", entity_data: { id: "m-200" } }],
    modules: [{ id: "m-200", name: "Payments", project: "p1", project_id: "p1" }],
    workspaces: [{ id: "workspace-fiai", slug: "fiai" }],
    projects: [],
  });
  const listAfterRestore = await handleRoute("get", "/api/workspaces/fiai/user-favorites/", {});
  assert.equal(listAfterRestore.data.length, 0); // Still deleted!

  // 4. Re-add favorite for the same module: MUST succeed with a new ID
  const reAddRes = await handleRoute("post", "/api/workspaces/fiai/projects/p1/user-favorite-modules/", { module: "m-200" });
  assert.ok(reAddRes.data.id);
  assert.notEqual(reAddRes.data.id, favId); // Different ID
  const listAfterReAdd = await handleRoute("get", "/api/workspaces/fiai/user-favorites/", {});
  assert.equal(listAfterReAdd.data.length, 1);
});

test("favorites: deleting underlying resource automatically cleans up corresponding favorites", async () => {
  localDB.cycles = [{ id: "c-300", name: "Temporary Cycle", project: "p1", project_id: "p1" }];
  localDB.workspaces = [{ id: "workspace-fiai", slug: "fiai", name: "FIAI" }];
  signIn();

  // Add cycle to favorites
  await handleRoute("post", "/api/workspaces/fiai/projects/p1/user-favorite-cycles/", { cycle: "c-300" });
  const beforeDel = await handleRoute("get", "/api/workspaces/fiai/user-favorites/", {});
  assert.equal(beforeDel.data.length, 1);

  // Delete cycle via handleRoute
  await handleRoute("delete", "/api/workspaces/fiai/projects/p1/cycles/c-300/", {});

  // Favorites list must auto-clean orphaned favorite
  const afterDel = await handleRoute("get", "/api/workspaces/fiai/user-favorites/", {});
  assert.equal(afterDel.data.length, 0);
});

// ════════════════════════════════════════════════════════════════════════════
// 4. TRIAGE PERSISTENCE & MIGRATION TESTS
// ════════════════════════════════════════════════════════════════════════════

test("triage: deleting unapproved inbox issue preserves its flag when migration runs again", async () => {
  localDB.workspaces = [{ id: "workspace-fiai", slug: "fiai" }];
  localDB.projects = [{ id: "p1", identifier: "PRJ", workspace: "workspace-fiai" }];
  localDB.states = [{ id: "st-backlog", project: "p1", project_id: "p1", group: "backlog", default: true }];

  // Create issue in Inbox (Pending: -2)
  const createRes = await handleRoute("post", "/api/workspaces/fiai/projects/p1/inbox-issues/", {
    name: "Triage Request",
    source: "IN_APP",
  });
  const inboxIssueId = createRes.data.id;
  const underlyingIssueId = createRes.data.issue.id;

  const createdIssue = localDB.issues.find((i) => i.id === underlyingIssueId);
  assert.equal(createdIssue.is_triage, true);

  // Delete Inbox issue while unapproved
  await handleRoute("delete", `/api/workspaces/fiai/projects/p1/inbox-issues/${inboxIssueId}/`, {});

  // Inbox issue is gone
  assert.equal(localDB.inbox_issues.length, 0);
  assert.ok(localDB._deleted_inbox_issue_ids.includes(inboxIssueId));

  // Underlying task remains with is_triage = true (NOT leaked to backlog)
  const taskAfterDel = localDB.issues.find((i) => i.id === underlyingIssueId);
  assert.ok(taskAfterDel);
  assert.equal(taskAfterDel.is_triage, true);

  // Re-run migration in the current in-memory fixture (not a browser F5).
  await handleRoute("get", "/api/workspaces/fiai/projects/p1/search-issues/", {});
  const taskAfterMigration = localDB.issues.find((i) => i.id === underlyingIssueId);
  assert.equal(taskAfterMigration.is_triage, true);
});

test("triage: accepting inbox issue sets is_triage = false, deleting accepted inbox history preserves active backlog state", async () => {
  localDB.workspaces = [{ id: "workspace-fiai", slug: "fiai" }];
  localDB.projects = [{ id: "p1", identifier: "PRJ", workspace: "workspace-fiai" }];
  localDB.states = [
    { id: "st-backlog", project: "p1", project_id: "p1", group: "backlog", default: true },
    { id: "st-started", project: "p1", project_id: "p1", group: "started" },
  ];

  // 1. Create issue in Inbox
  const createRes = await handleRoute("post", "/api/workspaces/fiai/projects/p1/inbox-issues/", {
    name: "Feature Request",
    source: "IN_APP",
  });
  const inboxIssueId = createRes.data.id;
  const underlyingIssueId = createRes.data.issue.id;

  // 2. Accept the issue (status: 1)
  await handleRoute("patch", `/api/workspaces/fiai/projects/p1/inbox-issues/${inboxIssueId}/`, {
    status: 1, // ACCEPTED
    issue: { state_id: "st-started" },
  });

  const acceptedTask = localDB.issues.find((i) => i.id === underlyingIssueId);
  assert.equal(acceptedTask.is_triage, false);

  // 3. Delete Inbox history of accepted issue
  await handleRoute("delete", `/api/workspaces/fiai/projects/p1/inbox-issues/${inboxIssueId}/`, {});

  // Underlying task must NOT revert to triage
  const taskAfterHistDel = localDB.issues.find((i) => i.id === underlyingIssueId);
  assert.ok(taskAfterHistDel);
  assert.equal(taskAfterHistDel.is_triage, false);
});

test("triage: migration preserves existing is_triage boolean values and does not overwrite", async () => {
  // Pre-existing issues in database
  localDB.issues = [
    { id: "task-manual-triage", name: "Manual Triage", is_triage: true },
    { id: "task-manual-active", name: "Manual Active", is_triage: false },
    { id: "task-legacy-undefined", name: "Legacy Undefined" }, // undefined
  ];
  localDB.inbox_issues = []; // No inbox records

  // Trigger route which runs ensureIssueTriageMigration
  await handleRoute("get", "/api/workspaces/fiai/projects/p1/search-issues/", {});

  const t1 = localDB.issues.find((i) => i.id === "task-manual-triage");
  const t2 = localDB.issues.find((i) => i.id === "task-manual-active");
  const t3 = localDB.issues.find((i) => i.id === "task-legacy-undefined");

  assert.equal(t1.is_triage, true); // Preserved!
  assert.equal(t2.is_triage, false); // Preserved!
  assert.equal(t3.is_triage, false); // Default for undefined without inbox relation
});

// ════════════════════════════════════════════════════════════════════════════
// 5. REVIEW REPRODUCTION TESTS
// ════════════════════════════════════════════════════════════════════════════

test("reproduce issue 1: cross-project DELETE cycle must be rejected without creating tombstone; unauthenticated favorite creation returns 401", async () => {
  localDB.workspaces = [{ id: "ws-a", slug: "ws-a", name: "Workspace A" }];
  localDB.projects = [
    { id: "proj-a", identifier: "PA", workspace: "ws-a", workspace_id: "ws-a" },
    { id: "proj-b", identifier: "PB", workspace: "ws-a", workspace_id: "ws-a" },
  ];
  localDB.workspace_members = [
    { id: "wm-1", workspace: "ws-a", workspace_id: "ws-a", member: "user-1", role: 20 },
  ];
  localDB.cycles = [
    { id: "cycle-b", name: "Sprint B", project: "proj-b", project_id: "proj-b", workspace: "ws-a", workspace_id: "ws-a" },
  ];

  signIn("user-1");

  // Attempt to delete cycle-b through proj-a URL
  const delRes = await handleRoute("delete", "/api/workspaces/ws-a/projects/proj-a/cycles/cycle-b/", {});
  assert.equal(delRes.status, 404);
  // Cycle B must NOT be deleted
  assert.equal(localDB.cycles.length, 1);
  assert.equal(localDB.cycles[0].id, "cycle-b");
  // Tombstone MUST NOT be recorded
  assert.equal((localDB._deleted_cycle_ids || []).includes("cycle-b"), false);

  // Unauthenticated favorite creation
  sessionStorage.clear();
  const unauthFavRes = await handleRoute("post", "/api/workspaces/ws-a/user-favorites/", {
    entity_type: "cycle",
    entity_identifier: "cycle-b",
    project_id: "proj-b",
  });
  assert.equal(unauthFavRes.status, 401);
  assert.equal(localDB.favorites.length, 0);
});

test("reproduce issue 2: merge associativity across arbitrary grouping and permutations of A, B, C", () => {
  const A = { id: "1", z: "0" };
  const B = { id: "1", z: "1" };
  const C = { id: "1", a: "0" };

  const AB_C = mergeRecordLWW(mergeRecordLWW(A, B), C);
  const A_BC = mergeRecordLWW(A, mergeRecordLWW(B, C));
  const BC_A = mergeRecordLWW(mergeRecordLWW(B, C), A);
  const C_AB = mergeRecordLWW(C, mergeRecordLWW(A, B));

  // All must be strictly equal in both z and all keys
  assert.equal(AB_C.z, A_BC.z);
  assert.deepEqual(AB_C, A_BC);
  assert.deepEqual(AB_C, BC_A);
  assert.deepEqual(AB_C, C_AB);
});

test("reproduce issue 3: accepted inbox task must bump updated_at so merging older Pending snapshot does not revert it", async () => {
  localDB.workspaces = [{ id: "ws-1", slug: "ws-1" }];
  localDB.projects = [{ id: "p1", identifier: "P1", workspace: "ws-1" }];
  localDB.states = [
    { id: "st-backlog", project: "p1", project_id: "p1", group: "backlog", default: true },
    { id: "st-started", project: "p1", project_id: "p1", group: "started" },
  ];

  signIn("user-1");

  // 1. Create issue in Inbox (Pending)
  const created = await handleRoute("post", "/api/workspaces/ws-1/projects/p1/inbox-issues/", {
    name: "Pending Issue",
  });
  const inboxId = created.data.id;
  const issueId = created.data.issue.id;

  // Snapshot 1 (older Pending snapshot)
  const snapshotPending = {
    workspaces: [{ id: "ws-1", slug: "ws-1" }],
    projects: [{ id: "p1", identifier: "P1" }],
    issues: [structuredClone(localDB.issues.find((i) => i.id === issueId))],
    inbox_issues: [structuredClone(localDB.inbox_issues.find((ib) => ib.id === inboxId))],
  };

  // Wait 10ms so time advances
  await new Promise((resolve) => setTimeout(resolve, 10));

  // 2. Accept the issue
  await handleRoute("patch", `/api/workspaces/ws-1/projects/p1/inbox-issues/${inboxId}/`, {
    status: 1, // ACCEPTED
    issue: { state_id: "st-started" },
  });

  // 3. Delete inbox history
  await handleRoute("delete", `/api/workspaces/ws-1/projects/p1/inbox-issues/${inboxId}/`, {});

  assert.equal(localDB.issues.find((i) => i.id === issueId).is_triage, false);

  // 4. Merge older Pending snapshot
  applyOffchainDB(snapshotPending);

  // Task MUST stay is_triage = false!
  const finalTask = localDB.issues.find((i) => i.id === issueId);
  assert.equal(finalTask.is_triage, false);
});

test("reproduce issue 4: FavoriteService POST /user-favorites/ creates favorite with user_id and GET retrieves it", async () => {
  localDB.workspaces = [{ id: "ws-1", slug: "ws-1" }];
  localDB.projects = [{ id: "p1", identifier: "P1", workspace: "ws-1", workspace_id: "ws-1" }];
  localDB.cycles = [{ id: "c1", name: "Sprint 1", project: "p1", project_id: "p1", workspace: "ws-1", workspace_id: "ws-1" }];
  localDB.workspace_members = [{ id: "wm-1", workspace: "ws-1", member: "user-1", role: 15 }];

  signIn("user-1");

  // Call POST /api/workspaces/ws-1/user-favorites/ (as called by FavoriteService.addFavorite)
  const postRes = await handleRoute("post", "/api/workspaces/ws-1/user-favorites/", {
    entity_type: "cycle",
    entity_identifier: "c1",
    project_id: "p1",
    entity_data: { name: "Sprint 1" },
  });

  assert.equal(postRes.status, 200);
  assert.ok(postRes.data.id);
  assert.equal(postRes.data.user_id, "user-1");
  assert.equal(postRes.data.entity_identifier, "c1");

  // Immediate GET /api/workspaces/ws-1/user-favorites/
  const getRes = await handleRoute("get", "/api/workspaces/ws-1/user-favorites/", {});
  assert.equal(getRes.status, 200);
  assert.equal(getRes.data.length, 1);
  assert.equal(getRes.data[0].id, postRes.data.id);
});

test("reproduce issue 5: GET favorite-pages/ returns TPage[] scoped to requested project and filters private pages", async () => {
  localDB.workspaces = [{ id: "ws-1", slug: "ws-1" }];
  localDB.projects = [
    { id: "p-a", identifier: "PA", workspace: "ws-1", workspace_id: "ws-1" },
    { id: "p-b", identifier: "PB", workspace: "ws-1", workspace_id: "ws-1" },
  ];
  localDB.workspace_members = [
    { id: "wm-1", workspace: "ws-1", member: "user-1", role: 15 },
    { id: "wm-2", workspace: "ws-1", member: "user-2", role: 15 },
  ];
  localDB.pages = [
    { id: "pg-a1", name: "Public Page A1", project: "p-a", project_id: "p-a", workspace: "ws-1", workspace_id: "ws-1", access: 0, created_by: "user-1" },
    { id: "pg-a2-priv", name: "Private Page A2", project: "p-a", project_id: "p-a", workspace: "ws-1", workspace_id: "ws-1", access: 1, created_by: "user-1" },
    { id: "pg-b1", name: "Public Page B1", project: "p-b", project_id: "p-b", workspace: "ws-1", workspace_id: "ws-1", access: 0, created_by: "user-1" },
  ];

  signIn("user-1");

  // User 1 favorites pg-a1, pg-a2-priv, and pg-b1
  await handleRoute("post", "/api/workspaces/ws-1/projects/p-a/favorite-pages/pg-a1/", {});
  await handleRoute("post", "/api/workspaces/ws-1/projects/p-a/favorite-pages/pg-a2-priv/", {});
  await handleRoute("post", "/api/workspaces/ws-1/projects/p-b/favorite-pages/pg-b1/", {});

  // User 1 requests favorite pages for project p-a
  const resUser1 = await handleRoute("get", "/api/workspaces/ws-1/projects/p-a/favorite-pages/", {});
  assert.equal(resUser1.status, 200);
  // Must return TPage[] (not favorite entries) and ONLY for project p-a
  assert.equal(resUser1.data.length, 2);
  const pageIdsUser1 = new Set(resUser1.data.map((p) => p.id));
  assert.ok(pageIdsUser1.has("pg-a1"));
  assert.ok(pageIdsUser1.has("pg-a2-priv"));
  assert.equal(pageIdsUser1.has("pg-b1"), false); // Project B must NOT be included!
  assert.equal(resUser1.data[0].name, "Public Page A1"); // Must be TPage object!

  // User 2 logs in (Member, but not creator of pg-a2-priv)
  signIn("user-2");
  await handleRoute("post", "/api/workspaces/ws-1/projects/p-a/favorite-pages/pg-a1/", {});
  const resUser2 = await handleRoute("get", "/api/workspaces/ws-1/projects/p-a/favorite-pages/", {});
  assert.equal(resUser2.status, 200);
  assert.equal(resUser2.data.length, 1);
  assert.equal(resUser2.data[0].id, "pg-a1"); // Private page pg-a2-priv must NOT be exposed to User 2!
});

const cyclePath = "/api/workspaces/fiai/projects/p1/cycles/c-secure/";
function seedCycle() {
  localDB.cycles = [{ id: "c-secure", name: "Secure", project_id: "p1", workspace_id: "workspace-fiai" }];
}

test("DELETE refuses anonymous users even with an empty membership cache, without mutations", async () => {
  seedCycle();
  sessionStorage.clear();
  localStorage.clear();
  localDB.workspace_members = [];
  const before = structuredClone(localDB);
  assert.equal((await handleRoute("delete", cyclePath, {})).status, 401);
  assert.deepEqual(localDB, before);
});

test("alternate DELETE paths cannot bypass project authorization", async () => {
  seedCycle();
  sessionStorage.clear();
  localStorage.clear();
  localDB.workspace_members = [];
  const before = structuredClone(localDB);
  assert.equal((await handleRoute("delete", "/api/workspaces/fiai/cycles/c-secure/", {})).status, 400);
  assert.equal((await handleRoute("delete", "/api/workspaces/fiai/projects/p1/v2/cycles/c-secure/", {})).status, 401);
  assert.deepEqual(localDB, before);
});

for (const member of [{ role: 5, is_active: true }, { role: 20, is_active: false }, { role: 0, is_active: true }]) {
  test(`DELETE refuses member role=${member.role}, active=${member.is_active}, without tombstones`, async () => {
    seedCycle();
    localDB.workspace_members = [{ workspace: "workspace-fiai", member: "user-test", ...member }];
    const before = structuredClone(localDB);
    assert.equal((await handleRoute("delete", cyclePath, {})).status, 403);
    assert.deepEqual(localDB, before);
  });
}

test("workspace UUID and slug authorize the same resource, including legacy project-only records", async () => {
  seedCycle();
  assert.equal(isValidScope(localDB.cycles[0], "p1", "fiai"), true);
  assert.equal(isValidScope({ project: "p1" }, "p1", "fiai"), true);
  assert.equal(isValidScope({ project: "unknown" }, "unknown", "fiai"), false);
  assert.equal(isValidScope({ workspace_id: "other", project_id: "p1" }, "p1", "fiai"), false);
  assert.equal((await handleRoute("post", "/api/workspaces/fiai/projects/p1/user-favorite-cycles/", { cycle: "c-secure" })).status, 200);
  assert.equal((await handleRoute("delete", cyclePath, {})).status, 200);
  assert.deepEqual(localDB._deleted_cycle_ids, ["c-secure"]);
});

test("favorites require real membership even when no cached members exist", async () => {
  seedCycle();
  localDB.workspace_members = [];
  const before = structuredClone(localDB);
  assert.equal((await handleRoute("post", "/api/workspaces/fiai/user-favorites/", {
    entity_type: "cycle", entity_identifier: "c-secure", project_id: "p1",
  })).status, 403);
  assert.deepEqual(localDB, before);
});

test("favorites cannot read a private project merely through workspace membership", async () => {
  seedCycle();
  localDB.workspace_members[0].role = 15;
  localDB.projects[0].network = 0;
  const before = structuredClone(localDB);
  assert.equal((await handleRoute("post", "/api/workspaces/fiai/projects/p1/user-favorite-cycles/", { cycle: "c-secure" })).status, 403);
  assert.deepEqual(localDB, before);
});

test("favorite PATCH rejects identity/ownership fields atomically, but supports UI rename and reorder", async () => {
  seedCycle();
  const created = await handleRoute("post", "/api/workspaces/fiai/user-favorites/", {
    entity_type: "cycle", entity_identifier: "c-secure", project_id: "p1",
  });
  const url = `/api/workspaces/fiai/user-favorites/${created.data.id}/`;
  for (const patch of [{ id: "changed" }, { user_id: "other" }, { workspace_id: "other" },
    { project_id: "other" }, { entity_data: { id: "other" } }, { entity_identifier: "other" }]) {
    const before = structuredClone(localDB);
    // oxlint-disable-next-line no-await-in-loop -- Check each denied mutation against an unchanged database.
    assert.equal((await handleRoute("patch", url, { name: "Attempted overwrite", ...patch })).status, 400);
    assert.deepEqual(localDB, before);
  }
  const renamed = await handleRoute("patch", url, { name: "Renamed", sequence: 123.5 });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.sequence, 123.5);
  assert.equal(renamed.data.user_id, "user-test");
});

test("favorites PATCH and DELETE cannot cross a workspace path even for the same user", async () => {
  seedCycle();
  const created = await handleRoute("post", "/api/workspaces/fiai/user-favorites/", { entity_type: "cycle", entity_identifier: "c-secure", project_id: "p1" });
  localDB.workspaces.push({ id: "other-id", slug: "other" });
  localDB.workspace_members.push({ workspace: "other-id", member: "user-test", role: 20 });
  const before = structuredClone(localDB);
  assert.equal((await handleRoute("patch", `/api/workspaces/other/user-favorites/${created.data.id}/`, { name: "Wrong workspace" })).status, 404);
  await handleRoute("delete", `/api/workspaces/other/user-favorites/${created.data.id}/`, {});
  assert.deepEqual(localDB, before);
});

test("Pages secondary project scope works when workspace IDs differ from slugs", async () => {
  localDB.projects.push({ id: "p2", workspace: "workspace-fiai" });
  localDB.pages = [{ id: "multi", project: "p1", project_ids: ["p1", "p2"], workspace: "workspace-fiai", name: "Shared", access: 0 }];
  assert.equal((await handleRoute("post", "/api/workspaces/fiai/projects/p2/favorite-pages/multi/", {})).status, 200);
  const list = await handleRoute("get", "/api/workspaces/fiai/projects/p2/favorite-pages/", {});
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.map((page) => page.id), ["multi"]);
  assert.equal(list.data[0].is_favorite, true);
});

test("favorite folders reject cross-owner parents and cycles while preserving reorder", async () => {
  const first = await handleRoute("post", "/api/workspaces/fiai/user-favorites/", { entity_type: "folder", name: "First" });
  const second = await handleRoute("post", "/api/workspaces/fiai/user-favorites/", { entity_type: "folder", name: "Second" });
  assert.equal((await handleRoute("patch", `/api/workspaces/fiai/user-favorites/${first.data.id}/`, { parent: second.data.id })).status, 200);
  const before = structuredClone(localDB);
  assert.equal((await handleRoute("patch", `/api/workspaces/fiai/user-favorites/${second.data.id}/`, { parent: first.data.id })).status, 400);
  assert.deepEqual(localDB, before);
});

test("Accepted and deleted Inbox history survives old snapshots with a frozen or backward clock", async (t) => {
  const instant = Date.parse("2026-11-05T00:00:00.000Z");
  t.mock.timers.enable({ apis: ["Date"], now: instant });
  localDB.states = [{ id: "backlog", project: "p1", group: "backlog", default: true }];
  const made = await handleRoute("post", "/api/workspaces/fiai/projects/p1/inbox-issues/", { issue: { name: "Frozen clock" } });
  assert.equal(made.status, 200);
  const old = structuredClone(localDB);
  const path = `/api/workspaces/fiai/projects/p1/inbox-issues/${made.data.id}/`;
  assert.equal((await handleRoute("patch", path, { status: 1 })).status, 200);
  const acceptedTime = Date.parse(localDB.issues[0].updated_at);
  assert(acceptedTime > instant);
  t.mock.timers.setTime(instant - 10000);
  assert.equal((await handleRoute("delete", path, {})).status, 200);
  assert(Date.parse(localDB.issues[0].updated_at) > acceptedTime);
  applyOffchainDB(old);
  assert.equal(localDB.issues[0].is_triage, false);
  assert.equal(localDB.inbox_issues.length, 0);
});

test("Inbox creation cannot override authorized scope, creator, timestamps or triage", async () => {
  const created = await handleRoute("post", "/api/workspaces/fiai/projects/p1/inbox-issues/", {
    issue: { name: "Untrusted fields", project_id: "foreign", project: "foreign", workspace_id: "foreign", workspace: "foreign",
      created_by: "other-user", is_triage: false, updated_at: "2099-01-01T00:00:00Z" },
  });
  assert.equal(created.status, 200);
  const issue = created.data.issue;
  assert.equal(issue.project_id, "p1");
  assert.equal(issue.workspace_id, "workspace-fiai");
  assert.equal(issue.created_by, "user-test");
  assert.equal(issue.is_triage, true);
  assert.notEqual(issue.updated_at, "2099-01-01T00:00:00Z");
});

test("Inbox PATCH cannot reassign the underlying issue or accept a task in another scope", async () => {
  const created = await handleRoute("post", "/api/workspaces/fiai/projects/p1/inbox-issues/", { issue: { name: "Scoped" } });
  localDB.issues.push({ id: "foreign", project_id: "another", workspace_id: "another", is_triage: true });
  const before = structuredClone(localDB);
  const path = `/api/workspaces/fiai/projects/p1/inbox-issues/${created.data.id}/`;
  assert.equal((await handleRoute("patch", path, { status: 1, issue_id: "foreign" })).status, 400);
  assert.deepEqual(localDB, before);
  assert.equal((await handleRoute("patch", path, { status: 1, issue: { id: "foreign" } })).status, 400);
  assert.deepEqual(localDB, before);
});

test("Inbox duplicate IDs are rejected without creating additional records", async () => {
  const created = await handleRoute("post", "/api/workspaces/fiai/projects/p1/inbox-issues/", { issue: { id: "provided-id", name: "Original" } });
  assert.equal(created.status, 200);
  const before = structuredClone(localDB);
  assert.equal((await handleRoute("post", "/api/workspaces/fiai/projects/p1/inbox-issues/", { issue: { id: "provided-id", name: "Duplicate" } })).status, 409);
  assert.deepEqual(localDB, before);
});

