/** Coalesces updates during a read into one follow-up; disposal prevents stale commits. */
export function createRefreshController(read: (isCurrent: () => boolean) => Promise<void>) {
  let active = true;
  let running = false;
  let pending = false;
  const request = async (queueIfRunning = true): Promise<void> => {
    if (!active || (running && !queueIfRunning)) return;
    pending = true;
    if (running) return;
    running = true;
    try {
      while (pending) {
        if (!active) break;
        pending = false;
        // oxlint-disable-next-line no-await-in-loop -- Reads must never overlap; pending is set by external updates.
        await read(() => active);
      }
    } finally {
      running = false;
    }
  };
  return {
    request,
    dispose: () => {
      active = false;
      pending = false;
    },
  };
}
