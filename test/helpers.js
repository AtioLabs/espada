'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp, initConfig } = require('../src/server.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function startServer(opts = {}) {
  const dir = opts.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'ag-'));
  if (!fs.existsSync(path.join(dir, 'config.json'))) initConfig(dir, opts.owners || ['alice', 'bob'], 'Test group', 'http://127.0.0.1:0');
  if (!opts.defaults) {
    const cp = path.join(dir, 'config.json'); const c = JSON.parse(fs.readFileSync(cp, 'utf8'));
    for (const g of Object.values(c.groups)) for (const o of Object.keys(g.policy)) g.policy[o].approveMessages = false;
    fs.writeFileSync(cp, JSON.stringify(c));
  }
  const app = createApp(dir);
  await new Promise((r) => app.server.listen(opts.port || 0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + app.server.address().port;
  const connect = {};
  for (const f of fs.readdirSync(path.join(dir, 'connect'))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'connect', f), 'utf8'));
    j.server = url; fs.writeFileSync(path.join(dir, 'connect', f), JSON.stringify(j));
    connect[f.replace('.json', '')] = { ...j, file: path.join(dir, 'connect', f) };
  }
  return { dir, app, url, connect, close: () => new Promise((r) => { app.server.closeAllConnections && app.server.closeAllConnections(); app.server.close(r); }) };
}
const call = async (url, token, method, p, body) => {
  const r = await fetch(url + p, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
};

// Acts like Claude Code: spawns the channel as a stdio MCP child, records channel notifications, calls tools.
async function fakeClaude(connectFile, workspace, opts = {}) {
  fs.mkdirSync(workspace, { recursive: true });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'channel.js')], env: { ...process.env, AG_CONNECT: connectFile, AG_WORKSPACE: workspace } });
  const client = new Client({ name: 'fake-claude-code', version: '0' }, { capabilities: {} });
  const events = [], checks = [];
  let tool;
  client.fallbackNotificationHandler = async (n) => {
    if (n.method !== 'notifications/claude/channel') return;
    if (n.params.meta && n.params.meta.kind === 'channel_check') { checks.push(n.params); if (opts.autoConfirm !== false) tool('group_ack', { msg_id: n.params.meta.msg_id }).catch(() => {}); return; }
    events.push(n.params);
  };
  await client.connect(transport);
  tool = async (name, args) => { const r = await client.callTool({ name, arguments: args || {} }); return { isError: !!r.isError, text: r.content[0].text }; };
  const waitFor = async (pred, ms = 8000) => { const t = Date.now(); for (;;) { const f = events.find(pred); if (f) return f; if (Date.now() - t > ms) throw new Error('timeout waiting for event; have ' + JSON.stringify(events.map((e) => e.content))); await new Promise((r) => setTimeout(r, 50)); } };
  return { client, events, checks, tool, waitFor, instructions: client.getInstructions(), capabilities: client.getServerCapabilities(), close: () => client.close() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('until timeout'); await sleep(50); } }
module.exports = { startServer, call, fakeClaude, sleep, until };
