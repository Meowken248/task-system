// oxlint-disable-next-line import/no-unassigned-import -- Isolated browser before DApp imports.
import "./browser.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { localDB, defaultDB } from "../../packages/services/src/dapp/store.ts";
import { applyOffchainDB } from "../../packages/services/src/dapp/chain.ts";
import { setPresentationMedia } from "../../packages/services/src/dapp/presentation-media.ts";

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); document.cookie = "";
  Object.keys(localDB).forEach((key) => delete localDB[key]);
  Object.assign(localDB, structuredClone(defaultDB), { users: [{ id: "user-a", email: "a@example.invalid" }], workspaces: [{ id: "ws-a", slug: "team" }] });
  process.env.VITE_AUTO_COMMIT_ONCHAIN = "false";
});

test("an old snapshot cannot clear a newer avatar, cover and workspace logo", () => {
  setPresentationMedia(localDB.users[0], "avatar", "https://ipfs.fixture/ipfs/avatar");
  setPresentationMedia(localDB.users[0], "cover", "https://ipfs.fixture/ipfs/cover");
  setPresentationMedia(localDB.workspaces[0], "logo", "https://ipfs.fixture/ipfs/logo");
  const snapshot = { users: [{ id: "user-a", email: "a@example.invalid", avatar_url: "", cover_image_url: null }], workspaces: [{ id: "ws-a", slug: "team", logo_url: "" }] };
  applyOffchainDB(snapshot);
  assert.equal(localDB.users[0].avatar_url, "https://ipfs.fixture/ipfs/avatar");
  assert.equal(localDB.users[0].cover_image_url, "https://ipfs.fixture/ipfs/cover");
  assert.equal(localDB.workspaces[0].logo_url, "https://ipfs.fixture/ipfs/logo");
  assert.equal(snapshot.users[0].avatar_url, "", "remote snapshot is not mutated");
});

test("a newer remote image wins over an older local version", () => {
  localDB.users[0].avatar_url = "old"; localDB.users[0].media_versions = { avatar: 100 };
  applyOffchainDB({ users: [{ id: "user-a", email: "a@example.invalid", avatar_url: "new", media_versions: { avatar: 200 } }], workspaces: [] });
  assert.equal(localDB.users[0].avatar_url, "new");
});

test("a deliberate image removal is preserved rather than resurrected by an old snapshot", () => {
  setPresentationMedia(localDB.users[0], "avatar", null);
  applyOffchainDB({ users: [{ id: "user-a", email: "a@example.invalid", avatar_url: "old" }], workspaces: [] });
  assert.equal(localDB.users[0].avatar_url, null);
});

test("newer name edits do not determine which avatar version wins", () => {
  localDB.users[0].avatar_url = "local"; localDB.users[0].media_versions = { avatar: 100 };
  localDB.users[0].updated_at = "2030-01-01T00:00:00Z";
  applyOffchainDB({ users: [{ id: "user-a", email: "a@example.invalid", avatar_url: "remote", media_versions: { avatar: 200 } }], workspaces: [] });
  assert.equal(localDB.users[0].avatar_url, "remote");
});

test("an old project cover cannot replace a newly uploaded cover even if unrelated metadata is newer", () => {
  localDB.projects = [{ id: "project-a", name: "Local", updated_at: "2026-01-01T00:00:00Z" }];
  setPresentationMedia(localDB.projects[0], "cover", "https://ipfs.fixture/ipfs/new-cover");
  applyOffchainDB({ projects: [{ id: "project-a", name: "Remote", cover_image: "old-cover", cover_image_url: "old-cover", updated_at: "2030-01-01T00:00:00Z" }], users: [], workspaces: [] });
  assert.equal(localDB.projects[0].cover_image, "https://ipfs.fixture/ipfs/new-cover");
  assert.equal(localDB.projects[0].cover_image_url, "https://ipfs.fixture/ipfs/new-cover");
  assert.equal(localDB.projects[0].name, "Remote");
});

test("a newer shared project cover wins while a newer local name is retained", () => {
  localDB.projects = [{ id: "project-a", name: "Local name", cover_image: "local", cover_image_url: "local", media_versions: { cover: 100 }, updated_at: "2030-01-01T00:00:00Z" }];
  applyOffchainDB({ projects: [{ id: "project-a", name: "Old name", cover_image: "remote", cover_image_url: "remote", media_versions: { cover: 200 }, updated_at: "2026-01-01T00:00:00Z" }], users: [], workspaces: [] });
  assert.equal(localDB.projects[0].name, "Local name");
  assert.equal(localDB.projects[0].cover_image_url, "remote");
  assert.equal(localDB.projects[0].cover_image, "remote");
  assert.equal(localDB.projects[0].media_versions.cover, 200);
});

test("a removed project cover is not resurrected by an older snapshot", () => {
  localDB.projects = [{ id: "project-a", updated_at: "2026-01-01T00:00:00Z" }];
  setPresentationMedia(localDB.projects[0], "cover", null);
  applyOffchainDB({ projects: [{ id: "project-a", cover_image: "old", cover_image_url: "old", media_versions: { cover: 1 }, updated_at: "2030-01-01T00:00:00Z" }], users: [], workspaces: [] });
  assert.equal(localDB.projects[0].cover_image, null);
  assert.equal(localDB.projects[0].cover_image_url, null);
});
