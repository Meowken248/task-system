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
    if (specifier.startsWith("@/app/assets/"))
      return {
        url:
          "data:text/javascript," +
          encodeURIComponent(
            `export default ${JSON.stringify("/fixture-assets/" + specifier.slice("@/app/assets/".length).split("?")[0])}`
          ),
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
const { handleCoverImageChange, STATIC_COVER_IMAGES, getCoverImageDisplayURL } = await import("../../apps/web/helpers/cover-image.helper.ts");
const { uploadCoverImage } = await import("../../apps/web/helpers/cover-image.helper.ts");
const { createProjectWithCover } = await import("../../apps/web/ce/components/projects/create/create-with-cover.ts");
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
    entity_type: "ISSUE_DESCRIPTION",
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

  // 3. PATCH confirm the local editor image upload
  const patchRes = await handleRoute("patch", `/api/assets/v2/workspaces/test-ws/${assetId}/`, {});
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.data.is_uploaded, true);

  assert.equal(localDB.projects.find((p) => p.id === "proj-1").cover_image, "");

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

const png = (
  encoded = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII="
) => new File([Buffer.from(encoded, "base64")], "screenshot.png", { type: "image/png" });

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
    new FileService().uploadWorkspaceAsset("test-ws", { entity_type: "PAGE_DESCRIPTION" }, png()),
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
    png("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
  );
  assert.notEqual(avatar.asset_url, cover.asset_url, "different image bytes have separate CIDs in this regression");
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
  assert.equal(localDB.projects[0].cover_image_url, cover.asset_url);
  assert(localDB.projects[0].media_versions.cover > 0);
});

test("project cover API writes and clears both image fields consistently", async () => {
  const url = "https://image-gateway.fixture/ipfs/pinned-cover";
  const saved = await handleRoute("patch", "/api/workspaces/test-ws/projects/proj-1/", { cover_image: url });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.cover_image_url, url);
  assert.equal(saved.data.cover_image, url);
  const version = saved.data.media_versions.cover;
  const cleared = await handleRoute("patch", "/api/workspaces/test-ws/projects/proj-1/", { cover_image_url: null });
  assert.equal(cleared.data.cover_image, null);
  assert.equal(cleared.data.cover_image_url, null);
  assert(cleared.data.media_versions.cover > version);
});

test("legacy project cover_image is exposed through the UI URL field in list and detail APIs", async () => {
  localDB.projects[0].cover_image = "https://image-gateway.fixture/ipfs/legacy-cover";
  delete localDB.projects[0].cover_image_url;
  const detail = await handleRoute("get", "/api/workspaces/test-ws/projects/proj-1/", {});
  assert.equal(detail.data.cover_image_url, localDB.projects[0].cover_image);
  const list = await handleRoute("get", "/api/workspaces/test-ws/projects/", {});
  assert.equal(list.data.find(p => p.id === "proj-1").cover_image_url, localDB.projects[0].cover_image);
});

test("new project custom cover uses its created scope and confirms actual IPFS bytes", async () => {
  const file = png();
  const result = await createProjectWithCover({ name: "New project", cover_image_url: "blob:preview" }, file, {
    create: async (fields) => {
      const project = { ...fields, id: "new-project", workspace: "ws-1", network: 2 };
      localDB.projects.push(project);
      return project;
    },
    uploadCover: (source, id) =>
      uploadCoverImage(source, {
        workspaceSlug: "test-ws",
        entityIdentifier: id,
        entityType: "PROJECT_COVER",
      }),
    saveCover: async (id, url) => {
      assert.equal(localDB.projects.find((p) => p.id === id).cover_image, url);
    },
  });
  assert.equal(result.coverFailed, false);
  const asset = localDB.assets.find((a) => a.entity_identifier === result.project.id);
  assert.equal(asset.storage, "ipfs");
  assert.equal(asset.is_uploaded, true);
  assert.ok(asset.ipfs_cid);
  assert.equal(asset.base64, undefined);
});

