// oxlint-disable-next-line import/no-unassigned-import -- Install isolated storage before DApp imports.
import "./browser.mjs";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { defaultDB, localDB, setLoggedInUser } from "../../packages/services/src/dapp/store.ts";
import { handleRoute } from "../../packages/services/src/dapp/routes.ts";
import { AbiCoder } from "ethers";

const wsA = "team-a";
const wsB = "team-b";
const pA1 = "proj-a1";
const pA2 = "proj-a2";
const pB1 = "proj-b1";

const call = (method, path, body = {}) => handleRoute(method, path, body);

function resetDB() {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "";
  Object.keys(localDB).forEach((key) => delete localDB[key]);
  Object.assign(localDB, structuredClone(defaultDB), {
    users: [
      { id: "user-owner", email: "owner@example.com" },
      { id: "user-member", email: "member@example.com" },
      { id: "user-guest", email: "guest@example.com" },
      { id: "user-admin", email: "admin@example.com" },
      { id: "user-stranger", email: "stranger@example.com" },
    ],
    workspaces: [
      { id: "ws-a", slug: wsA, name: "Workspace A", created_by: "user-owner" },
      { id: "ws-b", slug: wsB, name: "Workspace B", created_by: "user-stranger" },
      { id: "ws-empty", slug: "team-empty", name: "Empty Workspace", created_by: "user-owner" },
    ],
    workspace_members: [
      { id: "wm-a-owner", workspace: "ws-a", member: "user-owner", role: 20 },
      { id: "wm-a-admin", workspace: "ws-a", member: "user-admin", role: 20 },
      { id: "wm-a-member", workspace: "ws-a", member: "user-member", role: 15 },
      { id: "wm-a-guest", workspace: "ws-a", member: "user-guest", role: 5 },
      { id: "wm-b-stranger", workspace: "ws-b", member: "user-stranger", role: 20 },
      { id: "wm-empty-owner", workspace: "ws-empty", member: "user-owner", role: 20 },
    ],
    projects: [
      { id: pA1, identifier: "PA1", workspace: "ws-a", network: 2, created_by: "user-owner" },
      { id: pA2, identifier: "PA2", workspace: "ws-a", network: 0, created_by: "user-owner" }, // private project
      { id: pB1, identifier: "PB1", workspace: "ws-b", network: 2, created_by: "user-stranger" },
    ],
    project_members: [
      { id: "pm-a1-owner", project: pA1, member: "user-owner", role: 20 },
      { id: "pm-a1-admin", project: pA1, member: "user-admin", role: 20 },
      { id: "pm-a1-member", project: pA1, member: "user-member", role: 15 },
      { id: "pm-a1-guest", project: pA1, member: "user-guest", role: 5 },
      { id: "pm-a2-owner", project: pA2, member: "user-owner", role: 20 },
      // user-member is not in pA2 (private project)
    ],
    pages: [
      {
        id: "page-pub",
        name: "Public Page",
        access: 0,
        owned_by: "user-owner",
        created_by: "user-owner",
        project: pA1,
        project_id: pA1,
        project_ids: [pA1],
        workspace: "ws-a",
        workspace_id: "ws-a",
        description_html: "<p>Public content</p>",
        is_locked: false,
        archived_at: null,
      },
      {
        id: "page-priv",
        name: "Private Secret Page",
        access: 1,
        owned_by: "user-owner",
        created_by: "user-owner",
        project: pA1,
        project_id: pA1,
        project_ids: [pA1],
        workspace: "ws-a",
        workspace_id: "ws-a",
        description_html: "<p>Top secret owner content</p>",
        is_locked: false,
        archived_at: null,
      },
      {
        id: "page-locked",
        name: "Locked Public Page",
        access: 0,
        owned_by: "user-owner",
        created_by: "user-owner",
        project: pA1,
        project_id: pA1,
        project_ids: [pA1],
        workspace: "ws-a",
        workspace_id: "ws-a",
        description_html: "<p>Locked content</p>",
        is_locked: true,
        archived_at: null,
      },
      {
        id: "page-archived",
        name: "Archived Public Page",
        access: 0,
        owned_by: "user-owner",
        created_by: "user-owner",
        project: pA1,
        project_id: pA1,
        project_ids: [pA1],
        workspace: "ws-a",
        workspace_id: "ws-a",
        description_html: "<p>Archived content</p>",
        is_locked: false,
        archived_at: "2026-02-01T00:00:00Z",
      },
      {
        id: "page-multi",
        name: "Multi-Project Page",
        access: 0,
        owned_by: "user-owner",
        created_by: "user-owner",
        project: pA1,
        project_id: pA1,
        project_ids: [pA1, pA2],
        workspace: "ws-a",
        workspace_id: "ws-a",
        description_html: "<p>Multi content</p>",
        is_locked: false,
        archived_at: null,
      },
      {
        id: "page-b",
        name: "Workspace B Secret Page",
        access: 1,
        owned_by: "user-stranger",
        created_by: "user-stranger",
        project: pB1,
        project_id: pB1,
        project_ids: [pB1],
        workspace: "ws-b",
        workspace_id: "ws-b",
        description_html: "<p>Secret B</p>",
        is_locked: false,
        archived_at: null,
      },
    ],
    issues: [
      {
        id: "issue-a1",
        name: "Task in A1",
        project: pA1,
        project_id: pA1,
        workspace: "ws-a",
        workspace_id: "ws-a",
        sequence_id: 1,
        is_triage: false,
      },
      {
        id: "issue-a-triage",
        name: "Triage Task in A",
        project: pA1,
        project_id: pA1,
        workspace: "ws-a",
        workspace_id: "ws-a",
        sequence_id: 2,
        is_triage: true,
      },
      {
        id: "issue-b1",
        name: "Task in B1",
        project: pB1,
        project_id: pB1,
        workspace: "ws-b",
        workspace_id: "ws-b",
        sequence_id: 1,
        is_triage: false,
      },
    ],
    cycles: [],
    modules: [],
    views: [
      {
        id: "view-a1",
        name: "View A1",
        project: pA1,
        project_id: pA1,
        workspace: "ws-a",
        created_by: "user-owner",
      },
    ],
  });
  setLoggedInUser("user-owner");
}

