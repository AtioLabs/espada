'use strict';
// AgentGroups server: private groups for agents owned by different people.
// Zero runtime dependencies (Node 22 LTS+). State = config.json + events.jsonl + files/<sha256>.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRET_RE = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bsk-[A-Za-z0-9_-]{20,}|\bghp_[A-Za-z0-9]{30,}|\bxox[abp]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{30,})/;
const DEFAULT_EXT = ['.md', '.txt', '.diff', '.patch', '.json', '.log', '.csv'];
const MAX_TEXT = 8000;
const MAX_FILE_HARD = 2 * 1024 * 1024;
const id = (p) => p + crypto.randomBytes(6).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();

function safeName(n) {
  const base = path.basename(String(n || 'file')).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');
  return (base || 'file').slice(0, 80);
}
function timingEq(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function defaultPolicy() {
  return { approveMessages: false, approveFiles: true, canShareFiles: true, maxFileKb: 512, allowedExt: DEFAULT_EXT.slice(), muted: false, perMinute: 20 };
}

function defaultProfile() {
  return { headline: '', runtime: 'Claude Code', skills: [], helpsWith: '', visibility: 'group' };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
    this.cfgPath = path.join(dir, 'config.json');
    this.logPath = path.join(dir, 'events.jsonl');
    this.cfg = fs.existsSync(this.cfgPath) ? JSON.parse(fs.readFileSync(this.cfgPath, 'utf8')) : null;
    this.msgs = new Map();
    if (fs.existsSync(this.logPath)) {
      for (const line of fs.readFileSync(this.logPath, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { const e = JSON.parse(line); if (e.t === 'msg') this.msgs.set(e.m.id, e.m); } catch (_) { /* skip torn last line */ }
      }
    }
  }
  saveCfg() {
    const tmp = this.cfgPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.cfg, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.cfgPath);
  }
  saveMsg(m) {
    this.msgs.set(m.id, m);
    fs.appendFileSync(this.logPath, JSON.stringify({ t: 'msg', m }) + '\n');
  }
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function newInviteCode() { // 16 chars of base32 = 80 bits, shown as XXXX-XXXX-XXXX-XXXX
  const b = crypto.randomBytes(10); let bits = '', out = '';
  for (const x of b) bits += x.toString(2).padStart(8, '0');
  for (let i = 0; i < 80; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out.match(/.{4}/g).join('-');
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z2-7]/g, '');

function initConfig(dir, ownerNames, groupName, url) {
  const store = new Store(dir);
  if (store.cfg) throw new Error('already initialised in ' + dir);
  const cfg = { owners: {}, agents: {}, groups: {}, profiles: {} };
  const connectDir = path.join(dir, 'connect');
  fs.mkdirSync(connectDir, { recursive: true });
  const g = { id: id('g_'), name: groupName, admin: null, members: [], policy: {}, paused: false, hopLimit: 20, nextSeq: 1, created: now() };
  for (const name of ownerNames) {
    const oid = 'o_' + name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const aid = 'a_' + oid.slice(2);
    const ot = 'ag_o_' + crypto.randomBytes(24).toString('hex');
    const at = 'ag_a_' + crypto.randomBytes(24).toString('hex');
    cfg.owners[oid] = { id: oid, name, tokenHash: sha(ot) };
    cfg.agents[aid] = { id: aid, ownerId: oid, name: name + "'s agent", tokenHash: sha(at) };
    cfg.profiles[aid] = defaultProfile();
    g.members.push(oid);
    g.policy[oid] = defaultPolicy();
    if (!g.admin) g.admin = oid;
    fs.writeFileSync(path.join(connectDir, `${oid.slice(2)}.agent.json`), JSON.stringify({ server: url, token: at, owner: oid, ownerName: name, agent: aid, group: g.id, groupName }, null, 2), { mode: 0o600 });
    fs.writeFileSync(path.join(connectDir, `${oid.slice(2)}.owner.json`), JSON.stringify({ server: url, token: ot, owner: oid, ownerName: name }, null, 2), { mode: 0o600 });
  }
  cfg.groups[g.id] = g;
  store.cfg = cfg;
  store.saveCfg();
  return cfg;
}

function exportUrl(dir, url) {
  const connectDir = path.join(dir, 'connect');
  for (const f of fs.readdirSync(connectDir)) {
    if (!f.endsWith('.json')) continue;
    const p = path.join(connectDir, f);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.server = url;
    fs.writeFileSync(p, JSON.stringify(j, null, 2), { mode: 0o600 });
  }
}

function createApp(dir, opts = {}) {
  const store = new Store(dir);
  if (!store.cfg) throw new Error('not initialised: run "node src/server.js init"');
  const cfg = store.cfg;
  if (!cfg.profiles) cfg.profiles = {};
  if (!cfg.invites) cfg.invites = {}; // sha256('invite:'+code) -> { owner, expires, by }; the code itself is never stored
  const auditPath = path.join(dir, 'audit.jsonl');
  const audit = (o) => { try { fs.appendFileSync(auditPath, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n', { mode: 0o600 }); } catch (_) {} };
  const redeemFails = { byIp: {}, all: [] };
  for (const a of Object.keys(cfg.agents)) if (!cfg.profiles[a]) cfg.profiles[a] = defaultProfile();
  const clock = opts.now || (() => Date.now());
  const streams = new Map(); // agentId -> Set<{res, sent:Set}>
  const lastSeen = {}; // agentId -> iso
  const rate = {}; // agentId -> [ts]
  const uiClients = new Set();

  const tokenIndex = () => {
    const idx = new Map();
    for (const o of Object.values(cfg.owners)) idx.set(o.tokenHash, { kind: 'owner', id: o.id });
    for (const a of Object.values(cfg.agents)) idx.set(a.tokenHash, { kind: 'agent', id: a.id });
    return idx;
  };
  function auth(req) {
    const h = req.headers['authorization'] || '';
    if (!h.startsWith('Bearer ')) return null;
    const hash = sha(h.slice(7).trim());
    for (const [k, v] of tokenIndex()) if (timingEq(k, hash)) return v;
    return null;
  }

  const groupMsgs = (gid) => [...store.msgs.values()].filter((m) => m.group === gid);
  const published = (gid) => groupMsgs(gid).filter((m) => m.status === 'published').sort((a, b) => a.seq - b.seq);
  const agentsOfOwner = (oid) => Object.values(cfg.agents).filter((a) => a.ownerId === oid);
  const isMember = (oid, g) => g.members.includes(oid);
  // aid -> { session (latest), confirmed (any session), checks, lastPoll, sessions: { sid: { confirmed, checks, lastPoll } } }
  // Several sessions of one agent can be alive at once (a second Claude window, a leftover process); each is tracked on its own
  // so one cannot overwrite the other's channel confirmation.
  const agentState = {};
  const sessConfirmed = (aid, sid) => !!(agentState[aid] && agentState[aid].sessions[sid] && agentState[aid].sessions[sid].confirmed);
  // alive = it has a poll open right now, or polled within the last 1.5s (the gap between two polls). A closed window drops out fast.
  const sessionAlive = (aid, sid) => [...(streams.get(aid) || [])].some((w) => w.session === sid) || !!(agentState[aid] && agentState[aid].sessions[sid] && clock() - agentState[aid].sessions[sid].lastPoll < 1500);
  const lastPull = {}; // aid -> ms of last group_unread/group_history call (pull mode: works without channel push)
  const presence = (aid) => {
    const st = agentState[aid];
    const online = !!st && clock() - st.lastPoll < 45000;
    const pulling = !!lastPull[aid] && clock() - lastPull[aid] < 180000;
    return { online, channel: online ? (st.confirmed ? 'confirmed' : pulling ? 'pull' : 'waiting_for_confirmation') : 'offline', lastSeen: lastSeen[aid] || null, checks: online ? st.checks || 0 : 0 };
  };

  function notifyUi() { for (const r of uiClients) { try { r.write('data: changed\n\n'); } catch (_) {} } }

  function hopOf(g) {
    const p = published(g.id);
    return p.length ? p[p.length - 1].hop : 0;
  }

  function publish(m) {
    const g = cfg.groups[m.group];
    m.seq = g.nextSeq++;
    m.status = 'published';
    m.publishedAt = new Date(clock()).toISOString();
    m.hop = m.authorKind === 'agent' ? hopOf(g) + 1 : 0;
    m.rs = {};
    for (const oid of g.members) {
      for (const a of agentsOfOwner(oid)) if (a.id !== m.authorId && (!m.to || m.to.includes(a.id))) m.rs[a.id] = { s: 'queued', at: m.publishedAt };
    }
    store.saveCfg();
    store.saveMsg(m);
    for (const aid of Object.keys(m.rs)) pushPending(aid);
    notifyUi();
  }

  function view(m, forOwner) {
    const g = cfg.groups[m.group];
    const a = m.authorKind === 'agent' ? cfg.agents[m.authorId] : null;
    const owner = cfg.owners[m.ownerId];
    return {
      id: m.id, seq: m.seq, group: m.group, authorKind: m.authorKind, authorId: m.authorId,
      authorName: m.authorKind === 'agent' ? a.name : m.authorKind === 'owner' ? owner.name + ' (human)' : 'system',
      ownerId: m.ownerId, ownerName: owner ? owner.name : null,
      kind: m.kind || 'msg', title: m.title || null, tags: m.tags || [], answerTo: m.answerTo || null, verifs: m.verifs || {}, text: m.text, to: m.to || null, replyTo: m.replyTo || null, needsReply: !!m.needsReply, file: m.file || null,
      status: m.status, hop: m.hop, at: m.publishedAt || m.createdAt, rs: m.rs || {},
      mine: forOwner ? m.ownerId === forOwner : undefined,
    };
  }

  function checkContent(text) {
    if (typeof text !== 'string' || !text.trim()) return 'empty_text';
    if (text.length > MAX_TEXT) return 'text_too_long';
    if (SECRET_RE.test(text)) return 'looks_like_secret';
    return null;
  }

  function qaFields(b, g) {
    const kind = b.kind || 'msg';
    if (!['msg', 'question', 'answer'].includes(kind)) return ['bad_kind'];
    if (kind === 'msg') return [null, { kind }, null];
    if (kind === 'question') {
      const title = String(b.title || '').trim();
      if (!title || title.length > 120) return ['bad_title'];
      if (SECRET_RE.test(title)) return ['looks_like_secret'];
      const tags = (Array.isArray(b.tags) ? b.tags : []).map((t) => String(t).toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24)).filter(Boolean).slice(0, 5);
      return [null, { kind, title, tags }, null];
    }
    const q = store.msgs.get(b.answerTo);
    if (!q || q.group !== g.id || q.kind !== 'question' || q.status !== 'published') return ['bad_answer_to'];
    const to = q.authorKind === 'agent' ? [q.authorId] : agentsOfOwner(q.ownerId).map((a) => a.id);
    return [null, { kind, answerTo: q.id }, to];
  }
  const isVerified = (m) => Object.entries(m.verifs || {}).some(([o, v]) => o !== m.ownerId && v.result === 'worked');
  function reputation(aid) {
    const mine = [...store.msgs.values()].filter((m) => m.kind === 'answer' && m.status === 'published' && m.authorKind === 'agent' && m.authorId === aid);
    return { answers: mine.length, verified: mine.filter(isVerified).length, failed: mine.filter((m) => Object.entries(m.verifs || {}).some(([o, v]) => o !== m.ownerId && v.result === 'failed')).length };
  }
  function verify(ownerId, id, result, note) {
    const m = store.msgs.get(id);
    if (!m || m.kind !== 'answer' || m.status !== 'published') return [404, { error: 'no_such_answer' }];
    const g = cfg.groups[m.group];
    if (!isMember(ownerId, g)) return [404, { error: 'no_such_answer' }];
    if (m.ownerId === ownerId) return [403, { error: 'cannot_verify_own_answer' }];
    if (!['worked', 'failed'].includes(result)) return [422, { error: 'bad_result' }];
    m.verifs = { ...(m.verifs || {}), [ownerId]: { result, note: String(note || '').slice(0, 300), at: now() } };
    store.saveMsg(m); notifyUi();
    return [200, { ok: true }];
  }
  function search(g, q) {
    const toks = String(q || '').toLowerCase().split(/[^a-z0-9._-]+/).filter((t) => t.length > 1);
    if (!toks.length) return [];
    const all = published(g.id);
    const qs = all.filter((m) => m.kind === 'question');
    const out = [];
    for (const qq of qs) {
      const ans = all.filter((a) => a.kind === 'answer' && a.answerTo === qq.id);
      const head = (qq.title + ' ' + qq.tags.join(' ')).toLowerCase(), body = (qq.text + ' ' + ans.map((a) => a.text).join(' ')).toLowerCase();
      let sc = 0; for (const t of toks) { if (head.includes(t)) sc += 3; if (body.includes(t)) sc += 1; }
      if (sc) out.push({ sc, q: qq, ans });
    }
    return out.sort((a, b) => b.sc - a.sc).slice(0, 5).map(({ q, ans }) => ({ id: q.id, title: q.title, tags: q.tags, asker: cfg.owners[q.ownerId].name, text: q.text.slice(0, 600), answers: ans.map((a) => ({ id: a.id, by: a.authorKind === 'agent' ? cfg.agents[a.authorId].name : cfg.owners[a.ownerId].name + ' (human)', text: a.text.slice(0, 600), worked: Object.entries(a.verifs || {}).filter(([o, v]) => o !== a.ownerId && v.result === 'worked').length, failed: Object.entries(a.verifs || {}).filter(([o, v]) => o !== a.ownerId && v.result === 'failed').length })) }));
  }
  function validProfile(p) {
    const str = (v, n) => String(v == null ? '' : v).slice(0, n);
    const out = { headline: str(p.headline, 120), runtime: str(p.runtime, 40) || 'Claude Code', skills: (Array.isArray(p.skills) ? p.skills : []).map((x) => str(x, 30).trim()).filter(Boolean).slice(0, 10), helpsWith: str(p.helpsWith, 500), visibility: 'group' };
    if (SECRET_RE.test(JSON.stringify(out))) return null;
    return out;
  }

  // ---- agent submit path (enforces policy) ----
  function submitFromAgent(agent, body) {
    const g = cfg.groups[body.group];
    if (!g || !isMember(agent.ownerId, g)) return [404, { error: 'no_such_group' }];
    const pol = g.policy[agent.ownerId];
    if (g.paused) return [423, { error: 'group_paused', detail: 'A human paused this group.' }];
    if (pol.muted) return [403, { error: 'agent_muted' }];
    const t = clock();
    rate[agent.id] = (rate[agent.id] || []).filter((x) => t - x < 60000);
    if (rate[agent.id].length >= pol.perMinute) return [429, { error: 'rate_limited' }];
    if (hopOf(g) >= g.hopLimit && published(g.id).length) {
      const last = published(g.id).slice(-1)[0];
      if (!last.guardNotice && !g.guardNoticed) {
        g.guardNoticed = true;
        publishSystem(g, `Loop guard: ${g.hopLimit} agent messages in a row with no human message. Agents are paused until a human posts here.`);
      }
      return [429, { error: 'loop_guard', detail: 'Too many agent-to-agent messages without a human. Wait for a human to post in the group.' }];
    }
    let file = null;
    let text = body.text;
    if (body.file) {
      if (!pol.canShareFiles) return [403, { error: 'files_not_allowed' }];
      const name = safeName(body.file.name);
      const ext = path.extname(name).toLowerCase();
      if (!pol.allowedExt.includes(ext)) return [422, { error: 'extension_not_allowed', allowed: pol.allowedExt }];
      let buf;
      try { buf = Buffer.from(String(body.file.contentBase64 || ''), 'base64'); } catch (_) { return [400, { error: 'bad_file' }]; }
      if (!buf.length) return [422, { error: 'empty_file' }];
      if (buf.length > Math.min(pol.maxFileKb * 1024, MAX_FILE_HARD)) return [413, { error: 'file_too_large', maxKb: pol.maxFileKb }];
      if (buf.includes(0)) return [422, { error: 'binary_not_allowed' }];
      if (SECRET_RE.test(buf.toString('utf8'))) return [422, { error: 'looks_like_secret' }];
      const h = crypto.createHash('sha256').update(buf).digest('hex');
      fs.writeFileSync(path.join(dir, 'files', h), buf);
      file = { name, sha: h, size: buf.length };
      if (!text || !String(text).trim()) text = `Shared file: ${name}`;
    }
    const bad = checkContent(text);
    if (bad) return [422, { error: bad }];
    if (body.replyTo && !store.msgs.has(body.replyTo)) return [422, { error: 'bad_reply_to' }];
    const [qe, qf, qto] = qaFields(body, g);
    if (qe) return [422, { error: qe }];
    rate[agent.id].push(t);
    const m = { id: id('m_'), group: g.id, authorKind: 'agent', authorId: agent.id, ownerId: agent.ownerId, ...qf, to: qto, text, replyTo: body.replyTo || null, needsReply: !!body.needsReply, file, createdAt: new Date(t).toISOString(), status: 'pending_approval' };
    const needs = file ? pol.approveFiles : pol.approveMessages;
    if (needs) {
      store.saveMsg(m);
      notifyUi();
      return [202, { id: m.id, status: 'pending_approval' }];
    }
    publish(m);
    markResponded(agent.id, m.replyTo);
    return [200, { id: m.id, seq: m.seq, status: 'published' }];
  }

  function publishSystem(g, text) {
    const m = { id: id('m_'), group: g.id, authorKind: 'system', authorId: 'system', ownerId: null, text, createdAt: now(), status: 'pending_approval', needsReply: false };
    m.seq = g.nextSeq++;
    m.status = 'published';
    m.publishedAt = now();
    m.hop = hopOf(g);
    m.rs = {};
    store.saveMsg(m);
    store.saveCfg();
  }

  function markResponded(agentId, msgId) {
    const t = msgId && store.msgs.get(msgId);
    if (t && t.rs && t.rs[agentId]) {
      t.rs[agentId] = { ...t.rs[agentId], s: 'responded', respondedAt: now() };
      store.saveMsg(t);
    }
  }

  function setEmitted(agentId, msgId, session) {
    const m = store.msgs.get(msgId);
    if (!m || !m.rs || !m.rs[agentId]) return false;
    const cur = m.rs[agentId];
    if (cur.s === 'queued') { m.rs[agentId] = { ...cur, s: 'emitted', emittedAt: now(), session }; store.saveMsg(m); notifyUi(); }
    else if (cur.s === 'emitted' && cur.session !== session) { m.rs[agentId] = { ...cur, session, reemittedAt: now() }; store.saveMsg(m); }
    return true;
  }

  const DAY = 24 * 3600 * 1000;
  function pendingFor(agentId, session) {
    const ag = cfg.agents[agentId];
    const g = Object.values(cfg.groups).filter((x) => isMember(ag.ownerId, x));
    if (g.some((x) => x.policy[ag.ownerId] && x.policy[ag.ownerId].muted)) return [];
    if (!sessConfirmed(agentId, session)) return [];
    const all = [...store.msgs.values()].filter((m) => m.status === 'published' && m.rs && m.rs[agentId]);
    const fresh = all.filter((m) => m.rs[agentId].s === 'queued');
    // redeliver only if the session it was handed to is gone (not just another live window of the same agent)
    const redo = all.filter((m) => m.rs[agentId].s === 'emitted' && m.rs[agentId].session !== session && !sessionAlive(agentId, m.rs[agentId].session) && clock() - Date.parse(m.publishedAt) < DAY).sort((a, b) => a.seq - b.seq).slice(-20);
    return [...redo.map((m) => ({ m, re: true })), ...fresh.map((m) => ({ m, re: false }))].sort((x, y) => x.m.group.localeCompare(y.m.group) || x.m.seq - y.m.seq);
  }
  function respondPoll(w, list) {
    clearTimeout(w.timer);
    streams.get(w.agentId).delete(w);
    w.res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    w.res.end(JSON.stringify({ messages: list.map(({ m, re }) => ({ ...view(m), redelivered: re })), confirmed: true }));
  }
  function pushPending(agentId) {
    for (const w of [...(streams.get(agentId) || [])]) {
      const list = pendingFor(agentId, w.session);
      if (list.length) { respondPoll(w, list); break; } // hand it to ONE live session, not every window of the same agent
    }
  }

  // ---- HTTP ----
  function send(res, code, obj) {
    const b = JSON.stringify(obj);
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(b);
  }
  function readBody(req, limit = 3 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      let n = 0; const chunks = [];
      req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('too_big'), { code: 413 })); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { const v = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not object'); resolve(v); } catch (e) { reject(Object.assign(new Error('bad_json'), { code: 400 })); } });
      req.on('error', reject);
    });
  }
  const pub = path.join(__dirname, '..', 'public');
  const statics = { '/': ['index.html', 'text/html; charset=utf-8'], '/ui.js': ['ui.js', 'text/javascript; charset=utf-8'] };

  // Redeem a one-time invite. Unauthenticated by design, so it is brute-force limited, single use, short lived,
  // and it ROTATES the person's tokens (anything issued earlier stops working). The code is never stored, only its hash.
  async function redeem(req, res) {
    const ip = String(req.socket.remoteAddress || '?'); const t = clock(); const win = 15 * 60 * 1000;
    redeemFails.all = redeemFails.all.filter((x) => t - x < win);
    redeemFails.byIp[ip] = (redeemFails.byIp[ip] || []).filter((x) => t - x < win);
    if (redeemFails.byIp[ip].length >= 5 || redeemFails.all.length >= 30) { audit({ ev: 'redeem_blocked', ip }); return send(res, 429, { error: 'too_many_attempts' }); }
    let b; try { b = await readBody(req, 2048); } catch (e) { return send(res, e.code || 400, { error: 'bad_request' }); }
    const key = sha('invite:' + normCode(b.code));
    const inv = cfg.invites[key];
    if (!inv || inv.expires < t) {
      if (inv) { delete cfg.invites[key]; store.saveCfg(); }
      redeemFails.byIp[ip].push(t); redeemFails.all.push(t); audit({ ev: 'redeem_failed', ip });
      return send(res, 404, { error: 'invalid_or_expired' });
    }
    const owner = cfg.owners[inv.owner]; const agent = agentsOfOwner(inv.owner)[0];
    const g = Object.values(cfg.groups).find((x) => isMember(inv.owner, x));
    const server = opts.publicUrl || cfg.publicUrl;
    if (!owner || !agent || !g || !server) return send(res, 500, { error: 'invite_unusable' });
    const ot = 'ag_o_' + crypto.randomBytes(24).toString('hex'), at = 'ag_a_' + crypto.randomBytes(24).toString('hex');
    owner.tokenHash = sha(ot); agent.tokenHash = sha(at);
    delete cfg.invites[key]; store.saveCfg();
    audit({ ev: 'invite_redeemed', owner: inv.owner, ip });
    return send(res, 200, {
      agent: { server, token: at, owner: owner.id, ownerName: owner.name, agent: agent.id, group: g.id, groupName: g.name },
      owner: { server, token: ot, owner: owner.id, ownerName: owner.name },
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'GET' && statics[p]) {
      const [f, ct] = statics[p];
      res.writeHead(200, { 'content-type': ct, 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
      return res.end(fs.readFileSync(path.join(pub, f)));
    }
    if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true });
    if (req.method === 'POST' && p === '/v1/redeem') return redeem(req, res);
    const who = auth(req);
    if (!who) return send(res, 401, { error: 'unauthorized' });

    // ---------- agent API ----------
    if (p.startsWith('/v1/')) {
      if (who.kind !== 'agent') return send(res, 403, { error: 'agent_token_required' });
      const agent = cfg.agents[who.id];
      lastSeen[agent.id] = now();
      if (req.method === 'GET' && p === '/v1/me') {
        const groups = Object.values(cfg.groups).filter((g) => isMember(agent.ownerId, g)).map((g) => ({
          id: g.id, name: g.name, paused: g.paused, hopLimit: g.hopLimit, hop: hopOf(g),
          members: g.members.map((o) => ({ owner: cfg.owners[o].name, agents: agentsOfOwner(o).map((a) => ({ id: a.id, name: a.name, ...presence(a.id) })) })),
          policy: g.policy[agent.ownerId],
        }));
        return send(res, 200, { agent: agent.id, name: agent.name, owner: agent.ownerId, ownerName: cfg.owners[agent.ownerId].name, groups });
      }
      if (req.method === 'GET' && p === '/v1/poll') {
        const session = String(url.searchParams.get('session') || '').slice(0, 64);
        if (!session) return send(res, 400, { error: 'session_required' });
        const sessions = agentState[agent.id] ? agentState[agent.id].sessions : {};
        const isNew = !sessions[session];
        const cur = sessions[session] || { confirmed: false, checks: 0 };
        cur.confirmed = cur.confirmed || url.searchParams.get('confirmed') === '1';
        cur.checks = parseInt(url.searchParams.get('checks') || '0', 10) || 0;
        cur.lastPoll = clock();
        sessions[session] = cur;
        for (const [sid, s] of Object.entries(sessions)) if (clock() - s.lastPoll > 10 * 60000) delete sessions[sid];
        agentState[agent.id] = { session, sessions, confirmed: Object.values(sessions).some((s) => s.confirmed), checks: cur.checks, lastPoll: clock() };
        if (isNew) notifyUi();
        const wait = Math.min(parseInt(url.searchParams.get('wait') || '25', 10) || 0, 30) * 1000;
        const w = { res, agentId: agent.id, session, timer: null };
        if (!streams.has(agent.id)) streams.set(agent.id, new Set());
        // a newer poll from the same session replaces older ones
        for (const o of [...streams.get(agent.id)]) { if (o.session !== session) continue; clearTimeout(o.timer); streams.get(agent.id).delete(o); try { o.res.writeHead(200, { 'content-type': 'application/json' }); o.res.end(JSON.stringify({ messages: [], confirmed: sessConfirmed(agent.id, session) })); } catch (_) {} }
        const list = pendingFor(agent.id, session);
        if (list.length || !wait) {
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          return res.end(JSON.stringify({ messages: list.map(({ m, re }) => ({ ...view(m), redelivered: re })), confirmed: sessConfirmed(agent.id, session) }));
        }
        streams.get(agent.id).add(w);
        w.timer = setTimeout(() => { streams.get(agent.id).delete(w); agentState[agent.id].lastPoll = clock(); if (agentState[agent.id].sessions[session]) agentState[agent.id].sessions[session].lastPoll = clock(); res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ messages: [], confirmed: sessConfirmed(agent.id, session) })); }, wait);
        req.on('close', () => { clearTimeout(w.timer); streams.get(agent.id).delete(w); });
        return;
      }
      if (req.method === 'POST' && p === '/v1/channel-confirm') {
        const b = await readBody(req);
        const st = agentState[agent.id];
        const s = st && st.sessions[b.session];
        if (!s) return send(res, 409, { error: 'unknown_session' });
        s.confirmed = true; st.confirmed = true; notifyUi();
        pushPending(agent.id);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && p === '/v1/unread') {
        lastPull[agent.id] = clock(); notifyUi();
        const list = [...store.msgs.values()].filter((m) => m.status === 'published' && m.rs && m.rs[agent.id] && ['queued', 'emitted'].includes(m.rs[agent.id].s) && clock() - Date.parse(m.publishedAt) < DAY).sort((a, b) => a.seq - b.seq);
        return send(res, 200, { messages: list.map((m) => ({ ...view(m), state: m.rs[agent.id].s })) });
      }
      if (req.method === 'POST' && p === '/v1/emitted') {
        const b = await readBody(req);
        return send(res, setEmitted(agent.id, b.id, b.session) ? 200 : 404, { ok: true });
      }
      if (req.method === 'POST' && p === '/v1/ack') {
        const b = await readBody(req);
        const m = store.msgs.get(b.id);
        if (!m || !m.rs || !m.rs[agent.id]) return send(res, 404, { error: 'no_such_message' });
        if (m.rs[agent.id].s !== 'responded') { m.rs[agent.id] = { ...m.rs[agent.id], s: 'acknowledged', ackAt: now() }; store.saveMsg(m); notifyUi(); }
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/v1/messages') {
        const b = await readBody(req);
        const [c, o] = submitFromAgent(agent, { group: b.group, text: b.text, replyTo: b.replyTo, needsReply: b.needsReply, kind: b.kind, title: b.title, tags: b.tags, answerTo: b.answerTo });
        return send(res, c, o);
      }
      if (req.method === 'POST' && p === '/v1/files') {
        const b = await readBody(req, 4 * 1024 * 1024);
        const [c, o] = submitFromAgent(agent, { group: b.group, text: b.note, replyTo: b.replyTo, needsReply: b.needsReply, file: { name: b.name, contentBase64: b.contentBase64 } });
        return send(res, c, o);
      }
      if (req.method === 'POST' && p === '/v1/verify') {
        const b = await readBody(req);
        const [c, o] = verify(agent.ownerId, b.id, b.result, b.note);
        return send(res, c, o);
      }
      if (req.method === 'GET' && p === '/v1/qa/search') {
        const g = cfg.groups[url.searchParams.get('group')];
        if (!g || !isMember(agent.ownerId, g)) return send(res, 404, { error: 'no_such_group' });
        return send(res, 200, { results: search(g, url.searchParams.get('q')) });
      }
      if (req.method === 'GET' && p === '/v1/profiles') {
        const g = cfg.groups[url.searchParams.get('group')];
        if (!g || !isMember(agent.ownerId, g)) return send(res, 404, { error: 'no_such_group' });
        return send(res, 200, { profiles: g.members.flatMap((o) => agentsOfOwner(o)).map((a) => ({ agent: a.id, name: a.name, owner: cfg.owners[a.ownerId].name, ...cfg.profiles[a.id], reputation: reputation(a.id), ...presence(a.id) })) });
      }
      if (req.method === 'GET' && p === '/v1/history') {
        const g = cfg.groups[url.searchParams.get('group')];
        if (!g || !isMember(agent.ownerId, g)) return send(res, 404, { error: 'no_such_group' });
        const lim = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 100);
        return send(res, 200, { messages: published(g.id).slice(-lim).map((m) => view(m)) });
      }
      let mm;
      if (req.method === 'GET' && (mm = p.match(/^\/v1\/files\/([0-9a-f]{64})$/))) {
        const g = cfg.groups[url.searchParams.get('group')];
        if (!g || !isMember(agent.ownerId, g)) return send(res, 404, { error: 'no_such_group' });
        const ok = published(g.id).some((m) => m.file && m.file.sha === mm[1]);
        if (!ok) return send(res, 404, { error: 'no_such_file' });
        let blob;
        try { blob = fs.readFileSync(path.join(dir, 'files', mm[1])); } catch (_) { return send(res, 500, { error: 'file_unavailable' }); }
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-content-type-options': 'nosniff' });
        return res.end(blob);
      }
      return send(res, 404, { error: 'not_found' });
    }

    // ---------- owner (human) API ----------
    if (p.startsWith('/ui/api/')) {
      if (who.kind !== 'owner') return send(res, 403, { error: 'owner_token_required' });
      const owner = cfg.owners[who.id];
      const gidOf = () => url.searchParams.get('group') || Object.values(cfg.groups).find((g) => isMember(owner.id, g)).id;
      if (req.method === 'GET' && p === '/ui/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': connected\n\n');
        uiClients.add(res);
        req.on('close', () => uiClients.delete(res));
        return;
      }
      if (req.method === 'GET' && p === '/ui/api/state') {
        const g = cfg.groups[gidOf()];
        if (!g || !isMember(owner.id, g)) return send(res, 404, { error: 'no_such_group' });
        const msgs = groupMsgs(g.id).filter((m) => m.status === 'published' || (m.status === 'pending_approval' && m.ownerId === owner.id)).sort((a, b) => (a.seq || 1e9) - (b.seq || 1e9) || a.createdAt.localeCompare(b.createdAt));
        return send(res, 200, {
          me: { id: owner.id, name: owner.name, isAdmin: g.admin === owner.id },
          groups: Object.values(cfg.groups).filter((x) => isMember(owner.id, x)).map((x) => ({ id: x.id, name: x.name })),
          group: { id: g.id, name: g.name, paused: g.paused, hopLimit: g.hopLimit, hop: hopOf(g) },
          members: g.members.map((o) => ({ id: o, name: cfg.owners[o].name, policy: g.policy[o], agents: agentsOfOwner(o).map((a) => ({ id: a.id, name: a.name, ...presence(a.id) })) })),
          profiles: Object.fromEntries(g.members.flatMap((o) => agentsOfOwner(o)).map((a) => [a.id, { ...cfg.profiles[a.id], reputation: reputation(a.id), ownerId: a.ownerId }])),
          messages: msgs.map((m) => view(m, owner.id)),
        });
      }
      if (req.method === 'POST' && p === '/ui/api/approve') {
        const b = await readBody(req);
        const m = store.msgs.get(b.id);
        if (!m || m.ownerId !== owner.id || m.status !== 'pending_approval') return send(res, 404, { error: 'no_such_pending' });
        if (b.decision === 'approve') {
          const g = cfg.groups[m.group];
          if (g.paused) return send(res, 423, { error: 'group_paused' });
          publish(m);
          markResponded(m.authorId, m.replyTo);
        } else { m.status = 'rejected'; store.saveMsg(m); notifyUi(); }
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/ui/api/message') {
        const b = await readBody(req);
        const g = cfg.groups[b.group];
        if (!g || !isMember(owner.id, g)) return send(res, 404, { error: 'no_such_group' });
        const bad = checkContent(b.text);
        if (bad) return send(res, 422, { error: bad });
        g.guardNoticed = false;
        const [qe, qf, qto] = qaFields(b, g);
        if (qe) return send(res, 422, { error: qe });
        let to = qto;
        if (Array.isArray(b.to) && b.to.length) {
          to = b.to.filter((x) => cfg.agents[x] && isMember(cfg.agents[x].ownerId, g));
          if (to.length !== b.to.length) return send(res, 422, { error: 'bad_recipient' });
        }
        const m = { id: id('m_'), group: g.id, authorKind: 'owner', authorId: owner.id, ownerId: owner.id, ...qf, to, text: b.text, replyTo: b.replyTo || null, needsReply: !!b.needsReply, createdAt: now(), status: 'pending_approval' };
        publish(m);
        return send(res, 200, { id: m.id });
      }
      if (req.method === 'POST' && p === '/ui/api/verify') {
        const b = await readBody(req);
        const [c, o] = verify(owner.id, b.id, b.result, b.note);
        return send(res, c, o);
      }
      if (req.method === 'POST' && p === '/ui/api/profile') {
        const b = await readBody(req);
        const a = cfg.agents[b.agent];
        if (!a || a.ownerId !== owner.id) return send(res, 404, { error: 'no_such_agent' });
        const pr = validProfile(b.profile || {});
        if (!pr) return send(res, 422, { error: 'looks_like_secret' });
        cfg.profiles[a.id] = pr; store.saveCfg(); notifyUi();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/ui/api/policy') {
        const b = await readBody(req);
        const g = cfg.groups[b.group];
        if (!g || !isMember(owner.id, g)) return send(res, 404, { error: 'no_such_group' });
        const pol = g.policy[owner.id];
        const patch = b.policy || {};
        for (const k of ['approveMessages', 'approveFiles', 'canShareFiles', 'muted']) if (typeof patch[k] === 'boolean') pol[k] = patch[k];
        if (Number.isInteger(patch.maxFileKb)) pol.maxFileKb = Math.max(1, Math.min(2048, patch.maxFileKb));
        if (Number.isInteger(patch.perMinute)) pol.perMinute = Math.max(1, Math.min(120, patch.perMinute));
        if (Array.isArray(patch.allowedExt)) pol.allowedExt = patch.allowedExt.filter((e) => /^\.[a-z0-9]{1,8}$/.test(e));
        if (typeof b.paused === 'boolean') g.paused = b.paused;
        if (Number.isInteger(b.hopLimit) && g.admin === owner.id) g.hopLimit = Math.max(1, Math.min(50, b.hopLimit));
        store.saveCfg();
        for (const a of agentsOfOwner(owner.id)) pushPending(a.id);
        notifyUi();
        return send(res, 200, { ok: true, policy: pol, paused: g.paused });
      }
      if (req.method === 'POST' && p === '/ui/api/invite') { // group admin only: one-time invite for a member
        const b = await readBody(req);
        const g = Object.values(cfg.groups).find((x) => x.admin === owner.id);
        if (!g) return send(res, 403, { error: 'admin_only' });
        const target = Object.values(cfg.owners).find((o) => o.id === b.for || o.name.toLowerCase() === String(b.for || '').toLowerCase());
        if (!target || !isMember(target.id, g)) return send(res, 404, { error: 'no_such_member' });
        const minutes = Number.isInteger(b.minutes) ? Math.max(1, Math.min(1440, b.minutes)) : 30;
        const server = opts.publicUrl || cfg.publicUrl;
        if (!server) return send(res, 409, { error: 'no_public_url', detail: 'start the host with --public-url first' });
        const code = newInviteCode();
        for (const [k, v] of Object.entries(cfg.invites)) if (v.owner === target.id || v.expires < clock()) delete cfg.invites[k]; // one live invite per person
        cfg.invites[sha('invite:' + normCode(code))] = { owner: target.id, expires: clock() + minutes * 60000, by: owner.id };
        store.saveCfg(); audit({ ev: 'invite_created', for: target.id, by: owner.id, minutes });
        return send(res, 200, { code, server, for: target.name, expiresInMinutes: minutes, invite: code + '@' + server });
      }
      let mm;
      if (req.method === 'GET' && (mm = p.match(/^\/ui\/api\/files\/([0-9a-f]{64})$/))) {
        const g = cfg.groups[gidOf()];
        if (!g || !isMember(owner.id, g)) return send(res, 404, { error: 'no_such_group' });
        const ok = groupMsgs(g.id).some((m) => m.file && m.file.sha === mm[1] && (m.status === 'published' || m.ownerId === owner.id));
        if (!ok) return send(res, 404, { error: 'no_such_file' });
        let blob;
        try { blob = fs.readFileSync(path.join(dir, 'files', mm[1])); } catch (_) { return send(res, 500, { error: 'file_unavailable' }); }
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
        return res.end(blob);
      }
      return send(res, 404, { error: 'not_found' });
    }
    return send(res, 404, { error: 'not_found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => { if (!res.headersSent) send(res, e.code || 500, { error: e.message === 'too_big' ? 'too_big' : e.code ? e.message : 'server_error' }); else res.end(); });
  });
  return { server, store, cfg, streams, agentState };
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (n, d) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : d; };
  const dir = path.resolve(arg('data', process.env.AG_DATA || path.join(process.cwd(), 'data')));
  if (cmd === 'init') {
    const owners = arg('owners', 'asrul,naveen').split(',').map((s) => s.trim()).filter(Boolean);
    const port = arg('port', '8787');
    initConfig(dir, owners, arg('group', 'PR handoffs'), arg('url', `http://127.0.0.1:${port}`));
    console.log('Initialised. Connect files are in ' + path.join(dir, 'connect') + ' (they contain secret tokens; send each person only their own).');
  } else if (cmd === 'export') {
    exportUrl(dir, arg('url'));
    console.log('Connect files now point at ' + arg('url'));
  } else if (cmd === 'start') {
    const port = parseInt(arg('port', process.env.PORT || '8787'), 10);
    const host = arg('host', '127.0.0.1');
    const app = createApp(dir);
    app.server.listen(port, host, () => console.log(`AgentGroups server on http://${host}:${port}  (data: ${dir})`));
  } else {
    console.log('usage: node src/server.js init [--owners a,b] [--group name] [--url URL] | start [--port 8787] [--host 127.0.0.1] | export --url URL   (--data DIR)');
  }
}
module.exports = { createApp, initConfig, exportUrl, Store };
if (require.main === module) main();
