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

// Mock gunService
vi.mock('../src/services/gunService', () => ({
  GUN_NAMESPACE: 'v2',
}));

import {
  getEnabledVersions,
  setEnabledVersions,
  isVersionEnabled,
  reconcileVersions,
} from '../src/utils/dataVersionSettings';

describe('dataVersionSettings', () => {
  beforeEach(() => {
    storage.clear();
  });

  describe('getEnabledVersions', () => {
    it('returns default containing GUN_NAMESPACE', () => {
      const versions = getEnabledVersions();
      expect(versions).toContain('v2');
    });
  });

  describe('setEnabledVersions', () => {
    it('sets and retrieves versions', () => {
      setEnabledVersions(['v1', 'v2']);
      const versions = getEnabledVersions();
      expect(versions).toContain('v1');
      expect(versions).toContain('v2');
    });

    it('falls back to namespace when empty array passed', () => {
      setEnabledVersions([]);
      const versions = getEnabledVersions();
      expect(versions).toContain('v2');
    });

    it('persists to localStorage', () => {
      setEnabledVersions(['v1', 'v2']);
      const stored = JSON.parse(storage.get('interpoll_data_versions')!);
      expect(stored).toEqual(['v1', 'v2']);
    });
  });

  describe('reconcileVersions', () => {
    // GUN_NAMESPACE is mocked to 'v2' for this suite.
    it('keeps legacy opt-in roots below the current namespace', () => {
      expect(reconcileVersions(['v1', 'v2'])).toEqual(['v1', 'v2']);
    });

    it('drops a stale namespace the client has moved past', () => {
      // v3 is >= 3 and not the active namespace — a leftover from an upgrade.
      expect(reconcileVersions(['v3'])).toEqual(['v2']);
      expect(reconcileVersions(['v1', 'v3'])).toEqual(['v1', 'v2']);
    });

    it('always includes the active namespace', () => {
      expect(reconcileVersions(['v1'])).toContain('v2');
    });

    it('discards unparseable entries', () => {
      expect(reconcileVersions(['garbage', 'v1'])).toEqual(['v1', 'v2']);
    });
  });

  describe('isVersionEnabled', () => {
    it('returns true for enabled version', () => {
      setEnabledVersions(['v1', 'v2']);
      expect(isVersionEnabled('v1')).toBe(true);
    });

    it('returns false for disabled version', () => {
      setEnabledVersions(['v2']);
      expect(isVersionEnabled('v1')).toBe(false);
    });

    it('returns false for a stale namespace even if it was stored', () => {
      setEnabledVersions(['v2', 'v3']);
      expect(isVersionEnabled('v3')).toBe(false);
    });
  });
});