beforeEach(resetDB);

test("reproduce bug 1A: non-owner member can GET description of private page", async () => {
  setLoggedInUser("user-member");
  const res = await call("get", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-priv/description/`);
  // If bug exists, res.status is 200 with private content!
  // Target: status must be 403 NOT_AUTHORIZED
  assert.equal(res.status, 403, "Non-owner member should be denied reading private page description");
});

test("reproduce bug 1B: non-owner member can PATCH description of private page", async () => {
  setLoggedInUser("user-member");
  const res = await call("patch", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-priv/description/`, {
    description_html: "<p>Hacked by member</p>",
  });
  assert.equal(res.status, 403, "Non-owner member should be denied updating private page description");
});

test("reproduce bug 1C: locked page description cannot be modified", async () => {
  setLoggedInUser("user-owner");
  const res = await call("patch", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-locked/description/`, {
    description_html: "<p>Modifying locked content</p>",
  });
  assert.equal(res.status, 403, "Locked page description should reject edits");
});

test("reproduce bug 1D: page description cannot be read with mismatched project", async () => {
  setLoggedInUser("user-owner");
  // pB1 does not contain page-pub
  const res = await call("get", `/api/workspaces/${wsA}/projects/${pB1}/pages/page-pub/description/`);
  assert.equal(res.status, 404, "Mismatched project in URL should return 404");
});

test("reproduce bug 2A: Search in empty workspace falls back to projects in another workspace", async () => {
  setLoggedInUser("user-owner");
  const res = await call("get", `/api/workspaces/team-empty/search/?search=Task`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.results.issue, [], "Empty workspace search must NOT return tasks from other workspaces!");
});

test("reproduce bug 2B: Search returns private page of another user", async () => {
  setLoggedInUser("user-member");
  const res = await call("get", `/api/workspaces/${wsA}/search/?search=Secret`);
  assert.equal(res.status, 200);
  const leaked = (res.data.results.page || []).filter((p) => p.id === "page-priv");
  assert.equal(leaked.length, 0, "Search must NOT return private page to non-owner!");
});

test("reproduce bug 2C: Search returns triage task", async () => {
  setLoggedInUser("user-owner");
  const res = await call("get", `/api/workspaces/${wsA}/search/?search=Triage`);
  assert.equal(res.status, 200);
  const triageIssues = (res.data.results.issue || []).filter((i) => i.id === "issue-a-triage");
  assert.equal(triageIssues.length, 0, "Search must NOT return triage issue!");
});

// ── Additional Comprehensive Matrix Tests ──

test("positive flow: owner can read and update private page description", async () => {
  setLoggedInUser("user-owner");
  const getRes = await call("get", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-priv/description/`);
  assert.equal(getRes.status, 200);
  assert(getRes.data instanceof ArrayBuffer);
  assert.equal(getRes.data.byteLength, 0, "Legacy HTML is recovered by the editor, not returned as fake binary");

  const patchRes = await call("patch", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-priv/description/`, {
    description_html: "<p>Updated secret content</p>",
    description_binary: "AAECAw==",
  });
  assert.equal(patchRes.status, 200);

  const verifyRes = await call("get", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-priv/description/`);
  assert.deepEqual([...new Uint8Array(verifyRes.data)], [0, 1, 2, 3]);
  assert.equal(localDB.pages.find((p) => p.id === "page-priv").description_html, "<p>Updated secret content</p>");
});

test("admin cannot read or update private page description of another user", async () => {
  setLoggedInUser("user-admin");
  const getRes = await call("get", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-priv/description/`);
  assert.equal(getRes.status, 403, "Admin must NOT be allowed to read private page description");

  const patchRes = await call("patch", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-priv/description/`, {
    description_html: "<p>Hacked by admin</p>",
  });
  assert.equal(patchRes.status, 403, "Admin must NOT be allowed to update private page description");
});

test("guest cannot edit public page content", async () => {
  setLoggedInUser("user-guest");
  const res = await call("patch", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-pub/description/`, {
    description_html: "<p>Guest edit attempt</p>",
  });
  assert.equal(res.status, 403, "Guest must be denied editing public page content");
});

test("member can edit public page content when not locked/archived", async () => {
  setLoggedInUser("user-member");
  const res = await call("patch", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-pub/description/`, {
    description_html: "<p>Member valid edit</p>",
  });
  assert.equal(res.status, 200, "Member should be allowed to edit public page content");
});

