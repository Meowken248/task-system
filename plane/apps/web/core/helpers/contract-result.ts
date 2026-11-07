/** SDK versions may return decoded output directly or inside these response envelopes. */
export function readContractString(value: unknown, depth = 0): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || depth > 6) return null;
  if (Array.isArray(value)) return value.length === 1 ? readContractString(value[0], depth + 1) : null;
  const object = value as Record<string, unknown>;
  for (const key of ["result", "data", "output", "returnValue", "returnData", "decoded", "0"]) {
    if (!(key in object)) continue;
    const result = readContractString(object[key], depth + 1);
    if (result !== null) return result;
  }
  return null;
}
