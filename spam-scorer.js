/**
 * spam-scorer.js — Multi-language content spam scorer for InterPoll.
 *
 * Naughty words alone ≠ spam. The scorer only flags content when there are
 * 3+ distinct matches in a single message.  This layer provides content-quality
 * signals, NOT user punishment.
 */

import { createRequire } from 'module';

// ─── Thresholds ──────────────────────────────────────────────────────────────

export const SPAM_THRESHOLDS = {
  NONE: 2,       // 0-2 matches: no action
  FLAG: 3,       // 3-5 matches: flag content, +2 PoW difficulty bits
  HEAVY_FLAG: 6, // 6+  matches: flag + delay, +4 PoW difficulty bits
};

// Minimum word length to consider a match (avoids single-letter false positives)
const MIN_WORD_LENGTH = 2;

// ─── Embedded fallback dictionaries (used only if naughty-words fails) ───────

const FALLBACK_EN = [
  'fuck','shit','ass','damn','crap','hell','bitch','bastard','dick','cock',
  'pussy','slut','whore','piss','cunt','wanker','twat','bollocks','arse',
  'bugger','bloody','tosser','prick','fag','retard','douche','skank','tramp',
  'moron','idiot','jackass','dumbass','asshole','motherfucker','bullshit',
  'horseshit','dipshit','shithead','fuckface','cocksucker','nitwit','numbnuts',
  'scumbag','sleazebag','dirtbag','ratfink','lowlife','deadbeat','nutjob','psycho',
];

const FALLBACK_FR = [
  'merde','putain','connard','salaud','enculer','bordel','foutre','nique',
  'bite','couille','chier','pute','salope','batard','con','cul','enfoiré',
  'branleur','emmerdeur','salopard','chiotte','niquer','connasse','pouffiasse',
  'encule','dégueulasse','petasse','abruti','bouffon','crétin','débile',
  'tarée','trou du cul','fils de pute','va te faire','ta gueule',
  'ferme ta gueule','casse-couilles','pétain','garce','gourgandine',
  'merdeux','fumier','ordure','raclure','sac à merde','trouduc','branler',
  'foutu','sacrement','tabarnac',
];

const FALLBACK_RU = [
  'блять','сука','хуй','пизда','ебать','мудак','пиздец','залупа','хер',
  'жопа','говно','дерьмо','бляд','ёб','нахуй','пиздёж','ебан','ёбаный',
  'мудила','пидор','пидорас','шлюха','сучка','тварь','гандон','долбоёб',
  'дебил','идиот','кретин','урод','козёл','баран','скотина','падла',
  'мразь','отморозок','выблядок','пиздабол','хуесос','жопошник','засранец',
  'придурок','лох','чмо','быдло','хуёвый','пиздатый','заебал','ёбтвоюмать',
  'херня',
];

// ─── Custom slang / leetspeak additions ──────────────────────────────────────

const CUSTOM_SLANG = [
  'stfu','gtfo','lmfao','lmao','wtf','wth','omfg','fml','smfh',
  'thot','simp','incel','cuck','kys','smd','foff','biatch','beyotch',
  'azzhole','phuck','phuk',
];

// ─── Leetspeak substitution map ──────────────────────────────────────────────

const LEET_MAP = {
  '@': 'a', '0': 'o', '1': 'i', '3': 'e', '4': 'a',
  '5': 's', '7': 't', '$': 's', '!': 'i', '+': 't',
};

// Multi-char substitution applied before single-char
const LEET_MULTI = [['ph', 'f']];

// ─── Unicode homoglyph map (Cyrillic → Latin) ───────────────────────────────

const HOMOGLYPHS = {
  '\u0430': 'a', // а
  '\u0435': 'e', // е
  '\u043E': 'o', // о
  '\u0440': 'p', // р
  '\u0441': 'c', // с
  '\u0443': 'y', // у
  '\u0445': 'x', // х
  '\u041A': 'k', // К
  '\u043A': 'k', // к
  '\u041C': 'm', // М
  '\u043C': 'm', // м
  '\u0422': 't', // Т
  '\u0442': 't', // т
  '\u041D': 'h', // Н
  '\u043D': 'h', // н
  '\u0412': 'b', // В
  '\u0432': 'b', // в
};

// ─── Text normalization pipeline ─────────────────────────────────────────────

