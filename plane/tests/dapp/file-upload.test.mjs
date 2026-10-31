import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { imageIpfsFixture } from "./ipfs-image-fixture.mjs";
import {
  saveAttachment,
  getAttachment,
  deleteAttachment,
  FileUploadService,
  handleRoute,
  localDB,
  resolveAssetSource,
} from "../../packages/services/dist/index.js";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/app/assets/")) return {
      url: "data:text/javascript," + encodeURIComponent(`export default ${JSON.stringify("/fixture-assets/" + specifier.slice("@/app/assets/".length).split("?")[0])}`),
      shortCircuit: true,
    };
    if (specifier.startsWith("@/"))
      return nextResolve(new URL(`../../apps/web/core/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(new URL("../../apps/web/core/services/", import.meta.url).href) && url.endsWith(".ts")) {
      return {
        format: "module",
        source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), { mode: "transform", sourceUrl: url }),
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
const { FileService } = await import("../../apps/web/core/services/file.service.ts");
const { IssueAttachmentService } = await import("../../apps/web/core/services/issue/issue_attachment.service.ts");
const { handleCoverImageChange, STATIC_COVER_IMAGES } = await import("../../apps/web/helpers/cover-image.helper.ts");
const { EditorAssetStore } = await import("../../apps/web/core/store/editor/asset.store.ts");
let failWrites = false;
let failOpen = false;
let ipfs;

// Mock IndexedDB and browser globals for Node test environment
class MockIDBRequest {
  constructor() {
    this.result = null;
    this.error = null;
    this.onsuccess = null;
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- The mock implements this event-target property.
    this.onerror = null;
  }
  addEventListener(type, listener) {
    this[`on${type}`] = listener;
  }
}

class MockIDBTransaction {
  constructor(store) {
    this.store = store;
    this.oncomplete = null;
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- The mock implements this event-target property.
    this.onerror = null;
  }
  objectStore() {
    return this.store;
  }
  addEventListener(type, listener) {
    this[`on${type}`] = listener;
  }
}

class MockIDBObjectStore {
  constructor(map) {
    this.map = map;
  }
  put(item) {
    if (!failWrites) this.map.set(item.key, item);
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      req.result = item.key;
      if (req.onsuccess) req.onsuccess({ target: req });
    });
    return req;
  }
  get(key) {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      req.result = this.map.get(key) || null;
      if (req.onsuccess) req.onsuccess({ target: req });
    });
    return req;
  }
  delete(key) {
    if (!failWrites) this.map.delete(key);
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      if (req.onsuccess) req.onsuccess({ target: req });
    });
    return req;
  }
}

class MockIDBDatabase {
  constructor() {
    this.storage = new Map();
    this.objectStoreNames = {
      contains: (name) => name === "files",
    };
  }
  createObjectStore() {
    return new MockIDBObjectStore(this.storage);
  }
  transaction(_store, mode) {
    const tx = new MockIDBTransaction(new MockIDBObjectStore(this.storage));
    queueMicrotask(() => {
      if (this === mockDB && mode === "readwrite" && failWrites) {
        tx.error = new Error("fixture-quota-exceeded");
        tx.onabort?.();
      } else tx.oncomplete?.();
    });
    return tx;
  }
  addEventListener() {}
  close() {}
}

const mockDB = new MockIDBDatabase();
const auxiliaryDB = new MockIDBDatabase();

beforeEach(() => {
  mockDB.storage.clear();
  failWrites = false;
  failOpen = false;
  globalThis.window = {
    indexedDB: {
      open: (name) => {
        const req = new MockIDBRequest();
        queueMicrotask(() => {
          if (failOpen && name === "plane_attachment_storage") {
            req.error = new Error("fixture-storage-blocked");
            req.onerror?.();
            return;
          }
          req.result = name === "plane_attachment_storage" ? mockDB : auxiliaryDB;
          if (req.onsuccess) req.onsuccess({ target: req });
        });
        return req;
      },
    },
    location: { origin: "http://localhost:3000", hostname: "localhost", port: "3000", pathname: "/", search: "" },
    dispatchEvent() {},
    addEventListener() {},
    sessionStorage: {
      getItem: (k) => mockDB.storage.get(k) || null,
      setItem: (k, v) => mockDB.storage.set(k, v),
      removeItem: (k) => mockDB.storage.delete(k),
    },
    localStorage: {
      getItem: (k) => (k === "plane_dapp_auth_email" ? "test@example.com" : null),
      setItem: () => {},
      removeItem: () => {},
    },
  };
  globalThis.indexedDB = globalThis.window.indexedDB;
  globalThis.sessionStorage = globalThis.window.sessionStorage;
  globalThis.localStorage = globalThis.window.localStorage;
  globalThis.document = { cookie: "" };
  ipfs = imageIpfsFixture();
  globalThis.fetch = ipfs.fetch;

  localDB.users = [
    {
      id: "user-1",
      email: "test@example.com",
      avatar_url: "",
      avatar: "",
    },
  ];
  localDB.workspaces = [
    {
      id: "ws-1",
      slug: "test-ws",
      name: "Test Workspace",
      created_by: "user-1",
      logo_url: "",
    },
  ];
  localDB.projects = [
    {
      id: "proj-1",
      identifier: "PROJ",
      name: "Test Project",
      workspace: "ws-1",
      network: 2,
      cover_image: "",
    },
  ];
  localDB.attachments = [];
  localDB.assets = [];
  localDB.project_members = [];
  localDB.workspace_members = [];
  localDB.issues = [{ id: "issue-1", project: "proj-1", workspace: "ws-1" }];
  localDB._deleted_issue_ids = [];
});

test("saveAttachment persists data and getAttachment retrieves it accurately", async () => {
  const sample = {
    name: "test-avatar.png",
    base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    type: "image/png",
    size: 70,
  };

  await saveAttachment("avatar_123", sample);

  const retrieved = await getAttachment("avatar_123");
  assert.ok(retrieved, "Attachment should be retrieved from storage");
  assert.equal(retrieved.key, "avatar_123");
  assert.equal(retrieved.name, "test-avatar.png");
  assert.equal(retrieved.base64, sample.base64);
  assert.equal(retrieved.type, "image/png");
});

test("deleteAttachment removes the record from storage", async () => {
  await saveAttachment("doc_to_delete", {
    name: "doc.pdf",
    base64: "JVBERi0xLjQKJ",
    type: "application/pdf",
    size: 12,
  });

  assert.ok(await getAttachment("doc_to_delete"));
  await deleteAttachment("doc_to_delete");
  assert.equal(await getAttachment("doc_to_delete"), null);
});

test("FileUploadService.uploadFile processes file and saves to attachment storage without 15s delay", async () => {
  const service = new FileUploadService();
  const content = "Hello Plane Metanode Attachment";
  const file = new File([content], "note.txt", { type: "text/plain" });

  const formData = new FormData();
  formData.append("file", file);

  const start = Date.now();
  const result = await service.uploadFile("/mock_url", formData);
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 1000, `Upload should complete quickly, took ${elapsed}ms`);
  assert.ok(result.asset_id, "Result must contain asset_id");
  assert.ok(result.asset_url.startsWith("data:text/plain;base64,"), "asset_url must be data URL");
  assert.equal(result.attributes.name, "note.txt");

  const stored = await getAttachment(result.asset_id);
  assert.ok(stored, "File must be persisted in attachment storage");
  assert.equal(stored.name, "note.txt");
});

test("Full API lifecycle: POST init -> upload ingestion -> PATCH confirm -> GET display -> DELETE", async () => {
  // 1. POST init asset
  const initRes = await handleRoute("post", "/api/assets/v2/workspaces/test-ws/", {
    name: "screenshot.png",
    type: "image/png",
    size: 1024,
    entity_type: "PROJECT_COVER",
    entity_identifier: "proj-1",
  });
  assert.equal(initRes.status, 200);
  const assetId = initRes.data.asset_id;
  assert.ok(assetId);
  assert.equal(initRes.data.upload_data.url, "/api/assets/v2/upload/");

  // 2. Upload file content to storage
  const sampleBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const uploadRes = await handleRoute("post", "/api/assets/v2/upload/", {
    asset_id: assetId,
    name: "screenshot.png",
    base64: sampleBase64,
    type: "image/png",
    size: 70,
  });
  assert.equal(uploadRes.status, 200);
  assert.equal(uploadRes.data.success, true);

  // Verify stored in IndexedDB
  const inDb = await getAttachment(assetId);
  assert.ok(inDb);
  assert.equal(inDb.name, "screenshot.png");

  // 3. PATCH confirm upload and bind to project cover
  const patchRes = await handleRoute("patch", `/api/assets/v2/workspaces/test-ws/${assetId}/`, {});
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.data.is_uploaded, true);

  // Verify project cover_image was updated
  const project = localDB.projects.find((p) => p.id === "proj-1");
  assert.ok(project.cover_image.startsWith("data:image/png;base64,"));

  // 4. GET display asset
  const getRes = await handleRoute("get", `/api/assets/v2/display/${assetId}/`, {});
  assert.equal(getRes.status, 200);
  assert.equal(getRes.data.asset_id, assetId);
  assert.ok(getRes.data.asset_url.startsWith("data:image/png;base64,"));

  // 5. GET download asset
  const dlRes = await handleRoute("get", `/api/assets/v2/workspaces/test-ws/download/${assetId}/`, {});
  assert.equal(dlRes.status, 200);
  assert.equal(dlRes.data.base64, sampleBase64);

  // 6. DELETE asset
  const delRes = await handleRoute("delete", `/api/assets/v2/workspaces/test-ws/${assetId}/`, {});
  assert.equal(delRes.status, 200);

  // Verify deleted from storage
  const afterDel = await getAttachment(assetId);
  assert.equal(afterDel, null);

  // Verify GET returns 404
  const getAfterDel = await handleRoute("get", `/api/assets/v2/display/${assetId}/`, {});
  assert.equal(getAfterDel.status, 404);
});

test("User Avatar upload lifecycle updates user avatar_url immediately", async () => {
  // 1. Init user asset
  const initRes = await handleRoute("post", "/api/assets/v2/user-assets/", {
    name: "my-avatar.png",
    type: "image/png",
    size: 512,
    entity_type: "USER_AVATAR",
    entity_identifier: "user-1",
  });
  assert.equal(initRes.status, 200);
  const assetId = initRes.data.asset_id;

  // 2. Upload avatar image
  const form = new FormData();
  form.append("storage", "ipfs");
  form.append("asset_id", assetId);
  form.append("file", png());
  const pinned = await new FileUploadService().uploadFile("", form);

  // 3. Confirm avatar upload
  const patchRes = await handleRoute("patch", `/api/assets/v2/user-assets/${assetId}/`, { ipfs_cid: pinned.ipfs_cid });
  assert.equal(patchRes.status, 200);

  // 4. Verify user avatar was updated
  const user = localDB.users.find((u) => u.id === "user-1");
  assert.ok(user.avatar_url.startsWith("https://image-gateway.fixture/ipfs/"));
  assert.equal(user.avatar_url, user.avatar);
});

test("Work item / Issue attachment syncs attachment_count and issue_attachments accurately", async () => {
  // Setup an issue in localDB
  if (!localDB.issues) localDB.issues = [];
  localDB.issues = [
    {
      id: "issue-test-1",
      name: "TAask",
      sequence_id: 1,
      project: "proj-1",
      project_id: "proj-1",
      project_detail: { identifier: "AA", id: "proj-1" },
      attachment_count: 0,
      issue_attachments: [],
    },
  ];

  // Add an attachment to localDB.attachments for this issue
  if (!localDB.attachments) localDB.attachments = [];
  localDB.attachments = [
    {
      id: "asset_test_123",
      asset_id: "asset_test_123",
      asset_url: "asset_test_123",
      issue_id: "issue-test-1",
      issue: "issue-test-1",
      attributes: { name: "Time off.xlsx", size: 11264 },
      is_uploaded: true,
    },
  ];

  // 1. Fetch issue details via route handler
  const res = await handleRoute("get", "/api/workspaces/test-ws/projects/proj-1/issues/issue-test-1/", {});
  assert.equal(res.status, 200);
  assert.equal(res.data.id, "issue-test-1");
  // Attachment count must reflect real attachments in DB, not stale 0
  assert.equal(res.data.attachment_count, 1);
  assert.equal(res.data.issue_attachments.length, 1);
  assert.equal(res.data.issue_attachments[0].attributes.name, "Time off.xlsx");

  // 2. Fetch issue list
  const listRes = await handleRoute("get", "/api/workspaces/test-ws/projects/proj-1/issues/?all=true", {});
  assert.equal(listRes.status, 200);
  const found = listRes.data.results.find((i) => i.id === "issue-test-1");
  assert.ok(found);
  assert.equal(found.attachment_count, 1);

  // 3. Fetch issue attachments endpoint
  const attRes = await handleRoute(
    "get",
    "/api/workspaces/test-ws/projects/proj-1/issues/issue-test-1/attachments/",
    {}
  );
  assert.equal(attRes.status, 200);
  assert.equal(attRes.data.length, 1);
  assert.equal(attRes.data[0].id, "asset_test_123");
});

const png = () =>
  new File(
    [
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        "base64"
      ),
    ],
    "screenshot.png",
    { type: "image/png" }
  );

test("the real web FileService uploads an editor image and resolves its saved ID without HTTP", async () => {
  const result = await new FileService().uploadProjectAsset(
    "test-ws",
    "proj-1",
    { entity_type: "ISSUE_DESCRIPTION", entity_identifier: "issue-1" },
    png()
  );
  assert(result.asset_url.startsWith("data:image/png;base64,"));
  assert.equal(await resolveAssetSource(result.asset_id), result.asset_url);
  assert.equal(
    await resolveAssetSource(`/api/assets/v2/workspaces/test-ws/projects/proj-1/${result.asset_id}/`),
    result.asset_url
  );
  assert.equal(
    await resolveAssetSource(`http://localhost:3000/api/assets/v2/display/${result.asset_id}/?download=1`),
    result.asset_url
  );
});

