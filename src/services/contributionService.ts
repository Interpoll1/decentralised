// src/services/contributionService.ts
//
// Gun storage for the Contribution Graph (credits only — no payments).
//
//   contributions/<workId>/versions/<n>        hash-chained SplitVersion
//   contributions/<workId>/acceptances/<key>   contributor-signed Acceptance
//   contributionInbox/<contributorId>/<workId> lets invitees find pending invites

import { GunService } from './gunService';
import { CryptoService } from './cryptoService';
import { KeyService } from './keyService';
import { gunPut, gunReadChildren } from '../utils/gunAsync';
import { canonicalJson } from '../utils/forecastScoring';
import {
  buildSplitVersion, verifyHistory,
  type Acceptance, type SplitEntry, type SplitVersion, type WorkKind,
} from '../utils/contributionSplit';

const HEX_PUBKEY = /^[0-9a-f]{64}$/i;
const hashFn = (s: string) => CryptoService.hash(s);

function acceptancePayload(a: Acceptance): string {
  const { signature: _s, ...rest } = a;
  return canonicalJson({ v: 1, type: 'contribution-acceptance', ...rest });
}

function parse<T>(raw: any): T | null {
  if (!raw?.json || typeof raw.json !== 'string') return null;
  try { return JSON.parse(raw.json) as T; } catch { return null; }
}

export interface ContributionState {
  history: SplitVersion[];
  current: SplitVersion | null;
  acceptances: Acceptance[];
  historyValid: boolean;
}

export class ContributionService {
  private static get gun() { return GunService.getGun(); }
  private static root(workId: string) { return this.gun.get('contributions').get(workId); }

  static verifyAcceptance(a: Acceptance): boolean {
    if (!a.signature || !a.pubkey) return false;
    if (HEX_PUBKEY.test(a.contributorId) && a.contributorId.toLowerCase() !== a.pubkey.toLowerCase()) return false;
    try { return CryptoService.verify(CryptoService.hash(acceptancePayload(a)), a.signature, a.pubkey); } catch { return false; }
  }

  static async load(workId: string): Promise<ContributionState> {
    const [versionNodes, acceptanceNodes] = await Promise.all([
      gunReadChildren(this.root(workId).get('versions')),
      gunReadChildren(this.root(workId).get('acceptances')),
    ]);
    const history = versionNodes
      .map((c) => parse<SplitVersion>(c.value))
      .filter((v): v is SplitVersion => !!v && v.workId === workId)
      .sort((a, b) => a.version - b.version);
    const acceptances = acceptanceNodes
      .map((c) => parse<Acceptance>(c.value))
      .filter((a): a is Acceptance => !!a && a.workId === workId && this.verifyAcceptance(a));
    const historyValid = verifyHistory(history, hashFn);
    return { history, current: historyValid ? history[history.length - 1] ?? null : null, acceptances, historyValid };
  }

  /** Propose a new split version. The proposer auto-accepts their own entry. */
  static async propose(input: {
    workId: string; workKind: WorkKind; entries: SplitEntry[]; proposedBy: string;
  }): Promise<SplitVersion> {
    const state = await this.load(input.workId);
    if (!state.historyValid) throw new Error('Contribution history failed verification; refusing to extend it.');
    const next = buildSplitVersion({ ...input, proposedAt: Date.now() }, state.current, hashFn);
    await gunPut(this.root(input.workId).get('versions').get(String(next.version)), { json: JSON.stringify(next) });
    await Promise.all(next.entries.map((e) =>
      gunPut(this.gun.get('contributionInbox').get(e.contributorId).get(input.workId), { version: next.version, kind: input.workKind })
        .catch(() => undefined)));
    if (next.entries.some((e) => e.contributorId === input.proposedBy)) {
      await this.respond(next, input.proposedBy, 'accepted');
    }
    return next;
  }

  static async respond(
    version: SplitVersion,
    contributorId: string,
    state: Acceptance['state'],
    reason?: string,
  ): Promise<Acceptance> {
    if (!version.entries.some((e) => e.contributorId === contributorId)) {
      throw new Error('You are not listed on this split.');
    }
    const keys = await KeyService.getKeyPair();
    const a: Acceptance = {
      workId: version.workId, version: version.version, versionHash: version.hash,
      contributorId, state, at: Date.now(),
      ...(reason?.trim() ? { reason: reason.trim().slice(0, 500) } : {}),
      pubkey: keys.publicKey,
    };
    a.signature = CryptoService.sign(CryptoService.hash(acceptancePayload(a)), keys.privateKey);
    const key = `${contributorId}-${version.version}-${a.at}`;
    await gunPut(this.root(version.workId).get('acceptances').get(key), { json: JSON.stringify(a) });
    return a;
  }

  /** Works where this user has been listed (for an invites inbox). */
  static async inbox(contributorId: string): Promise<{ workId: string; version: number; kind: WorkKind }[]> {
    const items = await gunReadChildren(this.gun.get('contributionInbox').get(contributorId));
    return items
      .filter((c) => c.value && typeof c.value === 'object')
      .map((c) => ({ workId: c.key, version: Number((c.value as any).version) || 1, kind: (c.value as any).kind as WorkKind }));
  }
}
