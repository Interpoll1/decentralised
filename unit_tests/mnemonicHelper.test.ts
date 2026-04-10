import { describe, it, expect } from 'vitest';
import { MnemonicHelper } from '../src/utils/mnemonicHelper';

describe('MnemonicHelper', () => {
  describe('format', () => {
    it('lowercases and trims', () => {
      expect(MnemonicHelper.format('  Hello WORLD  ')).toBe('hello world');
    });
  });

  describe('toWords', () => {
    it('splits on whitespace', () => {
      expect(MnemonicHelper.toWords('one  two   three')).toEqual(['one', 'two', 'three']);
    });

    it('handles leading/trailing whitespace', () => {
      expect(MnemonicHelper.toWords('  one two  ')).toEqual(['one', 'two']);
    });
  });

  describe('fromWords', () => {
    it('joins words with spaces', () => {
      expect(MnemonicHelper.fromWords(['one', 'two', 'three'])).toBe('one two three');
    });
  });

  describe('isValidWordCount', () => {
    it('returns true for 12 words', () => {
      const mnemonic = 'a b c d e f g h i j k l';
      expect(MnemonicHelper.isValidWordCount(mnemonic)).toBe(true);
    });

    it('returns true for 24 words', () => {
      const mnemonic = Array(24).fill('word').join(' ');
      expect(MnemonicHelper.isValidWordCount(mnemonic)).toBe(true);
    });

    it('returns false for 6 words', () => {
      expect(MnemonicHelper.isValidWordCount('a b c d e f')).toBe(false);
    });
  });

  describe('getWordCount', () => {
    it('counts words correctly', () => {
      expect(MnemonicHelper.getWordCount('one two three')).toBe(3);
    });

    it('ignores extra whitespace', () => {
      expect(MnemonicHelper.getWordCount('  one   two  ')).toBe(2);
    });
  });
});