test("an upload cannot be confirmed without actual file content", async () => {
  const initialized = await handleRoute("post", "/api/assets/v2/workspaces/test-ws/", { name: "missing.png" });
  const confirmed = await handleRoute("patch", `/api/assets/v2/workspaces/test-ws/${initialized.data.asset_id}/`, {});
  assert.equal(confirmed.status, 409);
  assert.equal(localDB.assets[0].is_uploaded, false);
  assert.equal((await handleRoute("get", `/api/assets/v2/display/${initialized.data.asset_id}/`, {})).status, 404);
  await assert.rejects(resolveAssetSource(initialized.data.asset_id), /nội dung tệp/);
});

test("missing upload bytes do not produce a fake success URL", async () => {
  const response = await handleRoute("post", "/api/assets/v2/upload/", { asset_id: "no-bytes" });
  assert.equal(response.status, 400);
  assert.equal(response.data.success, undefined);
});

test("quota failures reject a local editor upload and never mark metadata as uploaded", async () => {
  failWrites = true;
  await assert.rejects(
    new FileService().uploadWorkspaceAsset(
      "test-ws",
      { entity_type: "PAGE_DESCRIPTION" },
      png()
    ),
    /quota/
  );
  assert.equal(localDB.workspaces[0].logo_url, "");
  assert(localDB.assets.every((asset) => asset.is_uploaded === false));
});

