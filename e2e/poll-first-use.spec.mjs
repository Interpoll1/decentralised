import { makePoll, mockRelay, navigate } from './support/relay.mjs';
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const pollPath = '/poll/poll-first-use-local';

async function verifySettingsPersistence(context, page, testInfo) {
  await mockRelay(context);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Feed', exact: true }).click();
  const posts = page.locator('.toggle-row').filter({ hasText: 'Show posts' });
  const polls = page.locator('.toggle-row').filter({ hasText: 'Show polls' });
  await expect(posts.locator('input')).toBeChecked();
  await posts.locator('label').click();
  await expect(posts.locator('input')).not.toBeChecked();
  await posts.locator('label').click();
  await expect(posts.locator('input')).toBeChecked();
  await polls.locator('label').click();
  await expect(polls.locator('input')).not.toBeChecked();
  await page.getByRole('button', { name: 'Latest', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('echo_feed_preferences')))).toMatchObject({
    showPosts: true, showPolls: false, mode: 'latest',
  });
  await page.screenshot({ path: testInfo.outputPath('settings-feed.png'), fullPage: true });
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  const mine = page.locator('.toggle-row').filter({ hasText: 'Always store my posts' });
  await expect(mine.locator('input')).toBeChecked();
  await mine.locator('label').click();
  await page.locator('.field-group').filter({ hasText: 'Keep recent posts' }).locator('select').selectOption('100');
  await expect.poll(async () => page.evaluate(async () => {
    const { PinningService } = await import('/src/services/pinningService.ts');
    return PinningService.getPolicy();
  })).toMatchObject({ myPosts: false, recentPosts: 100 });
  await page.reload();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await expect(mine.locator('input')).not.toBeChecked();
  await expect(page.locator('.field-group').filter({ hasText: 'Keep recent posts' }).locator('select')).toHaveValue('100');
  await page.screenshot({ path: testInfo.outputPath('settings-storage.png'), fullPage: true });
  expect(errors).toEqual([]);
}

test('mobile settings controls persist actual feed and storage preferences', async ({ context, page }, testInfo) => {
  await verifySettingsPersistence(context, page, testInfo);
});

test.describe('local relay integration', () => {
  let relay;
  let directory;
  const origin = 'http://127.0.0.1:5198';
  test.beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'echo-browser-relay-'));
    relay = spawn(process.execPath, [fileURLToPath(new URL('../community-relay/kit/relay.js', import.meta.url))], {
      windowsHide: true, stdio: 'ignore',
      env: { ...process.env, HOST: '127.0.0.1', PORT: '5198', UPSTREAM_PEERS: '', GUN_DATA_DIR: directory },
    });
    await expect.poll(async () => {
      try { return (await fetch(origin + '/health')).ok; } catch { return false; }
    }, { timeout: 15000 }).toBe(true);
  });
  test.afterAll(async () => {
    if (relay && relay.exitCode === null) {
      await new Promise(resolve => { relay.once('exit', resolve); relay.kill(); });
    }
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  test('bundled Gun replicates a poll between two fresh browser profiles', async ({ browser }) => {
    const profiles = [await browser.newContext(), await browser.newContext()];
    try {
      const pages = [];
      const id = `poll-${Date.now()}-relay-smoke`;
      for (const profile of profiles) {
        await profile.addInitScript(base => {
          localStorage.setItem('echo_relay_config', JSON.stringify({
            websocket: base.replace('http:', 'ws:'), gun: base + '/gun', api: base,
          }));
          localStorage.setItem('echo_peer_prefs', JSON.stringify({ usePrivate: false, usePublic: false }));
        }, origin);
        await mockRelay(profile, makePoll(), origin);
        const page = await profile.newPage(); pages.push(page);
        await page.goto('/settings');
        await page.evaluate(async base => {
          const { GunService } = await import('/src/services/gunService.ts');
          GunService.reconnect([base + '/gun']);
        }, origin);
      }
      await pages[1].evaluate(async id => {
        const { GunService } = await import('/src/services/gunService.ts');
        GunService.getGun().get('polls').get(id).on((data, _key, _message, event) => {
          if (data?.question === 'Local relay transport fixture') {
            window.__replicatedPoll = { id: data.id, question: data.question }; event?.off();
          }
        });
      }, id);
      await pages[0].evaluate(async id => {
        const { GunService } = await import('/src/services/gunService.ts');
        GunService.getGun().get('polls').get(id).put({ id, question: 'Local relay transport fixture', dataVersion: 'v5' });
      }, id);
      await expect.poll(() => pages[1].evaluate(() => window.__replicatedPoll), { timeout: 15000 })
        .toEqual({ id, question: 'Local relay transport fixture' });
    } finally { await Promise.all(profiles.map(profile => profile.close())); }
  });
});

test.describe('desktop settings', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
  test('settings controls persist actual feed and storage preferences', async ({ context, page }, testInfo) => {
    await verifySettingsPersistence(context, page, testInfo);
  });
});

