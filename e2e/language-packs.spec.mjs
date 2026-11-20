import { test, expect } from '@playwright/test';
import { makePoll, mockRelay } from './support/relay.mjs';

async function prepare(context, preference) {
  await mockRelay(context);
  await context.addInitScript(preference => {
    if (preference) localStorage.setItem('echo_language_v1', preference);
    localStorage.setItem('echo_onboarding_complete', 'true');
    localStorage.setItem('echo_bit_tour_v1', 'done');
    localStorage.setItem('echo_bit_navswap_v1', '1');
    localStorage.setItem('echo_moderation_onboarding_complete', 'skipped');
    localStorage.setItem('language-preservation-marker', 'keep-local-data');
  }, preference);
}

for (const viewport of [{ width:375, height:812 }, { width:844, height:390 }, { width:1440, height:1000 }]) {
  test(`Ukrainian settings and live language selection fit at ${viewport.width}px`, async ({ context, page }, testInfo) => {
    await prepare(context);
    await page.setViewportSize(viewport);
    const errors=[];page.on('pageerror', error=>errors.push(error.message));
    await page.goto('/settings');
    const languages = page.getByRole('combobox', { name:'Language', exact:true });
    await expect(languages).toHaveValue('system');
    await languages.selectOption('uk');
    await expect(page.locator('html')).toHaveAttribute('lang','uk');
    await expect(page.getByRole('heading', {name:'Обліковий запис',exact:true})).toBeVisible();
    await expect(page.getByRole('combobox', {name:'Мова',exact:true})).toHaveValue('uk');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({animations:'disabled',path:testInfo.outputPath('settings-uk.png')});
    await page.reload();
    const restored=page.getByRole('combobox',{name:'Мова',exact:true});
    await expect(restored).toHaveValue('uk');
    expect(await page.evaluate(()=>localStorage.getItem('language-preservation-marker'))).toBe('keep-local-data');
    expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe('rgb(231, 233, 236)');
    await restored.selectOption('en');
    await expect(page.getByRole('heading',{name:'Account',exact:true})).toBeVisible();
    await page.reload(); await expect(page.getByRole('combobox',{name:'Language',exact:true})).toHaveValue('en');
    expect(errors).toEqual([]);
  });
}

test.describe('Ukrainian device language',()=>{
  test.use({locale:'uk-UA'});
  test('a fresh visitor can choose English during onboarding',async({context,page},testInfo)=>{
    await mockRelay(context);await page.goto('/onboarding');
    await expect(page.getByRole('heading',{name:'Налаштуймо застосунок',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Почнімо',exact:true})).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang','uk');
    await expect(page.getByPlaceholder('слово1 слово2 слово3 …')).toHaveCount(0);
    await page.screenshot({animations:'disabled',path:testInfo.outputPath('onboarding-uk.png')});
    await page.getByRole('combobox',{name:'Мова',exact:true}).selectOption('en');
    await expect(page.getByRole('heading',{name:"Let's set you up",exact:true})).toBeVisible();
  });
});

test('Ukrainian poll controls keep the original question and answers and save a real vote',async({context,page},testInfo)=>{
  await prepare(context,'uk');await page.goto('/poll/'+makePoll().id);
  await expect(page.getByRole('heading',{name:'Which day should we meet?',exact:true})).toBeVisible();
  await page.getByText('Friday evening',{exact:true}).click();
  await expect(page.getByRole('button',{name:'Проголосувати',exact:true})).toBeEnabled();
  await page.screenshot({animations:'disabled',path:testInfo.outputPath('poll-uk.png')});
  await page.getByRole('button',{name:'Проголосувати',exact:true}).click();
  await expect(page).toHaveURL(/\/receipt\//, {timeout:20000});
  await expect(page.getByText('Квитанція голосу',{exact:true})).toBeVisible();
});

test('Ukrainian create-poll fields and Home navigation are translated while content stays original',async({context,page},testInfo)=>{
  await prepare(context,'uk');await page.goto('/create-poll');
  await expect(page.getByRole('heading',{name:'Запитай свою спільноту',exact:true})).toBeVisible();
  await expect(page.getByPlaceholder('Про що хочеш запитати?')).toBeVisible();
  await page.screenshot({animations:'disabled',path:testInfo.outputPath('create-poll-uk.png')});
  await page.goto('/home');
  await expect(page.getByRole('button',{name:'Повідомлення',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Стрічка',exact:true})).toBeVisible();
  await page.evaluate(()=>{
    const pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const now=Date.now();
    pinia._s.get('post').injectPost({id:'post-'+now+'-language',communityId:'c-ui',authorId:'ui-author',authorName:'Settings',authorShowRealName:true,title:'Settings',content:'Original post text',createdAt:now,updatedAt:now,upvotes:1,downvotes:0,commentCount:0,category:'technology',dataVersion:'v5'});
  });
  await expect(page.locator('.post-title').filter({hasText:/^Settings$/})).toBeVisible();
  await expect(page.getByText('Original post text',{exact:true})).toBeVisible();
  await page.screenshot({animations:'disabled',path:testInfo.outputPath('home-uk.png')});
});