test("a failed byte deletion keeps the asset metadata and does not report success", async () => {
  const service = new FileService();
  const uploaded = await service.uploadWorkspaceAsset("test-ws", { entity_type: "PAGE_DESCRIPTION" }, png());
  failWrites = true;
  await assert.rejects(service.deleteWorkspaceAsset("test-ws", uploaded.asset_id));
  assert(localDB.assets.some((asset) => asset.id === uploaded.asset_id));
  assert(mockDB.storage.has(uploaded.asset_id));
});

test("blocked IndexedDB does not silently claim persistence in sessionStorage", async () => {
  failOpen = true;
  await assert.rejects(saveAttachment("must-not-be-fake", { name: "a.txt", base64: "YQ==" }), /blocked/);
  assert.equal(sessionStorage.getItem("plane_att_must-not-be-fake"), null);
});

test("upload cancellation stops confirmation instead of returning a fabricated URL", async () => {
  const service = new FileUploadService();
  const form = new FormData();
  form.append("file", png());
  const upload = service.uploadFile("", form);
  service.cancelUpload();
  await assert.rejects(upload, /hủy upload/);
  assert.equal(mockDB.storage.size, 0);
});

test("cancelling while metadata is being initialized also stops the web upload", async () => {
  const service = new FileService();
  const pending = service.uploadWorkspaceAsset("test-ws", { entity_type: "PAGE_DESCRIPTION" }, png());
  service.cancelUpload();
  await assert.rejects(pending, /hủy upload/);
  assert(localDB.assets.every((asset) => !asset.is_uploaded));
});

