/** SHA-256 of the actual bundled JPEG bytes. Update deliberately when replacing a preset. */
export const COVER_PRESET_SHA256 = {
  IMAGE_1: "e7d6abc7b352b2567c14d0c72587c3900280861ef10e2b10810c7bb685f00964",
  IMAGE_2: "6cca4d1257aeb44d086c0fc8a06b78e6bfe8af652b4cfd67e96e08879536f0e0",
  IMAGE_3: "18a691508e4f94a28dc16bc887a2917b6a55cfe6cdf117dd66ceb538357b4640",
  IMAGE_4: "4aff8052056ed6e7ebcfb326042f16269186599a1f1379d3b297ccad9e5e0460",
  IMAGE_5: "6abb74a8698c639637bf1f410a24f5699ed6e10213b2341f374b2c1d9a05463a",
  IMAGE_6: "209c9f333024a071ae651dc77c41dc53562a51fad54061bd6176d7fc4fd2e41c",
  IMAGE_7: "d8976d84ce9e3860ad472b03e0446199563a0bb599e750aaa848dce13ded3baa",
  IMAGE_8: "3e1552e766a2b895239ec9b54f04fe9996fe10d0327051d93ccc749ca304f7c4",
  IMAGE_9: "57881fb83d079d9e3095001d44a6ebcbf0e77f80bd625a7d4a53c873c1a884a6",
  IMAGE_10: "0627dd6e167779130e2bdcfae16ef4e80d328bf000cab7da99830899f39314f2",
  IMAGE_11: "08310d5a300030faf14ec5045fced0f53881af02f643e0c742554496c0d2760a",
  IMAGE_12: "ce44808a88f876ce56c78b2eca0f688aebb8263e6b0603f18b1987fc52d819cc",
  IMAGE_13: "ec6683ac6fe64bc2e3bdb6215544d79798c2e58c853ded24b7dcaef2d432d896",
  IMAGE_14: "23eb3edb547d9bfcbc419dbf1711e7c5353ab20bd13b7713d9c10734fc2e42cf",
  IMAGE_15: "d804aec41e72b817d26553bca7a8634fc1e10307a49ceeb0db502aacb334b9c6",
  IMAGE_16: "aab908fe69528182cc799173027c00a604efc102af4931312191df488058d551",
  IMAGE_17: "634fe14ffa74abc612132e9054c9df0601d070a838ea510bebbe15ad2f8d1dd1",
  IMAGE_18: "30bfddbac5883b5c27333fcf998d8eb658f13617a55e59a440233a0b8d5a7005",
  IMAGE_19: "16a17048ededf6972b2a902908e5b9a63f15f9f91b2f4fd11dfec810f2375cc0",
  IMAGE_20: "b6bab45f0fc08df184d43c871c34f96b387b208582c318ccb43c66fad1242d09",
  IMAGE_21: "43586197ef78d839b401907b3cd77a25fa23088d9ffc0e1ff1417582c959ce9f",
  IMAGE_22: "02778b895e42406426fe1088841bce8952b52cb73361701aff420e4be598c664",
  IMAGE_23: "199a76c968b34357ec4d04cb1a36a891cfcd98bd4831192d5fa20b8d445f43d0",
  IMAGE_24: "20faf81938c8c10de7a4bc1892fdd2008afde0e114edf2e6a3a03e1ba94da9f3",
  IMAGE_25: "71bf0768340e1a38a7d787867c279432d6baafd60a426945934c0af09ca56cd7",
  IMAGE_26: "b4dc30269ff4f1c72ea9d8feb41745b5addc726337c5e0c8e9e3572cd935913b",
  IMAGE_27: "37d96d025aa28fe38ff31da556520fd008b8e221d9d37b52c9024a8614ac5a52",
  IMAGE_28: "90b212c93dd07e4a19821f1d8b8237777c581d5217c2e1dd09052f64ee2b14ba",
  IMAGE_29: "1116ff4fba721cc59a473e80f4ec211cc6f9fbe962900366c8fcb1b4168046e0",
} as const;
export type CoverPresetKey = keyof typeof COVER_PRESET_SHA256;
export const isCoverPresetKey = (value: unknown): value is CoverPresetKey =>
  typeof value === "string" && Object.hasOwn(COVER_PRESET_SHA256, value);

type PinReceipt = { cid: string; url: string; presetKey: CoverPresetKey; sha256: string; expires: number };
const receipts = new Map<string, PinReceipt>();

export async function verifyCoverPreset(file: File, key: unknown): Promise<CoverPresetKey> {
  if (!isCoverPresetKey(key)) throw new Error("Ảnh mẫu không hợp lệ.");
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const digest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== COVER_PRESET_SHA256[key]) throw new Error("Nội dung ảnh không khớp ảnh mẫu của ứng dụng.");
  return key;
}

/** Memory-only evidence of an actual successful pin request; never an API-supplied flag. */
export function recordPresetPin(assetId: string, cid: string, url: string, presetKey: CoverPresetKey): void {
  for (const [key, receipt] of receipts) if (receipt.expires <= Date.now()) receipts.delete(key);
  if (receipts.size >= 128) receipts.delete(receipts.keys().next().value!);
  receipts.set(assetId, {
    cid,
    url,
    presetKey,
    sha256: COVER_PRESET_SHA256[presetKey],
    expires: Date.now() + 5 * 60 * 1000,
  });
}

export function getPresetPin(assetId: string, cid: string, presetKey: unknown): PinReceipt | undefined {
  const receipt = receipts.get(assetId);
  if (!receipt || receipt.expires <= Date.now()) {
    receipts.delete(assetId);
    return undefined;
  }
  return receipt.cid === cid && receipt.presetKey === presetKey ? receipt : undefined;
}
export function forgetPresetPin(assetId: string): void {
  receipts.delete(assetId);
}

/** Resolve only a confirmed, hash-checked bundled image; no local image bytes are stored. */
export function getPinnedCoverPresetKey(assets: readonly any[], url: string): CoverPresetKey | undefined {
  const record = assets.find((asset) => {
    const key = asset?.preset_key;
    return (
      asset?.asset_url === url &&
      asset?.entity_type === "PROJECT_COVER" &&
      asset?.is_uploaded === true &&
      asset?.storage === "ipfs" &&
      Boolean(asset?.ipfs_cid) &&
      isCoverPresetKey(key) &&
      asset?.preset_sha256 === COVER_PRESET_SHA256[key]
    );
  });
  return isCoverPresetKey(record?.preset_key) ? record.preset_key : undefined;
}
