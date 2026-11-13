'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { startServer, call, fakeClaude, sleep, until } = require('./helpers.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agws-'));

test('Q&A: ask, targeted answer, search, verification counts only from the other owner, reputation', async () => {
  const S = await startServer();
  const a = await fakeClaude(S.connect['alice.agent'].file, tmp());
  const b = await fakeClaude(S.connect['bob.agent'].file, tmp());
  await until(() => S.app.streams.get('a_alice')?.size && S.app.streams.get('a_bob')?.size);
  assert.equal((await a.tool('group_qa_search', { query: 'proration' })).text, '[]');
  assert.equal((await a.tool('group_ask', { title: 'How do we test proration rounding?', text: 'Dummy question about rounding in invoices', tags: ['Testing', 'billing'] })).isError, false);
  const q = await b.waitFor((e) => e.meta.kind === 'question');
  assert.equal(q.meta.title, 'How do we test proration rounding?');
  assert.equal((await b.tool('group_answer', { question_id: q.meta.msg_id, text: 'Use fixed-point cents; see tests/proration.test.ts' })).isError, false);
  const ans = await a.waitFor((e) => e.meta.kind === 'answer');
  assert.equal(ans.meta.answer_to, q.meta.msg_id);
  // answers go only to the asker, not broadcast
  await sleep(200); assert.ok(!b.events.some((e) => e.meta.kind === 'answer'));
  // asker cannot answer a question that is not in the group / bad ids rejected
  assert.ok((await a.tool('group_answer', { question_id: 'm_nope', text: 'x' })).isError);
  // answer's own owner cannot verify; the other owner can
  assert.match((await b.tool('group_verify', { answer_id: ans.meta.msg_id, result: 'worked' })).text, /cannot_verify_own_answer/);
  assert.equal((await a.tool('group_verify', { answer_id: ans.meta.msg_id, result: 'worked', note: 'ran it' })).isError, false);
  const s = JSON.parse((await a.tool('group_qa_search', { query: 'proration rounding' })).text);
  assert.equal(s.length, 1); assert.equal(s[0].answers[0].worked, 1);
  const prof = JSON.parse((await a.tool('group_profiles')).text);
  assert.deepEqual(prof.find((p) => p.agent === 'a_bob').reputation, { answers: 1, verified: 1, failed: 0 });
  assert.deepEqual(prof.find((p) => p.agent === 'a_alice').reputation, { answers: 0, verified: 0, failed: 0 });
  // human verification flips to failed from owner token
  const st = (await call(S.url, S.connect['alice.owner'].token, 'POST', '/ui/api/verify', { id: ans.meta.msg_id, result: 'failed' }));
  assert.equal(st.status, 200);
  assert.equal(JSON.parse((await a.tool('group_profiles')).text).find((p) => p.agent === 'a_bob').reputation.verified, 0);
  assert.equal((await call(S.url, S.connect['bob.owner'].token, 'POST', '/ui/api/verify', { id: ans.meta.msg_id, result: 'worked' })).status, 403);
  await a.close(); await b.close(); await S.close();
});

test('Q&A goes through the same approval policy; pending questions are invisible to search', async () => {
  const S = await startServer();
  const g = S.connect['alice.agent'].group;
  await call(S.url, S.connect['alice.owner'].token, 'POST', '/ui/api/policy', { group: g, policy: { approveMessages: true } });
  const r = await call(S.url, S.connect['alice.agent'].token, 'POST', '/v1/messages', { group: g, kind: 'question', title: 'Secret pending question zebra', text: 'body' });
  assert.equal(r.status, 202);
  const sr = await call(S.url, S.connect['bob.agent'].token, 'GET', `/v1/qa/search?group=${g}&q=zebra`);
  assert.deepEqual(sr.body.results, []);
  await call(S.url, S.connect['alice.owner'].token, 'POST', '/ui/api/approve', { id: r.body.id, decision: 'approve' });
  assert.equal((await call(S.url, S.connect['bob.agent'].token, 'GET', `/v1/qa/search?group=${g}&q=zebra`)).body.results.length, 1);
  assert.equal((await call(S.url, S.connect['alice.agent'].token, 'POST', '/v1/messages', { group: g, kind: 'question', title: '', text: 'x' })).status, 422);
  assert.equal((await call(S.url, S.connect['alice.agent'].token, 'POST', '/v1/messages', { group: g, kind: 'weird', text: 'x' })).status, 422);
  await S.close();
});

test('profiles: owner edits only their own agent, secrets blocked, visible to group members', async () => {
  const S = await startServer();
  const g = S.connect['alice.agent'].group;
  const ok = await call(S.url, S.connect['alice.owner'].token, 'POST', '/ui/api/profile', { agent: 'a_alice', profile: { headline: 'Billing + tests', skills: ['TypeScript', 'jest'], helpsWith: 'PR summaries', runtime: 'Claude Code' } });
  assert.equal(ok.status, 200);
  assert.equal((await call(S.url, S.connect['bob.owner'].token, 'POST', '/ui/api/profile', { agent: 'a_alice', profile: { headline: 'hijack' } })).status, 404);
  assert.equal((await call(S.url, S.connect['alice.owner'].token, 'POST', '/ui/api/profile', { agent: 'a_alice', profile: { headline: 'key AKIAABCDEFGHIJKLMNOP' } })).status, 422);
  assert.equal((await call(S.url, S.connect['alice.agent'].token, 'POST', '/ui/api/profile', { agent: 'a_alice', profile: {} })).status, 403, 'agents cannot edit profiles');
  const p = (await call(S.url, S.connect['bob.agent'].token, 'GET', `/v1/profiles?group=${g}`)).body.profiles.find((x) => x.agent === 'a_alice');
  assert.equal(p.headline, 'Billing + tests'); assert.deepEqual(p.skills, ['TypeScript', 'jest']);
  await S.close();
});

test('pending (unapproved) file cannot be downloaded by the other owner, their agent, or a non-member via any route', async () => {
  const S = await startServer();
  const g = S.connect['alice.agent'].group;
  const r = await call(S.url, S.connect['alice.agent'].token, 'POST', '/v1/files', { group: g, name: 'private-draft.md', contentBase64: Buffer.from('UNAPPROVED DRAFT').toString('base64') });
  assert.equal(r.status, 202);
  const sha = S.app.store.msgs.get(r.body.id).file.sha;
  const routes = [[S.connect['bob.owner'].token, `/ui/api/files/${sha}?group=${g}`], [S.connect['bob.agent'].token, `/v1/files/${sha}?group=${g}`], ['ag_a_unknown', `/v1/files/${sha}?group=${g}`]];
  for (const [t, p] of routes) assert.notEqual((await call(S.url, t, 'GET', p)).status, 200, p);
  assert.equal((await fetch(S.url + `/ui/api/files/${sha}?group=${g}`, { headers: { authorization: 'Bearer ' + S.connect['alice.owner'].token } })).status, 200, 'author owner can preview own pending file');
  const lst = (await call(S.url, S.connect['bob.owner'].token, 'GET', '/ui/api/state')).body;
  assert.ok(!JSON.stringify(lst).includes(sha), 'sha does not leak into other owner state');
  const hist = (await call(S.url, S.connect['bob.agent'].token, 'GET', `/v1/history?group=${g}`)).body;
  assert.ok(!JSON.stringify(hist).includes(sha));
  await S.close();
});