test("concurrent uploads retain independent IDs and file bytes", async () => {
  const service = new FileService();
  const [first, second] = await Promise.all([
    service.uploadProjectAsset("test-ws", "proj-1", { entity_type: "ISSUE_DESCRIPTION" }, png()),
    service.uploadProjectAsset(
      "test-ws",
      "proj-1",
      { entity_type: "COMMENT_DESCRIPTION" },
      new File(["comment bytes"], "comment.txt", { type: "text/plain" })
    ),
  ]);
  assert.notEqual(first.asset_id, second.asset_id);
  assert.equal(await resolveAssetSource(first.asset_id), first.asset_url);
  assert.equal(await resolveAssetSource(second.asset_id), second.asset_url);
});

test("repeated callbacks for one editor block share a single pending upload", async () => {
  const store = new EditorAssetStore();
  const args = {
    blockId: "same-image-block",
    workspaceSlug: "test-ws",
    projectId: "proj-1",
    data: { entity_type: "ISSUE_DESCRIPTION" },
    file: png(),
  };
  const [first, second] = await Promise.all([store.uploadEditorAsset(args), store.uploadEditorAsset(args)]);
  assert.equal(first.asset_id, second.asset_id);
  assert.equal(localDB.assets.length, 1);
  assert.equal(store.assetsUploadStatus[args.blockId], undefined);
});

