import { describe, it, expect } from 'vitest';
import {
  EPOCH_MS,
  currentEpoch,
  rendezvousSoul,
  activeSouls,
} from '@/utils/rendezvous';

describe('rendezvous DGA', () => {
  describe('currentEpoch', () => {
    it('is stable within a window and advances across windows', () => {
      const base = 1_000 * EPOCH_MS; // aligned to a window boundary
      expect(currentEpoch(base)).toBe(1000);
      expect(currentEpoch(base + EPOCH_MS - 1)).toBe(1000);
      expect(currentEpoch(base + EPOCH_MS)).toBe(1001);
    });
  });

  describe('rendezvousSoul', () => {
    it('is deterministic — two independent nodes derive the same soul', () => {
      const nodeA = rendezvousSoul(42);
      const nodeB = rendezvousSoul(42);
      expect(nodeA).toBe(nodeB);
      expect(nodeA).toMatch(/^[0-9a-f]{32}$/);
    });

    it('produces a different soul each epoch (moving target)', () => {
      expect(rendezvousSoul(42)).not.toBe(rendezvousSoul(43));
    });
  });

  describe('activeSouls', () => {
    it('covers the current epoch plus both neighbours', () => {
      const now = 5_000 * EPOCH_MS + 123;
      const souls = activeSouls(now);
      expect(souls).toHaveLength(3);
      expect(souls).toEqual([
        rendezvousSoul(4999),
        rendezvousSoul(5000),
        rendezvousSoul(5001),
      ]);
    });

    it('two nodes straddling an epoch boundary share an overlapping soul', () => {
      const boundary = 7_000 * EPOCH_MS;
      const justBefore = activeSouls(boundary - 1); // epoch 6999
      const justAfter = activeSouls(boundary + 1); // epoch 7000
      const overlap = justBefore.filter((s) => justAfter.includes(s));
      expect(overlap.length).toBeGreaterThan(0);
    });
  });
});
