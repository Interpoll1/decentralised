// E2E for 1:1 calls: two Chromium contexts with fake media devices.
//
// Playwright is NOT a repo dependency. Run from a scratch dir that has it:
//   npm i playwright && npx playwright install chromium
//   BASE_URL=http://localhost:5173 node /path/to/e2e/call.spec.mjs
//
// NOTE: local dev defaults to the PRODUCTION relays (see src/config.ts), so this
// test sends real (signed, short-lived) call signals through them. Ask before
// pointing BASE_URL at the live site.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const RING_TIMEOUT = 30_000;

async function newUser(browser) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`${BASE}/chat#id=${'f'.repeat(64)}&name=warm`);
  // The device signing pubkey is the call address (== profile id).
  const pubkey = await page.evaluate(async () => {
    const { KeyService } = await import('/src/services/keyService.ts');
    return KeyService.getPublicKeyHex();
  });
  return { ctx, page, pubkey };
}

async function openDm(user, peer) {
  await user.page.goto(`${BASE}/chat#id=${peer.pubkey}&name=peer`);
  await user.page.waitForSelector('[data-testid="call-video"]', { timeout: 20_000 });
}

const status = (u) => u.page.locator('[data-testid="call-status"]');

async function run(name, fn) {
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  try {
    const a = await newUser(browser);
    const b = await newUser(browser);
    // Each must have the other as a known contact or the ring is dropped silently.
    await openDm(a, b);
    await openDm(b, a);
    await fn(a, b);
    console.log(`PASS ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await run('video call: ring → accept → media → mute → hang up', async (a, b) => {
  await a.page.click('[data-testid="call-video"]');
  await b.page.waitForSelector('[data-testid="call-accept"]', { timeout: RING_TIMEOUT });
  await b.page.click('[data-testid="call-accept"]');
  await b.page.waitForFunction(() => {
    const v = document.querySelector('.call-remote');
    return v && v.videoWidth > 0;
  }, null, { timeout: 30_000 });
  await b.page.click('[data-testid="call-mute"]');
  assert.equal((await b.page.textContent('[data-testid="call-mute"]')).trim(), 'Unmute');
  await a.page.click('[data-testid="call-hangup"]');
  await a.page.waitForSelector('.call-overlay', { state: 'detached', timeout: 10_000 });
  await b.page.waitForSelector('.call-overlay', { state: 'detached', timeout: 10_000 });
});

await run('decline', async (a, b) => {
  await a.page.click('[data-testid="call-voice"]');
  await b.page.click('[data-testid="call-decline"]', { timeout: RING_TIMEOUT });
  await status(a).filter({ hasText: 'Declined' }).waitFor({ timeout: 10_000 });
});

await run('busy', async (a, b) => {
  const c = await newUser(a.ctx.browser());
  await openDm(c, b);
  await openDm(b, c);
  await a.page.click('[data-testid="call-voice"]');
  await b.page.waitForSelector('[data-testid="call-accept"]', { timeout: RING_TIMEOUT });
  await c.page.click('[data-testid="call-voice"]');
  await status(c).filter({ hasText: 'Busy' }).waitFor({ timeout: 15_000 });
});