test("cover upload does not overwrite an existing user avatar", async () => {
  const service = new FileService();
  const avatar = await service.uploadUserAsset({ entity_type: "USER_AVATAR" }, png());
  const cover = await service.uploadUserAsset(
    { entity_type: "USER_COVER" },
    png()
  );
  assert.equal(localDB.users[0].avatar_url, avatar.asset_url);
  assert.equal(localDB.users[0].cover_image_url, cover.asset_url);
});

test("workspace logo and project cover bind the actual uploaded content", async () => {
  const service = new FileService();
  const logo = await service.uploadWorkspaceAsset(
    "test-ws",
    { entity_type: "WORKSPACE_LOGO", entity_identifier: "ws-1" },
    png()
  );
  const cover = await service.uploadProjectAsset(
    "test-ws",
    "proj-1",
    { entity_type: "PROJECT_COVER", entity_identifier: "proj-1" },
    png()
  );
  assert.equal(localDB.workspaces[0].logo_url, logo.asset_url);
  assert.equal(localDB.projects[0].cover_image, cover.asset_url);
});

test("a confirmed snapshot can resolve content on a device without the original byte cache", async () => {
  const result = await new FileService().uploadWorkspaceAsset("test-ws", { entity_type: "PAGE_DESCRIPTION" }, png());
  mockDB.storage.clear();
  assert.equal(await resolveAssetSource(result.asset_id), result.asset_url);
  assert.equal(
    (await handleRoute("get", `/api/assets/v2/display/${result.asset_id}/`, {})).data.asset_url,
    result.asset_url
  );
});

test("duplicating an editor asset copies bytes under the new ID and survives removal of the original", async () => {
  const service = new FileService();
  const original = await service.uploadWorkspaceAsset("test-ws", { entity_type: "PAGE_DESCRIPTION" }, png());
  const copy = await service.duplicateAsset("test-ws", original.asset_id, {
    entity_type: "PAGE_DESCRIPTION",
    entity_id: "page-copy",
  });
  assert.notEqual(copy.asset_id, original.asset_id);
  assert.equal((await getAttachment(copy.asset_id)).key, copy.asset_id);
  await service.deleteWorkspaceAsset("test-ws", original.asset_id);
  assert.equal(await resolveAssetSource(copy.asset_id), original.asset_url);
  await assert.rejects(resolveAssetSource(original.asset_id));
});

