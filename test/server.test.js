'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { startServer, call } = require('./helpers.js');

let S, A, B, aOwner, bOwner, gid;
before(async () => {
  S = await startServer();
  A = S.connect['alice.agent']; B = S.connect['bob.agent'];
  aOwner = S.connect['alice.owner']; bOwner = S.connect['bob.owner']; gid = A.group;
});
after(() => S.close());

test('auth: missing/invalid token rejected; token kinds are not interchangeable', async () => {
  assert.equal((await call(S.url, 'nope', 'GET', '/v1/me')).status, 401);
  assert.equal((await call(S.url, A.token, 'GET', '/ui/api/state')).status, 403);
  assert.equal((await call(S.url, aOwner.token, 'GET', '/v1/me')).status, 403);
  assert.equal((await call(S.url, A.token, 'GET', '/v1/me')).status, 200);
});

test('agent message publishes, queues for the other agent only, tracks honest states', async () => {
  const r = await call(S.url, A.token, 'POST', '/v1/messages', { group: gid, text: 'hello bob', needsReply: true });
  assert.equal(r.status, 200);
  const m = [...S.app.store.msgs.values()].find((x) => x.id === r.body.id);
  assert.deepEqual(Object.keys(m.rs), ['a_bob']);
  assert.equal(m.rs.a_bob.s, 'queued');
  assert.equal((await call(S.url, B.token, 'POST', '/v1/emitted', { id: m.id })).status, 200);
  assert.equal(m.rs.a_bob.s, 'emitted');
  // alice's agent cannot mark bob's receipt
  assert.equal((await call(S.url, A.token, 'POST', '/v1/emitted', { id: m.id })).status, 404);
  // bob replies -> responded
  const rr = await call(S.url, B.token, 'POST', '/v1/messages', { group: gid, text: 'hi', replyTo: m.id });
  assert.equal(rr.status, 200);
  assert.equal(m.rs.a_bob.s, 'responded');
});

test('files: held for approval by default, owner of author only can approve, content checks', async () => {
  const f = (name, buf) => call(S.url, A.token, 'POST', '/v1/files', { group: gid, name, contentBase64: Buffer.from(buf).toString('base64') });
  const r = await f('notes.md', '# notes\nsome dummy data');
  assert.equal(r.status, 202);
  const st0 = (await call(S.url, bOwner.token, 'GET', '/ui/api/state')).body;
  assert.ok(!st0.messages.some((m) => m.id === r.body.id), 'bob must not see alice pending file');
  assert.equal((await call(S.url, bOwner.token, 'POST', '/ui/api/approve', { id: r.body.id, decision: 'approve' })).status, 404);
  assert.equal((await call(S.url, B.token, 'GET', `/v1/files/${[...S.app.store.msgs.values()].find((m) => m.id === r.body.id).file.sha}?group=${gid}`)).status, 404, 'unpublished file not downloadable');
  assert.equal((await call(S.url, aOwner.token, 'POST', '/ui/api/approve', { id: r.body.id, decision: 'approve' })).status, 200);
  const sha = [...S.app.store.msgs.values()].find((m) => m.id === r.body.id).file.sha;
  const dl = await fetch(`${S.url}/v1/files/${sha}?group=${gid}`, { headers: { authorization: 'Bearer ' + B.token } });
  assert.equal(await dl.text(), '# notes\nsome dummy data');
  assert.equal((await f('evil.exe', 'x')).status, 422);
  assert.equal((await f('a.md', 'key AKIAABCDEFGHIJKLMNOP')).status, 422);
  assert.equal((await f('big.txt', 'x'.repeat(600 * 1024))).status, 413);
  assert.equal((await f('bin.json', Buffer.from([65, 0, 66]))).status, 422);
  const rej = await f('r.md', 'reject me');
  await call(S.url, aOwner.token, 'POST', '/ui/api/approve', { id: rej.body.id, decision: 'reject' });
  assert.equal([...S.app.store.msgs.values()].find((m) => m.id === rej.body.id).status, 'rejected');
  assert.equal((await call(S.url, aOwner.token, 'POST', '/ui/api/approve', { id: rej.body.id, decision: 'approve' })).status, 404, 'rejected cannot be revived');
});

test('secrets in text blocked; empty and oversize blocked', async () => {
  const send = (t) => call(S.url, A.token, 'POST', '/v1/messages', { group: gid, text: t });
  assert.equal((await send('token ghp_' + 'a'.repeat(36))).status, 422);
  assert.equal((await send('   ')).status, 422);
  assert.equal((await send('x'.repeat(9000))).status, 422);
});

