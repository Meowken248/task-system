import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { workspaceSourceAliases } from "../scripts/workspace-source-aliases.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const aliases = workspaceSourceAliases(root);
const resolve = (specifier) => aliases.find(({ find }) => find.test(specifier))?.replacement;

test("every mapped browser workspace export exists independently of dist", () => {
  assert.ok(aliases.length > 0);
  for (const alias of aliases) {
    assert.ok(fs.statSync(alias.replacement).isFile());
    const relative = path.relative(root, alias.replacement).replaceAll("\\", "/");
    assert.ok(!relative.includes("/dist/"), relative);
    assert.ok(relative.includes("/src/") || relative.endsWith("/package.json"), relative);
  }
});

test("Propel modules, nested charts and CSS resolve to their real source entrypoints", () => {
  for (const [specifier, source] of [
    ["@plane/propel/banner", "packages/propel/src/banner/index.ts"],
    ["@plane/propel/button", "packages/propel/src/button/index.ts"],
    ["@plane/propel/charts/area-chart", "packages/propel/src/charts/area-chart/index.ts"],
    ["@plane/propel/styles/react-day-picker.css", "packages/propel/src/styles/react-day-picker.css"],
    ["@plane/editor/lib", "packages/editor/src/lib.ts"],
    ["@plane/editor/styles", "packages/editor/src/styles/index.css"],
    ["@plane/editor/styles.css", "packages/editor/src/styles/index.css"],
    ["@plane/hooks", "packages/hooks/src/index.ts"],
  ])
    assert.equal(resolve(specifier), path.join(root, source));
});

test("source aliases preserve package.json and match only exported names", () => {
  assert.equal(resolve("@plane/propel/package.json"), path.join(root, "packages/propel/package.json"));
  for (const specifier of [
    "@plane/propel/banner-extra",
    "@plane/propel/banner/internal",
    "@plane/editor/stylesXcss",
    "@plane/hooks-extra",
  ]) {
    assert.equal(resolve(specifier), undefined);
  }
});
