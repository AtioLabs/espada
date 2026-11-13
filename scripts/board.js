const puppeteer = require('puppeteer-core'); const path = require('path');
(async () => { const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
  for (const s of ['light', 'dark']) { const p = await b.newPage(); await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: s }]); await p.setViewport({ width: 1320, height: 900, deviceScaleFactor: 1.5 }); await p.goto('file://' + path.resolve(__dirname, 'design-board.html')); await p.screenshot({ path: path.resolve(__dirname, '../shots/design-system-' + s + '.png'), fullPage: true }); }
  await b.close(); })();