test("locked page cannot be edited even via generic PATCH payload", async () => {
  setLoggedInUser("user-owner");
  const res = await call("patch", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-locked/`, {
    name: "New Name For Locked Page",
  });
  assert.equal(res.status, 403, "Generic PATCH must reject editing locked page");
});

test("unlocking locked page allows content edit, and locking blocks it again", async () => {
  setLoggedInUser("user-owner");
  // 1. Unlock page via dedicated lock route
  const unlockRes = await call("delete", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-locked/lock/`);
  assert.equal(unlockRes.status, 200);

  // 2. Edit content now succeeds
  const editRes = await call("patch", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-locked/description/`, {
    description_html: "<p>Edited after unlock</p>",
  });
  assert.equal(editRes.status, 200);

  // 3. Lock page again
  const lockRes = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-locked/lock/`);
  assert.equal(lockRes.status, 200);

  // 4. Edit content blocked again
  const editAgainRes = await call("patch", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-locked/description/`, {
    description_html: "<p>Blocked again</p>",
  });
  assert.equal(editAgainRes.status, 403);
});

test("duplicate: non-owner cannot duplicate private page, member can duplicate public page", async () => {
  setLoggedInUser("user-member");
  // Attempt duplicate private page
  const dupPrivRes = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-priv/duplicate/`);
  assert.equal(dupPrivRes.status, 403, "Member must NOT duplicate private page of owner");

  // Duplicate public page
  const dupPubRes = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-pub/duplicate/`);
  assert.equal(dupPubRes.status, 200);
  assert.equal(dupPubRes.data.name, "Public Page (Copy)");
  assert.equal(dupPubRes.data.owned_by, "user-member");
  assert.equal(dupPubRes.data.is_locked, false);
});

test("move: moving to invalid/foreign project rejected", async () => {
  setLoggedInUser("user-owner");
  // Move to project in workspace B
  const moveForeignRes = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-pub/move/`, {
    new_project_id: pB1,
  });
  assert.equal(moveForeignRes.status, 404, "Moving page to project in another workspace should fail 404");

  // Move to non-existent project
  const moveNonExistentRes = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-pub/move/`, {
    new_project_id: "non-existent-proj",
  });
  assert.equal(moveNonExistentRes.status, 404);
});

test("generic PATCH cannot alter id, project, workspace, created_by, or owned_by", async () => {
  setLoggedInUser("user-owner");
  const res = await call("patch", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-pub/`, {
    owned_by: "user-member",
  });
  assert.equal(res.status, 400, "Altering owned_by via generic PATCH must be rejected");
});

test("access changes reject invalid values", async () => {
  setLoggedInUser("user-owner");
  const res = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-pub/access/`, {
    access: 2,
  });
  assert.equal(res.status, 400, "Access value 2 must be rejected");
});

test("page list: member only sees public pages, owner sees public and private", async () => {
  // 1. Member
  setLoggedInUser("user-member");
  const memberListRes = await call("get", `/api/workspaces/${wsA}/projects/${pA1}/pages/`);
  assert.equal(memberListRes.status, 200);
  const memberPageIds = memberListRes.data.map((p) => p.id);
  assert.ok(memberPageIds.includes("page-pub"));
  assert.ok(!memberPageIds.includes("page-priv"), "Member must NOT see private page in page list");

  // 2. Owner
  setLoggedInUser("user-owner");
  const ownerListRes = await call("get", `/api/workspaces/${wsA}/projects/${pA1}/pages/`);
  assert.equal(ownerListRes.status, 200);
  const ownerPageIds = ownerListRes.data.map((p) => p.id);
  assert.ok(ownerPageIds.includes("page-pub"));
  assert.ok(ownerPageIds.includes("page-priv"), "Owner must see their private page in page list");
});

test("positive search: returns matching accessible items and excludes private project items for non-members", async () => {
  // Add a task in private project pA2
  localDB.issues.push({
    id: "issue-a2-private",
    name: "Secret Project Task",
    project: pA2,
    project_id: pA2,
    workspace: "ws-a",
    workspace_id: "ws-a",
    sequence_id: 10,
    is_triage: false,
  });

  // user-member is NOT a member of pA2
  setLoggedInUser("user-member");
  const memberSearchRes = await call("get", `/api/workspaces/${wsA}/search/?search=Secret`);
  assert.equal(memberSearchRes.status, 200);
  const memberIssues = memberSearchRes.data.results.issue.filter((i) => i.id === "issue-a2-private");
  assert.equal(memberIssues.length, 0, "Non-member of private project must NOT see issues in search");

  // user-owner IS member and owner of pA2
  setLoggedInUser("user-owner");
  const ownerSearchRes = await call("get", `/api/workspaces/${wsA}/search/?search=Secret`);
  assert.equal(ownerSearchRes.status, 200);
  const ownerIssues = ownerSearchRes.data.results.issue.filter((i) => i.id === "issue-a2-private");
  assert.equal(ownerIssues.length, 1, "Owner must see their private project issue in search");
});

// --- Group A: Pages list and create protection ---
test("reproduce bug A1: non-member or revoked member cannot create page (must return 403, not 201)", async () => {
  setLoggedInUser("user-stranger");
  const res = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/`, {
    name: "Stranger page",
  });
  assert.equal(res.status, 403, "Stranger without project access must not create page");
});

