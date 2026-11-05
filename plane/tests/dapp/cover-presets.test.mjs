import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  COVER_PRESET_SHA256,
  verifyCoverPreset,
  getPinnedCoverPresetKey,
} from "../../packages/services/src/file/cover-presets.ts";

test("every bundled cover matches its checked-in SHA-256 manifest", async () => {
  await Promise.all(
    Object.keys(COVER_PRESET_SHA256).map(async (key) => {
      const bytes = readFileSync(
        new URL(`../../apps/web/app/assets/cover-images/image_${key.slice(6)}.jpg`, import.meta.url)
      );
      assert.equal(await verifyCoverPreset(new File([bytes], "cover.jpg"), key), key);
    })
  );
});

test("arbitrary file bytes and unknown preset keys cannot use the preset flow", async () => {
  await assert.rejects(verifyCoverPreset(new File(["not the preset"], "cover.jpg"), "IMAGE_1"), /khớp/);
  await assert.rejects(verifyCoverPreset(new File(["data"], "cover.jpg"), "IMAGE_999"), /hợp lệ/);
});

test("bundled display requires a confirmed IPFS asset with the matching digest", () => {
  const record = {
    entity_type: "PROJECT_COVER",
    is_uploaded: true,
    storage: "ipfs",
    ipfs_cid: "pinned",
    asset_url: "https://gateway.invalid/ipfs/pinned",
    preset_key: "IMAGE_1",
    preset_sha256: COVER_PRESET_SHA256.IMAGE_1,
  };
  assert.equal(getPinnedCoverPresetKey([record], record.asset_url), "IMAGE_1");
  for (const patch of [
    { is_uploaded: false },
    { storage: "local" },
    { preset_sha256: "wrong" },
    { entity_type: "USER_COVER" },
  ]) {
    assert.equal(getPinnedCoverPresetKey([{ ...record, ...patch }], record.asset_url), undefined);
  }
  assert.equal(getPinnedCoverPresetKey([record], "https://gateway.invalid/ipfs/another"), undefined);
});
