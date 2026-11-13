'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { startServer, call } = require('./helpers.js');

const redeem = (url, code) => fetch(url + '/v1/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const mk = (extra = {}) => { const clock = { v: Date.now() }; return startServer({ appOpts: { publicUrl: 'https://espada.example', now: () => clock.v, ...extra }, }).then((S) => ({ S, clock })); };

test('invite: only the group admin can create one; unknown member rejected; needs a public url', async () => {
  const { S } = await mk();
  const alice = S.connect['alice.owner'], bob = S.connect['bob.owner'];
  assert.equal((await call(S.url, bob.token, 'POST', '/ui/api/invite', { for: 'alice' })).status, 403);
  assert.equal((await call(S.url, alice.token, 'POST', '/ui/api/invite', { for: 'nobody' })).status, 404);
  const ok = await call(S.url, alice.token, 'POST', '/ui/api/invite', { for: 'bob' });
  assert.equal(ok.status, 200); assert.match(ok.body.code, /^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/); assert.equal(ok.body.invite, ok.body.code + '@https://espada.example');
  await S.close();
  const bare = await startServer(); // no public url configured
  assert.equal((await call(bare.url, bare.connect['alice.owner'].token, 'POST', '/ui/api/invite', { for: 'bob' })).status, 409);
  await bare.close();
});

test('invite: single use, rotates tokens (old ones die, new ones work), code never stored', async () => {
  const { S } = await mk();
  const alice = S.connect['alice.owner'], oldBobAgent = S.connect['bob.agent'].token, oldBobOwner = S.connect['bob.owner'].token;
  const inv = (await call(S.url, alice.token, 'POST', '/ui/api/invite', { for: 'bob' })).body;
  const r = await redeem(S.url, inv.code.toLowerCase()); // case/format tolerant
  assert.equal(r.status, 200); assert.equal(r.body.agent.ownerName, 'bob'); assert.equal(r.body.agent.server, 'https://espada.example');
  assert.notEqual(r.body.agent.token, oldBobAgent);
  assert.equal((await call(S.url, oldBobAgent, 'GET', '/v1/me')).status, 401, 'old agent token revoked');
  assert.equal((await call(S.url, oldBobOwner, 'GET', '/ui/api/state')).status, 401, 'old owner token revoked');
  assert.equal((await call(S.url, r.body.agent.token, 'GET', '/v1/me')).status, 200, 'new agent token works');
  assert.equal((await call(S.url, r.body.owner.token, 'GET', '/ui/api/state')).status, 200, 'new owner token works');
  assert.equal((await redeem(S.url, inv.code)).status, 404, 'second use fails');
  const cfgText = fs.readFileSync(path.join(S.dir, 'config.json'), 'utf8');
  assert.ok(!cfgText.includes(inv.code) && !cfgText.includes(inv.code.replace(/-/g, '')), 'code not stored in clear');
  assert.ok(!cfgText.includes(r.body.agent.token), 'token not stored in clear');
  await S.close();
});

test('invite: expires, and a new invite replaces the previous one for that person', async () => {
  const { S, clock } = await mk();
  const alice = S.connect['alice.owner'];
  const a = (await call(S.url, alice.token, 'POST', '/ui/api/invite', { for: 'bob', minutes: 10 })).body;
  clock.v += 11 * 60000;
  assert.equal((await redeem(S.url, a.code)).status, 404, 'expired');
  const b = (await call(S.url, alice.token, 'POST', '/ui/api/invite', { for: 'bob' })).body;
  const c = (await call(S.url, alice.token, 'POST', '/ui/api/invite', { for: 'bob' })).body;
  assert.equal((await redeem(S.url, b.code)).status, 404, 'superseded');
  assert.equal((await redeem(S.url, c.code)).status, 200);
  await S.close();
});

test('invite: brute force is blocked after 5 wrong tries, even for the right code', async () => {
  const { S } = await mk();
  const inv = (await call(S.url, S.connect['alice.owner'].token, 'POST', '/ui/api/invite', { for: 'bob' })).body;
  for (let i = 0; i < 5; i++) assert.equal((await redeem(S.url, 'AAAA-BBBB-CCCC-DDDD')).status, 404);
  assert.equal((await redeem(S.url, 'AAAA-BBBB-CCCC-DDDD')).status, 429);
  assert.equal((await redeem(S.url, inv.code)).status, 429, 'locked out until the window passes');
  await S.close();
});

test('invite: audit log records create/redeem/fail with no secrets', async () => {
  const { S } = await mk();
  const inv = (await call(S.url, S.connect['alice.owner'].token, 'POST', '/ui/api/invite', { for: 'bob' })).body;
  await redeem(S.url, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ');
  const r = await redeem(S.url, inv.code);
  const log = fs.readFileSync(path.join(S.dir, 'audit.jsonl'), 'utf8');
  const evs = log.trim().split('\n').map((l) => JSON.parse(l).ev);
  assert.deepEqual(evs, ['invite_created', 'redeem_failed', 'invite_redeemed']);
  assert.ok(!log.includes(inv.code) && !log.includes(r.body.agent.token) && !log.includes(r.body.owner.token));
  await S.close();
});

test('redeem: junk bodies and oversize are rejected without crashing', async () => {
  const { S } = await mk();
  for (const body of ['null', '[]', '"x"', 'not json', JSON.stringify({ code: 'x'.repeat(5000) })]) {
    // oversize bodies are cut off by the server (connection closed), which is a rejection too
    const r = await fetch(S.url + '/v1/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body }).catch(() => ({ status: 'closed' }));
    assert.ok([400, 404, 413, 429, 'closed'].includes(r.status), body.slice(0, 20) + ' -> ' + r.status);
  }
  assert.equal((await fetch(S.url + '/health')).status, 200, 'server still healthy');
  await S.close();
});
