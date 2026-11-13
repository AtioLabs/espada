'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, call } = require('./helpers.js');

const poll = (S, who, session, confirmed = 0) => call(S.url, who.token, 'GET', `/v1/poll?session=${session}&wait=0&confirmed=${confirmed}&checks=1`);
const confirm = (S, who, session) => call(S.url, who.token, 'POST', '/v1/channel-confirm', { session });

test('two sessions of one agent do not overwrite each other: both can confirm, unknown sessions cannot', async () => {
  const S = await startServer();
  const bob = S.connect['bob.agent'];
  await poll(S, bob, 's_one');
  await poll(S, bob, 's_two'); // second window polls AFTER the first: used to make s_one "unknown"
  assert.equal((await confirm(S, bob, 's_one')).status, 200, 'first session can still confirm');
  assert.equal((await confirm(S, bob, 's_two')).status, 200, 'second session can confirm too');
  assert.equal((await confirm(S, bob, 's_ghost')).status, 409, 'a session that never polled is refused');
  assert.equal(S.app.agentState.a_bob.confirmed, true);
  await S.close();
});

test('only confirmed sessions receive messages; an unconfirmed duplicate gets nothing and does not break the confirmed one', async () => {
  const S = await startServer();
  const alice = S.connect['alice.agent'], bob = S.connect['bob.agent'];
  await poll(S, bob, 's_good', 1); await confirm(S, bob, 's_good');
  await poll(S, bob, 's_dup', 0); // leftover/duplicate process, never confirms
  const g = alice.group;
  assert.equal((await call(S.url, alice.token, 'POST', '/v1/messages', { group: g, text: 'hello bob' })).status, 200);
  const dup = await poll(S, bob, 's_dup', 0);
  assert.equal(dup.body.messages.length, 0, 'unconfirmed duplicate receives nothing');
  const good = await poll(S, bob, 's_good', 1);
  assert.equal(good.body.messages.length, 1, 'confirmed session still receives it');
  assert.equal(good.body.messages[0].text, 'hello bob');
  assert.equal(good.body.confirmed, true); assert.equal(dup.body.confirmed, false, 'each session sees its own confirmed flag');
  await S.close();
});

test('a message handed to a live session is not redelivered to its sibling window', async () => {
  const S = await startServer();
  const alice = S.connect['alice.agent'], bob = S.connect['bob.agent'];
  await poll(S, bob, 's_a', 1); await confirm(S, bob, 's_a');
  await poll(S, bob, 's_b', 1); await confirm(S, bob, 's_b');
  await call(S.url, alice.token, 'POST', '/v1/messages', { group: alice.group, text: 'once' });
  const a = await poll(S, bob, 's_a', 1);
  assert.equal(a.body.messages.length, 1);
  await call(S.url, bob.token, 'POST', '/v1/emitted', { id: a.body.messages[0].id, session: 's_a' });
  const b = await poll(S, bob, 's_b', 1);
  assert.equal(b.body.messages.filter((m) => m.redelivered).length, 0, 'not replayed to the other live window');
  await S.close();
});
