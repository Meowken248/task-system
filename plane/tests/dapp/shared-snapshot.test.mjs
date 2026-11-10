// oxlint-disable-next-line import/no-unassigned-import -- Install browser fixtures before importing the actual DApp modules.
import "./browser.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { localDB, defaultDB, getDBSnapshot } from "../../packages/services/src/dapp/store.ts";
import { applyOffchainDB } from "../../packages/services/src/dapp/chain.ts";
import { getStoredCredentials, setStoredCredential } from "../../packages/services/src/dapp/auth.ts";
import { preserveLocalUserAuth, sanitizeSharedSnapshot } from "../../packages/services/src/dapp/shared-snapshot.ts";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "";
  Object.keys(localDB).forEach((key) => delete localDB[key]);
  Object.assign(localDB, structuredClone(defaultDB));
});

test("refresh preserves editor comments and uploaded asset metadata missing from an older snapshot", () => {
  const url = "data:image/png;base64,YQ==";
  localDB.comments = [
    {
      id: "comment-with-image",
      issue: "issue-1",
      comment_html: '<image-component src="asset-1"></image-component>',
      updated_at: "2026-10-31T10:00:00Z",
    },
  ];
  localDB.assets = [
    { id: "asset-1", asset_id: "asset-1", asset_url: url, is_uploaded: true, updated_at: "2026-10-31T10:00:00Z" },
  ];
  applyOffchainDB({ comments: [], assets: [], users: [], workspaces: [] });
  assert.equal(localDB.comments[0].id, "comment-with-image");
  assert.equal(localDB.assets[0].asset_url, url);
});

test("newer remote editor comments and asset metadata win without duplicating records", () => {
  localDB.comments = [{ id: "comment", comment_html: "old", updated_at: "2026-10-29T00:00:00Z" }];
  localDB.assets = [{ id: "asset", name: "old", updated_at: "2026-10-29T00:00:00Z" }];
  applyOffchainDB({
    comments: [{ id: "comment", comment_html: "new", updated_at: "2026-10-31T00:00:00Z" }],
    assets: [{ id: "asset", name: "new", updated_at: "2026-10-31T00:00:00Z" }],
    users: [],
    workspaces: [],
  });
  assert.equal(localDB.comments.length, 1);
  assert.equal(localDB.comments[0].comment_html, "new");
  assert.equal(localDB.assets.length, 1);
  assert.equal(localDB.assets[0].name, "new");
});

test("old snapshots cannot resurrect deleted editor assets, attachments or comments", () => {
  localDB._deleted_asset_ids = ["asset-deleted"];
  localDB._deleted_attachment_ids = ["attachment-deleted"];
  localDB._deleted_comment_ids = ["comment-deleted"];
  applyOffchainDB({
    assets: [{ id: "asset-deleted" }],
    attachments: [{ id: "attachment-deleted" }],
    comments: [{ id: "comment-deleted" }],
    issue_comments: [{ id: "comment-deleted" }],
    users: [],
    workspaces: [],
  });
  assert.deepEqual(localDB.assets, []);
  assert.deepEqual(localDB.attachments, []);
  assert.deepEqual(localDB.comments, []);
  assert.deepEqual(localDB.issue_comments, []);
});

test("shared exports omit credentials and nested secrets without mutating local profiles", () => {
  setStoredCredential("owner@example.invalid", "local-password-hash");
  localDB.users = [
    {
      id: "owner",
      email: "owner@example.invalid",
      password_hash: "private-hash",
      is_email_verified: true,
      theme: { theme: "dark" },
    },
  ];
  localDB.credentials = { "legacy@example.invalid": "legacy-hash" };
  localDB.linkToken = "private-v3-locator";
  localDB.private_settings = {
    privateKey: "test-key",
    nested: [{ sessionToken: "test-session", otp_code: "123456", name: "keep" }],
  };
  const before = structuredClone(localDB);
  const result = getDBSnapshot();
  assert.equal(result.credentials, undefined);
  assert.equal(result.linkToken, undefined);
  assert.equal(result.users[0].password_hash, undefined);
  assert.equal(result.users[0].is_email_verified, undefined);
  assert.deepEqual(result.private_settings, { nested: [{ name: "keep" }] });
  assert.deepEqual(localDB, before);
  assert.equal(getStoredCredentials()["owner@example.invalid"], "local-password-hash");
  result.users[0].theme.theme = "light";
  assert.equal(localDB.users[0].theme.theme, "dark");
});

test("legacy invitation locators and workspace data survive sanitization", () => {
  const input = {
    invitations: [{ id: "invite", token: "legacy-locator", role: 15 }],
    issues: [{ description: "Work item", token_count: 3 }],
  };
  assert.deepEqual(sanitizeSharedSnapshot(input), input);
});

test("remote snapshots cannot install credentials or email-verification flags", () => {
  setStoredCredential("owner@example.invalid", "trusted-local-hash");
  const remote = {
    users: [
      { id: "intruder", email: "remote@example.invalid", password_hash: "injected-hash", is_email_verified: true },
    ],
    credentials: { "owner@example.invalid": "replaced", "remote@example.invalid": "injected" },
    workspaces: [],
  };
  const before = structuredClone(remote);
  applyOffchainDB(remote);
  assert.deepEqual(getStoredCredentials(), { "owner@example.invalid": "trusted-local-hash" });
  assert.equal(localDB.users.find((user) => user.id === "intruder").password_hash, undefined);
  assert.equal(localDB.users.find((user) => user.id === "intruder").is_email_verified, undefined);
  assert.deepEqual(remote, before);
});

test("merging a remote profile retains private auth already held on this device", () => {
  localDB.users = [
    { id: "owner", email: "owner@example.invalid", password_hash: "local-hash", is_email_verified: true },
  ];
  applyOffchainDB({
    users: [{ id: "owner", email: "owner@example.invalid", password_hash: "remote-hash", is_email_verified: false }],
    workspaces: [],
  });
  const user = localDB.users.find((entry) => entry.id === "owner");
  assert.equal(user.password_hash, "local-hash");
  assert.equal(user.is_email_verified, true);
  assert.equal(getDBSnapshot().users.find((entry) => entry.id === "owner").password_hash, undefined);
});

test("a colliding remote user ID cannot attach local authentication to another email", () => {
  const local = { id: "owner", email: "owner@example.invalid", password_hash: "local-hash" };
  const remote = { id: "owner", email: "attacker@example.invalid" };
  preserveLocalUserAuth(local, remote);
  assert.equal(remote.password_hash, undefined);
  localDB.users = [local];
  applyOffchainDB({ users: [remote], workspaces: [] });
  assert.equal(localDB.users.find((user) => user.id === "owner").email, "owner@example.invalid");
  assert.equal(getStoredCredentials()["attacker@example.invalid"], undefined);
});

test("shared objects cannot inject prototype keys", () => {
  const result = sanitizeSharedSnapshot(
    JSON.parse('{"__proto__":{"polluted":true},"users":[],"constructor":{"prototype":{"polluted":true}}}')
  );
  assert.deepEqual(result, { users: [] });
  assert.equal({}.polluted, undefined);
});
