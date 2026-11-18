import { configDefaults, defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '../src'),
    },
  },
  test: {
    root: resolve(__dirname),
    globals: true,
    environment: 'node',
    // Bound CPU contention for real-crypto concurrency tests on developer machines and CI.
    maxWorkers: 4,
    include: ['**/*.test.{ts,js}'],
    // Node test-runner suites are executed separately, never by Vitest.
    exclude: [...configDefaults.exclude, '**/tools/**', '**/deployment/**'],
    testTimeout: 15000,
  },
});
