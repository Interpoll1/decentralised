// Moderation & content-filtering service (client-side only)

import { ref } from 'vue';

export type Severity = 'low' | 'medium' | 'high';
export type FilterAction = 'blur' | 'hide' | 'flag';
export type WordCategory = 'profanity' | 'slurs' | 'sexual' | 'threats' | 'spam' | 'drugs';

export interface WordEntry {
  word: string;
  category: WordCategory;
  severity: Severity;
  enabled: boolean;
}

export interface WordMatch {
  word: string;
  category: WordCategory;
  severity: Severity;
}

export interface FilterResult {
  flagged: boolean;
  matches: WordMatch[];
  severity: Severity;
}

export interface ModerationSettings {
  minUserKarma: number;
  minContentScore: number;
  wordFilterEnabled: boolean;
  wordFilterAction: FilterAction;
  customBlockedWords: string[];
  customAllowedWords: string[];
  disabledCategories: WordCategory[];
  imageFilterEnabled: boolean;
  imageFilterSensitivity: number; // 0.0–1.0, lower = more aggressive
}

const STORAGE_KEY = 'moderation_settings';

const DEFAULT_SETTINGS: ModerationSettings = {
  minUserKarma: -1000,
  minContentScore: -5,
  wordFilterEnabled: false,
  wordFilterAction: 'blur',
  customBlockedWords: [],
  customAllowedWords: [],
  disabledCategories: [],
  imageFilterEnabled: true,
  imageFilterSensitivity: 0.6,
};

// ── Default word list ──────────────────────────────────────────────────
const DEFAULT_WORD_LIST: WordEntry[] = [
  // Profanity – low severity
  ...w(['damn', 'dammit', 'crap', 'hell', 'piss', 'pissed', 'bollocks',
        'bugger', 'bloody', 'arse', 'arsehole', 'ass', 'asshole', 'bastard',
        'bitch', 'bullshit', 'horseshit', 'dipshit', 'shit', 'shitty',
        'fuck', 'fucking', 'fucker', 'motherfucker', 'mf', 'stfu', 'gtfo',
        'wtf', 'lmfao', 'dick', 'dickhead', 'cock', 'prick', 'twat',
        'wanker', 'tosser', 'douche', 'douchebag', 'jackass', 'goddam',
        'goddamn', 'goddamnit', 'sonofabitch', 'sob'], 'profanity', 'low'),

  // Slurs – high severity
  ...w(['nigger', 'nigga', 'negro', 'coon', 'darkie', 'spic', 'wetback',
        'beaner', 'gringo', 'chink', 'gook', 'slant', 'zipperhead', 'jap',
        'paki', 'raghead', 'towelhead', 'sandnigger', 'camel jockey',
        'kike', 'heeb', 'hymie', 'yid', 'cracker', 'honky', 'redneck',
        'whitetrash', 'polack', 'wop', 'dago', 'guido', 'mick', 'kraut',
        'hun', 'frog', 'limey', 'gyp', 'gypsy', 'pikey',
        'retard', 'retarded', 'tard', 'spaz', 'spastic', 'cripple',
        'fag', 'faggot', 'dyke', 'homo', 'tranny', 'shemale',
        'ladyboy', 'trannie'], 'slurs', 'high'),

  // Sexual – medium severity
  ...w(['porn', 'porno', 'pornography', 'hentai', 'xxx', 'nsfw',
        'blowjob', 'bj', 'handjob', 'rimjob', 'anal', 'orgasm', 'orgy',
        'threesome', 'gangbang', 'creampie', 'cumshot', 'cum', 'jizz',
        'dildo', 'vibrator', 'fleshlight', 'milf', 'gilf', 'bdsm',
        'bondage', 'dominatrix', 'fetish', 'masturbate', 'masturbation',
        'fap', 'nudes', 'sexting', 'camgirl', 'onlyfans', 'escort',
        'hooker', 'prostitute', 'whore', 'slut', 'skank',
        'boobs', 'tits', 'titties', 'pussy', 'vagina', 'penis',
        'clitoris', 'erection', 'boner'], 'sexual', 'medium'),

  // Threats – high severity
  ...w(['kill', 'murder', 'stab', 'shoot', 'bomb', 'strangle', 'torture',
        'massacre', 'assassinate', 'execute', 'behead', 'decapitate',
        'rape', 'molest', 'assault', 'lynch', 'genocide', 'holocaust',
        'ethnic cleansing', 'terrorist', 'terrorism', 'jihad',
        'suicide bomb', 'mass shooting', 'school shooting',
        'death threat', 'kill yourself', 'kys', 'neck yourself',
        'go die', 'hope you die', 'dox', 'doxxing', 'swat', 'swatting',
        'kidnap', 'hostage'], 'threats', 'high'),

  // Spam – low severity
  ...w(['buy now', 'click here', 'free money', 'make money fast',
        'work from home', 'earn cash', 'get rich', 'lottery winner',
        'you have won', 'congratulations you', 'act now', 'limited time',
        'nigerian prince', 'wire transfer', 'bitcoin doubler',
        'crypto giveaway', 'send btc', 'dm me', 'check bio',
        'follow for follow', 'f4f', 'sub4sub', 'like4like',
        'onlyfans link', 'cashapp', 'venmo me', 'telegram link'], 'spam', 'low'),

  // Drugs – medium severity
  ...w(['cocaine', 'coke', 'crack', 'heroin', 'smack', 'meth',
        'methamphetamine', 'crystal meth', 'ecstasy', 'mdma', 'molly',
        'lsd', 'acid', 'shrooms', 'mushrooms', 'ketamine', 'ghb',
        'pcp', 'angel dust', 'fentanyl', 'oxycontin', 'oxy',
        'xanax', 'percocet', 'adderall', 'ritalin',
        'drug dealer', 'plug', 'dealer', 'trap house'], 'drugs', 'medium'),
];

