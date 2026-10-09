/**
 * Pure text rules for custom chat names (no storage, so UI components can import it cheaply).
 * See chatNicknames.ts for how they are persisted.
 */
export const MAX_NICKNAME = 40;

/**
 * Normalise what the user typed. Strips control, zero-width and bidi-override characters
 * (a pasted right-to-left override could otherwise make one name render as another), collapses
 * whitespace, and caps the length by characters rather than UTF-16 units so emoji aren't cut in half.
 * Returns '' when nothing usable is left, which means "remove the nickname".
 */
export function cleanNickname(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .normalize('NFC')
    // C0/C1 controls, zero-width & joiners, LRM/RLM, bidi embeddings/overrides/isolates, BOM
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, MAX_NICKNAME).join('').trim();
}