test("Images preset saves a real pin acknowledgement and displays exact bundled bytes when gateways are offline", async () => {
  const source = STATIC_COVER_IMAGES.IMAGE_1;
  const bytes = readFileSync(new URL("../../apps/web/app/assets/cover-images/image_1.jpg", import.meta.url));
  let reads = 0;
  globalThis.fetch = (url, options) => {
    if (url === source) return Promise.resolve(new Response(bytes, { headers: { "Content-Type": "image/jpeg" } }));
    if (String(url).includes("image-gateway.fixture")) { reads++; throw new TypeError("CORS unavailable"); }
    return ipfs.fetch(url, options);
  };
  const payload = await handleCoverImageChange(null, source, {
    workspaceSlug: "test-ws", entityIdentifier: "proj-1", entityType: "PROJECT_COVER",
  });
  assert.equal(ipfs.requests.length, 1);
  assert.equal(reads, 0);
  assert(payload.cover_image.startsWith("https://image-gateway.fixture/ipfs/"));
  const asset = localDB.assets.find(a => a.entity_type === "PROJECT_COVER");
  assert.equal(asset.is_uploaded, true);
  assert.equal(asset.storage, "ipfs");
  assert.equal(asset.preset_key, "IMAGE_1");
  assert.equal(asset.base64, undefined);
  assert.equal(mockDB.storage.has(asset.id), false);
  assert.deepEqual(ipfs.files.get(asset.ipfs_cid).bytes, new Uint8Array(bytes));
  assert.equal(getCoverImageDisplayURL(payload.cover_image, null), source);
  const repeat = await handleRoute("patch", `/api/assets/v2/workspaces/test-ws/${asset.id}/`, { ipfs_cid: asset.ipfs_cid });
  assert.equal(repeat.status, 200, "confirmation is idempotent after the receipt was consumed");
});

test("preset metadata and an arbitrary CID cannot forge a successful upload", async () => {
  const init = await handleRoute("post", "/api/assets/v2/workspaces/test-ws/", {
    entity_type: "PROJECT_COVER", entity_identifier: "proj-1", preset_key: "IMAGE_1", name: "cover.jpg",
  });
  const confirm = await handleRoute("patch", `/api/assets/v2/workspaces/test-ws/${init.data.asset_id}/`, { ipfs_cid: "Qm" + "a".repeat(44) });
  assert.equal(confirm.status, 409);
  assert.equal(localDB.projects[0].cover_image, "");
  assert.equal(localDB.assets[0].is_uploaded, false);
});

test("a failed preset pin keeps the previous project cover", async () => {
  const bytes = readFileSync(new URL("../../apps/web/app/assets/cover-images/image_1.jpg", import.meta.url));
  const source = STATIC_COVER_IMAGES.IMAGE_1;
  globalThis.fetch = (url, options) => url === source
    ? Promise.resolve(new Response(bytes, { headers: { "Content-Type": "image/jpeg" } }))
    : ipfs.fetch(url, options);
  ipfs.failUpload = true;
  localDB.projects[0].cover_image = "previous";
  await assert.rejects(handleCoverImageChange("previous", source, {
    workspaceSlug: "test-ws", entityIdentifier: "proj-1", entityType: "PROJECT_COVER",
  }));
  assert.equal(localDB.projects[0].cover_image, "previous");
  assert.equal(localDB.assets[0].is_uploaded, false);
});

test("a project cover without an existing owner is still rejected", async () => {
  await assert.rejects(
    new FileService().uploadWorkspaceAsset(
      "test-ws",
      {
        entity_identifier: "",
        entity_type: "PROJECT_COVER",
      },
      png()
    )
  );
  assert.equal(localDB.assets.length, 0);
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
  const deleted = await handleRoute(
    "delete",
    `/api/workspaces/test-ws/projects/proj-1/issues/issue-1/attachments/${result.id}/`,
    {}
  );
  assert.equal(deleted.status, 200);
  assert.equal(await getAttachment(result.id), null);
  assert.equal(localDB.issues[0].attachment_count, 0);
  assert(localDB._deleted_attachment_ids.includes(result.id));
});

test("attachment API storage failure preserves bytes, metadata and issue count", async () => {
  const result = await new IssueAttachmentService().uploadIssueAttachment("test-ws", "proj-1", "issue-1", png());
  failWrites = true;
  await assert.rejects(
    handleRoute("delete", `/api/workspaces/test-ws/projects/proj-1/issues/issue-1/attachments/${result.id}/`, {})
  );
  assert.ok(await getAttachment(result.id));
  assert.equal(localDB.attachments.length, 1);
  assert.equal(localDB.issues[0].attachment_count, 1);
});

