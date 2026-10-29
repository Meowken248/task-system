import { randomBytes, createHmac, timingSafeEqual, createCipheriv, createDecipheriv, hkdfSync } from "node:crypto";
import { AbiCoder, Wallet, getAddress, getBytes, hashMessage, id, keccak256, toUtf8Bytes } from "ethers";

export const CLAIM_LIFETIME_SECONDS = 300;
export const EMAIL_CLAIM_TYPE =
  "PlaneEmailClaim(uint256 chainId,address registry,bytes32 workspace,bytes32 invitationId,uint64 version,bytes32 recipientCommitment,uint8 role,address recipient,uint64 validUntil,bytes32 nonce,uint64 verifierEpoch)";
const abi = AbiCoder.defaultAbiCoder();
export const randomId = () => `0x${randomBytes(32).toString("hex")}`;
export const randomToken = (prefix = "") => prefix + randomBytes(32).toString("base64url");
export const normalizeEmail = (value) => {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("INVALID_EMAIL");
  return email;
};
export const normalizeWallet = (value) => {
  const address = getAddress(value);
  if (/^0x0{40}$/i.test(address)) throw new Error("INVALID_WALLET");
  return address.toLowerCase();
};
export const normalizeSlug = (value) => {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(value)) throw new Error("INVALID_WORKSPACE");
  return value;
};
export function emailCommitment(email, salt) {
  return keccak256(abi.encode(["bytes32", "string"], [salt, normalizeEmail(email)]));
}
export function secretDigest(secret, purpose, value) {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) throw new Error("SECRET_NOT_CONFIGURED");
  return createHmac("sha256", secret).update(`${purpose}\0${value}`).digest("hex");
}
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a || "");
  const right = Buffer.from(b || "");
  return left.length === right.length && timingSafeEqual(left, right);
}
// On-chain IDs are public. This secret locator authorizes mail requests only;
// membership still requires email verification and the recipient transaction.
export function invitationLinkToken(secret, domain, invitationId, version) {
  const scope = `${BigInt(domain.chainId)}:${normalizeWallet(domain.registry)}:${normalizeWallet(domain.verification)}`;
  return secretDigest(secret, `${scope}:invitation-link`, `${invitationId.toLowerCase()}:${BigInt(version)}`);
}
export function claimDigest(domain, invitation, ticket) {
  return keccak256(
    abi.encode(
      [
        "bytes32",
        "uint256",
        "address",
        "bytes32",
        "bytes32",
        "uint64",
        "bytes32",
        "uint8",
        "address",
        "uint64",
        "bytes32",
        "uint64",
      ],
      [
        id(EMAIL_CLAIM_TYPE),
        domain.chainId,
        domain.registry,
        keccak256(toUtf8Bytes(invitation.slug)),
        invitation.id,
        invitation.version,
        invitation.recipientCommitment,
        invitation.role,
        ticket.recipient,
        ticket.validUntil,
        ticket.nonce,
        ticket.verifierEpoch,
      ]
    )
  );
}
export function signClaim(privateKey, digest) {
  return new Wallet(privateKey).signingKey.sign(hashMessage(getBytes(digest))).serialized;
}

// Separate keys and authenticated purposes prevent swapping an IPFS envelope,
// challenge cookie and verified session even when they share a root secret.
function encryptionKey(secret, purpose) {
  secretDigest(secret, "configuration-check", "");
  return Buffer.from(hkdfSync("sha256", secret, "plane-member-auth-v3", purpose, 32));
}
export function seal(secret, purpose, payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret, purpose), iv);
  cipher.setAAD(Buffer.from(purpose));
  const encoded = Buffer.from(JSON.stringify(payload));
  if (encoded.length > 16384) throw new Error("PAYLOAD_TOO_LARGE");
  const ciphertext = Buffer.concat([cipher.update(encoded), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}
export function unseal(secret, purpose, token) {
  try {
    if (typeof token !== "string" || token.length > 24000) throw new Error();
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== "v1" || parts.slice(1).some((part) => !/^[A-Za-z0-9_-]+$/.test(part)))
      throw new Error();
    const [iv, ciphertext, tag] = parts.slice(1).map((part) => Buffer.from(part, "base64url"));
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret, purpose), iv);
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(tag);
    const payload = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
    return payload;
  } catch {
    throw new Error("INVALID_TOKEN");
  }
}
export function verificationCode(secret, scope, challengeId) {
  // Rejection sampling avoids modulo bias; the code survives a process restart
  // without being stored. Its public commitment must ALSO be keyed, not SHA(code).
  for (let counter = 0; ; counter++) {
    const value = Number.parseInt(secretDigest(secret, `otp:${scope}`, `${challengeId}:${counter}`).slice(0, 8), 16);
    if (value < 4294000000) return String(value % 1000000).padStart(6, "0");
  }
}