test("reproduce bug A2: pages list does not leak private page content or description", async () => {
  setLoggedInUser("user-member");
  const res = await call("get", `/api/workspaces/${wsA}/projects/${pA1}/pages/`);
  assert.equal(res.status, 200);
  for (const page of res.data) {
    assert.equal(page.description_html, undefined, "Page list should not include description_html");
    assert.equal(page.description_binary, undefined, "Page list should not include description_binary");
  }
});

// --- Group B: Handler access shadow & minimal response ---
test("reproduce bug B1 & B2: access route respects new owner and blocks old creator", async () => {
  localDB.pages.push({
    id: "page-transferred-mem",
    name: "Transferred Member Page",
    access: 1,
    owned_by: "user-member",
    created_by: "user-guest",
    project: pA1,
    project_id: pA1,
    project_ids: [pA1],
    workspace: "ws-a",
    workspace_id: "ws-a",
    description_html: "<p>Secret</p>",
    is_locked: false,
    archived_at: null,
  });

  // user-guest (old creator, role 5) attempts to change access -> must return 403
  setLoggedInUser("user-guest");
  const guestRes = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-transferred-mem/access/`, {
    access: 0,
  });
  assert.equal(guestRes.status, 403, "Old creator must not change access");

  // user-member (new owner) changes access -> must succeed
  setLoggedInUser("user-member");
  const memberRes = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-transferred-mem/access/`, {
    access: 0,
  });
  assert.equal(memberRes.status, 200, "New owner must be able to change access");
});

test("reproduce bug B3: Admin changing access on private page receives minimal response without private description", async () => {
  setLoggedInUser("user-admin");
  const res = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-priv/access/`, {
    access: 0,
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.description_html, undefined, "Admin changing access must not receive private description in response");
  assert.equal(res.data.description, undefined);
});

test("reproduce bug B4: Archived page cannot change access", async () => {
  setLoggedInUser("user-owner");
  const res = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-archived/access/`, {
    access: 1,
  });
  assert.equal(res.status, 403, "Archived page cannot have access modified");
});

// --- Group C: Favorites ownership & content leakage ---
test("reproduce bug C1 & C2: Favorites respects canonical owner and does not return private content to old creator", async () => {
  localDB.pages.push({
    id: "page-fav-transferred",
    name: "Fav Transferred",
    access: 1,
    owned_by: "user-member",
    created_by: "user-guest",
    project: pA1,
    project_id: pA1,
    project_ids: [pA1],
    workspace: "ws-a",
    workspace_id: "ws-a",
    description_html: "<p>Secret Fav</p>",
    is_locked: false,
    archived_at: null,
  });

  // Old creator (user-guest) tries to add to favorites -> 403
  setLoggedInUser("user-guest");
  const guestAddFav = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/favorite-pages/page-fav-transferred/`, {});
  assert.equal(guestAddFav.status, 403, "Old creator cannot add private page to favorites");

  // New owner (user-member) adds to favorites -> 200
  setLoggedInUser("user-member");
  const memberAddFav = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/favorite-pages/page-fav-transferred/`, {});
  assert.equal(memberAddFav.status, 200, "New owner can add private page to favorites");

  // Old creator fetches favorites -> must not receive page-fav-transferred
  setLoggedInUser("user-guest");
  const guestFavs = await call("get", `/api/workspaces/${wsA}/projects/${pA1}/favorite-pages/`);
  assert.equal(guestFavs.status, 200);
  assert.ok(!guestFavs.data.some((p) => p.id === "page-fav-transferred"), "Old creator must not see transferred private page in favorites");
});

