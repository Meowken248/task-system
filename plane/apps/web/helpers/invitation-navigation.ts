/** Return paths must stay inside this origin, including after URL parsing. */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return null;
  try {
    const url = new URL(value, "https://plane.invalid");
    return url.origin === "https://plane.invalid" ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

export function getInvitationReturnPath(params: URLSearchParams): string | null {
  const next = safeInternalPath(params.get("next_path"));
  if (next) {
    const url = new URL(next, "https://plane.invalid");
    if (
      /(^|\/)workspace-invitations\/?$/.test(url.pathname) &&
      url.searchParams.get("invitation_id") &&
      url.searchParams.get("slug")
    )
      return next;
  }
  if (!params.get("invitation_id") || !params.get("slug")) return null;
  const query = new URLSearchParams();
  for (const key of ["invitation_id", "slug", "token"]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  return `/workspace-invitations?${query}`;
}

/** React Router adds its basename itself; hard navigations use the full path. */
export function toRouterReturnPath(path: string, basename: string): string {
  const base = basename.replace(/\/+$/, "");
  const url = new URL(path, "https://plane.invalid");
  if (base && (url.pathname === base || url.pathname.startsWith(`${base}/`)))
    return `${url.pathname.slice(base.length) || "/"}${url.search}${url.hash}`;
  return path;
}

export function isAccountEntryPath(pathname: string, basename: string): boolean {
  const path = toRouterReturnPath(pathname, basename).split("?")[0].replace(/\/+$/, "") || "/";
  return path === "/" || path === "/sign-up" || path === "/workspace-invitations" || path.startsWith("/accounts/");
}
