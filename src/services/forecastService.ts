// src/services/forecastService.ts
//
// Gun storage for forecast polls. Kept off the poll node on purpose: the poll
// record's legacy signature format is frozen (see utils/pollSignature.ts), so
// forecast metadata lives in its own signed records under `forecasts/<pollId>`.
//
//   forecasts/<pollId>/spec          author-signed ForecastSpec
//   forecasts/<pollId>/entries/<k>   forecaster-signed ForecastEntry (append-only)
//   forecasts/<pollId>/resolution    author-signed ForecastResolution
//   forecasters/<userId>/<pollId>    index so profiles can find a user's forecasts
//
// Every record is stored as { json } and re-verified on read; unsigned or
// forged records are dropped, so a relay cannot invent forecasts.

import { GunService } from './gunService';
import { CryptoService } from './cryptoService';
import { KeyService } from './keyService';
import { gunOnce, gunPut, gunReadChildren } from '../utils/gunAsync';
import {
  clampConfidence, forecastSigningPayload, isValidForecast, normalizeTopic,
  resolutionSigningPayload, specSigningPayload, validateSpec,
  buildReputation, canonicalJson, scoreUser,
  type ForecastEntry, type ForecastResolution, type ForecastSpec, type ResolvedQuestion,
  type ForecasterReputation,
} from '../utils/forecastScoring';

/** Signed, self-published summary. Leaderboards re-derive top entries to check it. */
export interface PublishedReputation {
  userId: string;
  displayName: string;
  score: number;
  accuracy: number;
  forecasts: number;
  bestStreak: number;
  topics: { topic: string; score: number; accuracy: number; forecasts: number }[];
  updatedAt: number;
  pubkey?: string;
  signature?: string;
}

const FOLLOWS_KEY = 'interpoll-followed-forecasters';

function reputationPayload(r: PublishedReputation): string {
  const { signature: _s, ...rest } = r;
  return canonicalJson({ v: 1, type: 'forecast-reputation', ...rest });
}

const HEX_PUBKEY = /^[0-9a-f]{64}$/i;

function sign(payload: string, privateKey: string): string {
  return CryptoService.sign(CryptoService.hash(payload), privateKey);
}

function verify(payload: string, signature?: string, pubkey?: string): boolean {
  if (!signature || !pubkey) return false;
  try { return CryptoService.verify(CryptoService.hash(payload), signature, pubkey); } catch { return false; }
}

/** If an id is itself a pubkey, the signing key must be that pubkey. */
function idMatchesKey(id: string, pubkey?: string): boolean {
  return !HEX_PUBKEY.test(id) || id.toLowerCase() === pubkey?.toLowerCase();
}

function parse<T>(raw: any): T | null {
  if (!raw?.json || typeof raw.json !== 'string') return null;
  try { return JSON.parse(raw.json) as T; } catch { return null; }
}

export class ForecastService {
  private static get gun() { return GunService.getGun(); }
  private static root(pollId: string) { return this.gun.get('forecasts').get(pollId); }

  static verifySpec(spec: ForecastSpec | null): spec is ForecastSpec {
    return !!spec && spec.kind === 'forecast' && idMatchesKey(spec.authorId, spec.authorPubkey) &&
      verify(specSigningPayload(spec), spec.signature, spec.authorPubkey);
  }

  static verifyEntry(entry: ForecastEntry, optionIds: string[]): boolean {
    return isValidForecast(entry, optionIds) && idMatchesKey(entry.userId, entry.pubkey) &&
      verify(forecastSigningPayload(entry), entry.signature, entry.pubkey);
  }

  static verifyResolution(res: ForecastResolution | null, spec: ForecastSpec): res is ForecastResolution {
    if (!res || res.pollId !== spec.pollId) return false;
    if (res.status === 'resolved' && !res.winningOptionId) return false;
    // Only the poll author can resolve, with the key that signed the spec.
    return res.resolverPubkey === spec.authorPubkey &&
      verify(resolutionSigningPayload(res), res.signature, res.resolverPubkey);
  }

  static async createSpec(input: Omit<ForecastSpec, 'kind' | 'createdAt' | 'authorPubkey' | 'signature'>): Promise<ForecastSpec> {
    const errors = validateSpec(input);
    if (errors.length) throw new Error(errors.join(' '));
    const keys = await KeyService.getKeyPair();
    const spec: ForecastSpec = {
      ...input,
      kind: 'forecast',
      topic: normalizeTopic(input.topic),
      resolutionSource: input.resolutionSource.trim().slice(0, 300),
      resolutionCriteria: input.resolutionCriteria.trim().slice(0, 1000),
      createdAt: Date.now(),
      authorPubkey: keys.publicKey,
    };
    spec.signature = sign(specSigningPayload(spec), keys.privateKey);
    await gunPut(this.root(spec.pollId).get('spec'), { json: JSON.stringify(spec) });
    return spec;
  }