// --- Group D: Helper Pages role calculation vs standard project role ---
test("reproduce bug D: workspace guest with stale project Admin row cannot edit public page content", async () => {
  const pm = localDB.project_members.find((m) => m.member === "user-guest" && m.project === pA1);
  if (pm) pm.role = 20;

  setLoggedInUser("user-guest");
  const res = await call("patch", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-pub/description/`, {
    description_html: "<p>Guest exploit</p>",
  });
  assert.equal(res.status, 403, "Workspace guest with stale project row must be capped and cannot edit content");
});

// --- Group E: Search project membership role 0 or inactive ---
test("reproduce bug E: project member with role 0 or is_active: false in private project cannot see project in search", async () => {
  localDB.project_members.push({
    id: "pm-a2-inactive",
    project: pA2,
    member: "user-member",
    role: 0,
    is_active: false,
  });
  localDB.issues.push({
    id: "issue-a2-secret",
    name: "Zero Role Secret Issue",
    project: pA2,
    project_id: pA2,
    workspace: "ws-a",
    workspace_id: "ws-a",
    sequence_id: 99,
    is_triage: false,
  });

  setLoggedInUser("user-member");
  const res = await call("get", `/api/workspaces/${wsA}/search/?search=Zero`);
  assert.equal(res.status, 200);
  assert.equal(res.data.results.issue.length, 0, "Role 0 / inactive member must not see private project issues in search");
});

// --- Group F: Generic PATCH bypassing dedicated action routes ---
test("reproduce bug F: generic PATCH cannot modify is_locked, archived_at, or access directly", async () => {
  setLoggedInUser("user-member");
  // 1. Member trying to lock via generic PATCH (must be 403 denied)
  const lockRes = await call("patch", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-pub/`, {
    is_locked: true,
  });
  assert.equal(lockRes.status, 403, "Member cannot change is_locked via generic PATCH");

  // 2. Member trying to change access via generic PATCH (must be 403 denied)
  const accessRes = await call("patch", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-pub/`, {
    access: 1,
  });
  assert.equal(accessRes.status, 403, "Member cannot change access via generic PATCH");

  // 3. Member trying to archive via generic PATCH (must be 403 denied)
  const archiveRes = await call("patch", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-pub/`, {
    archived_at: new Date().toISOString(),
  });
  assert.equal(archiveRes.status, 403, "Member cannot change archived_at via generic PATCH");

  // 4. Owner trying to lock/archive via generic PATCH (must be 400 bad request, must use dedicated routes)
  setLoggedInUser("user-owner");
  const ownerLockRes = await call("patch", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-pub/`, {
    is_locked: true,
  });
  assert.equal(ownerLockRes.status, 400, "Owner cannot change is_locked via generic PATCH");

  const ownerArchiveRes = await call("patch", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-pub/`, {
    archived_at: new Date().toISOString(),
  });
  assert.equal(ownerArchiveRes.status, 400, "Owner cannot change archived_at via generic PATCH");

  // 5. Combined payload: unlocking + editing description on a locked page via generic PATCH
  const comboRes = await call("patch", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-locked/`, {
    is_locked: false,
    description_html: "<p>Bypassed Lock</p>",
  });
  assert.equal(comboRes.status, 400, "Combined payload trying to unlock via generic PATCH must be rejected");
});

// --- Group G: Wrong HTTP method executing mutations ---
test("reproduce bug G: GET on /lock/ and /archive/ must return 405 and not mutate data", async () => {
  setLoggedInUser("user-owner");
  // 1. GET /lock/ must return 405 and keep page locked
  const getLockRes = await call("get", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-locked/lock/`);
  assert.equal(getLockRes.status, 405, "GET /lock/ must return 405");
  const pageAfterGetLock = localDB.pages.find((p) => p.id === "page-locked");
  assert.equal(pageAfterGetLock.is_locked, true, "Page must remain locked");

  // 2. GET /archive/ must return 405 and keep page archived
  const getArchiveRes = await call("get", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-archived/archive/`);
  assert.equal(getArchiveRes.status, 405, "GET /archive/ must return 405");
  const pageAfterGetArchive = localDB.pages.find((p) => p.id === "page-archived");
  assert.ok(pageAfterGetArchive.archived_at, "Page must remain archived");
});

// --- Group H: Search filtering private views and tombstones ---
test("reproduce bug H: Search excludes private views of other users and tombstoned items", async () => {
  // Add private view for user-owner (EViewAccess.PRIVATE = 0)
  localDB.views.push({
    id: "view-owner-priv",
    name: "Owner Private View Secret",
    project: pA1,
    project_id: pA1,
    workspace: "ws-a",
    created_by: "user-owner",
    access: 0, // PRIVATE
  });

  // Add tombstoned cycle, module, and view
  localDB.cycles.push({
    id: "cycle-deleted",
    name: "Deleted Cycle Secret",
    project: pA1,
    workspace: "ws-a",
  });
  localDB._deleted_cycle_ids = ["cycle-deleted"];

  localDB.modules.push({
    id: "module-deleted",
    name: "Deleted Module Secret",
    project: pA1,
    workspace: "ws-a",
  });
  localDB._deleted_module_ids = ["module-deleted"];

  localDB.views.push({
    id: "view-deleted",
    name: "Deleted View Secret",
    project: pA1,
    workspace: "ws-a",
    created_by: "user-member",
    access: 1,
  });
  localDB._deleted_view_ids = ["view-deleted"];

  // Search as user-member:
  setLoggedInUser("user-member");
  const res = await call("get", `/api/workspaces/${wsA}/search/?search=Secret`);
  assert.equal(res.status, 200);

  // Must not include view-owner-priv
  assert.ok(!res.data.results.issue_view.some((v) => v.id === "view-owner-priv"), "Private view of another user must not appear in search");
  // Must not include cycle-deleted
  assert.ok(!res.data.results.cycle.some((c) => c.id === "cycle-deleted"), "Tombstoned cycle must not appear in search");
  // Must not include module-deleted
  assert.ok(!res.data.results.module.some((m) => m.id === "module-deleted"), "Tombstoned module must not appear in search");
  // Must not include view-deleted
  assert.ok(!res.data.results.issue_view.some((v) => v.id === "view-deleted"), "Tombstoned view must not appear in search");
});

// --- Group I: Search error propagation ---
test("reproduce bug I: Search endpoints return proper error status instead of masking with 200 empty", async () => {
  setLoggedInUser("user-stranger");

  // 1. Global search
  const globalRes = await call("get", `/api/workspaces/${wsA}/search/?search=Task`);
  assert.equal(globalRes.status, 403, "Global search must return 403 for unauthorized workspace member");

  // 2. Search issues
  const issuesRes = await call("get", `/api/workspaces/${wsA}/search-issues/?search=Task`);
  assert.equal(issuesRes.status, 403, "search-issues must return 403 for unauthorized workspace member");

  // 3. Entity search
  const entityRes = await call("get", `/api/workspaces/${wsA}/entity-search/?query=Task`);
  assert.equal(entityRes.status, 403, "entity-search must return 403 for unauthorized workspace member");
});

// =============================================================================
// REVIEW 2 REGRESSION TEST SUITE (BUGS A - H)
// =============================================================================

test("Review2 Bug A: Unscoped generic Pages requests rejected and cannot mutate data", async () => {
  resetDB();
  setLoggedInUser(null);

  // 1. Anonymous unscoped PATCH
  const patchRes = await call("patch", "/api/pages/page-pub/", { description_html: "<p>Hacked</p>" });
  assert.equal(patchRes.status, 401, "Anonymous unscoped PATCH must return 401");
  const targetPage = localDB.pages.find((p) => p.id === "page-pub");
  assert.notEqual(targetPage?.description_html, "<p>Hacked</p>", "Page content must not be mutated");

  // 2. Anonymous unscoped DELETE
  const deleteRes = await call("delete", "/api/pages/page-pub/", {});
  assert.equal(deleteRes.status, 401, "Anonymous unscoped DELETE must return 401");
  assert.ok(localDB.pages.some((p) => p.id === "page-pub"), "Page must still exist");

  // 3. Authenticated unscoped PATCH
  setLoggedInUser("user-owner");
  const authPatchRes = await call("patch", "/api/pages/page-pub/", { name: "New Name" });
  assert.equal(authPatchRes.status, 400, "Authenticated unscoped PATCH must return 400 INVALID_PAGE_SCOPE");
});

test("Review2 Bug B: Project revocation and requested project access take precedence over page ownership", async () => {
  resetDB();
  // page-priv belongs to pA2 (private project). Make user-member the owner of page-priv.
  const pagePriv = localDB.pages.find((p) => p.id === "page-priv");
  pagePriv.owned_by = "user-member";
  pagePriv.project = pA2;
  pagePriv.project_id = pA2;
  pagePriv.project_ids = [pA2];

  // user-member has no membership in private project pA2
  setLoggedInUser("user-member");
  const readRes = await call("get", `/api/workspaces/${wsA}/projects/${pA2}/pages/page-priv/description/`);
  assert.equal(readRes.status, 403, "Page owner without project access must be denied reading description (403)");

  const editRes = await call("patch", `/api/workspaces/${wsA}/projects/${pA2}/pages/page-priv/description/`, {
    description_html: "<p>Unauthorized edit</p>",
  });
  assert.equal(editRes.status, 403, "Page owner without project access must be denied editing description (403)");
  assert.notEqual(pagePriv.description_html, "<p>Unauthorized edit</p>", "Content must not be mutated");

  // Multi-project page: public page linked to pA1 and pA2. user-member can access pA1 but not pA2.
  const pagePub = localDB.pages.find((p) => p.id === "page-pub");
  pagePub.project_ids = [pA1, pA2];
  const multiRes = await call("get", `/api/workspaces/${wsA}/projects/${pA2}/pages/page-pub/`);
  assert.equal(multiRes.status, 403, "Accessing via unpermitted project in URL must return 403");
});

test("Review2 Bug C: Moving another user's private page does not leak content to admin", async () => {
  resetDB();
  // Admin tries to move page-priv (owned by user-owner) to pA1
  setLoggedInUser("user-admin");
  const readRes = await call("get", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-priv/description/`);
  assert.equal(readRes.status, 403, "Admin cannot read private page description");

  const moveRes = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-priv/move/`, {
    new_project_id: pA1,
  });
  assert.equal(moveRes.status, 200, "Admin can move page");
  assert.equal(moveRes.data?.description_html, undefined, "Private page description must NOT leak in move response");
  assert.equal(moveRes.data?.description, undefined);
  assert.equal(moveRes.data?.description_binary, undefined);
  assert.equal(moveRes.data?.description_json, undefined);
});

test("Review2 Bug D: Move target project identifier resolves within workspace scope", async () => {
  resetDB();
  // Add a project with identical identifier PA1 in another workspace ws-b
  localDB.projects.unshift({
    id: "proj-b-collision",
    identifier: "PA1",
    workspace: "ws-b",
    network: 2,
    created_by: "user-stranger",
  });

  setLoggedInUser("user-owner");
  // Move page-pub using identifier PA1
  const moveRes = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-pub/move/`, {
    new_project_id: "PA1",
  });
  assert.equal(moveRes.status, 200);
  const movedPage = localDB.pages.find((p) => p.id === "page-pub");
  assert.equal(movedPage.project, pA1, "Must move to pA1 in ws-a, not cross-workspace proj-b-collision");
  assert.equal(movedPage.workspace, "ws-a");
});

