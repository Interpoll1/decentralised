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

  describe('isVersionEnabled', () => {
    it('returns true for enabled version', () => {
      setEnabledVersions(['v1', 'v2']);
      expect(isVersionEnabled('v1')).toBe(true);
    });

    it('returns false for disabled version', () => {
      setEnabledVersions(['v2']);
      expect(isVersionEnabled('v1')).toBe(false);
    });
  });
});
