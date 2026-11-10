import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const spaceClientDir = path.resolve(rootDir, "apps", "space", "build", "client");
const webClientDir = path.resolve(rootDir, "apps", "web", "build", "client");
const webSpacesDir = path.resolve(webClientDir, "spaces");

if (!fs.existsSync(spaceClientDir)) {
  console.warn("[sync-space-build] apps/space/build/client not found. Skipping space bundle sync.");
  process.exit(0);
}

if (!fs.existsSync(webClientDir)) {
  console.warn("[sync-space-build] apps/web/build/client not found. Skipping space bundle sync.");
  process.exit(0);
}

try {
  fs.mkdirSync(webSpacesDir, { recursive: true });
  fs.cpSync(spaceClientDir, webSpacesDir, { recursive: true });
  console.log(`[sync-space-build] Successfully bundled space build into ${webSpacesDir}`);
} catch (err) {
  console.error("[sync-space-build] Error syncing space build:", err);
  process.exit(1);
}