test("Review2 Bug E: Page create rejects foreign project links, duplicate ID, and unauthenticated requests", async () => {
  resetDB();

  // 1. Foreign project link in body.project_ids
  setLoggedInUser("user-member");
  const foreignRes = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/`, {
    name: "Foreign Link Page",
    project_ids: [pB1, pA2], // pB1 is in ws-b, pA2 is private project member has no access to
  });
  assert.equal(foreignRes.status, 400, "Foreign project links must be rejected with 400");

  // 2. Duplicate page ID
  const dupRes = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/`, {
    id: "page-pub",
    name: "Duplicate Page",
  });
  assert.equal(dupRes.status, 400, "Duplicate page ID must be rejected with 400");
  assert.equal(dupRes.data?.code, "DUPLICATE_PAGE_ID");
  assert.equal(localDB.pages.filter((p) => p.id === "page-pub").length, 1, "Must not create duplicate");

  // 3. Unauthenticated create
  setLoggedInUser(null);
  const unauthRes = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/`, {
    name: "Anon Page",
  });
  assert.equal(unauthRes.status, 401, "Unauthenticated create must be rejected with 401");
});

test("Review2 Bug F: Transferred owner can delete archived page", async () => {
  resetDB();
  const page = localDB.pages.find((p) => p.id === "page-pub");
  page.owned_by = "user-member";
  page.created_by = "user-owner"; // old creator
  page.archived_at = "2026-01-01T00:00:00Z";

  setLoggedInUser("user-member");
  const delRes = await call("delete", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-pub/`);
  assert.equal(delRes.status, 200, "Transferred owner must be able to delete archived page");
  assert.ok(!localDB.pages.some((p) => p.id === "page-pub"), "Page must be deleted");
});

