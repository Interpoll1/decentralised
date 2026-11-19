import { expect, it } from 'vitest';
import { mergeStatus } from '../src/utils/messageStatus';
it('never resurrects a corrupted message with a delayed delivery event', () => {
  expect(mergeStatus('corrupted', 'published')).toBe('corrupted');
  expect(mergeStatus('confirmed', 'corrupted')).toBe('corrupted');
});
