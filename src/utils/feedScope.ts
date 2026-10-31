export type FeedScope = 'mine' | 'relay' | 'explore' | 'nearby';

interface ScopeItem {
  communityId?: string;
  authorId?: string;
  isPrivate?: boolean;
  isEncrypted?: boolean;
}

interface ScopeContext {
  joinedCommunityIds: ReadonlySet<string>;
  privateCommunityIds: ReadonlySet<string>;
  nearbyAuthorIds: ReadonlySet<string>;
}

/** Filter the already available feed; this does not establish relay provenance. */
export function matchesFeedScope(scope: FeedScope, item: ScopeItem, context: ScopeContext): boolean {
  if (scope === 'relay') return true;
  if (scope === 'nearby') return !!item.authorId && context.nearbyAuthorIds.has(item.authorId);
  if (!item.communityId) return false;
  const joined = context.joinedCommunityIds.has(item.communityId);
  if (scope === 'mine') return joined;
  return !joined && !item.isPrivate && !item.isEncrypted
    && !context.privateCommunityIds.has(item.communityId);
}
