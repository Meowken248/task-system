import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveMemberIdentity,
  formatShortWallet,
  normalizeWallet,
} from "../../apps/web/core/components/home/dashboard-kpi/identity-resolver.ts";
import {
  resolveActivityRecords,
  formatByteSize,
  formatVietnamDateTime,
} from "../../apps/web/core/components/home/dashboard-kpi/activity-resolver.ts";

test("resolveMemberIdentity finds workspace member by wallet address and does not falsely claim current user for user-* ID", () => {
  const members = [
    {
      id: "mem-1",
      member: {
        id: "user-alice",
        display_name: "Alice Nguyen",
        email: "alice@example.com",
        wallet_address: "0x1111111111111111111111111111111111111111",
      },
    },
  ];

  const currentUser = {
    id: "user-bob",
    display_name: "Bob Current",
    email: "bob@example.com",
    wallet_address: "0x2222222222222222222222222222222222222222",
  };

  // Case 1: Assignee is Alice by ID
  const res1 = resolveMemberIdentity({ assignee_id: "user-alice" }, members, currentUser);
  assert.equal(res1.displayName, "Alice Nguyen");
  assert.equal(res1.isCurrentUser, false);

  // Case 2: Assignee has only a wallet and no profile
  const res2 = resolveMemberIdentity(
    { assignee_wallet: "0x4ecb82724890c656d09761b617369479c5392d6d" },
    members,
    currentUser
  );
  assert.equal(res2.displayName, "0x4ecb...2d6d");
  assert.equal(res2.wallet, "0x4ecb82724890c656d09761b617369479c5392d6d");
  assert.equal(res2.isCurrentUser, false);

  // Case 3: Completely missing identity
  const res3 = resolveMemberIdentity({}, members, currentUser);
  assert.equal(res3.displayName, "Chưa xác định");
});

test("activity-resolver resolves comments and attachments to actual text and metadata", () => {
  const records = [
    {
      event_type: "task_content",
      content_kind: "comment",
      content_reference: "comm-123",
      transaction_hash: "0xtxhashcomment",
      recorded_at: "2026-10-31T10:00:00Z",
    },
    {
      event_type: "task_content",
      content_kind: "evidence",
      content_reference: "asset-456",
      transaction_hash: "0xtxhashevidence",
      recorded_at: "2026-10-31T09:00:00Z",
    },
  ];

  const comments = [
    {
      id: "comm-123",
      comment_stripped: "Hoàn thành kiểm thử module A",
      actor_detail: { display_name: "Developer X" },
    },
  ];

  const attachments = [
    {
      id: "asset-456",
      asset_id: "asset-456",
      attributes: {
        name: "test-result.png",
        size: 1048576, // 1 MB
        type: "image/png",
      },
    },
  ];

  const resolved = resolveActivityRecords(records, comments, attachments);
  assert.equal(resolved.length, 2);

  // Comment check
  assert.equal(resolved[0].kind, "comment");
  assert.equal(resolved[0].contentTitle, "Developer X đã bình luận");
  assert.equal(resolved[0].contentBody, "Hoàn thành kiểm thử module A");
  assert.equal(resolved[0].isOnChain, false); // a stored tx hash has not been verified
  assert.equal(resolved[0].transactionHash, "0xtxhashcomment");

  // Attachment check
  assert.equal(resolved[1].kind, "evidence");
  assert.equal(resolved[1].contentTitle, "test-result.png");
  assert.equal(resolved[1].contentBody, "Kích thước: 1 MB");
  assert.equal(resolved[1].metadata?.previewUrl, undefined);
  assert.equal(resolved[1].metadata?.assetSource, "asset-456");
});
