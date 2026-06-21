// src/services/moderationGrants.ts — shared community-scoped delete delegation.
//
// When a piece of content (post, comment, poll) is created, its author grants the
// community owner + current moderators `delete` on the node, so they can moderate
// it later — scoped to that community, never global. Best-effort and cooperative:
// the author signs these grants at creation time, and a node only affects its OWN
// content, so a peer that skips the grant merely weakens moderation of its own.
import { db } from './gdbServices'

/**
 * Grant `delete` on a freshly-created node to its community's owner + moderators
 * (skips self and tolerates failures). Reused by post, comment and poll creation.
 */
export async function grantCommunityModerators(nodeId: string, communityId: string): Promise<void> {
  if (!communityId) return
  const me = db.sm.getActiveEthAddress()
  const { result } = await db.get(communityId)
  const value = result?.value as { owner?: string; creatorId?: string; moderators?: string[] } | undefined
  if (!value) return
  const targets = new Set<string>()
  const owner = value.owner || value.creatorId
  if (owner) targets.add(owner)
  if (Array.isArray(value.moderators)) value.moderators.forEach(m => m && targets.add(m))
  for (const addr of targets) {
    if (!me || addr.toLowerCase() === me.toLowerCase()) continue
    try { await db.sm.acls.grant(nodeId, addr, 'delete') } catch { /* best-effort, cooperative */ }
  }
}
