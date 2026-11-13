'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync, spawn } = require('child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const root = path.join(__dirname, '..');
const cli = path.join(root, 'src', 'cli.js');

test('cli: host first-run init, workspace generation, and the generated .mcp.json actually launches the bundled channel', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'agcli-'));
  const port = 18000 + Math.floor(Math.random() * 1000);
  const srv = spawn(process.execPath, [cli, 'host', '--data', data, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; srv.stdout.on('data', (d) => { out += d; });
  const t0 = Date.now(); while (!/Agent connect files/.test(out) && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 50));
  try {
    assert.match(out, /asrul: http:\/\/127.0.0.1:\d+\/#token=ag_o_/);
    assert.match(out, /naveen: /);
    const ws = path.join(data, 'ws-asrul');
    const r = spawnSync(process.execPath, [cli, 'workspace', '--connect', path.join(data, 'connect', 'asrul.agent.json'), '--dir', ws], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    for (const f of ['.mcp.json', 'CLAUDE.md', 'start-claude.cmd', 'start-claude.sh']) assert.ok(fs.existsSync(path.join(ws, f)), f);
    assert.ok(fs.statSync(path.join(ws, 'outbox')).isDirectory());
    const cfg = JSON.parse(fs.readFileSync(path.join(ws, '.mcp.json'), 'utf8')).mcpServers.agentgroups;
    assert.ok(!JSON.stringify(cfg).includes(JSON.parse(fs.readFileSync(path.join(data, 'connect', 'asrul.agent.json'))).token), 'no token inside .mcp.json');
    // launch exactly as Claude Code would: command + args + env, from the workspace dir
    const transport = new StdioClientTransport({ command: cfg.command, args: cfg.args, env: { ...process.env, ...cfg.env }, cwd: ws });
    const client = new Client({ name: 'fake', version: '0' }, { capabilities: {} });
    await client.connect(transport);
    assert.ok(client.getServerCapabilities().experimental['claude/channel']);
    const st = await client.callTool({ name: 'group_status', arguments: {} });
    assert.match(st.content[0].text, /PR handoffs/);
    const d = spawnSync(process.execPath, [cli, 'doctor', '--connect', path.join(data, 'connect', 'asrul.agent.json')], { encoding: 'utf8' });
    assert.match(d.stdout, /\[ok\]   token valid/);
    await client.close();
  } finally { srv.kill(); }
});

test('cli: precheck rejects old/unknown claude versions (fake claude on PATH)', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fakeclaude-'));
  const run = (ver) => { fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\necho "' + ver + '"\n', { mode: 0o755 }); return spawnSync(process.execPath, [cli, 'precheck'], { env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH }, encoding: 'utf8' }); };
  assert.equal(run('2.1.313 (Claude Code)').status, 1);
  assert.equal(run('2.1.314 (Claude Code)').status, 0);
  assert.equal(run('2.2.0 (Claude Code)').status, 0);
  assert.equal(run('garbage').status, 1);
});

test('cli: workspace is isolated by default (config dir, tools, deny rules) and --no-isolation is explicit', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'agiso-'));
  const { initConfig } = require('../src/server.js');
  initConfig(data, ['asrul', 'naveen'], 'g', 'http://127.0.0.1:1');
  const c = path.join(data, 'connect', 'asrul.agent.json');
  const ws = path.join(data, 'w1');
  assert.equal(spawnSync(process.execPath, [cli, 'workspace', '--connect', c, '--dir', ws]).status, 0);
  const cmd = fs.readFileSync(path.join(ws, 'start-claude.cmd'), 'utf8');
  const cfg = path.resolve(ws) + '.claude-home';
  assert.ok(cmd.includes('CLAUDE_CONFIG_DIR=' + cfg), 'config dir is a sibling outside the workspace');
  assert.ok(!path.resolve(cfg).startsWith(path.resolve(ws) + path.sep), 'config dir not inside workspace');
  assert.match(cmd, /cli\.js" precheck/);
  assert.match(cmd, /CLAUDE_CODE_DISABLE_AUTO_MEMORY=1/);
  assert.match(cmd, /--tools "Read,Write,Edit"/);
  assert.match(cmd, /--dangerously-load-development-channels server:agentgroups/);
  assert.doesNotMatch(cmd, /skip-permissions|bypass/i);
  const st = JSON.parse(fs.readFileSync(path.join(ws, '.claude', 'settings.json'), 'utf8'));
  assert.equal(st.permissions.blockReadsOutsideWorkingDirectories, true);
  assert.ok(st.permissions.deny.includes('Bash') && st.permissions.deny.includes('WebFetch'));
  assert.equal(st.permissions.blockWritesOutsideWorkingDirectories, true);
  const ws2 = path.join(data, 'w2');
  spawnSync(process.execPath, [cli, 'workspace', '--connect', c, '--dir', ws2, '--no-isolation']);
  assert.doesNotMatch(fs.readFileSync(path.join(ws2, 'start-claude.cmd'), 'utf8'), /CLAUDE_CONFIG_DIR/);
});
