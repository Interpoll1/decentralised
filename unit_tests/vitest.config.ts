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
    include: ['**/*.test.{ts,js}'],
    // Node test-runner suites are executed separately, never by Vitest.
    exclude: [...configDefaults.exclude, '**/tools/**', '**/deployment/**'],
    testTimeout: 15000,
  },
});
