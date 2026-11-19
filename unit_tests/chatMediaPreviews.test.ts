import { afterEach, expect, it, vi } from 'vitest';
import { ChatMediaPreviews } from '../src/utils/chatMediaPreviews';
afterEach(() => vi.restoreAllMocks());
it('does not retain duplicate blob allocations when history is hydrated repeatedly', () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const previews = new ChatMediaPreviews();
  expect(previews.retain('alice', 'm1', 'authenticated-envelope', 'blob:first')).toBe('blob:first');
  expect(previews.retain('alice', 'm1', 'authenticated-envelope', 'blob:duplicate')).toBe('blob:first');
  expect(revoke).toHaveBeenCalledWith('blob:duplicate');
  expect(revoke).not.toHaveBeenCalledWith('blob:first');
});
it('keeps distinct identities separate and replaces a changed message envelope', () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const previews = new ChatMediaPreviews();
  previews.retain('alice', 'same-id', 'first', 'blob:alice');
  expect(previews.retain('bob', 'same-id', 'first', 'blob:bob')).toBe('blob:bob');
  expect(revoke).not.toHaveBeenCalled();
  expect(previews.retain('alice', 'same-id', 'changed', 'blob:new')).toBe('blob:new');
  expect(revoke).toHaveBeenCalledWith('blob:alice');
});
