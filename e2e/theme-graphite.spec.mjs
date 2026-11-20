import { test, expect } from '@playwright/test';
import { makePoll, mockRelay, navigate } from './support/relay.mjs';

async function prepare(context, preference) {
  await mockRelay(context);
  await context.addInitScript(preference => {
    localStorage.setItem('theme', 'dark'); // reproduce the previously shipped automatic preference
    if (preference) localStorage.setItem('echo_theme_preference_v1', preference);
    localStorage.setItem('graphite-preservation-marker', 'keep-existing-data');
    localStorage.setItem('echo_onboarding_complete', 'true');
    localStorage.setItem('echo_bit_tour_v1', 'done');
    localStorage.setItem('echo_bit_navswap_v1', '1');
    localStorage.setItem('echo_moderation_onboarding_complete', 'skipped');
  }, preference);
}

async function seedFeed(page) {
  await page.evaluate(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const communities = pinia._s.get('community'), posts = pinia._s.get('post');
    if (!communities || !posts) throw new Error('Home stores not ready');
    const now = Date.now();
    communities.communities = [{ id: 'c-graphite-qa', name: 'photography', displayName: 'Photography',
      description: 'Local UI fixture', creatorId: 'qa', createdAt: now, memberCount: 3, rules: [], dataVersion: 'v5' }];
    posts.injectPost({ id: `post-${now}-graphite`, communityId: 'c-graphite-qa', authorId: 'qa-author',
      authorName: 'Alex Rivers', authorShowRealName: true, title: 'Small projects, big ideas.',
      content: 'A place to share what you are making and hear what others think.',
      createdAt: now, updatedAt: now, upvotes: 3, downvotes: 0, commentCount: 2,
      category: 'technology', dataVersion: 'v5' });
  });
  await expect(page.getByText('Small projects, big ideas.', { exact: true })).toBeVisible();
}

async function expectReadable(locator) {
  const contrast = await locator.evaluate(element => {
    const channels = color => color.match(/[\d.]+/g).map(Number);
    const luminance = rgb => rgb.slice(0, 3).map(v => {
      v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    let background = [231, 233, 236];
    const ancestors = []; for (let n = element; n; n = n.parentElement) ancestors.unshift(n);
    for (const n of ancestors) {
      const c = channels(getComputedStyle(n).backgroundColor), alpha = c[3] ?? 1;
      background = background.map((value, i) => c[i] * alpha + value * (1 - alpha));
    }
    const foreground = channels(getComputedStyle(element).color);
    const a = luminance(foreground), b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
}

async function checkPaint(page, dark = false) {
  const paint = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const rgb = value => value.trim();
    return { dark: document.documentElement.classList.contains('dark'),
      canvas: rgb(root.getPropertyValue('--app-bg-base')), ink: rgb(root.getPropertyValue('--app-text')),
      surface: rgb(root.getPropertyValue('--app-surface')), accent: rgb(root.getPropertyValue('--app-accent')),
      body: getComputedStyle(document.body).backgroundColor,
      chrome: document.querySelector('meta[name="theme-color"]').content };
  });
  expect(paint.dark).toBe(dark);
  expect(paint.canvas).toBe(dark ? '#232a31' : '#e7e9ec');
  expect(paint.body).toBe(dark ? 'rgb(35, 42, 49)' : 'rgb(231, 233, 236)');
  expect(paint.accent).toBe(dark ? '#a0cbb9' : '#17664b');
  expect(paint.chrome).toBe(paint.canvas);
  return paint;
}

for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 1000 }, { width: 844, height: 390 }]) {
  test(`graphite Home is light on upgrade and dark OS at ${viewport.width}px`, async ({ context, page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await prepare(context);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/home');
    await expect(page.locator('.hp-root')).toBeVisible();
    await seedFeed(page);
    await checkPaint(page);
    await expectReadable(page.locator('.post-action-btn--heart').first());
    await expectReadable(page.locator('.scope-pill.active:visible, .scope-tab.active:visible').first());
    await expectReadable(page.locator('.post-action-btn').filter({ hasText: '2' }).first());
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => localStorage.getItem('graphite-preservation-marker'))).toBe('keep-existing-data');
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('home-light.png') });
    expect(errors).toEqual([]);
  });
}

test('graphite theme switch works with keyboard and persists both choices across routes and reloads', async ({ context, page }, testInfo) => {
  await prepare(context);
  await page.goto('/settings');
  const control = page.getByRole('switch', { name: 'Dark mode' });
  await expect(control).not.toBeChecked();
  await checkPaint(page);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('settings-light.png') });
  await control.focus(); await page.keyboard.press('Space');
  await expect(control).toBeChecked(); await checkPaint(page, true);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('settings-dark.png') });
  await expectReadable(page.locator('.settings-tab.active'));
  const switchStyle = await control.evaluate(input => { const track = input.nextElementSibling; return { thumb: getComputedStyle(track, '::after').transform, accent: getComputedStyle(track).backgroundColor }; });
  expect(switchStyle.thumb).toBe('matrix(1, 0, 0, 1, 18, 0)');
  expect(switchStyle.accent).toBe('rgb(160, 203, 185)');
  await page.reload(); await expect(control).toBeChecked(); await checkPaint(page, true);
  await navigate(page, '/home'); await checkPaint(page, true);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('home-dark.png') });
  await page.goto('/settings');
  await page.locator('.theme-toggle').click();
  await expect(control).not.toBeChecked();
  await page.reload(); await expect(control).not.toBeChecked(); await checkPaint(page);
});

test('graphite poll controls and secondary routes retain the light palette', async ({ context, page }, testInfo) => {
  await prepare(context);
  await page.goto('/poll/' + makePoll().id);
  await expect(page.getByText('Friday evening', { exact: true })).toBeVisible();
  await checkPaint(page);
  await page.getByText('Friday evening', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Submit Vote', exact: true })).toBeEnabled();
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('poll-light.png') });
  await navigate(page, '/search'); await checkPaint(page);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('search-light.png') });
});

test('graphite onboarding and tour use readable surfaces in both themes', async ({ context, page }, testInfo) => {
  await mockRelay(context);
  await page.goto('/onboarding');
  await expect(page.locator('.bs-step')).toBeVisible();
  await checkPaint(page);
  await expectReadable(page.locator('.bs-note').first());
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('onboarding-light.png') });
  await page.evaluate(() => localStorage.setItem('echo_theme_preference_v1', 'dark'));
  await page.reload(); await checkPaint(page, true);
  await expectReadable(page.locator('.bs-note').first());
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('onboarding-dark.png') });
  await page.evaluate(() => {
    localStorage.setItem('echo_onboarding_complete', 'true');
    localStorage.setItem('echo_moderation_onboarding_complete', 'skipped');
    localStorage.setItem('echo_theme_preference_v1', 'light');
  });
  await page.goto('/home');
  const tour = page.getByRole('dialog', { name: 'Echo tour' });
  await expect(tour).toBeVisible({ timeout: 15000 });
  await expectReadable(tour.locator('.bc-body'));
  await expectReadable(tour.locator('.bc-btn--primary'));
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('tour-light.png') });
});
