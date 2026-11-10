import { test } from "node:test";
import assert from "node:assert/strict";
import { planWorkspaceMigration } from "../../scripts/preview-workspace-registry-migration.mjs";

const owner = "0x1111111111111111111111111111111111111111";
const member = "0x2222222222222222222222222222222222222222";
const workspace = (members) => ({ slug: "audit", name: "Audit", owner, cid: "cid", members });

test("migration deduplicates historical members without dropping the owner", () => {
  const result = planWorkspaceMigration(
    workspace([
      { address: member, role: 1 },
      { address: member, role: 1 },
    ])
  );
  assert.equal(result.members.length, 2);
  assert.equal(result.members.find((entry) => entry.address === owner).role, 3);
});
test("migration normalizes a stale Owner role against the canonical owner", () => {
  const result = planWorkspaceMigration(workspace([{ address: member, role: 3 }]));
  assert.equal(result.members.find((entry) => entry.address === member).role, 2);
  assert.equal(result.normalizations.length, 1);
});
test("migration preview does not mutate the source input", () => {
  const source = workspace([{ address: member, role: 3 }]);
  const original = structuredClone(source);
  planWorkspaceMigration(source);
  assert.deepEqual(source, original);
});
test("migration fails on an invalid active role", () =>
  assert.throws(() => planWorkspaceMigration(workspace([{ address: member, role: 9 }]))));
