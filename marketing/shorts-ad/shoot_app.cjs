const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2.62, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  await ctx.addInitScript(() => { localStorage.setItem('interpoll_onboarding_complete','true'); localStorage.setItem('interpoll_bit_tour_v1','done'); localStorage.setItem('interpoll_bit_navswap_v1','done'); localStorage.setItem('interpoll_moderation_onboarding_complete','true'); });
  const p = await ctx.newPage();
  const routes = process.argv.slice(2);
  for (const r of routes) {
    try {
      await p.goto('http://127.0.0.1:5173' + r, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p.waitForTimeout(9000);
      const name = r.replace(/\//g, '_') || '_root';
      await p.screenshot({ path: `${process.env.OUT}/app${name}.png` });
      console.log('shot', r);
    } catch (e) { console.log('fail', r, e.message.split('\n')[0]); }
  }
  await b.close();
})();