test("avatar, profile cover and workspace logo use real IPFS URLs without storing image bytes locally", async () => {
  failOpen = true;
  const service = new FileService();
  const avatar = await service.uploadUserAsset({ entity_type: "USER_AVATAR" }, png());
  const cover = await service.uploadUserAsset({ entity_type: "USER_COVER" }, png());
  const logo = await service.uploadWorkspaceAsset(
    "test-ws",
    { entity_type: "WORKSPACE_LOGO", entity_identifier: "ws-1" },
    png()
  );
  for (const result of [avatar, cover, logo])
    assert(result.asset_url.startsWith("https://image-gateway.fixture/ipfs/"));
  for (const result of [avatar, cover, logo]) assert.equal(mockDB.storage.has(result.asset_id), false);
  for (const [key, value] of mockDB.storage) {
    assert.equal(key.startsWith("plane_att_"), false);
    assert.equal(
      String(value).includes("data:image/"),
      false,
      "metadata checkpoints contain references, not image bytes"
    );
  }
  assert.equal(ipfs.requests.length, 3);
  assert(
    localDB.assets.every((asset) => asset.storage === "ipfs" && asset.ipfs_cid && !asset.asset_url.startsWith("data:"))
  );
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
  globalThis.fetch = (url, options) =>
    url === STATIC_COVER_IMAGES.IMAGE_1
      ? Promise.resolve(new Response(jpeg, { headers: { "Content-Type": "image/jpeg" } }))
      : fixtureFetch(url, options);
  window.fiaiSDK = {};
  try {
    const result = await handleCoverImageChange(null, STATIC_COVER_IMAGES.IMAGE_1, {
      entityIdentifier: "",
      entityType: "USER_COVER",
      isUserAsset: true,
    });
    assert.equal(ipfs.requests.length, 1);
    assert(result.cover_image_url.startsWith("https://image-gateway.fixture/ipfs/"));
    assert.equal(result.cover_image_url, result.cover_image);
    assert.equal(localDB.users[0].cover_image_url, result.cover_image_url);
  } finally {
    delete window.fiaiSDK;
  }
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

test("shared IPFS content does not make avatar deletion remove the cover or another user's asset", async () => {
  const service = new FileService();
  const cover = await service.uploadUserAsset({ entity_type: "USER_COVER" }, png());
  const avatar = await service.uploadUserAsset({ entity_type: "USER_AVATAR" }, png());
  assert.equal(avatar.asset_url, cover.asset_url, "IPFS deduplicates the same file into the same CID");
  localDB.assets.unshift({
    ...localDB.assets[1],
    id: "foreign-avatar",
    asset_id: "foreign-avatar",
    created_by: "other-user",
  });
  await service.deleteOldUserAsset(avatar.asset_url);
  assert.equal(localDB.users[0].avatar_url, null);
  assert.equal(localDB.users[0].cover_image_url, cover.asset_url);
  assert(localDB.assets.some((asset) => asset.id === "foreign-avatar"));
  assert(localDB.assets.some((asset) => asset.id === cover.asset_id));
});

test("REVIEW: deleting a cover through the real user endpoint must survive an older snapshot", async () => {
  const { applyOffchainDB } = await import("../../packages/services/dist/index.js");
  await new FileService().uploadUserAsset({ entity_type: "USER_COVER" }, png());
  const previous = structuredClone({ users: localDB.users, workspaces: localDB.workspaces });
  const version = localDB.users[0].media_versions.cover;
  const result = await handleRoute("patch", "/api/users/me/", { cover_image: null, cover_image_url: null });
  assert.equal(result.status, 200);
  assert.equal(localDB.users[0].cover_image_url, null);
  const advanced = localDB.users[0].media_versions.cover > version;
  applyOffchainDB(previous);
  console.log(
    "REVIEW_COVER",
    JSON.stringify({ versionAdvanced: advanced, restoredCover: localDB.users[0].cover_image_url })
  );
  assert.equal(localDB.users[0].cover_image_url, null, "Deleted cover must not return after snapshot restoration");
});

test("REVIEW: cancelling while IPFS confirmation is pending must not commit an avatar", async () => {
  const service = new FileService();
  let release, entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  let reads = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://image-gateway.fixture/") && ++reads === 2) {
      entered();
      await gate;
    }
    return ipfs.fetch(url, options);
  };
  const pending = service.uploadUserAsset({ entity_type: "USER_AVATAR" }, png());
  await ready;
  service.cancelUpload();
  release();
  const outcome = await Promise.allSettled([pending]);
  console.log("REVIEW_CANCEL", JSON.stringify({ outcome: outcome[0].status, avatar: localDB.users[0].avatar_url }));
  assert.equal(localDB.users[0].avatar_url, "", "Cancellation must keep the previous avatar");
});

