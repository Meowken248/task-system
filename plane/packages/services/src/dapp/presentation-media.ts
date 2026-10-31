const slots = {
  avatar: ["avatar_url", "avatar"],
  cover: ["cover_image_url", "cover_image"],
  logo: ["logo_url"],
} as const;
type MediaSlot = keyof typeof slots;

/** A version belongs to an image field, not to unrelated name/theme edits. */
export function setPresentationMedia(record: any, slot: MediaSlot, value: string | null): void {
  const fields = slots[slot];
  if (record.media_versions?.[slot] && fields.every((field) => record[field] === value)) return;
  record.media_versions = { ...record.media_versions, [slot]: Math.max(Date.now(), Number(record.media_versions?.[slot] || 0) + 1) };
  for (const field of fields) record[field] = value;
}

export function preserveNewerPresentationMedia(local: any, shared: any, kind: "user" | "workspace"): void {
  const selected: MediaSlot[] = kind === "user" ? ["avatar", "cover"] : ["logo"];
  for (const slot of selected) {
    const fields = slots[slot];
    const localVersion = Number(local.media_versions?.[slot]) || 0;
    const sharedVersion = Number(shared.media_versions?.[slot]) || 0;
    const localValue = local[fields[0]];
    const sharedValue = shared[fields[0]];
    const legacyLocalTime = Date.parse(local.updated_at || local.created_at || "") || 0;
    const legacySharedTime = Date.parse(shared.updated_at || shared.created_at || "") || 0;
    const keepLocal = localVersion > sharedVersion || (!localVersion && !sharedVersion &&
      localValue !== undefined && (legacyLocalTime > legacySharedTime || (Boolean(localValue) && !sharedValue && legacyLocalTime >= legacySharedTime)));
    if (!keepLocal) continue;
    for (const field of fields) if (Object.hasOwn(local, field)) shared[field] = local[field];
    if (localVersion) shared.media_versions = { ...shared.media_versions, [slot]: localVersion };
  }
}

export function applyPresentationMediaPatch(record: any, patch: Record<string, any>, kind: "user" | "workspace"): void {
  const selected: MediaSlot[] = kind === "user" ? ["avatar", "cover"] : ["logo"];
  for (const slot of selected) {
    const field = slots[slot].find((key) => Object.hasOwn(patch, key));
    if (field && (typeof patch[field] === "string" || patch[field] === null)) setPresentationMedia(record, slot, patch[field]);
  }
}
