import { test } from "node:test";
import assert from "node:assert/strict";
import {
  safeInternalPath,
  getInvitationReturnPath,
  toRouterReturnPath,
  isAccountEntryPath,
} from "../../apps/web/helpers/invitation-navigation.ts";

test("auth round trips retain the complete invitation including token and base path", () => {
  for (const base of ["", "/plane"]) {
    const path = `${base}/workspace-invitations?invitation_id=fixture&slug=team&token=inv_fixture`;
    const auth = new URLSearchParams({ next_path: path, email: "recipient@example.invalid" });
    assert.equal(getInvitationReturnPath(auth), path);
    assert.equal(safeInternalPath(path), path);
  }
});

test("legacy top-level invitation auth links preserve all authorization parameters", () => {
  const params = new URLSearchParams({
    invitation_id: "fixture",
    slug: "team",
    token: "inv_fixture",
    email: "ignored@example.invalid",
  });
  assert.equal(
    getInvitationReturnPath(params),
    "/workspace-invitations?invitation_id=fixture&slug=team&token=inv_fixture"
  );
});

test("unsafe and incomplete return paths cannot become invitation redirects", () => {
  for (const path of [
    "//evil.invalid",
    "https://evil.invalid/",
    "javascript:alert(1)",
    "/\\evil.invalid",
    "/\n/evil.invalid",
    "relative/path",
  ])
    assert.equal(safeInternalPath(path), null);
  for (const path of [
    "//evil.invalid/workspace-invitations?invitation_id=x&slug=y",
    "/workspace-invitations?slug=team",
    "/unrelated?invitation_id=x&slug=team",
  ])
    assert.equal(getInvitationReturnPath(new URLSearchParams({ next_path: path })), null);
});

test("router redirects never duplicate the configured basename or lose the token", () => {
  const path = "/plane/workspace-invitations?invitation_id=x&slug=team&token=secret";
  assert.equal(toRouterReturnPath(path, "/plane/"), path.slice(6));
  assert.equal(toRouterReturnPath(path.slice(6), "/plane"), path.slice(6));
  assert.equal(toRouterReturnPath("/plane/?next_path=x", "/plane"), "/?next_path=x");
});

test("account entry and invitation pages do not require a blocking workspace recovery overlay", () => {
  for (const path of [
    "/",
    "/sign-up/",
    "/workspace-invitations",
    "/accounts/reset-password",
    "/plane/sign-up",
    "/plane/workspace-invitations/",
  ])
    assert.equal(isAccountEntryPath(path, "/plane"), true);
  for (const path of ["/team", "/team/settings/members/", "/plane/team", "/onboarding"])
    assert.equal(isAccountEntryPath(path, "/plane"), false);
});
