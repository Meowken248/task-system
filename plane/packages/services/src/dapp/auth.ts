import type { DAppUser } from "./types";

// ── Password hashing helper (SHA-256 Web Crypto with salt) ─────────────
export async function hashPassword(password: string): Promise<string> {
  if (!password) return "";
  const enc = new TextEncoder().encode(`plane_dapp_salt:${password}`);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hashBuf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    hash = (hash << 5) - hash + password.charCodeAt(i);
    hash |= 0;
  }
  return `fallback_${Math.abs(hash).toString(16)}`;
}

// ── Permanent Credential Store (Isolated from IPFS sync) ─────────────────
export function getStoredCredentials(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem("plane_dapp_credentials");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function setStoredCredential(email: string, passwordHash: string): void {
  if (typeof window === "undefined" || !email || !passwordHash) return;
  try {
    const creds = getStoredCredentials();
    creds[email.toLowerCase().trim()] = passwordHash;
    localStorage.setItem("plane_dapp_credentials", JSON.stringify(creds));
  } catch { }
}

// ── User factory (Dynamic, zero static mock users) ────────────────────────
export function createUserObject(
  id: string,
  email: string,
  firstName?: string,
  lastName?: string,
  passwordHash?: string
): DAppUser {
  const cleanEmail = (email || "").trim();
  const fName = firstName || (cleanEmail ? cleanEmail.split("@")[0] : "Admin");
  const lName = lastName || "";
  const displayName = `${fName} ${lName}`.trim() || fName;
  const creds = getStoredCredentials();
  const resolvedHash = passwordHash || (cleanEmail ? creds[cleanEmail.toLowerCase()] : null) || null;
  if (cleanEmail && resolvedHash) {
    setStoredCredential(cleanEmail, resolvedHash);
  }
  return {
    id,
    email: cleanEmail,
    first_name: fName,
    last_name: lName,
    display_name: displayName,
    avatar_url: "",
    password_hash: resolvedHash,
    is_bot: false,
    is_active: true,
    is_email_verified: true,
    is_password_autoset: false,
    is_tour_completed: true,
    is_onboarded: true,
    onboarding_step: {
      workspace_join: true,
      profile_complete: true,
      workspace_create: true,
      workspace_invite: true,
    },
    mobile_number: null,
    last_workspace_id: "workspace-fiai",
    last_workspace_slug: "fiai",
    user_timezone: "Asia/Ho_Chi_Minh",
    username: cleanEmail ? cleanEmail.split("@")[0] : id,
    last_login_medium: "email",
    cover_image_url: null,
    date_joined: new Date().toISOString(),
    theme: { theme: "dark" },
  };
}
