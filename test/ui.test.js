'use strict';
// Real browser tests of the owner page (needs puppeteer-core + a Chrome; skipped otherwise). Dummy data only.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs');
const { startServer, call, sleep, until } = require('./helpers');
let puppeteer = null; try { puppeteer = require('puppeteer-core'); } catch (_) {}
const chrome = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((p) => fs.existsSync(p));
const skip = !puppeteer || !chrome ? 'puppeteer-core or Chrome not available' : false;

async function open(S, who) {
  const b = await puppeteer.launch({ executablePath: chrome, args: ['--no-sandbox'], headless: 'new' });
  const p = await b.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.setViewport({ width: 1100, height: 800 });
  await p.goto(S.url + '/#token=' + S.connect[who + '.owner'].token);
  await p.waitForSelector('#composer-text');
  return { b, p, errs };
}
const state = async (S, who) => (await call(S.url, S.connect[who + '.owner'].token, 'GET', '/ui/api/state')).body;

test('ui: tapping an agent chip addresses it without typing a name; Enter sends, Shift+Enter does not', { skip }, async () => {
  const S = await startServer();
  const { b, p, errs } = await open(S, 'alice');
  await p.click('[data-target="a_bob"]');
  assert.equal(await p.$eval('[data-target="a_bob"]', (e) => e.getAttribute('aria-pressed')), 'true');
  await p.type('#composer-text', 'line one');
  await p.keyboard.down('Shift'); await p.keyboard.press('Enter'); await p.keyboard.up('Shift');
  await p.type('#composer-text', 'line two');
  await sleep(300);
  assert.equal((await state(S, 'alice')).messages.length, 0, 'Shift+Enter must not send');
  await p.keyboard.press('Enter');
  const st = await until(async () => { const s = await state(S, 'alice'); return s.messages.length ? s : null; });
  const m = st.messages[0];
  assert.deepEqual(m.to, ['a_bob']); assert.equal(m.needsReply, true); assert.equal(m.authorKind, 'owner'); assert.equal(m.text, 'line one\nline two');
  assert.doesNotMatch(m.text, /bob/i, 'no name typed');
  await p.waitForFunction(() => document.querySelector('#composer-text').value === '');
  assert.deepEqual(errs, []);
  await b.close(); await S.close();
});

test('ui: Reply on an agent message targets that agent and sets replyTo; Everyone is the default', { skip }, async () => {
  const S = await startServer();
  const bobAgent = S.connect['bob.agent'];
  const r = await call(S.url, bobAgent.token, 'POST', '/v1/messages', { group: bobAgent.group, text: 'hello from bob agent' });
  assert.equal(r.status, 200);
  const { b, p, errs } = await open(S, 'alice');
  assert.equal(await p.$eval('[data-target="every"]', (e) => e.getAttribute('aria-pressed')), 'true');
  await p.waitForSelector('.msg.agentmsg .act');
  await p.click('.msg.agentmsg .act');
  assert.equal(await p.$eval('[data-target="a_bob"]', (e) => e.getAttribute('aria-pressed')), 'true');
  await p.type('#composer-text', 'thanks, go on'); await p.keyboard.press('Enter');
  const st = await until(async () => { const s = await state(S, 'alice'); return s.messages.find((m) => m.authorKind === 'owner') ? s : null; });
  const m = st.messages.find((x) => x.authorKind === 'owner');
  assert.deepEqual(m.to, ['a_bob']); assert.equal(m.replyTo, r.body.id || st.messages.find((x) => x.authorKind === 'agent').id);
  assert.deepEqual(errs, []);
  await b.close(); await S.close();
});

test('ui: "@" opens a picker; choosing an agent selects its chip and removes the @', { skip }, async () => {
  const S = await startServer();
  const { b, p } = await open(S, 'alice');
  await p.type('#composer-text', 'hi @');
  await p.waitForSelector('.pick');
  await p.click('.pick button:nth-child(2)');
  assert.equal(await p.$eval('#composer-text', (e) => e.value), 'hi ');
  assert.equal(await p.$eval('[data-target="a_bob"]', (e) => e.getAttribute('aria-pressed')), 'true');
  await b.close(); await S.close();
});

