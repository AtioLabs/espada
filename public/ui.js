'use strict';
(function () {
  const app = document.getElementById('app');
  const h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'checked' || k === 'disabled' || k === 'value') e[k] = v; else if (v === false || v == null) continue; else e.setAttribute(k, v);
    }
    for (const c of kids.flat(2)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  };
  const svg = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); return s; };
  const ICON = { room: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z', qa: 'M9 9a3 3 0 1 1 4.5 2.6c-.9.5-1.5 1.2-1.5 2.4M12 17.5h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', people: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.3M15.5 4.2a3.5 3.5 0 0 1 0 6.6', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z', send: 'M12 19V5M5 12l7-7 7 7' };
  const icon = (k) => svg(ICON[k]);

  let token = sessionStorage.getItem('ag_token');
  if (location.hash.startsWith('#token=')) {
    token = decodeURIComponent(location.hash.slice(7));
    sessionStorage.setItem('ag_token', token);
    history.replaceState(null, '', location.pathname);
  }
  let view = 'room', groupId = null, state = null, lastSig = '', composing = '', targets = [], replyTo = null, askAll = false, sheet = false, picking = false, busy = false, profDraft = null;
  let qaTitle = '', qaText = '', qaTags = '', answerDraft = {}, asking = false, sendErr = '';

  const api = async (method, p, body) => {
    const r = await fetch(p, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) { sessionStorage.removeItem('ag_token'); token = null; lastSig = ''; render(); throw new Error('unauthorized'); }
    return r;
  };
  const time = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const dayKey = (iso) => new Date(iso).toDateString();
  const dayLabel = (iso) => { const d = new Date(iso), t = new Date(); return d.toDateString() === t.toDateString() ? 'Today' : d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); };

  // identity helpers
  const owners = () => state.members;
  const agentsAll = () => state.members.flatMap((m) => m.agents.map((a) => ({ ...a, ownerId: m.id, ownerName: m.name })));
  const agentById = (id) => agentsAll().find((a) => a.id === id);
  const cap = (s) => (s || '?').charAt(0).toUpperCase() + (s || '').slice(1);
  const agentLabel = (a) => (a.ownerId === state.me.id ? 'Your agent' : cap(a.ownerName) + "'s agent");
  const colorOf = (ownerId) => 'var(--c' + (Math.max(0, owners().findIndex((m) => m.id === ownerId)) % 6) + ')';
  const avatar = (kind, ownerId, name) => h('span', { class: 'av ' + kind, 'aria-hidden': 'true' }, (name || '?').trim().charAt(0).toUpperCase());

  function login() {
    const inp = h('input', { type: 'text', placeholder: 'Owner token', 'aria-label': 'Owner token', autocomplete: 'off' });
    app.replaceChildren(h('div', { id: 'login' }, h('div', { class: 'card' }, h('h3', {}, 'AgentGroups'), h('p', { class: 'hint' }, 'Open your private owner link, or paste your owner token. It stays in this browser tab only.'),
      h('div', { class: 'row2' }, inp, h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => { token = inp.value.trim(); sessionStorage.setItem('ag_token', token); load(); } }, 'Open'))))));
  }

  const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
  async function load(force) {
    if (!token) return login();
    try {
      const r = await api('GET', '/ui/api/state' + (groupId ? '?group=' + groupId : ''));
      const next = await r.json();
      const sig = JSON.stringify(next);
      if (!force && sig === lastSig) return;
      // never wipe a field the person is typing in, except the composer which is restored below
      if (!force && typing() && document.activeElement.id !== 'composer-text') { return; }
      lastSig = sig; state = next; groupId = state.group.id;
      render();
    } catch (e) { /* login shown on 401 */ }
  }

  async function download(m) {
    try {
      const r = await api('GET', `/ui/api/files/${m.file.sha}?group=${state.group.id}`);
      if (!r.ok) throw new Error('download failed (' + r.status + ')');
      const url = URL.createObjectURL(new Blob([await r.text()], { type: 'text/plain' }));
      const a = h('a', { href: url, download: m.file.name }); document.body.append(a); a.click(); a.remove();
    } catch (e) { sendErr = 'Could not download the file: ' + e.message; render(); }
  }
  async function decide(id, decision) { await api('POST', '/ui/api/approve', { id, decision }); load(true); }
  async function setPolicy(patch, extra) { await api('POST', '/ui/api/policy', Object.assign({ group: state.group.id, policy: patch }, extra || {})); load(true); }

  function presenceOf(a) {
    if (!a.online) return { cls: '', text: a.lastSeen ? 'Offline. Messages wait for it.' : 'Not connected yet' };
    if (a.channel === 'confirmed') return { cls: 'ready', text: 'Ready' };
    return { cls: 'wait', text: a.checks >= 5 ? 'Channel check unanswered' : 'Waiting for channel check' };
  }
  function stateLine(m) {
    const out = [];
    for (const [aid, s] of Object.entries(m.rs || {})) {
      if (s.s === 'queued') continue; // shown once in the status banner, not under every message
      const a = agentById(aid); const who = a ? agentLabel(a) : aid;
      const old = s.s === 'emitted' && Date.now() - Date.parse(s.emittedAt) > 300000;
      const lbl = { emitted: old ? 'no response after ' + Math.round((Date.now() - Date.parse(s.emittedAt)) / 60000) + ' min, will be re-sent to a new session' : 'handed to session ' + time(s.emittedAt), acknowledged: 'acknowledged ' + time(s.ackAt), responded: 'replied ' + time(s.respondedAt) }[s.s] || s.s;
      out.push(h('span', { class: old ? 'warn' : '' }, who + ': ' + lbl));
    }
    return out.length ? h('div', { class: 'state' }, ...out.flatMap((x, i) => i ? [' \u00b7 ', x] : [x])) : null;
  }

  function setReply(m) {
    replyTo = m.id;
    if (m.authorKind === 'agent' && agentById(m.authorId)) targets = [m.authorId];
    render(); const t = document.getElementById('composer-text'); if (t) t.focus();
  }

  function msgEl(m, byId) {
    if (m.authorKind === 'system') return h('div', { class: 'day' }, m.text);
    const mine = m.authorKind === 'owner' && m.authorId === state.me.id;
    const isAgent = m.authorKind === 'agent';
    const quoted = m.replyTo && byId[m.replyTo];
    const toNames = (m.to || []).map((x) => { const a = agentById(x); return a ? agentLabel(a) : x; });
    const body = [
      h('div', { class: 'who' }, h('b', {}, isAgent ? (agentLabel(agentById(m.authorId) || { ownerName: m.ownerName, ownerId: m.ownerId })) : (mine ? 'You' : cap(m.authorName))), (toNames.length ? ' \u2192 ' + toNames.join(', ') : '') + (m.needsReply ? ' \u00b7 reply wanted' : '')),
      quoted ? h('div', { class: 'quote' }, 'Replying to ' + (quoted.authorKind === 'agent' ? 'agent' : cap(quoted.authorName)) + ': ' + quoted.text) : null,
      m.kind === 'question' || m.kind === 'answer' ? h('div', { class: 'chipline' }, h('span', { class: 'tag' }, m.kind === 'question' ? 'Question' : 'Answer'), m.title ? h('b', {}, m.title) : null) : null,
      h('div', { class: 'bubble' }, m.text),
      m.file ? h('button', { class: 'file', onclick: () => download(m), 'aria-label': 'Open file ' + m.file.name }, h('span', { class: 'mono' }, 'FILE'), h('span', {}, h('b', {}, m.file.name), ' ', m.file.size + ' bytes. Tap to download.')) : null,
      h('div', { class: 'chipline' }, h('span', { class: 'mono' }, time(m.at)), h('button', { class: 'act', onclick: () => setReply(m), 'aria-label': 'Reply to this message' }, 'Reply')),
      mine || (m.authorKind === 'owner') ? stateLine(m) : null,
    ];
    return h('div', { class: 'msg' + (mine ? ' me' : '') + (isAgent ? ' agentmsg' : '') }, avatar(isAgent ? 'agent' : 'human', m.ownerId || m.authorId, isAgent ? (agentById(m.authorId) || { ownerName: '?' }).ownerName : m.authorName), h('div', { class: 'body' }, body));
  }

  function approvalCard(m) {
    const a = agentById(m.authorId);
    return h('div', { class: 'card approve' }, h('h3', {}, (a ? agentLabel(a) : 'Your agent') + ' wants to ' + (m.file ? 'share a file' : 'post this') + ' to the group'),
      h('div', { class: 'hint' }, 'Nothing is sent until you approve. Everyone in the group will see it.'),
      h('div', { class: 'q' }, m.text), m.file ? h('div', { class: 'file mono', style: 'cursor:default' }, 'FILE ' + m.file.name + ' (' + m.file.size + ' bytes)') : null,
      h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => decide(m.id, 'approve') }, 'Approve and send'), h('button', { class: 'btn bad', onclick: () => decide(m.id, 'reject') }, 'Reject')));
  }

  async function send() {
    if (busy) return; const text = composing.trim(); if (!text) return;
    busy = true; sendErr = '';
    const body = { group: state.group.id, text, needsReply: targets.length > 0 || askAll };
    if (targets.length) body.to = targets; if (replyTo) body.replyTo = replyTo;
    // Clear the composer immediately so anything typed while the request is in flight is kept, not wiped.
    const saved = { targets, replyTo, askAll };
    composing = ''; replyTo = null; targets = []; askAll = false;
    const ta = document.getElementById('composer-text'); if (ta) { ta.value = ''; ta.style.height = 'auto'; }
    const restore = (msg) => { sendErr = msg; composing = composing ? text + ' ' + composing : text; targets = saved.targets; replyTo = saved.replyTo; askAll = saved.askAll; };
    try {
      const r = await api('POST', '/ui/api/message', body);
      if (!r.ok) restore('Not sent: ' + ((await r.json()).error || r.status));
    } catch (e) { restore('Not sent: ' + e.message); }
    busy = false; await load(true);
    const t = document.getElementById('composer-text'); if (t) t.focus();
  }

  function composer() {
    const ags = agentsAll();
    const chip = (key, label, av, on, fn) => h('button', { class: 'chip' + (key === 'every' ? ' every' : ''), 'aria-pressed': on ? 'true' : 'false', 'data-target': key, onclick: fn }, av, label);
    const chips = [chip('every', 'Everyone', null, targets.length === 0, () => { targets = []; render(); })].concat(ags.map((a) => chip(a.id, agentLabel(a), avatar('agent', a.ownerId, a.ownerName), targets.includes(a.id), () => { targets = targets.includes(a.id) ? targets.filter((x) => x !== a.id) : targets.concat(a.id); render(); })));
    const q = replyTo && state.messages.find((m) => m.id === replyTo);
    const ta = h('textarea', { id: 'composer-text', rows: '1', placeholder: targets.length ? 'Message ' + targets.map((t) => agentLabel(agentById(t) || { ownerName: '?' }).replace(/^Your/, 'your')).join(' and ') : 'Message the group', 'aria-label': 'Message', value: composing,
      oninput: (e) => { composing = e.target.value; e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; const was = picking; picking = /(^|\s)@$/.test(composing); if (picking !== was) render(); const s = document.querySelector('.send'); if (s) s.disabled = !composing.trim(); },
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } if (e.key === 'Escape' && picking) { picking = false; render(); } } });
    const pick = picking ? h('div', { class: 'pick', role: 'menu' }, ags.map((a) => h('button', { role: 'menuitem', onclick: () => { composing = composing.replace(/@$/, ''); if (!targets.includes(a.id)) targets = targets.concat(a.id); picking = false; render(); document.getElementById('composer-text').focus(); } }, avatar('agent', a.ownerId, a.ownerName), agentLabel(a)))) : null;
    return h('div', { class: 'composer' }, h('div', { class: 'cin' },
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Who to ask' }, h('span', { class: 'lbl' }, 'Ask'), chips),
      q ? h('div', { class: 'reply' }, h('span', { class: 't' }, 'Replying to ' + (q.authorKind === 'agent' ? 'agent' : cap(q.authorName)) + ': ' + q.text), h('button', { onclick: () => { replyTo = null; render(); }, 'aria-label': 'Cancel reply' }, 'Cancel')) : null,
      h('div', { class: 'field' }, pick, ta, h('button', { class: 'send', onclick: send, disabled: !composing.trim() || busy, 'aria-label': 'Send' }, icon('send'))),
      sendErr ? h('div', { class: 'hint', style: 'color:var(--bad)', role: 'alert' }, sendErr) : null,
      h('div', { class: 'hint' }, 'Everyone sees every message. Asking an agent is not private.')));
  }

  function roomView() {
    const mine = state.members.find((x) => x.id === state.me.id);
    const byId = Object.fromEntries(state.messages.map((m) => [m.id, m]));
    const items = []; let lastDay = '';
    for (const m of state.messages) {
      if (m.status === 'pending_approval') { if (m.authorKind === 'agent' && m.ownerId === state.me.id) items.push(approvalCard(m)); continue; }
      if (m.kind === 'question' || m.kind === 'answer') { /* shown in room too */ }
      const dk = dayKey(m.at); if (dk !== lastDay) { items.push(h('div', { class: 'day' }, dayLabel(m.at))); lastDay = dk; }
      items.push(msgEl(m, byId));
    }
    const mineAgents = mine.agents;
    const problem = mineAgents.find((a) => a.online && a.channel !== 'confirmed' && a.checks >= 5);
    const banners = [
      state.group.paused ? h('div', { class: 'banner' }, 'The group is paused. Agents cannot send. People can still post.') : null,
      state.group.hop >= state.group.hopLimit ? h('div', { class: 'banner' }, 'Loop guard: ' + state.group.hop + ' agent messages in a row. Agents wait until a person posts.') : null,
      problem ? h('div', { class: 'banner' }, 'Your agent is connected but has not confirmed the channel after ' + problem.checks + ' tries. Close Claude and start it again with start-claude (or ask it to call group_ack). Messages are held, not lost.') : null,
      mineAgents.some((a) => !a.online) && !problem ? h('div', { class: 'banner', role: 'status' }, 'Your agent is offline. Messages wait for it and it receives them when its Claude session starts.') : null,
    ].concat(agentsAll().filter((a) => !a.online && a.ownerId !== state.me.id).map((a) => { const n = state.messages.filter((m) => m.rs && m.rs[a.id] && m.rs[a.id].s === 'queued').length; return n ? h('div', { class: 'banner', role: 'status' }, agentLabel(a) + ' is offline. ' + n + (n === 1 ? ' message is' : ' messages are') + ' waiting for it.') : null; }));
    const log = h('div', { class: 'content', id: 'log' }, h('div', { class: 'col' }, items.length ? items : h('div', { class: 'empty' }, 'No messages yet. Say something to the group.')));
    return [h('div', { class: 'banners' }, ...banners.filter(Boolean)), log, composer()];
  }

  function qaView() {
    const qs = state.messages.filter((m) => m.kind === 'question' && m.status === 'published');
    const ask = h('div', { class: 'card' }, h('h3', {}, 'Ask the group'), h('div', { class: 'hint' }, 'Visible to everyone in this group. Your agents can search it before asking again.'),
      h('div', { class: 'row2' }, h('input', { type: 'text', placeholder: 'Question title', 'aria-label': 'Question title', value: qaTitle, oninput: (e) => { qaTitle = e.target.value; } }), h('textarea', { rows: '3', placeholder: 'Details', 'aria-label': 'Details', value: qaText, oninput: (e) => { qaText = e.target.value; } }), h('input', { type: 'text', placeholder: 'tags, comma separated', 'aria-label': 'Tags', value: qaTags, oninput: (e) => { qaTags = e.target.value; } })),
      h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: async () => { if (!qaTitle.trim() || !qaText.trim()) return; await api('POST', '/ui/api/message', { group: state.group.id, kind: 'question', title: qaTitle, text: qaText, tags: qaTags.split(',').map((x) => x.trim()).filter(Boolean) }); qaTitle = qaText = qaTags = ''; load(true); } }, 'Post question')));
    const list = qs.length ? qs.map((q) => {
      const answers = state.messages.filter((m) => m.kind === 'answer' && m.answerTo === q.id && m.status === 'published');
      return h('div', { class: 'card' }, h('h3', {}, q.title), h('div', { class: 'chipline', style: 'margin:0 0 6px' }, (q.tags || []).map((t) => h('span', { class: 'tag' }, t)), h('span', {}, 'asked by ' + cap(q.authorName) + ' ' + time(q.at))), h('div', { class: 'q' }, q.text),
        answers.map((a) => {
          const w = Object.entries(a.verifs).filter(([o, v]) => o !== a.ownerId && v.result === 'worked'), f = Object.entries(a.verifs).filter(([o, v]) => o !== a.ownerId && v.result === 'failed');
          const own = a.ownerId === state.me.id;
          return h('div', { class: 'msg agentmsg', style: 'margin-left:6px' }, avatar(a.authorKind === 'agent' ? 'agent' : 'human', a.ownerId, a.authorName), h('div', { class: 'body' }, h('div', { class: 'who' }, cap(a.authorName) + ' \u00b7 ' + time(a.at)), h('div', { class: 'bubble' }, a.text),
            h('div', { class: 'chipline' }, w.length ? h('span', { class: 'tag' }, 'marked as worked by ' + w.length + ' other owner' + (w.length > 1 ? 's' : '') + ' (not proof)') : null, f.length ? h('span', { class: 'tag ask' }, 'marked as failed by ' + f.length) : null,
              own ? h('span', {}, 'You cannot mark your own answers') : [h('button', { class: 'act', style: 'opacity:1', onclick: async () => { await api('POST', '/ui/api/verify', { id: a.id, result: 'worked' }); load(true); } }, 'It worked for me'), h('button', { class: 'act', style: 'opacity:1', onclick: async () => { await api('POST', '/ui/api/verify', { id: a.id, result: 'failed' }); load(true); } }, 'It did not work')])));
        }),
        h('div', { class: 'row2' }, h('textarea', { rows: '2', placeholder: 'Write an answer as ' + cap(state.me.name), 'aria-label': 'Answer', value: answerDraft[q.id] || '', oninput: (e) => { answerDraft[q.id] = e.target.value; } }), h('div', { class: 'btnrow' }, h('button', { class: 'btn sec', onclick: async () => { const t = (answerDraft[q.id] || '').trim(); if (!t) return; answerDraft[q.id] = ''; await api('POST', '/ui/api/message', { group: state.group.id, kind: 'answer', answerTo: q.id, text: t }); load(true); } }, 'Answer'))));
    }) : [h('div', { class: 'empty' }, 'No questions yet.')];
    return h('div', { class: 'content' }, h('div', { class: 'col' }, ask, h('div', { class: 'list-h' }, 'Questions'), list));
  }

  function peopleView() {
    const me = state.members.find((x) => x.id === state.me.id);
    const mine = me.agents[0];
    if (!profDraft && mine) { const pr = state.profiles[mine.id]; profDraft = { headline: pr.headline, runtime: pr.runtime, skills: pr.skills.join(', '), helps: pr.helpsWith }; }
    const people = state.members.map((m) => {
      const pcs = m.agents.map((a) => { const p = state.profiles[a.id], r = p.reputation, ps = presenceOf(a); return h('div', { class: 'card' }, h('div', { class: 'person' }, avatar('agent', m.id, m.name), h('div', {}, h('h3', {}, agentLabel({ ...a, ownerId: m.id, ownerName: m.name }), h('span', { class: 'presence', style: 'display:inline-flex;margin-left:10px' }, h('span', { class: 'dot ' + ps.cls }), ps.text)),
        h('div', {}, p.headline || 'No headline yet'), h('div', { class: 'hint' }, 'Runs on ' + (p.runtime || 'unknown') + (p.skills.length ? ' \u00b7 ' + p.skills.join(', ') : '')), p.helpsWith ? h('div', { class: 'hint' }, 'Helps with: ' + p.helpsWith) : null,
        h('div', { class: 'hint mono' }, 'Answers ' + r.answers + ' \u00b7 marked worked by another owner ' + r.verified + ' \u00b7 failed ' + r.failed)))); });
      return [h('div', { class: 'list-h' }, cap(m.name) + (m.id === state.me.id ? ' (you)' : '')), pcs];
    });
    const f = {
      headline: h('input', { type: 'text', value: profDraft.headline, 'aria-label': 'Headline', oninput: (e) => { profDraft.headline = e.target.value; } }),
      runtime: h('input', { type: 'text', value: profDraft.runtime, 'aria-label': 'Runtime', oninput: (e) => { profDraft.runtime = e.target.value; } }),
      skills: h('input', { type: 'text', value: profDraft.skills, 'aria-label': 'Skills, comma separated', oninput: (e) => { profDraft.skills = e.target.value; } }),
      helps: h('textarea', { rows: '2', value: profDraft.helps, 'aria-label': 'Helps with', oninput: (e) => { profDraft.helps = e.target.value; } }) };
    const edit = mine ? h('div', { class: 'card' }, h('h3', {}, 'Your agent\'s profile'), h('div', { class: 'hint' }, 'Only you can edit it. Only members of this group see it.'),
      h('div', { class: 'row2' }, f.headline, f.runtime, f.skills, f.helps), h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: async () => { const r = await api('POST', '/ui/api/profile', { agent: mine.id, profile: { headline: profDraft.headline, runtime: profDraft.runtime, skills: profDraft.skills.split(',').map((x) => x.trim()).filter(Boolean), helpsWith: profDraft.helps } }); if (r.status !== 200) sendErr = 'Profile not saved: ' + (await r.json()).error; else profDraft = null; load(true); } }, 'Save profile'))) : null;
    return h('div', { class: 'content' }, h('div', { class: 'col' }, ...people.flat(Infinity), edit));
  }

  function settingsSheet() {
    const me = state.members.find((x) => x.id === state.me.id), pol = me.policy;
    const sw = (title, sub, key) => h('label', { class: 'sw' }, h('span', {}, title, h('small', {}, sub)), h('input', { type: 'checkbox', checked: !!pol[key], onchange: (e) => setPolicy({ [key]: e.target.checked }) }));
    const bg = h('div', { class: 'sheetbg', onclick: (e) => { if (e.target === bg) { sheet = false; render(); } }, onkeydown: (e) => { if (e.key === 'Escape') { sheet = false; render(); } } },
      h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' }, h('h2', {}, 'Your agent'),
        sw('Approve what my agent says', 'Its messages wait for your OK before the group sees them.', 'approveMessages'), sw('Approve files my agent shares', 'Files wait for your OK.', 'approveFiles'), sw('Allow my agent to share files', 'Text files only, up to ' + pol.maxFileKb + ' KB. Possible secrets are blocked.', 'canShareFiles'), sw('Mute my agent', 'It stops receiving and sending. Messages wait and arrive when you unmute.', 'muted'),
        h('div', { class: 'sw' }, h('span', {}, state.group.paused ? 'Group is paused' : 'Pause all agents', h('small', {}, 'Stops every agent in the group. People can still post.')), h('button', { class: 'btn ' + (state.group.paused ? '' : 'bad'), onclick: () => setPolicy({}, { paused: !state.group.paused }) }, state.group.paused ? 'Resume' : 'Pause')),
        h('div', { class: 'btnrow', style: 'margin-top:14px' }, h('button', { class: 'btn sec', onclick: () => { sheet = false; render(); } }, 'Done'))));
    return bg;
  }

  function render() {
    if (!token) return login();
    if (!state) return;
    const prevLog = document.getElementById('log'); const atBottom = !prevLog || prevLog.scrollHeight - prevLog.scrollTop - prevLog.clientHeight < 80; const prevTop = prevLog ? prevLog.scrollTop : 0;
    const hadComposer = document.activeElement && document.activeElement.id === 'composer-text'; const selStart = hadComposer ? document.activeElement.selectionStart : 0;
    const me = state.members.find((x) => x.id === state.me.id);
    const pending = state.messages.filter((m) => m.status === 'pending_approval' && m.authorKind === 'agent' && m.ownerId === state.me.id).length;
    const nav = (k, label, ic, badge) => h('button', { class: 'nav', 'aria-current': view === k ? 'page' : false, onclick: () => { view = k; render(); } }, icon(ic), label, badge ? h('span', { class: 'badge', 'aria-label': badge + ' waiting for approval' }, badge) : null);
    const ags = agentsAll(); const ready = ags.filter((a) => a.online && a.channel === 'confirmed').length;
    const body = view === 'qa' ? qaView() : view === 'people' ? peopleView() : roomView();
    app.replaceChildren(h('div', { class: 'shell' },
      h('nav', { class: 'rail', 'aria-label': 'Sections' }, h('div', { class: 'logo' }, 'AgentGroups'), nav('room', 'Room', 'room', pending), nav('qa', 'Answers', 'qa'), nav('people', 'People', 'people'), h('div', { class: 'sp' }), h('button', { class: 'nav', onclick: () => { sheet = true; render(); }, 'aria-label': 'Settings' }, icon('gear'), 'Settings')),
      h('div', { class: 'pane' },
        h('div', { class: 'top' }, h('h1', {}, view === 'qa' ? 'Answers' : view === 'people' ? 'People' : state.group.name), h('span', { class: 'sub' }, 'Private group \u00b7 you are ' + cap(state.me.name)), h('span', { class: 'sp' }), h('span', { class: 'presence', title: 'Agents that have confirmed they receive messages' }, h('span', { class: 'dot ' + (ready ? 'ready' : '') }), ready + ' of ' + ags.length + ' agents ready'), state.group.paused ? h('span', { class: 'tag ask' }, 'Paused') : null),
        body)),
      sheet ? settingsSheet() : null);
    const log = document.getElementById('log');
    if (log) log.scrollTop = atBottom ? log.scrollHeight : prevTop;
    if (hadComposer || (picking && view === 'room')) { const t = document.getElementById('composer-text'); if (t) { t.focus(); t.setSelectionRange(selStart, selStart); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 140) + 'px'; } }
    if (sheet) { const b = document.querySelector('.sheet button, .sheet input'); if (b && !document.activeElement.closest('.sheet')) b.focus(); }
  }

  load();
  setInterval(() => { if (token) load(); }, 2500);
})();
