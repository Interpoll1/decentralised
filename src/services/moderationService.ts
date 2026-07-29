// Moderation & content-filtering service (client-side only)
//
// Rewritten to use context-aware regex patterns instead of bare word matching.
// No profanity filter, no slurs, no abusive language — those are normal on most
// platforms and cause far too many false positives. This filter covers only
// content that is genuinely illegal or harmful regardless of context.
//
// Categories kept:
//   threats  — direct personal threats, doxxing, self-harm instructions
//   sexual   — commercial solicitation only (not anatomy or discussion)
//   spam     — financial scams and solicitation
//
// Categories removed:
//   profanity — common on all platforms, user preference not platform safety
//   slurs     — handled at relay level (moderation-middleware.js), not client
//   drugs     — bare drug names cause too many false positives in news/harm-reduction

import { ref } from 'vue';

export type Severity = 'low' | 'medium' | 'high';
export type FilterAction = 'blur' | 'hide' | 'flag';
export type PatternCategory = 'threats' | 'sexual' | 'spam';
export type ImageFilterMode = 'manual' | 'detail-auto' | 'all-auto';

// Keep WordCategory as a union for backwards compat with any UI that references it
export type WordCategory = PatternCategory | 'profanity' | 'slurs' | 'drugs';

export interface PatternEntry {
  pattern: RegExp;
  label: string;       // human-readable description shown in UI on match
  category: PatternCategory;
  severity: Severity;
  enabled: boolean;
}

// Legacy interface — kept so existing UI components don't break
export interface WordEntry {
  word: string;
  category: WordCategory;
  severity: Severity;
  enabled: boolean;
}

export interface WordMatch {
  word: string;        // the label of the matched pattern
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
  customBlockedWords: string[];   // kept for user additions, treated as literal phrases
  customAllowedWords: string[];
  disabledCategories: WordCategory[];
  imageFilterEnabled: boolean;
  imageFilterMode: ImageFilterMode;
  imageFilterSensitivity: number;
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
  imageFilterEnabled: false,
  imageFilterMode: 'manual',
  imageFilterSensitivity: 0.6,
};

// ── Pattern list ──────────────────────────────────────────────────────────────
// Every pattern requires enough context that innocent text won't match.
// Organised by category and severity to mirror relay-side middleware.

