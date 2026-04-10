import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('vue', () => ({
  ref: (val: any) => ({ value: val }),
}));

import {
  setBetaFeature,
  isBetaEnabled,
} from '../src/utils/betaFeatures';

describe('betaFeatures', () => {
  beforeEach(() => {
    storage.clear();
  });

  describe('isBetaEnabled', () => {
    it('returns false by default for resilience', () => {
      expect(isBetaEnabled('resilience')).toBe(false);
    });
  });

  describe('setBetaFeature', () => {
    it('enables a feature', () => {
      setBetaFeature('resilience', true);
      expect(isBetaEnabled('resilience')).toBe(true);
    });

    it('disables a feature', () => {
      setBetaFeature('resilience', true);
      setBetaFeature('resilience', false);
      expect(isBetaEnabled('resilience')).toBe(false);
    });

    it('persists to localStorage', () => {
      setBetaFeature('resilience', true);
      const stored = JSON.parse(storage.get('interpoll_beta_features')!);
      expect(stored.resilience).toBe(true);
    });
  });
});
