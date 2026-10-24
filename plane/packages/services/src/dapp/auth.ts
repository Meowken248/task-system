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
  /** SHA-256 của mã xác nhận — KHÔNG bao giờ lưu mã thô trong trình duyệt. */
  codeHash: string;
  /** Trường của dữ liệu cũ (mã thô). Bị xoá ngay khi đọc, không dùng để xác thực. */
  code?: string;
  expiresAt: number;
  attempts: number;
}

const OTP_CACHE_KEY = "plane_dapp_otp_cache";
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5;
const OTP_HASH_PREFIX = "sha256:";

/** Sinh mã 6 chữ số bằng nguồn ngẫu nhiên mật mã (không dùng Math.random đơn thuần). */
function createOtpCode(): string {
  const values = new Uint32Array(1);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(values);
  } else {
    // Môi trường rất cũ: vẫn còn ngẫu nhiên, chỉ kém mạnh hơn.
    values[0] = Math.floor(Math.random() * 0xffffffff);
  }
  return (100000 + (values[0] % 900000)).toString();
}

/** Băm mã xác nhận trước khi lưu. Không lưu mã thô để tránh lộ khi máy bị đọc trộm. */
async function hashOtpCode(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(code);
  if (typeof crypto !== "undefined" && crypto.subtle?.digest) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return (
      OTP_HASH_PREFIX +
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
    );
  }
  // Không có WebCrypto: vẫn băm (không lưu thô). Chỉ dùng cho trình duyệt quá cũ.
  let hash = 0;
  for (let index = 0; index < code.length; index += 1) hash = (hash * 31 + code.charCodeAt(index)) | 0;
  return `${OTP_HASH_PREFIX}fallback:${(hash >>> 0).toString(16)}`;
}

/** So sánh chuỗi theo thời gian hằng để không lộ thông tin qua thời gian phản hồi. */
function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

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

export async function generateAndStoreOtp(email: string): Promise<string> {
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail) return "";

  const code = createOtpCode();
  const map = getStoredOtpMap();
  map[cleanEmail] = {
    codeHash: await hashOtpCode(code),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  };
  saveStoredOtpMap(map);
  return code;
}

export async function verifyOtpCode(
  email: string,
  inputCode: string
): Promise<{ valid: boolean; error?: string }> {
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

  // Dữ liệu cũ (trước khi băm) không còn dùng được → buộc lấy mã mới.
  if (!record || !record.codeHash) {
    if (record) {
      delete map[cleanEmail];
      saveStoredOtpMap(map);
    }
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

  const matches = safeEqual(record.codeHash, await hashOtpCode(cleanCode));
  if (!matches) {
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

