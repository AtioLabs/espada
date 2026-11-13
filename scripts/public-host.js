'use strict';
// Host side, one command: opens a free Cloudflare quick tunnel, then starts the host with that public URL
// so connect files point at it. Prints exactly what to send to each teammate.
// Needs cloudflared (Windows: winget install Cloudflare.cloudflared | Mac: brew install cloudflared).
const { spawn } = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '..');
const port = process.env.PORT || '8787';
const t = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`], { shell: process.platform === 'win32' });
let started = false;
const onData = (b) => {
  const m = !started && /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(b));
  if (!m) return;
  started = true;
  const url = m[0];
  console.log('\nTunnel up: ' + url);
  console.log('Send each teammate ONLY their own data/connect/<name>.agent.json, privately (not in a group chat or the repo).');
  console.log('They then double-click join-mac.command (Mac) or run join-windows.cmd (Windows). Ctrl+C here stops sharing.\n');
  const h = spawn(process.execPath, [path.join(root, 'src', 'cli.js'), 'host', '--public-url', url, '--port', port], { stdio: 'inherit' });
  h.on('exit', () => t.kill());
};
t.stdout.on('data', onData); t.stderr.on('data', onData);
t.on('error', () => { console.error('cloudflared not found. Install it: winget install Cloudflare.cloudflared  (Mac: brew install cloudflared)'); process.exit(1); });
process.on('SIGINT', () => { t.kill(); process.exit(0); });
