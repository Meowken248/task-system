import type { ChainInteger, ClaimDomain, ClaimTicket } from "./protocol.mjs";

export type DeliveryStatus = "not_started" | "sending" | "accepted" | "ambiguous" | "failed";
export interface MemberDomain extends ClaimDomain {
  verification: string;
}
export interface InvitationRecord {
  slug: string;
  recipientCommitment: string;
  role: ChainInteger;
  expiresAt: ChainInteger;
  version: ChainInteger;
  invitedBy: string;
  claimedBy: string;
  revoked: boolean;
  metadataCID: string;
  declined: boolean;
}
export interface ChallengeRecord {
  invitationId: string;
  codeCommitment: string;
  sessionCommitment: string;
  invitationVersion: ChainInteger;
  verifierEpoch: ChainInteger;
  expiresAt: ChainInteger;
  verifiedAt: ChainInteger;
  attempts: ChainInteger;
}
export interface ReservationRecord extends ClaimTicket {
  version: ChainInteger;
}
export interface PolicyAdapter {
  getInvitation(id: string): Promise<InvitationRecord>;
  getVerifier(slug: string): Promise<{ address: string; epoch: ChainInteger }>;
  getReservation(id: string): Promise<ReservationRecord>;
  reserveClaim(id: string, version: number, recipient: string, nonce: string, validUntil: number): Promise<unknown>;
  decline(id: string, version: number): Promise<unknown>;
}
export interface VerificationAdapter {
  getChallenge(id: string): Promise<ChallengeRecord>;
  nextRequestAt(id: string): Promise<ChainInteger>;
  registerChallenge(input: {
    challengeId: string;
    invitationId: string;
    version: number;
    expiresAt: number;
    codeCommitment: string;
    sessionCommitment: string;
    networkBucket: string;
  }): Promise<unknown>;
  verifyChallenge(id: string, attemptId: string, commitment: string): Promise<boolean>;
  beginDelivery(id: string, requestId: string, retry: boolean): Promise<{ acquired: boolean; status: DeliveryStatus }>;
  finishDelivery(id: string, requestId: string, status: DeliveryStatus): Promise<unknown>;
}
export interface ChainBindings {
  domain: MemberDomain;
  policy: PolicyAdapter;
  verification: VerificationAdapter;
  clock(): Promise<number>;
}
export interface MemberAuthOptions extends ChainBindings {
  secret: string;
  signingKey: string;
  ipfs: { put(ciphertext: string): Promise<string>; get(cid: string): Promise<string> };
  mail: {
    send(input: {
      email: string;
      code: string;
      challengeId: string;
      signal: AbortSignal;
    }): Promise<{ status: "accepted" | "ambiguous" | "failed" }>;
  };
}
export interface PreparedInvitation {
  id: string;
  slug: string;
  recipientCommitment: string;
  role: 1 | 2;
  expiresAt: number;
  expectedVersion: number;
  metadataCID: string;
}
export interface MemberAuth {
  prepareInvitation(input: {
    slug: string;
    email: string;
    role: 1 | 2;
    expiresAt: number;
    expectedVersion?: number;
    requestId: string;
  }): Promise<PreparedInvitation>;
  publicInvitation(id: string): Promise<{
    id: string;
    slug: string;
    role: number;
    version: number;
    expiresAt: number;
    state: "claimed" | "revoked" | "declined" | "expired" | "pending";
  }>;
  requestCode(input: {
    invitationId: string;
    linkToken: string;
    requestId: string;
    networkAddress: string;
  }): Promise<{ challengeToken: string; delivery: DeliveryStatus; expiresAt: number; resendAt: number }>;
  retryCodeDelivery(input: { challengeToken: string; requestId: string }): Promise<DeliveryStatus>;
  verifyCode(input: {
    challengeToken: string;
    code: string;
    requestId: string;
  }): Promise<{ sessionToken: string; expiresAt: number }>;
  prepareClaim(input: {
    sessionToken: string;
    wallet: string;
    requestId: string;
  }): Promise<{ invitationId: string; version: number; signature: string } & ClaimTicket>;
  decline(input: { sessionToken: string }): Promise<{ state: "declined" }>;
}
export function createMemberAuth(options: MemberAuthOptions): MemberAuth;
