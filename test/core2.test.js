'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { startServer, call, fakeClaude, sleep, until } = require('./helpers.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agws-'));

test('fresh install defaults hold agent messages AND files for owner approval', async () => {
  const S = await startServer({ defaults: true });
  const g = S.connect['alice.agent'].group;
  const pol = S.app.cfg.groups[g].policy.o_alice;
  assert.equal(pol.approveMessages, true); assert.equal(pol.approveFiles, true);
  const r = await call(S.url, S.connect['alice.agent'].token, 'POST', '/v1/messages', { group: g, text: 'hello' });
  assert.equal(r.status, 202);
  await S.close();
});

test('JSON null / array / scalar bodies are rejected with 400', async () => {
  const S = await startServer();
  for (const body of ['null', '[]', '5', '"x"']) {
    const r = await fetch(S.url + '/v1/messages', { method: 'POST', headers: { authorization: 'Bearer ' + S.connect['alice.agent'].token, 'content-type': 'application/json' }, body });
    assert.equal(r.status, 400, body);
    const r2 = await fetch(S.url + '/ui/api/message', { method: 'POST', headers: { authorization: 'Bearer ' + S.connect['alice.owner'].token, 'content-type': 'application/json' }, body });
    assert.equal(r2.status, 400, body);
  }
  await S.close();
});

test('channel not confirmed (e.g. Claude launched WITHOUT the channel flag): messages are held, not consumed; confirming releases them', async () => {
  const S = await startServer();
  const a = await fakeClaude(S.connect['alice.agent'].file, tmp());
  const b = await fakeClaude(S.connect['bob.agent'].file, tmp(), { autoConfirm: false });
  await b.client.listTools();
  await until(() => b.checks.length);
  await a.tool('group_send', { text: 'while bob has no working channel' });
  await sleep(2500);
  assert.equal(b.events.length, 0);
  const m = [...S.app.store.msgs.values()][0];
  assert.equal(m.rs.a_bob.s, 'queued', 'still queued, not marked emitted');
  const st = (await call(S.url, S.connect['alice.owner'].token, 'GET', '/ui/api/state')).body;
  assert.equal(st.members.flatMap((x) => x.agents).find((x) => x.id === 'a_bob').channel, 'waiting_for_confirmation');
  const status = JSON.parse((await b.tool('group_status')).text);
  assert.equal(status.channel_confirmed_this_session, false);
  assert.ok((await b.tool('group_ack', { msg_id: 'chk_wrong' })).isError);
  await b.tool('group_ack', { msg_id: b.checks[0].meta.msg_id });
  await b.waitFor((e) => /no working channel/.test(e.content));
  assert.equal(JSON.parse((await b.tool('group_status')).text).channel_confirmed_this_session, true);
  await until(() => m.rs.a_bob.s === 'emitted');
  await a.close(); await b.close(); await S.close();
});

test('new session redelivers unacknowledged messages (flagged), acknowledged ones are not replayed, group_unread lists them', async () => {
  const S = await startServer();
  const a = await fakeClaude(S.connect['alice.agent'].file, tmp());
  const b = await fakeClaude(S.connect['bob.agent'].file, tmp());
  await until(() => S.app.agentState.a_bob);
  await a.tool('group_send', { text: 'handled one' });
  await a.tool('group_send', { text: 'never handled two' });
  await b.waitFor((e) => e.content === 'never handled two');
  const unread = JSON.parse((await b.tool('group_unread')).text);
  assert.equal(unread.length, 2);
  await b.tool('group_ack', { msg_id: b.events[0].meta.msg_id });
  assert.equal(JSON.parse((await b.tool('group_unread')).text).length, 1);
  await b.close();
  const b2 = await fakeClaude(S.connect['bob.agent'].file, tmp());
  const e = await b2.waitFor((x) => /never handled two/.test(x.content));
  assert.equal(e.meta.redelivered, 'true');
  assert.match(e.content, /redelivered/);
  await sleep(300);
  assert.ok(!b2.events.some((x) => /handled one/.test(x.content) && !/never/.test(x.content)));
  await a.close(); await b2.close(); await S.close();
});

test('attachment download failure is explicit, never silent', async () => {
  const S = await startServer();
  const g = S.connect['alice.agent'].group;
  const r = await call(S.url, S.connect['alice.agent'].token, 'POST', '/v1/files', { group: g, name: 'x.md', contentBase64: Buffer.from('hello file').toString('base64') });
  await call(S.url, S.connect['alice.owner'].token, 'POST', '/ui/api/approve', { id: r.body.id, decision: 'approve' });
  fs.unlinkSync(path.join(S.dir, 'files', S.app.store.msgs.get(r.body.id).file.sha));
  const b = await fakeClaude(S.connect['bob.agent'].file, tmp());
  const e = await b.waitFor((x) => x.meta.msg_id === r.body.id, 15000);
  assert.equal(e.meta.file_error, 'download_failed');
  assert.ok(!e.meta.file_path);
  assert.match(e.content, /could NOT be downloaded/);
  await b.close(); await S.close();
});

test('mute pauses delivery (messages wait); unmute delivers them', async () => {
  const S = await startServer();
  const g = S.connect['alice.agent'].group;
  const a = await fakeClaude(S.connect['alice.agent'].file, tmp());
  const b = await fakeClaude(S.connect['bob.agent'].file, tmp());
  await until(() => S.app.agentState.a_bob?.confirmed);
  const bo = S.connect['bob.owner'].token;
  await call(S.url, bo, 'POST', '/ui/api/policy', { group: g, policy: { muted: true } });
  await a.tool('group_send', { text: 'sent while bob muted' });
  await sleep(800);
  assert.equal(b.events.length, 0);
  assert.equal([...S.app.store.msgs.values()][0].rs.a_bob.s, 'queued');
  await call(S.url, bo, 'POST', '/ui/api/policy', { group: g, policy: { muted: false } });
  await b.waitFor((e) => /sent while bob muted/.test(e.content));
  await a.close(); await b.close(); await S.close();
});

test('long-poll works when the response is delayed (proxy-safe): no streaming dependency', async () => {
  const S = await startServer();
  const a = S.connect['alice.agent'];
  const t0 = Date.now();
  const r = await fetch(S.url + '/v1/poll?session=s_test&wait=1', { headers: { authorization: 'Bearer ' + a.token } });
  assert.equal(r.status, 200); assert.deepEqual((await r.json()).messages, []);
  assert.ok(Date.now() - t0 >= 900);
  assert.equal((await fetch(S.url + '/v1/poll', { headers: { authorization: 'Bearer ' + a.token } })).status, 400);
  await S.close();
});

test('unanswered channel check is surfaced to the owner page with the try count', async () => {
  const S = await startServer();
  const a = S.connect['alice.agent'];
  await fetch(S.url + '/v1/poll?session=s_x&wait=1&checks=5', { headers: { authorization: 'Bearer ' + a.token } });
  const st = (await call(S.url, S.connect['alice.owner'].token, 'GET', '/ui/api/state')).body;
  const ag = st.members.flatMap((m) => m.agents).find((x) => x.online);
  assert.equal(ag.channel, 'waiting_for_confirmation');
  assert.equal(ag.checks, 5);
  await S.close();
});
