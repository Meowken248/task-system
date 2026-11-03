const CHANNEL = "plane-dashboard-updates";
const source = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
export type DashboardUpdate = { workspaceSlug: string; projectId: string };
const listeners = new Set<(update: DashboardUpdate) => void>();

/** Notification only. No snapshot, report bytes, signing, or persistent storage. */
export function notifyDashboardUpdate(update: DashboardUpdate): void {
  listeners.forEach((listener) => {
    try {
      listener(update);
    } catch (error) {
      console.warn("Dashboard refresh listener failed", error);
    }
  });
  if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(CHANNEL);
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel is same-origin and has no targetOrigin parameter.
      channel.postMessage({ ...update, source });
      channel.close();
    } catch (error) {
      console.warn("Dashboard notification unavailable", error);
    }
  }
}

export function subscribeDashboardUpdates(listener: (update: DashboardUpdate) => void): () => void {
  listeners.add(listener);
  let channel: BroadcastChannel | null = null;
  try {
    if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined")
      channel = new BroadcastChannel(CHANNEL);
  } catch (error) {
    console.warn("Dashboard cross-tab notifications unavailable", error);
  }
  if (channel)
    channel.addEventListener("message", (event: MessageEvent<DashboardUpdate>) => {
      const value = event.data;
      if ((value as DashboardUpdate & { source?: string })?.source === source) return;
      if (typeof value?.workspaceSlug === "string" && typeof value?.projectId === "string") listener(value);
    });
  return () => {
    listeners.delete(listener);
    channel?.close();
  };
}
