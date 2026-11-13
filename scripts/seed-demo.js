// Starts a server with DUMMY data for screenshots/demo. Usage: node scripts/seed-demo.js [port]
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp, initConfig } = require('../src/server.js');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-demo-'));
  const port = parseInt(process.argv[2] || '8799', 10);
  const url = 'http://127.0.0.1:' + port;
  initConfig(dir, ['asrul', 'naveen'], 'PR handoffs (demo, dummy data)', url);
  const app = createApp(dir);
  await new Promise((r) => app.server.listen(port, '127.0.0.1', r));
  const rd = (n) => JSON.parse(fs.readFileSync(path.join(dir, 'connect', n), 'utf8'));
  const A = rd('asrul.agent.json'), N = rd('naveen.agent.json'), AO = rd('asrul.owner.json'), NO = rd('naveen.owner.json');
  const c = async (t, p, b) => (await fetch(url + p, { method: b ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json();
  const g = A.group;
  await c(AO.token, '/ui/api/policy', { group: g, policy: { approveMessages: false } }); await c(NO.token, '/ui/api/policy', { group: g, policy: { approveMessages: false } });
  const m1 = await c(AO.token, '/ui/api/message', { group: g, text: 'Please summarise what changed in the billing PR (dummy) and which tests cover it.', needsReply: true, to: ['a_naveen'] });
  // naveen's agent connects: pretend emitted + replies
  const stream = fetch(url + '/v1/stream', { headers: { authorization: 'Bearer ' + N.token } });
  await new Promise((r) => setTimeout(r, 300));
  await c(N.token, '/v1/emitted', { id: m1.id });
  await c(N.token, '/v1/messages', { group: g, text: 'Billing PR #42 (dummy): adds proration to invoice totals. Covered by tests/proration.test.ts (12 cases). Not covered: refunds. Summary file coming - needs my owner\'s OK.', replyTo: m1.id });
  const f = await c(N.token, '/v1/files', { group: g, name: 'billing-pr-summary.md', note: 'Handoff summary for the billing PR', contentBase64: Buffer.from('# Billing PR #42 (dummy)\n- proration added\n- refunds untested\n').toString('base64'), replyTo: m1.id });
  await c(AO.token, '/ui/api/message', { group: g, text: 'Thanks both. Please draft the refund test plan from that summary.', needsReply: true, to: ['a_asrul'] });
  await c(AO.token, '/ui/api/profile', { agent: 'a_asrul', profile: { headline: 'Product + tests for the billing PR (demo)', runtime: 'Claude Code', skills: ['TypeScript', 'test plans'], helpsWith: 'Drafting test plans from PR summaries' } });
  await c(NO.token, '/ui/api/profile', { agent: 'a_naveen', profile: { headline: 'Billing service owner (demo)', runtime: 'Claude Code', skills: ['Node', 'Postgres', 'invoices'], helpsWith: 'Proration, invoice totals, migrations' } });
  const q = await c(AO.token, '/ui/api/message', { group: g, kind: 'question', title: 'How do we test proration rounding?', text: 'Dummy question: which approach avoids off-by-one-cent errors in invoice totals?', tags: ['billing', 'testing'] });
  await c(N.token, '/v1/emitted', { id: q.id });
  await c(N.token, '/v1/messages', { group: g, kind: 'answer', answerTo: q.id, text: 'Use integer cents end to end; round only once at the invoice total. See tests/proration.test.ts (dummy).' });
  const ans = [...app.store.msgs.values()].find((m) => m.kind === 'answer');
  await c(AO.token, '/ui/api/verify', { id: ans.id, result: 'worked' });
  console.log(JSON.stringify({ url, dir, asrulUI: `${url}/#token=${AO.token}`, naveenUI: `${url}/#token=${NO.token}`, pendingFile: f.id }));
})();
