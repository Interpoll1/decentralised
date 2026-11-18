import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: '.',
  testMatch: 'poll-first-use.spec.mjs',
  outputDir: '../test-results/poll-first-use',
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:5197',
    channel: process.env.CI ? undefined : 'chrome',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
  },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5197 --strictPort',
    url: 'http://127.0.0.1:5197',
  },
});
