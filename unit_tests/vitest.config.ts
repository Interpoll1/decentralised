import { defineConfig } from 'vitest/config';
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
    testTimeout: 15000,
  },
});
