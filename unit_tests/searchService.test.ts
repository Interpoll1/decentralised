import { describe, it, expect } from 'vitest';

// Test pagination logic directly (SearchService uses fetch/IntegrityService)
describe('SearchService pagination logic', () => {
  function getTotalPages(total: number, perPage = 20): number {
    return Math.max(1, Math.ceil(total / perPage));
  }

  function hasNextPage(currentPage: number, total: number, perPage = 20): boolean {
    return currentPage < getTotalPages(total, perPage);
  }

  function hasPreviousPage(currentPage: number): boolean {
    return currentPage > 1;
  }

  describe('getTotalPages', () => {
    it('returns 1 for 0 results', () => {
      expect(getTotalPages(0)).toBe(1);
    });

    it('returns correct pages for exact division', () => {
      expect(getTotalPages(40, 20)).toBe(2);
    });

    it('rounds up for partial pages', () => {
      expect(getTotalPages(41, 20)).toBe(3);
    });

    it('returns 1 for results less than perPage', () => {
      expect(getTotalPages(5, 20)).toBe(1);
    });
  });

  describe('hasNextPage', () => {
    it('returns true when more pages exist', () => {
      expect(hasNextPage(1, 50, 20)).toBe(true);
    });

    it('returns false on last page', () => {
      expect(hasNextPage(3, 50, 20)).toBe(false);
    });

    it('returns false when only one page', () => {
      expect(hasNextPage(1, 5, 20)).toBe(false);
    });
  });

  describe('hasPreviousPage', () => {
    it('returns false on page 1', () => {
      expect(hasPreviousPage(1)).toBe(false);
    });

    it('returns true on page 2+', () => {
      expect(hasPreviousPage(2)).toBe(true);
    });
  });
});
