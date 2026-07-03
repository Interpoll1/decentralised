import { describe, it, expect, beforeEach } from 'vitest';
import { PeerReputationService } from '@/services/peerReputationService';

// Minimal in-memory localStorage so the service's persistence path is exercised
// under the node test environment.
function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}

function resetService(): void {
  (PeerReputationService as any).records = new Map();
  (PeerReputationService as any).loaded = false;
}

describe('PeerReputationService', () => {
  beforeEach(() => {
    installLocalStorage();
    (globalThis as any).localStorage.clear();
    resetService();
  });

  it('starts every endpoint at a neutral score', () => {
    expect(PeerReputationService.scoreFor('relay-a')).toBe(0.5);
  });

  it('raises score on success and lowers it on failure', () => {
    PeerReputationService.recordSuccess('relay-a');
    expect(PeerReputationService.scoreFor('relay-a')).toBeGreaterThan(0.5);

    PeerReputationService.recordFailure('relay-b');
    expect(PeerReputationService.scoreFor('relay-b')).toBeLessThan(0.5);
  });

  it('keeps scores within [0, 1] under repeated observations', () => {
    for (let i = 0; i < 50; i++) PeerReputationService.recordSuccess('good');
    for (let i = 0; i < 50; i++) PeerReputationService.recordFailure('bad');
    expect(PeerReputationService.scoreFor('good')).toBeLessThanOrEqual(1);
    expect(PeerReputationService.scoreFor('good')).toBeGreaterThan(0.9);
    expect(PeerReputationService.scoreFor('bad')).toBeGreaterThanOrEqual(0);
    expect(PeerReputationService.scoreFor('bad')).toBeLessThan(0.1);
  });

  it('ranks best-reputation endpoints first, stable for ties', () => {
    PeerReputationService.recordSuccess('winner');
    PeerReputationService.recordFailure('loser');
    const ranked = PeerReputationService.rank(['loser', 'winner', 'neutral']);
    expect(ranked[0]).toBe('winner');
    expect(ranked[ranked.length - 1]).toBe('loser');
    // 'neutral' (never seen, 0.5) sits between the two.
    expect(ranked).toEqual(['winner', 'neutral', 'loser']);
  });

  it('flags poor, stale endpoints as prune-eligible', () => {
    for (let i = 0; i < 30; i++) PeerReputationService.recordFailure('dead');
    // Fresh failures are low-score but not stale yet → not prunable.
    expect(PeerReputationService.shouldPrune('dead')).toBe(false);

    // Age the record past the prune TTL.
    const rec = (PeerReputationService as any).records.get('dead');
    rec.lastSeen = Date.now() - 48 * 60 * 60_000;
    expect(PeerReputationService.shouldPrune('dead')).toBe(true);
  });

  it('persists and reloads reputation across a fresh in-memory instance', () => {
    PeerReputationService.recordSuccess('relay-a');
    const before = PeerReputationService.scoreFor('relay-a');

    // Simulate a page reload: drop in-memory state, keep localStorage.
    resetService();

    expect(PeerReputationService.scoreFor('relay-a')).toBeCloseTo(before, 6);
  });
});