function w(words: string[], category: WordCategory, severity: Severity): WordEntry[] {
  return words.map(word => ({ word, category, severity, enabled: true }));
}

// ── Service ────────────────────────────────────────────────────────────

// Reactive version counter — touch inside Vue computed properties to
// re-evaluate when settings change.
export const moderationVersion = ref(0);

export class ModerationService {
  private static settings: ModerationSettings | null = null;
  private static wordList: WordEntry[] | null = null;

  // Patterns compiled lazily and cached
  private static _regex: RegExp | null = null;
  private static _regexVersion = 0;

  static getDefaultSettings(): ModerationSettings {
    return { ...DEFAULT_SETTINGS };
  }

  static getDefaultWordList(): WordEntry[] {
    return DEFAULT_WORD_LIST.map(e => ({ ...e }));
  }

  static getSettings(): ModerationSettings {
    if (!this.settings) this.loadSettings();
    return { ...this.settings! };
  }

  static saveSettings(partial: Partial<ModerationSettings>): void {
    const current = this.getSettings();
    this.settings = { ...current, ...partial };
    this._regex = null; // invalidate compiled regex
    this.wordList = null; // force word list rebuild with new custom words
    this._regexVersion++;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));

    // Keep legacy key in sync so old code doesn't break during migration
    localStorage.setItem('minUserKarma', String(this.settings.minUserKarma));

    // Bump reactive counter so Vue computed properties re-evaluate
    moderationVersion.value++;
  }

  static getWordList(): WordEntry[] {
    if (!this.wordList) this.loadSettings();
    return this.wordList!.map(e => ({ ...e }));
  }

  static getActiveWords(): WordEntry[] {
    const s = this.getSettings();
    return this.getWordList().filter(
      e => e.enabled && !s.disabledCategories.includes(e.category),
    );
  }

  // ── Filtering logic ────────────────────────────────────────────────

  static checkContent(text: string): FilterResult {
    const s = this.getSettings();
    if (!s.wordFilterEnabled || !text) {
      return { flagged: false, matches: [], severity: 'low' };
    }

    const regex = this.getRegex();
    if (!regex) return { flagged: false, matches: [], severity: 'low' };

    const lower = text.toLowerCase();
    const found: WordMatch[] = [];
    const activeWords = this.getActiveWords();
    const wordMap = new Map<string, WordEntry>();
    for (const w of activeWords) wordMap.set(w.word.toLowerCase(), w);

    let match: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((match = regex.exec(lower)) !== null) {
      const matched = match[0];
      const entry = wordMap.get(matched);
      if (entry && !found.some(f => f.word === entry.word)) {
        found.push({ word: entry.word, category: entry.category, severity: entry.severity });
      }
    }

    if (found.length === 0) return { flagged: false, matches: [], severity: 'low' };

    const maxSeverity = found.some(f => f.severity === 'high')
      ? 'high'
      : found.some(f => f.severity === 'medium')
        ? 'medium'
        : 'low';

    return { flagged: true, matches: found, severity: maxSeverity };
  }

  static shouldHideByScore(score: number): boolean {
    return score < this.getSettings().minContentScore;
  }

  static shouldHideByKarma(authorKarma: number | null): boolean {
    if (authorKarma === null) return false;
    const min = this.getSettings().minUserKarma;
    if (min <= -1000) return false;
    return authorKarma < min;
  }

  // ── Private helpers ────────────────────────────────────────────────

  private static loadSettings(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.settings = { ...DEFAULT_SETTINGS, ...parsed };
      } else {
        // Migrate legacy minUserKarma if present
        const legacy = localStorage.getItem('minUserKarma');
        this.settings = {
          ...DEFAULT_SETTINGS,
          minUserKarma: legacy ? Number(legacy) : DEFAULT_SETTINGS.minUserKarma,
        };
      }
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }

    // Build merged word list: defaults + custom blocked − custom allowed
    const s = this.settings!;
    const base = DEFAULT_WORD_LIST.map(e => ({ ...e }));
    const allowedSet = new Set(s.customAllowedWords.map(w => w.toLowerCase()));

    // Disable allowed overrides
    for (const entry of base) {
      if (allowedSet.has(entry.word.toLowerCase())) entry.enabled = false;
    }

    // Add custom blocked words
    const existingWords = new Set(base.map(e => e.word.toLowerCase()));
    for (const word of s.customBlockedWords) {
      if (!existingWords.has(word.toLowerCase())) {
        base.push({ word, category: 'profanity', severity: 'medium', enabled: true });
      }
    }

    this.wordList = base;
    this._regex = null;
    this._regexVersion++;
  }

  private static getRegex(): RegExp | null {
    if (this._regex) return this._regex;

    const active = this.getActiveWords();
    if (active.length === 0) return null;

    // Sort by length descending so longer phrases match first
    const escaped = active
      .map(e => e.word.toLowerCase())
      .sort((a, b) => b.length - a.length)
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    this._regex = new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'g');
    return this._regex;
  }
}