const DEFAULT_PATTERNS: PatternEntry[] = [

  // ── threats: high ────────────────────────────────────────────────────────

  // Direct personal threats — requires subject + verb + target
  { pattern: /i(?:'ll|\s+will|\s+am\s+going\s+to)\s+(kill|murder|shoot|stab|rape)\s+(you|u|him|her|them|your\s+\w+)/i,
    label: 'direct threat', category: 'threats', severity: 'high', enabled: true },

  { pattern: /\bkill\s+your(self|selves)\b/i,
    label: 'self-harm instruction', category: 'threats', severity: 'high', enabled: true },

  { pattern: /\b(neck|hang)\s+your(self|selves)\b/i,
    label: 'self-harm instruction', category: 'threats', severity: 'high', enabled: true },

  { pattern: /\bkys\b(?!\s*kyats)/i,
    label: 'self-harm instruction', category: 'threats', severity: 'high', enabled: true },

  { pattern: /\bgo\s+(kill|hang|rope)\s+your(self|selves)\b/i,
    label: 'self-harm instruction', category: 'threats', severity: 'high', enabled: true },

  { pattern: /\bi\s+know\s+where\s+you\s+live.{0,30}(kill|hurt|find|come\s+for)\b/i,
    label: 'location threat', category: 'threats', severity: 'high', enabled: true },

  { pattern: /\bi\s+have\s+your\s+(address|location|ip\s+address|home\s+address)\b/i,
    label: 'doxxing threat', category: 'threats', severity: 'high', enabled: true },

  { pattern: /\b(posting|dropping|releasing)\s+(your\s+)?(dox|address|location|info)\b/i,
    label: 'doxxing', category: 'threats', severity: 'high', enabled: true },

  { pattern: /\bswatt?ing\s+(you|him|her|them|someone)\b/i,
    label: 'swatting threat', category: 'threats', severity: 'high', enabled: true },

  { pattern: /\bhow\s+to\s+(make|build|create|assemble)\s+a\s+(bomb|explosive|pipe\s*bomb|ied)\b/i,
    label: 'weapons instructions', category: 'threats', severity: 'high', enabled: true },

  // ── threats: medium ───────────────────────────────────────────────────────

  // Self-harm facilitation — method + instructional framing only
  { pattern: /\b(easiest|quickest|painless|best)\s+way\s+to\s+(kill\s+yourself|commit\s+suicide|end\s+it)\b/i,
    label: 'self-harm facilitation', category: 'threats', severity: 'medium', enabled: true },

  { pattern: /\bhow\s+to\s+(commit\s+suicide|kill\s+yourself|end\s+your\s+life)\b/i,
    label: 'self-harm facilitation', category: 'threats', severity: 'medium', enabled: true },

  { pattern: /\b(lethal\s+dose|overdose\s+on)\s+(tylenol|acetaminophen|insulin|medication)\b/i,
    label: 'self-harm method', category: 'threats', severity: 'medium', enabled: true },

  // CSAM — always high regardless of category
  { pattern: /\bcsam\b/i,
    label: 'CSAM', category: 'threats', severity: 'high', enabled: true },

  { pattern: /child\s*(porn(?:ography)?|sex(?:ual)?\s*abuse\s*material)/i,
    label: 'CSAM', category: 'threats', severity: 'high', enabled: true },

  { pattern: /\b(minor|underage|preteen)\s+(porn|nudes?|sex(?:ual)?|naked\s*pics?)/i,
    label: 'CSAM', category: 'threats', severity: 'high', enabled: true },

  { pattern: /\bloli(?:con)?\s*(porn|hentai|content|pics?)\b/i,
    label: 'CSAM', category: 'threats', severity: 'high', enabled: true },

  // ── sexual: medium — solicitation context only ────────────────────────────

  { pattern: /\b(selling|buy|purchase|dm\s+for)\s+(nudes?|porn|content|pics?)\b/i,
    label: 'sexual solicitation', category: 'sexual', severity: 'medium', enabled: true },

  { pattern: /\bonlyfans\.com\/\w+/i,
    label: 'commercial sexual content', category: 'sexual', severity: 'medium', enabled: true },

  { pattern: /\bescort\s+(service|available|in\s+\w+town)\b/i,
    label: 'escort solicitation', category: 'sexual', severity: 'medium', enabled: true },

  { pattern: /\b(rates?|booking)\s+.{0,20}\s+(escort|companionship|full\s+service)\b/i,
    label: 'escort solicitation', category: 'sexual', severity: 'medium', enabled: true },

  // ── spam: low — financial scams ───────────────────────────────────────────

  { pattern: /\bnigerian\s+prince\b/i,
    label: 'scam', category: 'spam', severity: 'low', enabled: true },

  { pattern: /\bbitcoin\s+doubler\b/i,
    label: 'crypto scam', category: 'spam', severity: 'low', enabled: true },

  { pattern: /\bcrypto\s+giveaway\b/i,
    label: 'crypto scam', category: 'spam', severity: 'low', enabled: true },

  { pattern: /\b(send|transfer)\s+\d+\s*(btc|eth|usdt|crypto)\s+(to|and\s+receive)\b/i,
    label: 'crypto scam', category: 'spam', severity: 'low', enabled: true },

  { pattern: /\byou\s+have\s+(won|been\s+selected).{0,40}(prize|lottery|reward)\b/i,
    label: 'lottery scam', category: 'spam', severity: 'low', enabled: true },

  // ── spam: low — drug dealing solicitation ────────────────────────────────
  // Drug names alone ignored; only dealing intent triggers

  { pattern: /\b(selling|buy|cop|score|plug)\s+(coke|crack|meth|mdma|molly|heroin|fent(?:anyl)?|xans?|percs?)\b/i,
    label: 'drug solicitation', category: 'spam', severity: 'low', enabled: true },

  { pattern: /\b(dm|message|telegram|signal|wickr)\s+(for\s+)?(a\s+)?(plug|supply|pack|re-?up)\b/i,
    label: 'drug solicitation', category: 'spam', severity: 'low', enabled: true },

  { pattern: /\btrap\s+house\b/i,
    label: 'drug solicitation', category: 'spam', severity: 'low', enabled: true },

  { pattern: /\bfent(?:anyl)?\s+(pills?|pressed|blues?)\b/i,
    label: 'fentanyl dealing', category: 'spam', severity: 'low', enabled: true },
];

// ── Reactive version counter ──────────────────────────────────────────────────
export const moderationVersion = ref(0);

// ── Service ───────────────────────────────────────────────────────────────────
export class ModerationService {
  private static settings: ModerationSettings | null = null;
  private static _patterns: PatternEntry[] | null = null;

  static getDefaultSettings(): ModerationSettings {
    return { ...DEFAULT_SETTINGS };
  }

  // Legacy shim — returns patterns as WordEntry shape so existing UI doesn't break
  static getDefaultWordList(): WordEntry[] {
    return DEFAULT_PATTERNS.map(p => ({
      word: p.label,
      category: p.category,
      severity: p.severity,
      enabled: p.enabled,
    }));
  }

  static getSettings(): ModerationSettings {
    if (!this.settings) this.loadSettings();
    return { ...this.settings! };
  }

  static saveSettings(partial: Partial<ModerationSettings>): void {
    const current = this.getSettings();
    this.settings = { ...current, ...partial };
    this._patterns = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    localStorage.setItem('minUserKarma', String(this.settings.minUserKarma));
    moderationVersion.value++;
  }

  // Legacy shim
  static getWordList(): WordEntry[] {
    return this.getDefaultWordList();
  }

  static getActivePatterns(): PatternEntry[] {
    if (this._patterns) return this._patterns;
    const s = this.getSettings();
    const allowed = new Set(s.customAllowedWords.map(w => w.toLowerCase()));

    let active = DEFAULT_PATTERNS.filter(p =>
      p.enabled &&
      !s.disabledCategories.includes(p.category) &&
      !allowed.has(p.label.toLowerCase())
    );

    // Add user's custom blocked phrases as literal patterns
    for (const phrase of s.customBlockedWords) {
      if (!phrase.trim()) continue;
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      active.push({
        pattern: new RegExp(`\\b${escaped}\\b`, 'i'),
        label: phrase,
        category: 'threats',
        severity: 'medium',
        enabled: true,
      });
    }

    this._patterns = active;
    return active;
  }

  // ── Main check ────────────────────────────────────────────────────────────

  static checkContent(text: string): FilterResult {
    const s = this.getSettings();
    if (!s.wordFilterEnabled || !text) {
      return { flagged: false, matches: [], severity: 'low' };
    }

    const active = this.getActivePatterns();
    const found: WordMatch[] = [];

    for (const entry of active) {
      if (entry.pattern.test(text)) {
        // Avoid duplicate labels
        if (!found.some(f => f.word === entry.label)) {
          found.push({ word: entry.label, category: entry.category, severity: entry.severity });
        }
      }
    }

    if (!found.length) return { flagged: false, matches: [], severity: 'low' };

    const maxSeverity: Severity = found.some(f => f.severity === 'high')
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

  // ── Private ───────────────────────────────────────────────────────────────

  private static loadSettings(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.settings = { ...DEFAULT_SETTINGS, ...parsed };
      } else {
        const legacy = localStorage.getItem('minUserKarma');
        this.settings = {
          ...DEFAULT_SETTINGS,
          minUserKarma: legacy ? Number(legacy) : DEFAULT_SETTINGS.minUserKarma,
        };
      }
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    this._patterns = null;
  }
}


git add .
git commit -m "check readme or file i gave for updates"
git push origin updates