test("Review2 Bug G: Object membership with active wallet does not crash role resolution", async () => {
  resetDB();
  const testWallet = "0x1111111111111111111111111111111111111111";
  const userMember = localDB.users.find((u) => u.id === "user-member");
  userMember.metanode_wallet_address = testWallet;

  // Set member to an object { id: "user-member" }
  const pmMember = localDB.project_members.find((pm) => pm.member === "user-member");
  pmMember.member = { id: "user-member" };

  sessionStorage.setItem("plane_active_wallet_address", testWallet);
  setLoggedInUser("user-member");

  // Read description of public page
  const res = await call("get", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-pub/description/`);
  assert.equal(res.status, 200, "Must not crash with TypeError and allow reading public page");
  sessionStorage.clear();
});

test("Review2 Bug H: Search resolves legacy issue storing project identifier", async () => {
  resetDB();
  // Issue stores project as identifier PA1 instead of UUID
  const issue = localDB.issues[0];
  issue.project = "PA1";

  setLoggedInUser("user-member");
  const searchRes = await call("get", `/api/workspaces/${wsA}/search/?search=${encodeURIComponent(issue.name)}&workspace_search=true`);
  assert.equal(searchRes.status, 200);
  const foundIssue = searchRes.data?.results?.issue?.find((i) => i.id === issue.id);
  assert.ok(foundIssue, "Legacy issue referenced by project identifier must be found in search");
  assert.equal(foundIssue.project_id, pA1, "Must normalize to canonical project UUID");
});

test("Review3 Bug R1: Chain role downgrade from Admin to Member takes immediate effect and blocks lock", async () => {
  resetDB();
  const testWallet = "0x2222222222222222222222222222222222222222";
  const userMember = localDB.users.find((u) => u.id === "user-member");
  userMember.metanode_wallet_address = testWallet;
  sessionStorage.setItem("plane_active_wallet_address", testWallet);

  process.env.VITE_WORKSPACE_REGISTRY_ADDRESS = "0x3333333333333333333333333333333333333333";
  process.env.VITE_RPC_URL = "https://review.fixture";

  let reads = 0;
  globalThis.fetch = async () => Response.json({
    result: AbiCoder.defaultAbiCoder().encode(["uint8"], [++reads === 1 ? 3 : 1])
  });

  setLoggedInUser("user-member");
  const lockRes = await call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-pub/lock/`);
  assert.equal(lockRes.status, 403, "Dropping role to Member must immediately deny lock with 403");
  assert.equal(reads, 2, "Must read both workspace and project permissions");

  const page = localDB.pages.find((p) => p.id === "page-pub");
  assert.equal(page.is_locked, false, "Page must not be locked");

  process.env.VITE_WORKSPACE_REGISTRY_ADDRESS = "";
  process.env.VITE_RPC_URL = "";
});

test("Review3 Bug R1: Actor and wallet switch across await boundaries triggers 409 and protects private page", async () => {
  resetDB();
  const walletA = "0x1111111111111111111111111111111111111111";
  const walletB = "0x2222222222222222222222222222222222222222";
  const userOwner = localDB.users.find((u) => u.id === "user-owner");
  const userMember = localDB.users.find((u) => u.id === "user-member");
  userOwner.metanode_wallet_address = walletA;
  userMember.metanode_wallet_address = walletB;

  sessionStorage.setItem("plane_active_wallet_address", walletA);
  process.env.VITE_WORKSPACE_REGISTRY_ADDRESS = "0x3333333333333333333333333333333333333333";
  process.env.VITE_RPC_URL = "https://review.fixture";

  let reads = 0;
  globalThis.fetch = async (url, opts) => {
    const rpc = JSON.parse(opts.body);
    const role = rpc.params[0].data.toLowerCase().endsWith(walletA.slice(2)) ? 3 : 1;
    const value = { result: AbiCoder.defaultAbiCoder().encode(["uint8"], [role]) };
    const currentRead = ++reads;
    return {
      json: async () => {
        if (currentRead === 1) {
          // Switch to non-owner member during RPC wait
          setLoggedInUser("user-member");
          sessionStorage.setItem("plane_active_wallet_address", walletB);
        }
        return value;
      }
    };
  };

  setLoggedInUser("user-owner");
  const readRes = await call("get", `/api/workspaces/${wsA}/projects/${pA1}/pages/page-priv/description/`);
  assert.equal(readRes.status, 409, "Identity change must be detected and return 409");
  assert.notEqual(readRes.data, "<p>Private Content</p>", "Private content must never be leaked across sessions");

  process.env.VITE_WORKSPACE_REGISTRY_ADDRESS = "";
  process.env.VITE_RPC_URL = "";
});

