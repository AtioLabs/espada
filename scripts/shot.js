const puppeteer = require('puppeteer-core');
// usage: node shot.js LINK OUT W H [view] [dark] [action]
const [,, link, out, w, h, view, scheme, action] = process.argv;
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme === 'dark' ? 'dark' : 'light' }]);
  await p.setViewport({ width: +(w || 1200), height: +(h || 820), deviceScaleFactor: 2 });
  await p.goto(link); await new Promise((r) => setTimeout(r, 1500));
  if (view && view !== '-') { await p.evaluate((t) => { [...document.querySelectorAll('.nav')].find((x) => x.textContent.startsWith(t)).click(); }, view); await new Promise((r) => setTimeout(r, 500)); }
  if (action === 'pick') { await p.evaluate(() => { document.querySelector('[data-target]:nth-child(3)').click(); }); await new Promise((r) => setTimeout(r, 300)); }
  await p.screenshot({ path: out });
  console.log('page errors:', JSON.stringify(errs));
  await b.close();
})();
