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
