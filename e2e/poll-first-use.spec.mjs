import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pollPath = '/poll/poll-first-use-local';

function makePoll(overrides = {}) {
  return {
    id: 'poll-first-use-local',
    communityId: 'community-first-use-local',
    authorId: 'local-author',
    authorName: 'Local tester',
    question: 'Which day should we meet?',
    description: 'Local browser fixture',
    options: [
      { id: 'friday', text: 'Friday evening', votes: 0, voters: [] },
      { id: 'saturday', text: 'Saturday morning', votes: 0, voters: [] },
    ],
    createdAt: Date.now(),
    expiresAt: Date.now() + 86400000,
    allowMultipleChoices: false,
    showResultsBeforeVoting: false,
    requireLogin: false,
    isPrivate: false,
    totalVotes: 0,
    isExpired: false,
    ...overrides,
  };
}

// Exercise the actual app with fresh device storage and local relay responses.
// Every external HTTP request and WebSocket is intercepted before opening a page.
async function mockRelay(context, poll = makePoll()) {
  await context.routeWebSocket('**', () => {});
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5197') return route.continue();
    if (url.hostname === 'cdn.jsdelivr.net' && /\/(gun|sea)\.js$/.test(url.pathname)) {
      const script = url.pathname.endsWith('/sea.js') ? 'sea.js' : 'gun.js';
      return route.fulfill({
        contentType: 'application/javascript',
        body: readFileSync(require.resolve(`gun/${script}`)),
      });
    }
    if (url.pathname === `/api/poll/${poll.id}`) return route.fulfill({ json: poll });
    if (url.pathname === '/api/vote-authorize') {
      return route.fulfill({ json: { allowed: true, reservationToken: 'local-test-reservation' } });
    }
    return route.fulfill({ json: { ok: true, communities: [], posts: [], polls: [] } });
  });
}

async function navigate(page, path) {
  await page.evaluate(async destination => {
    const { default: router } = await import('/src/router/index.ts');
    await router.push(destination);
  }, path);
}

test('a fresh visitor can choose an answer through its label after tour timers expire', async ({ context, page }) => {
  await mockRelay(context);
  await page.goto(pollPath);
  await expect(page.getByRole('heading', { name: 'Which day should we meet?' })).toBeVisible();
  // Cover both automatic-tour delays (1.5s welcome and 3s navigation update).
  await page.waitForTimeout(3300);
  await expect(page.getByRole('dialog', { name: 'Interpoll tour' })).toHaveCount(0);
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
  await context.addInitScript(() => localStorage.setItem('interpoll_onboarding_complete', 'true'));
  await page.goto('/home');
  const tour = page.getByRole('dialog', { name: 'Interpoll tour' });
  await expect(tour).toBeVisible({ timeout: 15000 });
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  const position = await tour.locator('.bc-count').innerText();
  await navigate(page, pollPath);
  await expect(tour).toHaveCount(0);
  await page.waitForTimeout(3300);
  await expect(tour).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('interpoll_bit_tour_v1'))).toBeNull();
  await navigate(page, '/home');
  await expect(tour).toBeVisible();
  await expect(tour.locator('.bc-count')).toHaveText(position);
});

test('leaving Home during the welcome delay does not start the tour over a poll', async ({ context, page }) => {
  await mockRelay(context);
  await context.addInitScript(() => localStorage.setItem('interpoll_onboarding_complete', 'true'));
  await page.goto('/home');
  await navigate(page, pollPath);
  await expect(page.getByRole('heading', { name: 'Which day should we meet?' })).toBeVisible();
  await page.waitForTimeout(3300);
  await expect(page.getByRole('dialog', { name: 'Interpoll tour' })).toHaveCount(0);
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