test('a fresh visitor can choose an answer through its label after tour timers expire', async ({ context, page }) => {
  await mockRelay(context);
  await page.goto(pollPath);
  await expect(page.getByRole('heading', { name: 'Which day should we meet?' })).toBeVisible();
  // Cover both automatic-tour delays (1.5s welcome and 3s navigation update).
  await page.waitForTimeout(3300);
  await expect(page.getByRole('dialog', { name: 'Echo tour' })).toHaveCount(0);
  const submit = page.getByRole('button', { name: 'Submit Vote', exact: true });
  await expect(submit).toBeDisabled();
  await page.getByText('Friday evening', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Friday evening' })).toBeChecked();
  await expect(submit).toBeEnabled();
  await page.getByText('Saturday morning', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Saturday morning' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Friday evening' })).not.toBeChecked();
});

test('multiple-choice labels select and clear independent answers', async ({ context, page }) => {
  await mockRelay(context, makePoll({ allowMultipleChoices: true }));
  await page.goto('/community/community-first-use-local' + pollPath);
  const submit = page.getByRole('button', { name: 'Submit Vote', exact: true });
  await expect(submit).toBeDisabled();
  await page.getByText('Friday evening', { exact: true }).click();
  await expect(submit).toBeEnabled();
  await page.getByText('Saturday morning', { exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Friday evening' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Saturday morning' })).toBeChecked();
  await page.getByText('Friday evening', { exact: true }).click();
  await expect(submit).toBeEnabled();
  await page.getByText('Saturday morning', { exact: true }).click();
  await expect(submit).toBeDisabled();
});

test('an active Home tour pauses on a poll and resumes on Home', async ({ context, page }) => {
  await mockRelay(context);
  await context.addInitScript(() => localStorage.setItem('echo_onboarding_complete', 'true'));
  await page.goto('/home');
  const tour = page.getByRole('dialog', { name: 'Echo tour' });
  await expect(tour).toBeVisible({ timeout: 15000 });
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  const position = await tour.locator('.bc-count').innerText();
  await navigate(page, pollPath);
  await expect(tour).toHaveCount(0);
  await page.waitForTimeout(3300);
  await expect(tour).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('echo_bit_tour_v1'))).toBeNull();
  await navigate(page, '/home');
  await expect(tour).toBeVisible();
  await expect(tour.locator('.bc-count')).toHaveText(position);
});

test('leaving Home during the welcome delay does not start the tour over a poll', async ({ context, page }) => {
  await mockRelay(context);
  await context.addInitScript(() => localStorage.setItem('echo_onboarding_complete', 'true'));
  await page.goto('/home');
  await navigate(page, pollPath);
  await expect(page.getByRole('heading', { name: 'Which day should we meet?' })).toBeVisible();
  await page.waitForTimeout(3300);
  await expect(page.getByRole('dialog', { name: 'Echo tour' })).toHaveCount(0);
});

test('selecting an answer records a local vote and opens its receipt', async ({ context, page }) => {
  await mockRelay(context);
  await page.goto(pollPath);
  await page.getByText('Friday evening', { exact: true }).click();
  await page.getByRole('button', { name: 'Submit Vote', exact: true }).click();
  await expect(page).toHaveURL(/\/receipt/, { timeout: 20000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('voted-polls') || '[]')))
    .toContain('poll-first-use-local');
  await expect(page.locator('ion-router-outlet > .ion-page:not(.ion-page-hidden)')).toHaveCount(1);
  await page.goBack();
  await expect(page.getByText("You've already voted in this poll!", { exact: true })).toBeVisible();
  await expect(page.getByText('Results are hidden until you vote', { exact: true })).toHaveCount(0);
});

test('multiple-choice submission records both option IDs in the local vote', async ({ context, page }) => {
  await mockRelay(context, makePoll({ allowMultipleChoices: true }));
  await page.goto(pollPath);
  await page.getByText('Friday evening', { exact: true }).click();
  await page.getByText('Saturday morning', { exact: true }).click();
  await page.getByRole('button', { name: 'Submit Vote', exact: true }).click();
  await expect(page).toHaveURL(/\/receipt/, { timeout: 20000 });
  const choices = await page.evaluate(async () => {
    const { StorageService } = await import('/src/services/storageService.ts');
    const votes = await StorageService.getVotesByPoll('poll-first-use-local');
    return votes.at(-1)?.optionIds;
  });
  expect(choices).toEqual(['friday', 'saturday']);
});

test.describe('desktop keyboard input', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

  test('a long answer wraps and can be selected with the keyboard', async ({ context, page }) => {
    const poll = makePoll();
    poll.options[0].text = 'Friday evening after work, with enough time for everyone to arrive and join the conversation';
    await mockRelay(context, poll);
    await page.goto(pollPath);
    const radio = page.getByRole('radio', { name: poll.options[0].text });
    await radio.focus();
    await page.keyboard.press('Space');
    await expect(radio).toBeChecked();
    await expect(page.getByRole('button', { name: 'Submit Vote', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
