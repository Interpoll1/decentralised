import type { StoredChatMessage } from '../types/social';

/**
 * Searching conversations by person or by message text. Everything here is local and pure:
 * it runs over the messages already stored on this device, nothing leaves it.
 *
 * Matching ignores case AND accents ("jose" finds "José"), and the match positions it reports are
 * in the ORIGINAL text so a highlight lands on exactly what the user sees.
 */

/** Message search starts at 2 characters (1 char would match nearly everything). Names match from 1. */
export const MIN_MESSAGE_QUERY = 2;

interface Folded { text: string; start: number[]; end: number[] }

/**
 * Lower-case and strip accents, remembering for every folded UTF-16 unit which span of the original
 * it came from. (Folding can change length: e.g. "İ" lower-cases to two units.)
 */
export function fold(input: string): Folded {
  let text = '';
  const start: number[] = [];
  const end: number[] = [];
  let i = 0;
  for (const ch of input) {                                     // iterates by code point
    const piece = ch.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');
    for (let k = 0; k < piece.length; k++) { start.push(i); end.push(i + ch.length); }
    text += piece;
    i += ch.length;
  }
  return { text, start, end };
}

/** First match of `query` in `text`, as [start, end) offsets into the original `text`. */
export function findMatch(text: string, query: string): { start: number; end: number } | null {
  const q = fold(query.trim()).text;
  if (!q) return null;
  const f = fold(text);
  const at = f.text.indexOf(q);
  if (at < 0) return null;
  return { start: f.start[at], end: f.end[at + q.length - 1] };
}

/** Split `text` into plain/highlighted runs for rendering (no HTML involved, so nothing to escape). */
export function splitHighlight(text: string, query: string): { t: string; hit: boolean }[] {
  const m = query.trim() ? findMatch(text, query) : null;
  if (!m) return text ? [{ t: text, hit: false }] : [];
  return [
    { t: text.slice(0, m.start), hit: false },
    { t: text.slice(m.start, m.end), hit: true },
    { t: text.slice(m.end), hit: false },
  ].filter(p => p.t);
}

export interface Snippet { before: string; hit: string; after: string }

const isLow  = (c: number) => c >= 0xdc00 && c <= 0xdfff;
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;

/** A short window of `text` around the first match, with ellipses where it was cut. */
export function snippet(text: string, query: string, radius = 36): Snippet | null {
  const flat = text.replace(/\s+/g, ' ').trim();              // newlines would wreck a one-line preview
  const m = findMatch(flat, query);
  if (!m) return null;
  let ws = Math.max(0, m.start - radius);
  let we = Math.min(flat.length, m.end + radius);
  if (ws > 0 && isLow(flat.charCodeAt(ws))) ws++;               // never cut an emoji in half
  if (we < flat.length && isHigh(flat.charCodeAt(we - 1))) we--;
  return {
    before: (ws > 0 ? '…' : '') + flat.slice(ws, m.start),
    hit:    flat.slice(m.start, m.end),
    after:  flat.slice(m.end, we) + (we < flat.length ? '…' : ''),
  };
}

export interface MessageHit extends Snippet {
  /** How many messages in this conversation match (capped). */
  count: number;
  /** Time of the most recent matching message, which is the one the snippet shows. */
  time: number;
  /** Whether that message was sent by us (shown as "You:"). */
  mine: boolean;
}

const MAX_COUNT = 999;
const MAX_TEXT = 20_000;       // a pathological giant message shouldn't stall the UI

/** Per conversation (keyed by the other person's id): how many messages match, and the latest one. */
export function searchMessages(rows: StoredChatMessage[], me: string, query: string): Record<string, MessageHit> {
  const q = query.trim();
  if (!me || Array.from(q).length < MIN_MESSAGE_QUERY || !fold(q).text) return {};
  const out: Record<string, MessageHit> = {};
  for (const r of rows) {
    if (r.kind !== 'dm' || r.control || (r.syncStatus as string) === 'corrupted') continue;   // 'corrupted' is set at runtime by the media viewer
    if (typeof r.text !== 'string' || !r.text || r.text.startsWith('{"_file":true')) continue;   // receipts, media payloads
    const parts = (r.roomId || '').split(':');
    if (!parts.includes(me)) continue;
    const peer = parts.find(id => id !== me);
    if (!peer) continue;
    const s = snippet(r.text.slice(0, MAX_TEXT), q);
    if (!s) continue;
    const cur = out[peer];
    const count = Math.min(MAX_COUNT, (cur?.count ?? 0) + 1);
    if (!cur || r.timestamp >= cur.time) out[peer] = { ...s, count, time: r.timestamp, mine: !!r.outgoing };
    else cur.count = count;
  }
  return out;
}