test("missing restore and check operations do not create phantom assets", async () => {
  assert.equal((await handleRoute("get", "/api/assets/v2/workspaces/test-ws/check/absent/", {})).data.exists, false);
  assert.equal((await handleRoute("post", "/api/assets/v2/workspaces/test-ws/restore/absent/", {})).status, 404);
  assert.equal(localDB.assets.length, 0);
});

test("data, blob and external sources are preserved instead of being wrapped in API paths", async () => {
  await Promise.all(
    ["data:image/png;base64,YQ==", "blob:http://localhost/fixture", "https://images.example.invalid/a.png"].map(
      async (source) => assert.equal(await resolveAssetSource(source), source)
    )
  );
});

test("direct attachment upload and deletion use the authenticated issue scope", async () => {
  const service = new IssueAttachmentService();
  const result = await service.uploadIssueAttachment("test-ws", "proj-1", "issue-1", png());
  assert.equal(result.created_by, "user-1");
  assert.ok(await getAttachment(result.id));
  assert.equal((await service.getIssueAttachments("test-ws", "proj-1", "issue-1")).length, 1);
  await service.deleteIssueAttachment("test-ws", "proj-1", "issue-1", result.id);
  assert.equal(await getAttachment(result.id), null);
  assert.equal(localDB.attachments.length, 0);
});

test("direct attachment service rejects a project from another workspace before storing bytes", async () => {
  localDB.workspaces.push({ id: "ws-2", slug: "other-ws", created_by: "user-1" });
  const service = new IssueAttachmentService();
  await assert.rejects(service.uploadIssueAttachment("other-ws", "proj-1", "issue-1", png()), /quyền/);
  assert.equal(localDB.attachments.length, 0);
  assert.equal(mockDB.storage.size, 0);
});

test("direct attachment deletion rejects an asset belonging to another issue", async () => {
  localDB.issues.push({ id: "issue-2", project: "proj-1" });
  const service = new IssueAttachmentService();
  const result = await service.uploadIssueAttachment("test-ws", "proj-1", "issue-2", png());
  await assert.rejects(service.deleteIssueAttachment("test-ws", "proj-1", "issue-1", result.id), /quyền/);
  assert.ok(await getAttachment(result.id));
  assert.equal(localDB.attachments.length, 1);
});

test("attachment API deletion records a tombstone and updates the actual issue count", async () => {
  const result = await new IssueAttachmentService().uploadIssueAttachment("test-ws", "proj-1", "issue-1", png());
  assert.equal(localDB.issues[0].attachment_count, 1);
  const deleted = await handleRoute("delete", `/api/workspaces/test-ws/projects/proj-1/issues/issue-1/attachments/${result.id}/`, {});
  assert.equal(deleted.status, 200);
  assert.equal(await getAttachment(result.id), null);
  assert.equal(localDB.issues[0].attachment_count, 0);
  assert(localDB._deleted_attachment_ids.includes(result.id));
});

test("attachment API storage failure preserves bytes, metadata and issue count", async () => {
  const result = await new IssueAttachmentService().uploadIssueAttachment("test-ws", "proj-1", "issue-1", png());
  failWrites = true;
  await assert.rejects(handleRoute("delete", `/api/workspaces/test-ws/projects/proj-1/issues/issue-1/attachments/${result.id}/`, {}));
  assert.ok(await getAttachment(result.id));
  assert.equal(localDB.attachments.length, 1);
  assert.equal(localDB.issues[0].attachment_count, 1);
});

