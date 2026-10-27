/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** Opaque, cryptographically random tokens identify stored invitation records.
 * Legacy payloads are lookup hints only and must never grant membership. */

/** Prefix of every invitation token. */
export const INVITE_TOKEN_PREFIX = "inv_";

/** Invitation links stay valid for 14 days (enterprise default, rotate by re-inviting). */
export const INVITE_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Token format version written by `createInvitationToken`. */
export const INVITE_TOKEN_VERSION = 2;

/** Hard cap so a hostile link cannot force a huge base64/JSON parse. */
const MAX_TOKEN_LENGTH = 4096;

export type InvitationTokenClaims = {
  /** Format version (`undefined` for legacy links issued before versioning). */
  v?: number;
  /** Invitation record id inside the workspace database. */
  id: string;
  /** Workspace slug the invitation belongs to. */
  ws: string;
  /** Invited email — typed by the admin. Absent for wallet invitations. */
  email?: string;
  /** Plane role of the invitee (15 = Member, 20 = Admin). */
  role?: number;
  /** Wallet address for wallet invitations. */
  wallet?: string;
  /** ISO timestamp of the moment the link was issued. */
  iat?: string;
  /** ISO timestamp after which the link must not be accepted. */
  exp?: string;
};

export type CreateInvitationTokenInput = {
  id: string;
  workspaceSlug: string;
  email?: string | null;
  role?: number | null;
  wallet?: string | null;
  expiresAt?: string | null;
  /** Injectable clock (tests). */
  now?: Date;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fromBase64Url(value: string): string {
  const raw = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = raw.length % 4 === 0 ? raw : raw + "=".repeat(4 - (raw.length % 4));
  if (typeof Buffer !== "undefined") {
    return Buffer.from(padded, "base64").toString("utf-8");
  }
  let binary = "";
  try {
    binary = atob(padded);
  } catch {
    return "";
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Generate the opaque token embedded in the email link. Identity and expiry
 * belong to the stored record. The optional input is kept for legacy callers;
 * none of its claims are encoded or trusted.
 */
export function createInvitationToken(_input?: CreateInvitationTokenInput): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Trình duyệt chưa hỗ trợ tạo liên kết mời an toàn. Hãy dùng kết nối bảo mật.");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `${INVITE_TOKEN_PREFIX}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Decode and normalise the claims of an invitation token.
 * Returns `null` for opaque/legacy tokens or malformed payloads — callers must
 * then fall back to the stored record / on-chain snapshot only.
 */
export function decodeInvitationToken(token: string | null | undefined): InvitationTokenClaims | null {
  const raw = typeof token === "string" ? token.trim() : "";
  if (!raw || !raw.startsWith(INVITE_TOKEN_PREFIX) || raw.length > MAX_TOKEN_LENGTH) return null;

  const json = fromBase64Url(raw.slice(INVITE_TOKEN_PREFIX.length));
  if (!json) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const id = cleanString(parsed.id);
  const ws = cleanString(parsed.ws).toLowerCase();
  if (!id || !ws) return null;

  const claims: InvitationTokenClaims = { id, ws };
  return claims;
}

/** `true` when the link claims describe the invitation that is being opened. */
export function claimsMatchInvitation(
  claims: InvitationTokenClaims | null | undefined,
  target: { workspaceSlug?: string | null; invitationId?: string | null }
): boolean {
  if (!claims) return false;
  const slug = cleanString(target?.workspaceSlug).toLowerCase();
  if (!slug || claims.ws !== slug) return false;
  const invitationId = cleanString(target?.invitationId);
  if (invitationId && claims.id !== invitationId) return false;
  return true;
}

/**
 * Expiry of a stored invitation record.
 * Accepts both the record fields (`token_expires_at` / `invite_expires_at`) and
 * the `exp` claim of the link token.
 */
export function isInvitationTokenExpired(record: any, now: number = Date.now()): boolean {
  const candidates = [record?.token_expires_at, record?.invite_expires_at, record?.exp];
  let hasExpiry = false;
  for (const candidate of candidates) {
    const raw = cleanString(candidate);
    if (!raw) {
      if (candidate !== undefined && candidate !== null && candidate !== "") return true;
      continue;
    }
    hasExpiry = true;
    const ts = new Date(raw).getTime();
    if (Number.isNaN(ts) || ts <= now) return true;
  }
  return !hasExpiry && record?.token_version === 2;
}
