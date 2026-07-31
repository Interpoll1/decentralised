/**
 * contentGuard.ts
 *
 * Lightweight client-side spam filter.
 * Detects random character spam, keyboard mash, pure repetition, and
 * text with no vowels (gibberish word-salad).
 *
 * Deliberately lenient for short texts and non-Latin scripts so we don't
 * false-positive on other languages or perfectly valid terse messages.
 */

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

/** Strictness level for different content types */
export type ContentContext = 'title' | 'body' | 'comment' | 'chat';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VOWELS = new Set('aeiouAEIOU');

/** QWERTY keyboard rows (and their reverses) used for mash detection */
const KEYBOARD_SEQS = [
  'qwertyuiop', 'asdfghjkl', 'zxcvbnm',
  'poiuytrewq', 'lkjhgfdsa', 'mnbvcxz',
  'qwerty', 'asdfgh', 'zxcvbn', 'yuiop', 'hjkl', 'bnm',
  'ytrewq', 'hgfdsa', 'nbvcxz',
];

/** True if the text is predominantly non-Latin (skip consonant/vowel checks) */
function isNonLatin(text: string): boolean {
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const totalLetters = (text.match(/\p{L}/gu) || []).length;
  return totalLetters > 4 && latinChars / totalLetters < 0.5;
}

/** Length of the longest run of the same character */
function longestCharRun(s: string): number {
  let max = 1, cur = 1;
  for (let i = 1; i < s.length; i++) {
    cur = s[i] === s[i - 1] ? cur + 1 : 1;
    if (cur > max) max = cur;
  }
  return max;
}

/** Fraction of non-space chars that are the single most-common character */
function dominantCharRatio(s: string): number {
  const chars = s.replace(/\s/g, '').toLowerCase();
  if (!chars.length) return 0;
  const freq: Record<string, number> = {};
  for (const c of chars) freq[c] = (freq[c] || 0) + 1;
  return Math.max(...Object.values(freq)) / chars.length;
}

/** Length of the longest repeated bigram run (e.g. "ababab" → 3 repeats) */
function longestBigramRun(s: string): number {
  let max = 1;
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.slice(i, i + 2);
    let count = 1, pos = i + 2;
    while (s.slice(pos, pos + 2) === bg) { count++; pos += 2; }
    if (count > max) max = count;
  }
  return max;
}

/** True if text contains a keyboard-mash sequence of ≥5 chars */
function hasKeyboardMash(text: string): boolean {
  const lower = text.toLowerCase();
  for (const seq of KEYBOARD_SEQS) {
    if (seq.length < 5) continue;
    // sliding window over text
    for (let i = 0; i <= lower.length - 5; i++) {
      const chunk = lower.slice(i, i + 5);
      if (seq.includes(chunk)) return true;
    }
  }
  return false;
}

/** For a Latin word, check max consecutive consonants */
function maxConsonantRun(word: string): number {
  let max = 0, cur = 0;
  for (const c of word.toLowerCase()) {
    if (/[a-z]/.test(c)) {
      cur = VOWELS.has(c) ? 0 : cur + 1;
      if (cur > max) max = cur;
    } else {
      cur = 0;
    }
  }
  return max;
}

/** True if a word looks like a plausible word (has a vowel, no extreme consonant run) */
function isWordLike(word: string): boolean {
  const letters = word.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 3) return true; // skip very short tokens
  const hasVowel = [...letters].some(c => VOWELS.has(c));
  const consonantRun = maxConsonantRun(letters);
  return hasVowel && consonantRun <= 4;
}

/**
 * Ratio of gibberish words in a Latin string.
 * Returns 0.0–1.0; higher = more gibberish.
 */
function gibberishRatio(text: string): number {
  const words = text.trim().split(/\s+/).filter(w => w.replace(/[^a-zA-Z]/g, '').length >= 3);
  if (words.length === 0) return 0;
  const bad = words.filter(w => !isWordLike(w)).length;
  return bad / words.length;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check a single piece of text for spam signals.
 * Returns `{ ok: true }` if clean, or `{ ok: false, reason }` if spammy.
 */
export function checkContent(text: string, context: ContentContext = 'comment'): GuardResult {
  const trimmed = text.trim();

  // Too short to check reliably
  if (trimmed.length < 6) return { ok: true };

  // Non-Latin scripts: only check for pure repetition
  if (isNonLatin(trimmed)) {
    if (longestCharRun(trimmed) >= 8) {
      return { ok: false, reason: 'Looks like repeated characters' };
    }
    return { ok: true };
  }

  const noSpaces = trimmed.replace(/\s/g, '');

  // 1. Pure character repetition ("aaaaaaa")
  if (longestCharRun(noSpaces) >= 6) {
    return { ok: false, reason: 'Looks like repeated characters' };
  }

  // 2. Single char dominates (e.g. 70 %+ of content is one letter)
  if (noSpaces.length >= 8 && dominantCharRatio(noSpaces) > 0.55) {
    return { ok: false, reason: 'Looks like repeated characters' };
  }

  // 3. Repeated bigram pattern ("ababababab")
  if (noSpaces.length >= 8 && longestBigramRun(noSpaces.toLowerCase()) >= 4) {
    return { ok: false, reason: 'Looks like repeated characters' };
  }

  // 4. Keyboard mash — applies to all contexts for long-enough tokens
  if (noSpaces.length >= 5 && hasKeyboardMash(trimmed)) {
    return { ok: false, reason: 'Looks like keyboard mashing' };
  }

  // 5. Gibberish word ratio — only for titles/bodies, and only when there are
  //    enough words to make a reliable judgment
  const wordCount = trimmed.split(/\s+/).length;
  const threshold: Record<ContentContext, number> = {
    title:   0.5,  // 50 % gibberish words → reject
    body:    0.65,
    comment: 0.75,
    chat:    0.85, // very lenient — people send URLs, codes, etc.
  };

  if (wordCount >= 3 || (wordCount === 1 && noSpaces.length >= 10)) {
    const ratio = gibberishRatio(trimmed);
    if (ratio > threshold[context]) {
      return { ok: false, reason: 'Looks like random characters' };
    }
  }

  // 6. Single long token with no vowels at all (e.g. "fghjklzxcvbn")
  if (wordCount === 1 && noSpaces.length >= 8) {
    const hasAnyVowel = [...noSpaces].some(c => VOWELS.has(c));
    if (!hasAnyVowel) {
      return { ok: false, reason: 'Looks like random characters' };
    }
  }

  return { ok: true };
}

/**
 * Check a poll/post option or choice string.
 * Same as checkContent('title') but with a slightly shorter minimum length.
 */
export function checkOption(text: string): GuardResult {
  if (text.trim().length < 2) return { ok: true };
  return checkContent(text, 'title');
}
