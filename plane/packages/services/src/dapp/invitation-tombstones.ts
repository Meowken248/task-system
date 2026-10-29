/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Invitation tombstones (pure helpers, no browser dependencies).
 *
 * A tombstone is the only thing that prevents a deleted invitation from being
 * resurrected by the cross-port cookie, the IPFS snapshot, or a stale
 * notification. Tombstones are scoped to (workspace, email) so that removing a
 * person from workspace A never suppresses their invitation in workspace B.
 */

/** All workspace identifiers (slug / id / nested object) an invitation belongs to. */
export function getInvitationWorkspaceKeys(inv: any): string[] {
  const raw = [
    inv?.workspace?.slug,
    inv?.workspace_slug,
    inv?.workspace?.id,
    inv?.workspace_id,
    typeof inv?.workspace === "string" ? inv.workspace : null,
  ];
  return Array.from(
    new Set(
      raw
        .filter(Boolean)
        .map((w: any) => String(w).toLowerCase().trim())
        .filter(Boolean)
    )
  );
}

/** Tombstone key for the (workspace, email) pair. */
export function makeInvitationTombstoneKey(
  workspaceSlug: string | undefined | null,
  email: string | undefined | null
): string | null {
  const ws = String(workspaceSlug || "").toLowerCase().trim();
  const mail = String(email || "").toLowerCase().trim();
  if (!ws || !mail) return null;
  return `ws:${ws}|email:${mail}`;
}

/**
 * Returns true when an invitation has been permanently deleted.
 *
 * Matching rules (most specific first):
 *  1. invitation id (globally unique) - legacy tombstones also stored the
 *     `ws-member-` / `inv-` / `member-` prefixed variants of the id;
 *  2. invitation token;
 *  3. `ws:<workspace>|email:<email>` - current, workspace-scoped scope;
 *  4. bare email - legacy tombstones written by older versions (kept so that
 *     users who already deleted an invitation do not see it resurrect).
 */
export function isInvitationDeleted(inv: any, deletedSet: Set<string>): boolean {
  if (!inv || !deletedSet || deletedSet.size === 0) return false;
  const rawId = String(inv.id || "").trim();
  const invId = rawId.toLowerCase();
  const invToken = String(inv.token || "").trim();
  const invMail = (inv.email || "").toLowerCase().trim();

  if (rawId && deletedSet.has(rawId)) return true;
  if (invId && deletedSet.has(invId)) return true;
  if (invToken && deletedSet.has(invToken)) return true;
  if (invId) {
    if (deletedSet.has(`ws-member-${invId}`)) return true;
    if (deletedSet.has(`member-${invId}`)) return true;
    if (deletedSet.has(`inv-${invId}`)) return true;
  }
  if (invMail) {
    for (const ws of getInvitationWorkspaceKeys(inv)) {
      if (deletedSet.has(`ws:${ws}|email:${invMail}`)) return true;
      if (invId && deletedSet.has(`ws:${ws}|inv:${invId}`)) return true;
    }
    if (deletedSet.has(invMail)) return true;
  }
  return false;
}

/** Published re-invitations supersede old device-local email bans. Exact
 * invitation-id/token revocations and published email bans still apply.
 */
export function effectiveInvitationTombstones(inv: any, local: Set<string>, published?: string[]): Set<string> {
  const effective = new Set(local);
  if (published) {
    const email = String(inv?.email || "")
      .toLowerCase()
      .trim();
    if (email) {
      effective.delete(email);
      for (const key of getInvitationWorkspaceKeys(inv)) effective.delete(`ws:${key}|email:${email}`);
    }
    published.forEach((entry) => effective.add(entry));
  }
  return effective;
}