test("REVIEW: deleting an asset during confirmation must prevent it binding to the user later", async () => {
  const service = new FileService();
  let release, entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  let reads = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://image-gateway.fixture/") && ++reads === 2) {
      entered();
      await gate;
    }
    return ipfs.fetch(url, options);
  };
  const pending = service.uploadUserAsset({ entity_type: "USER_AVATAR" }, png());
  await ready;
  const id = localDB.assets[0].id;
  const removed = await handleRoute("delete", "/api/assets/v2/user-assets/" + id + "/", {});
  assert.equal(removed.status, 200);
  release();
  const outcome = await Promise.allSettled([pending]);
  console.log(
    "REVIEW_DELETE",
    JSON.stringify({
      outcome: outcome[0].status,
      remainingAssets: localDB.assets.length,
      avatar: localDB.users[0].avatar_url,
    })
  );
  assert.equal(localDB.users[0].avatar_url, "", "A deleted asset must not become the avatar");
});

async function logoPermissionRace(action) {
  const wallet = "0x1111111111111111111111111111111111111111";
  sessionStorage.setItem("plane_active_wallet_address", wallet);
  localDB.users[0].metanode_wallet_address = wallet;
  process.env.VITE_WORKSPACE_REGISTRY_ADDRESS = "0x3333333333333333333333333333333333333333";
  process.env.VITE_RPC_URL = "https://review-permission.fixture";
  let release, entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  let reads = 0,
    confirmationReached = false,
    held = false;
  globalThis.fetch = async (url, options) => {
    if (String(url) === "https://review-permission.fixture") {
      if (confirmationReached && !held) {
        held = true;
        entered();
        await gate;
      }
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x" + BigInt(2).toString(16).padStart(64, "0") });
    }
    if (String(url).startsWith("https://image-gateway.fixture/") && ++reads === 2) confirmationReached = true;
    return ipfs.fetch(url, options);
  };
  const service = new FileService();
  const pending = service.uploadWorkspaceAsset(
    "test-ws",
    { entity_type: "WORKSPACE_LOGO", entity_identifier: "ws-1" },
    png()
  );
  await ready;
  const id = localDB.assets[0].id;
  if (action === "cancel") service.cancelUpload();
  else {
    const removed = await handleRoute("delete", "/api/assets/v2/workspaces/test-ws/" + id + "/", {});
    assert.equal(removed.status, 200);
  }
  release();
  const [outcome] = await Promise.allSettled([pending]);
  console.log(
    "REVIEW2_RPC_RACE",
    JSON.stringify({
      action,
      outcome: outcome.status,
      logo: localDB.workspaces[0].logo_url,
      remainingAssets: localDB.assets.length,
    })
  );
  assert.equal(
    localDB.workspaces[0].logo_url,
    "",
    "No logo may be committed after " + action + " during the final permission check"
  );
}

test(
  "REVIEW2: cancellation during final chain permission check must keep old workspace logo",
  { timeout: 10000 },
  async () => {
    try {
      await logoPermissionRace("cancel");
    } finally {
      process.env.VITE_WORKSPACE_REGISTRY_ADDRESS = "";
      process.env.VITE_RPC_URL = "";
    }
  }
);

test(
  "REVIEW2: deletion during final chain permission check must not bind a removed logo",
  { timeout: 10000 },
  async () => {
    try {
      await logoPermissionRace("delete");
    } finally {
      process.env.VITE_WORKSPACE_REGISTRY_ADDRESS = "";
      process.env.VITE_RPC_URL = "";
    }
  }
);
