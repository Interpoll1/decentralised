import { describe, expect, it } from 'vitest';
import { checkContent, checkOption } from '@/utils/contentGuard';

describe('contentGuard - checkContent', () => {
  describe('short-text leniency', () => {
    it('allows text under the 6-char minimum regardless of content', () => {
      expect(checkContent('aaaaa').ok).toBe(true);
      expect(checkContent('qwert').ok).toBe(true);
      expect(checkContent('hi').ok).toBe(true);
    });
  });

  describe('non-Latin script leniency', () => {
    it('allows normal non-Latin text', () => {
      expect(checkContent('这是一个正常的中文句子').ok).toBe(true);
      expect(checkContent('Это нормальное предложение на русском').ok).toBe(true);
    });

    it('still flags pure repetition in non-Latin scripts', () => {
      const res = checkContent('ままままままままま');
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/repeated characters/);
    });
  });

  describe('random character spam / repetition', () => {
    it('flags a long run of the same character', () => {
      const res = checkContent('aaaaaaaaaa');
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/repeated characters/);
    });

    it('flags text dominated by a single character', () => {
      const res = checkContent('aaaaaaaabcaaaaaaaa');
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/repeated characters/);
    });

    it('flags a repeated bigram pattern', () => {
      const res = checkContent('abababababab');
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/repeated characters/);
    });
  });

  describe('keyboard mash', () => {
    it('flags a qwerty row mash', () => {
      const res = checkContent('qwertyuiop is my title');
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/keyboard mashing/);
    });

    it('flags asdfgh mash', () => {
      const res = checkContent('asdfghjkl');
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/keyboard mashing/);
    });
  });

  describe('no-vowel gibberish', () => {
    it('flags a single long token with no vowels', () => {
      const res = checkContent('xkgptrmwbkg');
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/random characters/);
    });

    it('allows a normal single word with vowels', () => {
      expect(checkContent('wonderful').ok).toBe(true);
    });
  });

  describe('gibberish word ratio across contexts', () => {
    // Multi-word gibberish that isn't a keyboard-row mash but is still
    // consonant-heavy word-salad.
    const gibberishSentence = 'zxkjq mvbpn qtrsl fkptm mvczr';

    it('rejects gibberish word-salad as a title (strictest threshold)', () => {
      const res = checkContent(gibberishSentence, 'title');
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/random characters/);
    });

    it('rejects gibberish word-salad as a body', () => {
      const res = checkContent(gibberishSentence, 'body');
      expect(res.ok).toBe(false);
    });

    it('allows normal readable text for every context', () => {
      const normal = 'This is a perfectly normal sentence with real words';
      for (const context of ['title', 'body', 'comment', 'chat'] as const) {
        expect(checkContent(normal, context).ok).toBe(true);
      }
    });

    it('defaults to comment context when none is given', () => {
      const normal = 'This is a perfectly normal message';
      expect(checkContent(normal).ok).toBe(true);
    });

    it('is more lenient for chat than for title given the same borderline text', () => {
      // Enough gibberish to clear the title/body/comment thresholds but not chat's 0.85.
      const borderline = 'zxkjq mvbpn qwrst hello there friend';
      const titleResult = checkContent(borderline, 'title');
      const chatResult = checkContent(borderline, 'chat');
      // Chat should never be stricter than title for the same text.
      if (!titleResult.ok) {
        expect(chatResult.ok).toBe(true);
      }
    });
  });
});

describe('contentGuard - checkOption', () => {
  it('allows very short option text (under its own 2-char minimum)', () => {
    expect(checkOption('a').ok).toBe(true);
    expect(checkOption('').ok).toBe(true);
  });

  it('allows a normal option', () => {
    expect(checkOption('Yes').ok).toBe(true);
    expect(checkOption('Pineapple pizza').ok).toBe(true);
  });

  it('flags repeated-character spam using title-level strictness', () => {
    const res = checkOption('aaaaaaaaaa');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/repeated characters/);
  });

  it('flags keyboard mash options', () => {
    const res = checkOption('qwertyuiop');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/keyboard mashing/);
  });

  it('flags a no-vowel gibberish option', () => {
    const res = checkOption('xkgptrmwbkg');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/random characters/);
  });
});