test("Review3 Bug R2: Cross-workspace issue with colliding project identifier is strictly filtered out in all search endpoints", async () => {
  resetDB();
  // Project in workspace B also uses identifier PA1
  const projB = localDB.projects.find((p) => p.id === pB1);
  projB.identifier = "PA1";

  // Foreign issue in workspace B storing project as identifier PA1
  localDB.issues.push({
    id: "foreign-issue-b",
    name: "Foreign Secret Task",
    project: "PA1",
    workspace: "ws-b",
    sequence_id: 10,
    is_triage: false,
  });

  setLoggedInUser("user-member");

  // 1. Workspace global search in workspace A
  const globalRes = await call("get", `/api/workspaces/${wsA}/search/?search=Foreign&workspace_search=true`);
  assert.equal(globalRes.status, 200);
  const globalIssues = globalRes.data?.results?.issue || [];
  assert.equal(globalIssues.some((i) => i.id === "foreign-issue-b"), false, "Foreign issue must not appear in global search");

  // 2. Entity search in workspace A
  const entityRes = await call("get", `/api/workspaces/${wsA}/entity-search/?query_type=issue&query=Foreign&count=20`);
  assert.equal(entityRes.status, 200);
  const entityIssues = entityRes.data?.issue || [];
  assert.equal(entityIssues.some((i) => i.id === "foreign-issue-b"), false, "Foreign issue must not appear in entity search");

  // 3. Search issues in workspace A
  const issueSearchRes = await call("get", `/api/workspaces/${wsA}/projects/${pA1}/search-issues/?search=Foreign&workspace_search=true`);
  assert.equal(issueSearchRes.status, 200);
  const issueSearchResults = Array.isArray(issueSearchRes.data) ? issueSearchRes.data : [];
  assert.equal(issueSearchResults.some((i) => i.id === "foreign-issue-b"), false, "Foreign issue must not appear in search-issues");
});

test("Review3 Bug R3: List and create Pages scope project resolution strictly to workspace and do not match foreign workspace project", async () => {
  resetDB();
  // Place foreign project with colliding identifier PA1 at the start of localDB.projects
  localDB.projects.unshift({
    id: "foreign-project-colliding",
    identifier: "PA1",
    workspace: "ws-b",
    network: 2,
    created_by: "user-stranger",
  });

  localDB.pages.push({
    id: "foreign-page-colliding",
    name: "Foreign Page Colliding",
    project: "foreign-project-colliding",
    project_id: "foreign-project-colliding",
    project_ids: ["foreign-project-colliding"],
    workspace: "ws-b",
    access: 0,
    created_by: "user-stranger",
    owned_by: "user-stranger",
  });

  setLoggedInUser("user-member");

  // 1. GET list using identifier PA1 in workspace A
  const listRes = await call("get", `/api/workspaces/${wsA}/projects/PA1/pages/`);
  assert.equal(listRes.status, 200);
  const returnedIds = (Array.isArray(listRes.data) ? listRes.data : []).map((p) => p.id);
  assert.equal(returnedIds.includes("foreign-page-colliding"), false, "List must not return page belonging to foreign workspace project");

  // 2. POST create using identifier PA1 in workspace A
  const createRes = await call("post", `/api/workspaces/${wsA}/projects/PA1/pages/`, {
    name: "Alias Project Page",
  });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.data.project, pA1, "Created page must be bound to workspace A's canonical project pA1, not foreign project");
  assert.deepEqual(createRes.data.project_ids, [pA1], "project_ids must contain canonical project pA1");
  assert.equal(createRes.data.workspace, "ws-a", "workspace must be workspace A");
});

test("Review3 Bug R4: Concurrent create requests with identical ID are serialized and second request rejected with 400 DUPLICATE_PAGE_ID", async () => {
  resetDB();
  setLoggedInUser("user-member");

  const [res1, res2] = await Promise.all([
    call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/`, {
      id: "concurrent-page-unique-id",
      name: "Concurrent Page One",
      project_ids: [pA1],
    }),
    call("post", `/api/workspaces/${wsA}/projects/${pA1}/pages/`, {
      id: "concurrent-page-unique-id",
      name: "Concurrent Page Two",
      project_ids: [pA1],
    }),
  ]);

  const statuses = [res1.status, res2.status].sort();
  assert.deepEqual(statuses, [201, 400], "Exactly one create must succeed (201) and one fail (400)");
  const duplicateRecords = localDB.pages.filter((p) => p.id === "concurrent-page-unique-id");
  assert.equal(duplicateRecords.length, 1, "There must be exactly 1 page record created in localDB");
});