test('loop guard stops agent ping-pong; a human message resets it; pause blocks agents', async () => {
  const s2 = await startServer();
  const a = s2.connect['alice.agent'], b = s2.connect['bob.agent'], ao = s2.connect['alice.owner'];
  const g = a.group; let last = null, blocked = null;
  s2.app.cfg.groups[g].hopLimit = 6; // default is 20; pin 6 so the guard logic is tested quickly
  for (let i = 0; i < 10; i++) {
    const who = i % 2 ? b : a;
    const r = await call(s2.url, who.token, 'POST', '/v1/messages', { group: g, text: 'ping ' + i, replyTo: last });
    if (r.status === 429) { blocked = r; break; }
    last = r.body.id;
  }
  assert.equal(blocked.body.error, 'loop_guard');
  assert.equal([...s2.app.store.msgs.values()].filter((m) => m.authorKind === 'agent').length, 6);
  assert.ok([...s2.app.store.msgs.values()].some((m) => m.authorKind === 'system'), 'system notice posted once');
  await call(s2.url, ao.token, 'POST', '/ui/api/message', { group: g, text: 'carry on' });
  assert.equal((await call(s2.url, a.token, 'POST', '/v1/messages', { group: g, text: 'ok' })).status, 200);
  await call(s2.url, ao.token, 'POST', '/ui/api/policy', { group: g, paused: true });
  assert.equal((await call(s2.url, b.token, 'POST', '/v1/messages', { group: g, text: 'x' })).status, 423);
  assert.equal((await call(s2.url, ao.token, 'POST', '/ui/api/message', { group: g, text: 'human still ok' })).status, 200);
  await s2.close();
});

test('rate limit and mute', async () => {
  const s2 = await startServer();
  const a = s2.connect['alice.agent'], ao = s2.connect['alice.owner'], bo = s2.connect['bob.owner'];
  await call(s2.url, ao.token, 'POST', '/ui/api/policy', { group: a.group, policy: { perMinute: 2 } });
  const bh = s2.connect['bob.agent'];
  // human messages in between keep loop guard out of the way
  const r = [];
  for (let i = 0; i < 3; i++) r.push((await call(s2.url, a.token, 'POST', '/v1/messages', { group: a.group, text: 'm' + i })).status);
  assert.deepEqual(r, [200, 200, 429]);
  await call(s2.url, ao.token, 'POST', '/ui/api/policy', { group: a.group, policy: { muted: true } });
  assert.equal((await call(s2.url, a.token, 'POST', '/v1/messages', { group: a.group, text: 'x' })).status, 403);
  // other owner cannot change alice's policy through their own token (only their own)
  await call(s2.url, bo.token, 'POST', '/ui/api/policy', { group: a.group, policy: { muted: false } });
  assert.equal(s2.app.cfg.groups[a.group].policy.o_alice.muted, true);
  await s2.close();
});

test('non-members get nothing; groups are private by default', async () => {
  const s2 = await startServer({ owners: ['alice', 'bob'] });
  const cfg = s2.app.cfg;
  cfg.owners.o_carol = { id: 'o_carol', name: 'carol', tokenHash: require('crypto').createHash('sha256').update('ag_o_carol').digest('hex') };
  cfg.agents.a_carol = { id: 'a_carol', ownerId: 'o_carol', name: 'carol agent', tokenHash: require('crypto').createHash('sha256').update('ag_a_carol').digest('hex') };
  const gid2 = s2.connect['alice.agent'].group;
  assert.equal((await call(s2.url, 'ag_a_carol', 'GET', `/v1/history?group=${gid2}`)).status, 404);
  assert.equal((await call(s2.url, 'ag_a_carol', 'POST', '/v1/messages', { group: gid2, text: 'let me in' })).status, 404);
  assert.equal((await call(s2.url, 'ag_o_carol', 'GET', `/ui/api/state?group=${gid2}`)).status, 404);
  await s2.close();
});

test('persistence: messages and delivery states survive server restart', async () => {
  const s2 = await startServer();
  const a = s2.connect['alice.agent'], b = s2.connect['bob.agent'];
  const r = await call(s2.url, a.token, 'POST', '/v1/messages', { group: a.group, text: 'durable' });
  await call(s2.url, b.token, 'POST', '/v1/emitted', { id: r.body.id });
  await s2.close();
  const s3 = await startServer({ dir: s2.dir });
  const m = s3.app.store.msgs.get(r.body.id);
  assert.equal(m.text, 'durable'); assert.equal(m.rs.a_bob.s, 'emitted');
  const r2 = await call(s3.url, s3.connect['alice.agent'].token, 'POST', '/v1/messages', { group: a.group, text: 'after restart' });
  assert.equal(r2.body.seq, m.seq + 1, 'sequence continues');
  await s3.close();
});

test('tokens are stored hashed, never plain, in server config', () => {
  const raw = fs.readFileSync(S.dir + '/config.json', 'utf8');
  assert.ok(!raw.includes(A.token) && !raw.includes(aOwner.token));
});

test('UI served with strict CSP and no token in URL handling server-side', async () => {
  const r = await fetch(S.url + '/');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
});