test("avatar, profile cover and workspace logo use real IPFS URLs without storing image bytes locally", async () => {
  failOpen = true;
  const service = new FileService();
  const avatar = await service.uploadUserAsset({ entity_type: "USER_AVATAR" }, png());
  const cover = await service.uploadUserAsset({ entity_type: "USER_COVER" }, png());
  const logo = await service.uploadWorkspaceAsset("test-ws", { entity_type: "WORKSPACE_LOGO", entity_identifier: "ws-1" }, png());
  for (const result of [avatar, cover, logo]) assert(result.asset_url.startsWith("https://image-gateway.fixture/ipfs/"));
  for (const result of [avatar, cover, logo]) assert.equal(mockDB.storage.has(result.asset_id), false);
  for (const [key, value] of mockDB.storage) {
    assert.equal(key.startsWith("plane_att_"), false);
    assert.equal(String(value).includes("data:image/"), false, "metadata checkpoints contain references, not image bytes");
  }
  assert.equal(ipfs.requests.length, 3);
  assert(localDB.assets.every((asset) => asset.storage === "ipfs" && asset.ipfs_cid && !asset.asset_url.startsWith("data:")));
  assert.equal(localDB.users[0].avatar_url, avatar.asset_url);
  assert.equal(localDB.users[0].cover_image_url, cover.asset_url);
  assert.equal(localDB.workspaces[0].logo_url, logo.asset_url);
});

test("failed IPFS pinning preserves the previous avatar and does not confirm success", async () => {
  localDB.users[0].avatar_url = "https://existing.fixture/old.png";
  ipfs.failUpload = true;
  await assert.rejects(new FileService().uploadUserAsset({ entity_type: "USER_AVATAR" }, png()), /IPFS/);
  assert.equal(localDB.users[0].avatar_url, "https://existing.fixture/old.png");
  assert(localDB.assets.every((asset) => asset.is_uploaded === false));
});

test("a non-image gateway response cannot replace the current profile image", async () => {
  localDB.users[0].cover_image_url = "https://existing.fixture/cover.png";
  ipfs.badGateway = true;
  await assert.rejects(new FileService().uploadUserAsset({ entity_type: "USER_COVER" }, png()), /IPFS/);
  assert.equal(localDB.users[0].cover_image_url, "https://existing.fixture/cover.png");
});

test("deleting an IPFS avatar dereferences it without depending on IndexedDB", async () => {
  const service = new FileService();
  const avatar = await service.uploadUserAsset({ entity_type: "USER_AVATAR" }, png());
  failOpen = true;
  await service.deleteOldUserAsset(avatar.asset_url);
  assert.equal(localDB.users[0].avatar_url, null);
  assert.equal(localDB.assets.length, 0);
});

test("a preset profile cover is pinned even when the MetaNode SDK is present", async () => {
  const jpeg = readFileSync(new URL("../../apps/web/app/assets/cover-images/image_1.jpg", import.meta.url));
  const fixtureFetch = ipfs.fetch;
  globalThis.fetch = (url, options) => url === STATIC_COVER_IMAGES.IMAGE_1
    ? Promise.resolve(new Response(jpeg, { headers: { "Content-Type": "image/jpeg" } })) : fixtureFetch(url, options);
  window.fiaiSDK = {};
  try {
    const result = await handleCoverImageChange(null, STATIC_COVER_IMAGES.IMAGE_1, {
      entityIdentifier: "", entityType: "USER_COVER", isUserAsset: true,
    });
    assert.equal(ipfs.requests.length, 1);
    assert(result.cover_image_url.startsWith("https://image-gateway.fixture/ipfs/"));
    assert.equal(result.cover_image_url, result.cover_image);
    assert.equal(localDB.users[0].cover_image_url, result.cover_image_url);
  } finally { delete window.fiaiSDK; }
});

test("an implicit user avatar also uses IPFS and its metadata API returns the pinned URL", async () => {
  const result = await new FileService().uploadUserAsset({}, png());
  assert.equal(localDB.assets[0].entity_type, "USER_AVATAR");
  assert.equal(localDB.assets[0].storage, "ipfs");
  const metadata = await handleRoute("get", `/api/assets/v2/user-assets/${result.asset_id}/`, {});
  assert.equal(metadata.status, 200);
  assert.equal(metadata.data.file_url, result.asset_url);
  assert.equal(metadata.data.base64, undefined);
});