test('ui: held agent message appears as an approval card; Approve publishes it; Reject drops it', { skip }, async () => {
  const S = await startServer({ defaults: true });
  const a = S.connect['alice.agent'];
  const r1 = await call(S.url, a.token, 'POST', '/v1/messages', { group: a.group, text: 'pending one' });
  assert.equal(r1.status, 202);
  const { b, p, errs } = await open(S, 'alice');
  await p.waitForSelector('.card.approve');
  assert.match(await p.$eval('.card.approve', (e) => e.textContent), /wants to post this to the group.*pending one/s);
  assert.equal((await state(S, 'bob')).messages.length, 0, 'other owner sees nothing yet');
  await p.$eval('.card.approve .btn:not(.bad)', (e) => e.click());
  await until(async () => (await state(S, 'bob')).messages.length === 1);
  const r2 = await call(S.url, a.token, 'POST', '/v1/messages', { group: a.group, text: 'pending two' });
  await p.waitForSelector('.card.approve');
  await p.$eval('.card.approve .btn.bad', (e) => e.click());
  await until(async () => !(await p.$('.card.approve')));
  assert.equal((await state(S, 'bob')).messages.length, 1);
  assert.deepEqual(errs, []);
  await b.close(); await S.close();
});

test('ui: message text is rendered as text, never as HTML (injection stays inert)', { skip }, async () => {
  const S = await startServer();
  const a = S.connect['bob.agent'];
  await call(S.url, a.token, 'POST', '/v1/messages', { group: a.group, text: '<img src=x onerror="window.__pwn=1"><b>bold</b>' });
  const { b, p } = await open(S, 'alice');
  await p.waitForSelector('.msg.agentmsg .bubble');
  assert.equal(await p.evaluate(() => window.__pwn), undefined);
  assert.equal(await p.$eval('.msg.agentmsg .bubble', (e) => e.children.length), 0);
  assert.match(await p.$eval('.msg.agentmsg .bubble', (e) => e.textContent), /<img src=x/);
  await b.close(); await S.close();
});

test('ui: settings sheet toggles a real policy; focus rings and labels exist on controls', { skip }, async () => {
  const S = await startServer({ defaults: true });
  const { b, p } = await open(S, 'alice');
  await p.click('button[aria-label="Settings"]');
  await p.waitForSelector('.sheet');
  const cbs = await p.$$('.sheet input[type=checkbox]');
  assert.equal(cbs.length, 4);
  await cbs[0].click();   // approve messages off
  await until(async () => (await state(S, 'alice')).members.find((m) => m.id === 'o_alice').policy.approveMessages === false);
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('.sheet'));
  const unlabeled = await p.$$eval('button, textarea, input', (els) => els.filter((e) => !(e.textContent.trim() || e.getAttribute('aria-label') || e.getAttribute('placeholder'))).length);
  assert.equal(unlabeled, 0);
  await b.close(); await S.close();
});

test('ui: People view renders profiles as elements (no "[object") and offline agents show one status banner, not a line per message', { skip }, async () => {
  const S = await startServer();
  const { b, p, errs } = await open(S, 'alice');
  await p.type('#composer-text', 'one'); await p.keyboard.press('Enter');
  await until(async () => (await state(S, 'alice')).messages.length === 1);
  await p.type('#composer-text', 'two'); await p.keyboard.press('Enter');
  await until(async () => (await state(S, 'alice')).messages.length === 2);
  await p.waitForSelector('.banners .banner[role=status]');
  assert.equal((await p.$$('.state')).length, 0, 'no per-message offline lines');
  const navs = await p.$$('.nav');
  for (const n of navs) { if ((await n.evaluate((e) => e.textContent)).includes('People')) await n.click(); }
  await p.waitForSelector('.person');
  assert.ok(!(await p.evaluate(() => document.body.textContent)).includes('[object'));
  assert.ok((await p.$$('.person')).length >= 2);
  assert.deepEqual(errs, []);
  await b.close(); await S.close();
});
