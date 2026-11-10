import fs from "node:fs";
import path from "node:path";

// Browser workspace packages used by Web/Spaces. Keep their published exports
// intact; only the dev server resolves those exact entrypoints to source files.
const browserPackages = [
  "constants",
  "editor",
  "hooks",
  "i18n",
  "propel",
  "services",
  "shared-state",
  "types",
  "ui",
  "utils",
];

export function workspaceSourceAliases(root) {
  return browserPackages.flatMap((name) => {
    const dir = path.join(root, "packages", name);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return Object.entries(manifest.exports).map(([entry, target]) => {
      const specifier = entry === "." ? manifest.name : `${manifest.name}/${entry.slice(2)}`;
      let replacement;
      if (entry === "./package.json") {
        replacement = path.join(dir, "package.json");
      } else {
        if (typeof target !== "string" || !target.startsWith("./dist/")) {
          throw new Error(`Unsupported workspace export: ${specifier}`);
        }
        const source = path.join(dir, target.replace("./dist/", "src/").replace(/\.[cm]?js$/, ".ts"));
        replacement = [source, source.replace(/\.ts$/, ".tsx")].find((file) => fs.existsSync(file));
        if (!replacement) throw new Error(`Missing source for workspace export: ${specifier}`);
      }
      return {
        find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
        replacement,
      };
    });
  });
}
