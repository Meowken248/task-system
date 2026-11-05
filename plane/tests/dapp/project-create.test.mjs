import assert from "node:assert/strict";
import { test } from "node:test";
import { createProjectWithCover } from "../../apps/web/ce/components/projects/create/create-with-cover.ts";

function fixture(overrides = {}) {
  const calls = [];
  const project = { id: "new-project", name: "New project", identifier: "NEW" };
  const services = {
    create: async (data) => {
      calls.push(["create", data]);
      return project;
    },
    uploadCover: async (source, id) => {
      calls.push(["upload", source, id]);
      return "https://gateway.invalid/ipfs/cover";
    },
    saveCover: async (id, url) => {
      calls.push(["save", id, url]);
    },
    ...overrides,
  };
  return { calls, project, services };
}

test("default cover uploads only after creation and uses the returned project ID", async () => {
  const { calls, project, services } = fixture();
  const result = await createProjectWithCover(
    { name: "New project", identifier: "new", cover_image_url: "/assets/default.jpg", cover_image_asset: "old-asset" },
    null,
    services
  );
  assert.equal(result.project, project);
  assert.equal(result.coverFailed, false);
  assert.deepEqual(calls, [
    ["create", { name: "New project", identifier: "NEW" }],
    ["upload", "/assets/default.jpg", "new-project"],
    ["save", "new-project", "https://gateway.invalid/ipfs/cover"],
  ]);
});

test("a custom file replaces its preview without persisting blob URLs", async () => {
  const { calls, services } = fixture();
  const file = new File(["image bytes"], "custom.png", { type: "image/png" });
  await createProjectWithCover(
    { name: "Custom", cover_image_url: "blob:temporary-preview", cover_image: "blob:old-preview" },
    file,
    services
  );
  assert.equal(calls[0][1].cover_image_url, undefined);
  assert.equal(calls[0][1].cover_image, undefined);
  assert.equal(calls[1][1], file);
  assert.equal(calls[1][2], "new-project");
});

test("a failed create does not upload assets or save a cover", async () => {
  const error = new Error("Identifier already exists");
  const { calls, services } = fixture({
    create: async () => {
      throw error;
    },
  });
  await assert.rejects(createProjectWithCover({ cover_image_url: "/assets/default.jpg" }, null, services), error);
  assert.deepEqual(calls, []);
});

for (const failedStep of ["uploadCover", "saveCover"]) {
  test(`${failedStep} failure returns the created project without retrying creation`, async () => {
    const error = new Error("Storage unavailable");
    const { calls, project, services } = fixture({
      [failedStep]: async () => {
        throw error;
      },
    });
    const result = await createProjectWithCover({ cover_image_url: "/assets/default.jpg" }, null, services);
    assert.equal(result.project, project);
    assert.equal(result.coverFailed, true);
    assert.equal(result.coverError, error);
    assert.equal(calls.filter(([name]) => name === "create").length, 1);
  });
}

test("a project without a cover is created without any asset calls", async () => {
  const { calls, services } = fixture();
  assert.equal((await createProjectWithCover({ name: "No cover" }, null, services)).coverFailed, false);
  assert.deepEqual(
    calls.map(([name]) => name),
    ["create"]
  );
});

test("an expired preview without its file is rejected before creation", async () => {
  const { calls, services } = fixture();
  await assert.rejects(
    createProjectWithCover({ cover_image_url: "blob:expired" }, null, services),
    /select the cover image again/
  );
  assert.deepEqual(calls, []);
});