  static async loadSpec(pollId: string): Promise<ForecastSpec | null> {
    const spec = parse<ForecastSpec>(await gunOnce(this.root(pollId).get('spec')));
    return spec && spec.pollId === pollId && this.verifySpec(spec) ? spec : null;
  }

  static async submitForecast(input: {
    pollId: string; userId: string; optionId: string; confidence: number; note?: string;
  }): Promise<ForecastEntry> {
    const keys = await KeyService.getKeyPair();
    const entry: ForecastEntry = {
      pollId: input.pollId,
      userId: input.userId,
      optionId: input.optionId,
      confidence: clampConfidence(input.confidence),
      createdAt: Date.now(),
      ...(input.note?.trim() ? { note: input.note.trim().slice(0, 280) } : {}),
      pubkey: keys.publicKey,
    };
    entry.signature = sign(forecastSigningPayload(entry), keys.privateKey);
    const key = `${input.userId}-${entry.createdAt}`;
    await gunPut(this.root(input.pollId).get('entries').get(key), { json: JSON.stringify(entry) });
    void gunPut(this.gun.get('forecasters').get(input.userId).get(input.pollId), { at: entry.createdAt }).catch(() => {});
    return entry;
  }

  /** Verified entries. Without `optionIds`, any option seen in the entries is accepted. */
  static async loadEntries(pollId: string, optionIds?: string[]): Promise<ForecastEntry[]> {
    const children = await gunReadChildren(this.root(pollId).get('entries'));
    const parsed = children.map((c) => parse<ForecastEntry>(c.value)).filter((e): e is ForecastEntry => !!e && e.pollId === pollId);
    const allowed = optionIds ?? [...new Set(parsed.map((e) => e.optionId))];
    const out = parsed.filter((e) => this.verifyEntry(e, allowed));
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  static async resolve(
    spec: ForecastSpec,
    input: Pick<ForecastResolution, 'status' | 'winningOptionId' | 'evidenceUrl' | 'note'> & { resolverId: string },
  ): Promise<ForecastResolution> {
    const keys = await KeyService.getKeyPair();
    if (keys.publicKey !== spec.authorPubkey) throw new Error('Only the poll author can resolve this forecast.');
    if (input.status === 'resolved' && !input.winningOptionId) throw new Error('Pick the winning option.');
    const res: ForecastResolution = {
      pollId: spec.pollId,
      status: input.status,
      ...(input.status === 'resolved' ? { winningOptionId: input.winningOptionId } : {}),
      ...(input.evidenceUrl?.trim() ? { evidenceUrl: input.evidenceUrl.trim().slice(0, 500) } : {}),
      ...(input.note?.trim() ? { note: input.note.trim().slice(0, 1000) } : {}),
      resolvedAt: Date.now(),
      resolverId: input.resolverId,
      resolverPubkey: keys.publicKey,
    };
    res.signature = sign(resolutionSigningPayload(res), keys.privateKey);
    await gunPut(this.root(spec.pollId).get('resolution'), { json: JSON.stringify(res) });
    return res;
  }

  static async loadResolution(spec: ForecastSpec): Promise<ForecastResolution | null> {
    const res = parse<ForecastResolution>(await gunOnce(this.root(spec.pollId).get('resolution')));
    return this.verifyResolution(res, spec) ? res : null;
  }

  /**
   * Gather every resolved question a user forecast on. Option ids are taken
   * from the forecasts themselves (union), which is enough for scoring.
   */
  static async loadResolvedQuestionsFor(userId: string, limit = 100): Promise<ResolvedQuestion[]> {
    const index = await gunReadChildren(this.gun.get('forecasters').get(userId));
    const pollIds = index.map((c) => c.key).slice(0, limit);
    const questions = await Promise.all(pollIds.map(async (pollId) => {
      const spec = await this.loadSpec(pollId);
      if (!spec) return null;
      const resolution = await this.loadResolution(spec);
      if (!resolution) return null;
      const raw = await gunReadChildren(this.root(pollId).get('entries'));
      const parsed = raw.map((c) => parse<ForecastEntry>(c.value)).filter((e): e is ForecastEntry => !!e);
      const optionIds = [...new Set([...parsed.map((e) => e.optionId), resolution.winningOptionId].filter(Boolean) as string[])];
      const entries = parsed.filter((e) => e.pollId === pollId && this.verifyEntry(e, optionIds));
      return { spec, optionIds, resolution, entries } as ResolvedQuestion;
    }));
    return questions.filter((q): q is ResolvedQuestion => !!q);
  }

  // ── reputation & leaderboards ─────────────────────────────────────────────

  static async computeReputation(userId: string): Promise<ForecasterReputation> {
    const questions = await this.loadResolvedQuestionsFor(userId);
    return buildReputation(userId, scoreUser(userId, questions));
  }

  /** Publish my own summary so leaderboards can list me. */
  static async publishReputation(userId: string, displayName: string, rep: ForecasterReputation): Promise<void> {
    if (rep.forecasts === 0) return;
    const keys = await KeyService.getKeyPair();
    if (!idMatchesKey(userId, keys.publicKey)) return;
    const r: PublishedReputation = {
      userId, displayName: displayName.slice(0, 60), score: rep.score, accuracy: rep.accuracy,
      forecasts: rep.forecasts, bestStreak: rep.bestStreak,
      topics: rep.byTopic.slice(0, 10).map(({ topic, score, accuracy, forecasts }) => ({ topic, score, accuracy, forecasts })),
      updatedAt: Date.now(), pubkey: keys.publicKey,
    };
    r.signature = sign(reputationPayload(r), keys.privateKey);
    await gunPut(this.gun.get('forecastReputation').get(userId), { json: JSON.stringify(r) });
  }

  /**
   * Leaderboard (optionally per topic). Summaries are self-signed, so the top
   * `verifyTop` rows are recomputed from raw signed forecasts and rows whose
   * claims don't hold are dropped.
   */
  static async loadLeaderboard(topic?: string, verifyTop = 10): Promise<(PublishedReputation & { verified: boolean })[]> {
    const nodes = await gunReadChildren(this.gun.get('forecastReputation'));
    const rows = nodes
      .map((c) => parse<PublishedReputation>(c.value))
      .filter((r): r is PublishedReputation => !!r && !!r.userId && idMatchesKey(r.userId, r.pubkey) &&
        verify(reputationPayload(r), r.signature, r.pubkey))
      .map((r) => {
        if (!topic) return r;
        const t = r.topics.find((x) => x.topic === topic);
        return t ? { ...r, score: t.score, accuracy: t.accuracy, forecasts: t.forecasts } : null;
      })
      .filter((r): r is PublishedReputation => !!r)
      .sort((a, b) => b.score - a.score || b.forecasts - a.forecasts);

    const out: (PublishedReputation & { verified: boolean })[] = [];
    for (const [i, r] of rows.entries()) {
      if (i >= verifyTop) { out.push({ ...r, verified: false }); continue; }
      const real = await this.computeReputation(r.userId).catch(() => null);
      const realTopic = topic ? real?.byTopic.find((t) => t.topic === topic) : real;
      if (!realTopic || Math.abs(realTopic.score - r.score) > 2) continue; // stale or inflated claim
      out.push({ ...r, score: realTopic.score, accuracy: realTopic.accuracy, forecasts: realTopic.forecasts, verified: true });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /** All poll ids a user has forecast on (newest first). */
  static async forecastPollIds(userId: string): Promise<{ pollId: string; at: number }[]> {
    const items = await gunReadChildren(this.gun.get('forecasters').get(userId));
    return items.map((c) => ({ pollId: c.key, at: Number((c.value as any)?.at) || 0 })).sort((a, b) => b.at - a.at);
  }

  // ── follows (local, plus a public follower set for counts) ─────────────────

  static followed(): string[] {
    try { return JSON.parse(localStorage.getItem(FOLLOWS_KEY) || '[]'); } catch { return []; }
  }

  static isFollowing(userId: string): boolean { return this.followed().includes(userId); }

  static async setFollow(me: string, target: string, follow: boolean): Promise<void> {
    const list = new Set(this.followed());
    if (follow) list.add(target); else list.delete(target);
    try { localStorage.setItem(FOLLOWS_KEY, JSON.stringify([...list])); } catch { /* storage blocked */ }
    if (me) await gunPut(this.gun.get('forecastFollowers').get(target).get(me), follow ? { at: Date.now() } : { at: 0 });
  }

  static async followerCount(target: string): Promise<number> {
    const items = await gunReadChildren(this.gun.get('forecastFollowers').get(target));
    return items.filter((c) => Number((c.value as any)?.at) > 0).length;
  }
}
