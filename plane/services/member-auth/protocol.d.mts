export type ChainInteger = bigint | number | string;
export interface ClaimDomain {
  chainId: ChainInteger;
  registry: string;
}
export interface ClaimInvitation {
  id: string;
  slug: string;
  version: ChainInteger;
  recipientCommitment: string;
  role: ChainInteger;
}
export interface ClaimTicket {
  recipient: string;
  validUntil: ChainInteger;
  nonce: string;
  verifierEpoch: ChainInteger;
}
export const CLAIM_LIFETIME_SECONDS: 300;
export const EMAIL_CLAIM_TYPE: string;
export function randomId(): string;
export function randomToken(prefix?: string): string;
export function normalizeEmail(value: unknown): string;
export function normalizeWallet(value: string): string;
export function normalizeSlug(value: unknown): string;
export function emailCommitment(email: string, salt: string): string;
export function secretDigest(secret: string, purpose: string, value: string): string;
export function safeEqual(a?: string, b?: string): boolean;
export function invitationLinkToken(
  secret: string,
  domain: ClaimDomain & { verification: string },
  invitationId: string,
  version: ChainInteger
): string;
export function claimDigest(domain: ClaimDomain, invitation: ClaimInvitation, ticket: ClaimTicket): string;
export function signClaim(privateKey: string, digest: string): string;
export function seal(secret: string, purpose: string, payload: Record<string, unknown>): string;
export function unseal(secret: string, purpose: string, token: string): Record<string, unknown>;
export function verificationCode(secret: string, scope: string, challengeId: string): string;
