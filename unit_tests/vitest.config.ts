import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Tests exercise the web adapters. The desktop adapters are covered by
      // their own build (`build:desktop`) and by the Rust crate tests; pointing
      // the suite at them here would require a Tauri IPC host that does not
      // exist under vitest.
      '@platform': resolve(__dirname, '../src/platform/web'),
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
