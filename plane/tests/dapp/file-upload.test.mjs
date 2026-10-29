import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  saveAttachment,
  getAttachment,
  deleteAttachment,
  FileUploadService,
  handleRoute,
  localDB,
} from "../../packages/services/dist/index.js";

// Mock IndexedDB and browser globals for Node test environment
class MockIDBRequest {
  constructor() {
    this.result = null;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
  }
}

class MockIDBTransaction {
  constructor(store) {
    this.store = store;
    this.oncomplete = null;
    this.onerror = null;
  }
  objectStore() {
    return this.store;
  }
}

class MockIDBObjectStore {
  constructor(map) {
    this.map = map;
  }
  put(item) {
    this.map.set(item.key, item);
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
    this.map.delete(key);
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
  transaction() {
    const tx = new MockIDBTransaction(new MockIDBObjectStore(this.storage));
    queueMicrotask(() => {
      if (tx.oncomplete) tx.oncomplete();
    });
    return tx;
  }
  addEventListener() {}
}

const mockDB = new MockIDBDatabase();

beforeEach(() => {
  mockDB.storage.clear();
  globalThis.window = {
    indexedDB: {
      open: () => {
        const req = new MockIDBRequest();
        queueMicrotask(() => {
          req.result = mockDB;
          if (req.onsuccess) req.onsuccess({ target: req });
        });
        return req;
      },
    },
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
      logo_url: "",
    },
  ];
  localDB.projects = [
    {
      id: "proj-1",
      identifier: "PROJ",
      name: "Test Project",
      cover_image: "",
    },
  ];
  localDB.attachments = [];
  localDB.assets = [];
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
  const sampleBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
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
    name: "my-avatar.jpg",
    type: "image/jpeg",
    size: 512,
    entity_type: "USER_AVATAR",
    entity_identifier: "user-1",
  });
  assert.equal(initRes.status, 200);
  const assetId = initRes.data.asset_id;

  // 2. Upload avatar image
  const avatarBase64 = "/9j/4AAQSkZJRgABAQEASABIAAD/";
  await handleRoute("post", "/api/assets/v2/upload/", {
    asset_id: assetId,
    name: "my-avatar.jpg",
    base64: avatarBase64,
    type: "image/jpeg",
    size: 20,
  });

  // 3. Confirm avatar upload
  const patchRes = await handleRoute("patch", `/api/assets/v2/user-assets/${assetId}/`, {});
  assert.equal(patchRes.status, 200);

  // 4. Verify user avatar was updated
  const user = localDB.users.find((u) => u.id === "user-1");
  assert.ok(user.avatar_url.startsWith("data:image/jpeg;base64,"));
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
  const res = await handleRoute(
    "get",
    "/api/workspaces/test-ws/projects/proj-1/issues/issue-test-1/",
    {}
  );
  assert.equal(res.status, 200);
  assert.equal(res.data.id, "issue-test-1");
  // Attachment count must reflect real attachments in DB, not stale 0
  assert.equal(res.data.attachment_count, 1);
  assert.equal(res.data.issue_attachments.length, 1);
  assert.equal(res.data.issue_attachments[0].attributes.name, "Time off.xlsx");

  // 2. Fetch issue list
  const listRes = await handleRoute(
    "get",
    "/api/workspaces/test-ws/projects/proj-1/issues/?all=true",
    {}
  );
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

