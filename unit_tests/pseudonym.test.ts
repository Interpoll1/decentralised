import { describe, it, expect } from 'vitest';
import { generatePseudonym } from '../src/utils/pseudonym';

describe('generatePseudonym', () => {
  it('returns a three-word hyphenated string', () => {
    const result = generatePseudonym('post1', 'author1');
    const parts = result.split('-');
    expect(parts).toHaveLength(3);
    parts.forEach((word) => expect(word.length).toBeGreaterThan(0));
  });

  it('is deterministic for the same inputs', () => {
    const a = generatePseudonym('post1', 'author1');
    const b = generatePseudonym('post1', 'author1');
    expect(a).toBe(b);
  });

  it('changes when postId changes', () => {
    const a = generatePseudonym('post1', 'author1');
    const b = generatePseudonym('post2', 'author1');
    expect(a).not.toBe(b);
  });

  it('changes when authorId changes', () => {
    const a = generatePseudonym('post1', 'author1');
    const b = generatePseudonym('post1', 'author2');
    expect(a).not.toBe(b);
  });

  it('handles empty strings without crashing', () => {
    const result = generatePseudonym('', '');
    expect(typeof result).toBe('string');
    expect(result.split('-')).toHaveLength(3);
  });

  it('handles very long inputs', () => {
    const long = 'x'.repeat(10000);
    const result = generatePseudonym(long, long);
    expect(result.split('-')).toHaveLength(3);
  });
});
