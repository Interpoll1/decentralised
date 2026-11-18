import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: '.', testMatch: 'production-language.spec.mjs',
  outputDir: '../test-results/production', workers: 1, timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:5198', channel: process.env.CI ? undefined : 'chrome',
    viewport: { width:390, height:844 }, locale:'uk-UA', serviceWorkers:'block',
    screenshot:'only-on-failure',
  },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5198 --strictPort'
      + (process.env.INTERPOLL_SMOKE_NEGATIVE ? ' --outDir test-results/negative-built' : ''),
    url:'http://127.0.0.1:5198',
  },
});
