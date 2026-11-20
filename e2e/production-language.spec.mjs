import { test, expect } from '@playwright/test';
import { makePoll, mockRelay } from './support/relay.mjs';

test('the emitted production chunks boot, switch languages and open a poll',async({context,page},testInfo)=>{
  await mockRelay(context,makePoll(),undefined,'http://127.0.0.1:5198');
  await context.addInitScript(()=>{
    localStorage.setItem('echo_onboarding_complete','true');
    localStorage.setItem('echo_bit_tour_v1','done');
    localStorage.setItem('echo_bit_navswap_v1','1');
    localStorage.setItem('echo_moderation_onboarding_complete','skipped');
  });
  const errors=[];page.on('pageerror',error=>{ errors.push(error.message); console.error('[built-app exception]',error.message); });
  await page.goto('/settings');
  const language=page.getByRole('combobox',{name:'Мова',exact:true});
  await expect(language).toBeVisible({timeout:12000});
  await expect(page.getByRole('heading',{name:'Обліковий запис',exact:true})).toBeVisible();
  await page.screenshot({animations:'disabled',path:testInfo.outputPath('built-settings-uk.png')});
  await language.selectOption('en');
  await expect(page.getByRole('heading',{name:'Account',exact:true})).toBeVisible();
  await page.getByRole('combobox',{name:'Language',exact:true}).selectOption('uk');
  await page.goto('/poll/'+makePoll().id);
  await expect(page.getByRole('heading',{name:'Which day should we meet?',exact:true})).toBeVisible();
  await page.getByText('Friday evening',{exact:true}).click();
  await expect(page.getByRole('button',{name:'Проголосувати',exact:true})).toBeEnabled();
  await page.screenshot({animations:'disabled',path:testInfo.outputPath('built-poll-uk.png')});
  const manifestUrl=await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest=await(await page.request.get(manifestUrl)).json();
  expect(manifest.theme_color).toBe('#e7e9ec');expect(manifest.background_color).toBe('#e7e9ec');
  expect(errors).toEqual([]);
});
