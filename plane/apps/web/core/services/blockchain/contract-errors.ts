/** Only errors declared by PlaneTaskManager prove that a task is missing. */
const missingNames = new Set(["InvalidTask", "InvalidSubTask"]);
// Selectors verified against ethers.id and the Solidity error declarations.
const missingSelectors = new Set(["0x0531bbb1", "0x10300f62"]);

export function isMissingTaskContractError(error: unknown, visited = new Set<object>(), depth = 0): boolean {
  if (depth > 8) return false;
  if (typeof error === "string") {
    const message = error.trim();
    if (missingSelectors.has(message.toLowerCase())) return true;
    if (/\b(?:InvalidTask|InvalidSubTask)\s*\(\s*\)/.test(message)) return true;
    const returnedData = message.match(/execution reverted\s*:?\s*["']?(0x[0-9a-f]{8})\b/i)?.[1];
    return Boolean(returnedData && missingSelectors.has(returnedData.toLowerCase()));
  }
  if (!error || typeof error !== "object" || visited.has(error)) return false;
  visited.add(error);
  const value = error as Record<string, unknown>;
  if (typeof value.errorName === "string" && missingNames.has(value.errorName)) return true;
  return [value.data, value.message, value.reason, value.error, value.cause, value.info].some((nested) =>
    isMissingTaskContractError(nested, visited, depth + 1)
  );
}
