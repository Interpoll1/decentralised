import { describe, expect, it } from 'vitest';
import { matchesFeedScope, type FeedScope } from '../src/utils/feedScope';

const context = {
  joinedCommunityIds: new Set(['joined']),
  privateCommunityIds: new Set(['private']),
  nearbyAuthorIds: new Set(['nearby-author']),
};
const items = [
  { id: 'joined-post', communityId: 'joined', authorId: 'other' },
  { id: 'public-poll', communityId: 'public', authorId: 'nearby-author' },
  { id: 'private-post', communityId: 'private', authorId: 'other' },
  { id: 'encrypted-post', communityId: 'unknown', isEncrypted: true },
  { id: 'private-poll', communityId: 'unknown', isPrivate: true },
  { id: 'no-space' },
];
const ids = (scope: FeedScope) => items.filter(item => matchesFeedScope(scope, item, context)).map(item => item.id);

describe('feed source filtering', () => {
  it('keeps the available feed in This relay', () => expect(ids('relay')).toHaveLength(6));
  it('shows joined spaces only, without needing community metadata', () => expect(ids('mine')).toEqual(['joined-post']));
  it('discovers unjoined public spaces, excluding private or encrypted records', () => expect(ids('explore')).toEqual(['public-poll']));
  it('restricts Nearby to the current nearby author set', () => expect(ids('nearby')).toEqual(['public-poll']));
  it('does not fill empty My spaces or Nearby with unrelated content', () => {
    const empty = { ...context, joinedCommunityIds: new Set<string>(), nearbyAuthorIds: new Set<string>() };
    expect(items.filter(item => matchesFeedScope('mine', item, empty))).toEqual([]);
    expect(items.filter(item => matchesFeedScope('nearby', item, empty))).toEqual([]);
  });
  it('moves a discovered community into My spaces immediately after joining', () => {
    const joined = { ...context, joinedCommunityIds: new Set(['joined', 'public']) };
    expect(matchesFeedScope('mine', items[1], joined)).toBe(true);
    expect(matchesFeedScope('explore', items[1], joined)).toBe(false);
  });
});
