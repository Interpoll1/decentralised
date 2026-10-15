// Usage: node render.cjs full <outdir> [workers]   |   node render.cjs preview <outdir> t1 t2 ...
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const [mode, out, ...rest] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const url = 'file://' + path.resolve(__dirname, 'index.html');
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files', '--force-color-profile=srgb'] });
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => console.error('PAGEERROR', e.message));
    page.on('console', m => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });
    await page.goto(url);
    await page.waitForFunction(() => window.READY === true, null, { timeout: 30000 });
    return page;
  };
  if (mode === 'preview') {
    const page = await open();
    for (const t of rest.map(Number)) {
      await page.evaluate(t => window.render(t), t);
      await page.screenshot({ path: path.join(out, `t${t.toFixed(2)}.png`) });
      console.log('preview', t);
    }
  } else {
    const fps = 30, dur = 30, total = fps * dur;
    const workers = Number(rest[0] || 4);
    const pages = await Promise.all(Array.from({ length: workers }, open));
    let done = 0;
    const t0 = Date.now();
    await Promise.all(pages.map(async (page, w) => {
      for (let f = w; f < total; f += workers) {
        await page.evaluate(t => window.render(t), f / fps);
        await page.screenshot({ path: path.join(out, `f${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 94 });
        if (++done % 90 === 0) console.log(`${done}/${total} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
    }));
  }
  await browser.close();
})();
