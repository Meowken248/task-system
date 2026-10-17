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
  passwordHash?: string,
  isFirstUser = false
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
    is_onboarded: isFirstUser,
    onboarding_step: {
      workspace_join: isFirstUser,
      profile_complete: true,
      workspace_create: isFirstUser,
      workspace_invite: true,
    },
    mobile_number: null,
    last_workspace_id: isFirstUser ? "workspace-fiai" : null,
    last_workspace_slug: isFirstUser ? "fiai" : null,
    user_timezone: "Asia/Ho_Chi_Minh",
    username: cleanEmail ? cleanEmail.split("@")[0] : id,
    last_login_medium: "email",
    cover_image_url: null,
    date_joined: new Date().toISOString(),
    theme: { theme: "dark" },
  };
}

// ── OTP Magic Code Helper (10 minutes TTL, max 5 attempts) ───────────────────
export interface IOtpRecord {
  code: string;
  expiresAt: number;
  attempts: number;
}

const OTP_CACHE_KEY = "plane_dapp_otp_cache";
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5;

export function getStoredOtpMap(): Record<string, IOtpRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(OTP_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveStoredOtpMap(map: Record<string, IOtpRecord>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(OTP_CACHE_KEY, JSON.stringify(map));
  } catch { }
}

export function generateAndStoreOtp(email: string): string {
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail) return "";

  // Sinh mã số ngẫu nhiên 6 chữ số từ 100000 đến 999999
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const map = getStoredOtpMap();
  map[cleanEmail] = {
    code,
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  };
  saveStoredOtpMap(map);
  return code;
}

export function verifyOtpCode(
  email: string,
  inputCode: string
): { valid: boolean; error?: string } {
  const cleanEmail = (email || "").trim().toLowerCase();
  const cleanCode = (inputCode || "").trim();

  if (!cleanEmail) {
    return { valid: false, error: "Email không hợp lệ." };
  }
  if (!cleanCode) {
    return { valid: false, error: "Vui lòng nhập mã xác nhận." };
  }

  const map = getStoredOtpMap();
  const record = map[cleanEmail];

  if (!record || !record.code) {
    return {
      valid: false,
      error: "Mã xác nhận không tồn tại hoặc đã hết hạn. Vui lòng bấm gửi lại mã.",
    };
  }

  if (Date.now() > record.expiresAt) {
    delete map[cleanEmail];
    saveStoredOtpMap(map);
    return {
      valid: false,
      error: "Mã xác nhận đã hết hạn (quá 10 phút). Vui lòng bấm gửi lại mã mới.",
    };
  }

  if (record.code !== cleanCode) {
    record.attempts = (record.attempts || 0) + 1;
    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      delete map[cleanEmail];
      saveStoredOtpMap(map);
      return {
        valid: false,
        error: "Bạn đã nhập sai mã quá 5 lần. Mã này đã bị hủy, vui lòng lấy mã mới.",
      };
    }
    saveStoredOtpMap(map);
    return {
      valid: false,
      error: `Mã xác nhận không chính xác. Bạn còn ${MAX_OTP_ATTEMPTS - record.attempts} lần thử!`,
    };
  }

  return { valid: true };
}

export function clearOtpCode(email: string): void {
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail) return;
  const map = getStoredOtpMap();
  if (map[cleanEmail]) {
    delete map[cleanEmail];
    saveStoredOtpMap(map);
  }
}