function normalize(text) {
  // 1. Lowercase
  let out = text.toLowerCase();

  // 2. NFKD normalization — strip combining diacritics
  out = out.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

  // 3. Multi-char leetspeak (ph→f) before single-char
  for (const [from, to] of LEET_MULTI) {
    out = out.replaceAll(from, to);
  }

  // 4. Single-char leetspeak
  out = out.replace(/[@013457$!+]/g, (ch) => LEET_MAP[ch] ?? ch);

  // 5. Homoglyphs
  out = out.replace(/./g, (ch) => HOMOGLYPHS[ch] ?? ch);

  // 6. Strip non-alphanumeric but keep spaces
  out = out.replace(/[^a-z0-9\s]/g, '');

  // Collapse whitespace
  out = out.replace(/\s+/g, ' ').trim();

  return out;
}

// ─── SpamScorer class ────────────────────────────────────────────────────────

export class SpamScorer {
  /** @type {Map<string, Set<string>>} language → Set of words */
  #dictionaries = new Map();

  /** Combined Set of every word across all languages (normalized) */
  #allWords = new Set();

  /** Reverse lookup: word → language codes */
  #wordToLangs = new Map();

  constructor() {
    this.#loadDictionaries();
  }

  // ── Dictionary loading ───────────────────────────────────────────────────

  #loadDictionaries() {
    let nw;
    try {
      const require = createRequire(import.meta.url);
      nw = require('naughty-words');
    } catch {
      nw = null;
    }

    if (nw && typeof nw === 'object') {
      for (const [lang, words] of Object.entries(nw)) {
        if (Array.isArray(words) && words.length > 0) {
          this.#addLanguage(lang, words);
        }
      }
    } else {
      // Embedded fallback
      this.#addLanguage('en', FALLBACK_EN);
      this.#addLanguage('fr', FALLBACK_FR);
      this.#addLanguage('ru', FALLBACK_RU);
    }

    // Custom slang layer (always added)
    this.#addLanguage('slang', CUSTOM_SLANG);
  }

  #addLanguage(lang, rawWords) {
    const set = new Set();
    for (const w of rawWords) {
      const norm = normalize(String(w));
      if (norm.length < MIN_WORD_LENGTH) continue;
      set.add(norm);
      this.#allWords.add(norm);

      if (!this.#wordToLangs.has(norm)) {
        this.#wordToLangs.set(norm, new Set());
      }
      this.#wordToLangs.get(norm).add(lang);
    }
    // Merge into existing set if language already present
    const existing = this.#dictionaries.get(lang);
    if (existing) {
      for (const w of set) existing.add(w);
    } else {
      this.#dictionaries.set(lang, set);
    }
  }

  // ── Scoring ──────────────────────────────────────────────────────────────

  /**
   * Score a text string.
   * @param {string} text
   * @returns {{ matchCount: number, matches: string[], languagesHit: string[] }}
   */
  score(text) {
    const empty = { matchCount: 0, matches: [], languagesHit: [] };

    if (text == null || typeof text !== 'string') return empty;

    // Cap length to prevent DoS
    const capped = text.length > 5000 ? text.slice(0, 5000) : text;

    const normalizedText = normalize(capped);
    const originalLower = capped.toLowerCase();

    // Tokenize both forms
    const normalizedTokens = normalizedText.split(/\s+/).filter(Boolean);
    const originalTokens = originalLower
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const matchedWords = new Set();
    const langsHit = new Set();

    const checkToken = (token) => {
      if (token.length < MIN_WORD_LENGTH) return;
      if (this.#allWords.has(token) && !matchedWords.has(token)) {
        matchedWords.add(token);
        const langs = this.#wordToLangs.get(token);
        if (langs) {
          for (const l of langs) langsHit.add(l);
        }
      }
    };

    for (const token of normalizedTokens) checkToken(token);
    for (const token of originalTokens) checkToken(token);

    return {
      matchCount: matchedWords.size,
      matches: [...matchedWords],
      languagesHit: [...langsHit],
    };
  }

  /**
   * PoW difficulty bits to add based on score.
   * 0-2 → 0, 3-5 → 2, 6+ → 4
   */
  getPowPenalty(scoreResult) {
    const { matchCount } = scoreResult;
    if (matchCount >= SPAM_THRESHOLDS.HEAVY_FLAG) return 4;
    if (matchCount >= SPAM_THRESHOLDS.FLAG) return 2;
    return 0;
  }

  /** True if content should be flagged (≥3 matches) */
  shouldFlag(scoreResult) {
    return scoreResult.matchCount >= SPAM_THRESHOLDS.FLAG;
  }

  /** True if content should be delayed (≥6 matches) */
  shouldDelay(scoreResult) {
    return scoreResult.matchCount >= SPAM_THRESHOLDS.HEAVY_FLAG;
  }

  /** Dictionary statistics */
  getStats() {
    return {
      languageCount: this.#dictionaries.size,
      totalWords: this.#allWords.size,
    };
  }
}
