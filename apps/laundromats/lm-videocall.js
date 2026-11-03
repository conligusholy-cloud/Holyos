// Laundromats — videohovor s kompetentní osobou (laundromats.eu/videocall).
// Návštěvník požádá o hovor → HolyOS upozorní Jana a Tomáše (Velín push + zvonek v HolyOS) odkazem
// /videocall/agent/:room?k=… → kdo otevře první, hovor přijme. Video/zvuk přes WebRTC (prohlížeč:
// iOS Safari, Android Chrome, Windows/Mac – bez instalace), signalizace a chat přes SSE + POST
// (bez WebSocketů, jen Express). TURN servery (Twilio) dodává HolyOS, aby spojení prošlo i přes mobilní sítě.
'use strict';
const crypto = require('crypto');
const path = require('path');
const jwt = require('jsonwebtoken');
const { layout, esc } = require('./lm-layout');

module.exports = function mountVideocall(app, ctx) {
  const { HOLYOS_URL, LM_SECRET, rateLimited, render, trackServer } = ctx;
  const rooms = new Map(); // id → room
  const now = () => Date.now();
  // úklid: neaktivní místnosti po 3 h
  setInterval(() => { const lim = now() - 3 * 3600e3; for (const [id, r] of rooms) if (r.touched < lim) { closeAll(r); rooms.delete(id); } }, 10 * 60e3).unref();

  async function hos(method, p, body) {
    const token = jwt.sign({ aud: 'holyos-api', iss: 'laundromats' }, LM_SECRET, { expiresIn: '1m' });
    const r = await fetch(HOLYOS_URL + '/api/auth/lm/vc' + p, { method, headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    return r.json().catch(() => ({}));
  }
  function push(r, role, msg) { // role = komu ('visitor' | 'agent' | 'all')
    const data = 'data: ' + JSON.stringify(msg) + '\n\n';
    for (const c of r.clients) if (role === 'all' || c.role === role) { try { c.res.write(data); } catch (e) { /* odpojený */ } }
  }
  function closeAll(r) { for (const c of r.clients) { try { c.res.end(); } catch (e) {} } r.clients.clear(); }
  function auth(r, role, k) {
    if (!r) return null;
    if (role === 'visitor') return k && k === r.vkey ? { role, name: r.visitor.name } : null;
    if (role === 'agent') { try { const t = jwt.verify(String(k || ''), LM_SECRET, { audience: 'lm-vc-agent', issuer: 'holyos' }); return t.room === r.id ? { role, name: t.name || 'Best Series', pid: t.pid } : null; } catch (e) { return null; } }
    return null;
  }
  const pub = (r) => ({ id: r.id, status: r.status, agent: r.agent ? r.agent.name : null, visitor: { name: r.visitor.name }, msgs: r.msgs.slice(-200), vready: r.vready });
  const json = require('express').json({ limit: '200kb' });

  // ── ICE servery (STUN/TURN) z HolyOS, cache 1 h ──
  let ice = { at: 0, data: null };
  app.get('/api/vc/ice', async (req, res) => {
    if (rateLimited('vcice:' + req.ip, 60, 3600e3)) return res.status(429).json({});
    try { if (!ice.data || now() - ice.at > 3600e3) { const j = await hos('GET', '/ice'); if (j && Array.isArray(j.iceServers)) ice = { at: now(), data: j.iceServers }; } } catch (e) { /* záloha níž */ }
    res.set('Cache-Control', 'no-store').json({ iceServers: ice.data || [{ urls: ['stun:stun.l.google.com:19302'] }] });
  });

  // ── návštěvník: žádost o hovor ──
  app.post('/api/vc/start', json, async (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true, room: 'x', key: 'x' });
    if (rateLimited('vcstart:' + req.ip, 6, 3600e3)) return res.status(429).json({ ok: false, error: 'Příliš mnoho pokusů, zkuste to prosím později.' });
    const name = String(b.name || (req.account && req.account.name) || '').trim().slice(0, 120);
    if (name.length < 2) return res.status(400).json({ ok: false, error: 'Vyplňte prosím své jméno.' });
    const phone = String(b.phone || (req.account && req.account.phone) || '').trim().slice(0, 40), email = String(b.email || (req.account && req.account.email) || '').trim().slice(0, 160), note = String(b.note || '').trim().slice(0, 300);
    const id = crypto.randomBytes(10).toString('hex'), vkey = crypto.randomBytes(16).toString('hex');
    const r = { id, vkey, created: now(), touched: now(), status: 'waiting', agent: null, vready: false, visitor: { name, phone, email, note }, msgs: [], clients: new Set(), lead_id: req.account && req.account.lead_id };
    if (note) r.msgs.push({ from: 'visitor', name, text: note, at: now() });
    rooms.set(id, r);
    try { const j = await hos('POST', '/notify', { room: id, name, phone, email, note, lead_id: r.lead_id }); r.notified = (j && j.notified) || []; } catch (e) { console.warn('[lm-vc] notify:', e.message); r.notified = []; }
    if (trackServer) trackServer(req, 'videocall_request', { room: id });
    res.json({ ok: true, room: id, key: vkey, notified: r.notified.length });
  });

  // ── události (SSE) ──
  app.get('/api/vc/:room([a-f0-9]{20})/events', (req, res) => {
    const r = rooms.get(req.params.room); const who = auth(r, String(req.query.role), req.query.k);
    if (!who) return res.status(403).end();
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders && res.flushHeaders();
    const c = { role: who.role, res }; r.clients.add(c); r.touched = now();
    res.write('data: ' + JSON.stringify({ type: 'state', room: pub(r) }) + '\n\n');
    const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch (e) {} }, 20000);
    req.on('close', () => { clearInterval(hb); r.clients.delete(c); push(r, who.role === 'agent' ? 'visitor' : 'agent', { type: 'peer_offline', role: who.role }); });
    push(r, who.role === 'agent' ? 'visitor' : 'agent', { type: 'peer_online', role: who.role });
  });

  // ── odeslání: chat / signalizace / stav ──
  app.post('/api/vc/:room([a-f0-9]{20})/send', json, (req, res) => {
    const b = req.body || {}; const r = rooms.get(req.params.room); const who = auth(r, String(b.role), b.k);
    if (!who) return res.status(403).json({ ok: false });
    if (rateLimited('vcsend:' + req.ip, 600, 60000)) return res.status(429).json({ ok: false });
    r.touched = now(); const other = who.role === 'agent' ? 'visitor' : 'agent';
    if (b.type === 'chat') {
      const text = String(b.text || '').trim().slice(0, 2000); if (!text) return res.json({ ok: true });
      const m = { from: who.role, name: who.name, text, at: now() }; r.msgs.push(m); if (r.msgs.length > 500) r.msgs.shift();
      push(r, 'all', { type: 'chat', msg: m });
    } else if (b.type === 'signal') {
      push(r, other, { type: 'signal', data: b.data });
    } else if (b.type === 'join' && who.role === 'agent') {
      if (r.agent && r.agent.name !== who.name) return res.json({ ok: false, taken: r.agent.name });
      r.agent = { name: who.name, pid: who.pid, at: now() }; r.status = 'active';
      push(r, 'all', { type: 'state', room: pub(r) });
      if (trackServer) trackServer({ headers: {}, path: '/videocall', ip: '', account: r.lead_id ? { id: 0, lead_id: r.lead_id } : null }, 'videocall_answered', { room: r.id, by: who.name });
      // ostatním upozorněným: hovor už přijal X (zvonek v HolyOS zůstává, push netřeba)
    } else if (b.type === 'ready' && who.role === 'visitor') {
      r.vready = { video: !!b.video, audio: !!b.audio, at: now() };
      push(r, 'agent', { type: 'visitor_ready', media: r.vready });
    } else if (b.type === 'hangup') {
      r.status = 'ended'; push(r, 'all', { type: 'hangup', by: who.role, name: who.name });
    } else if (b.type === 'media') {
      push(r, other, { type: 'peer_media', video: !!b.video, audio: !!b.audio });
    }
    res.json({ ok: true });
  });

  app.get('/videocall/vc.js', (req, res) => res.set('Cache-Control', 'no-cache').type('application/javascript').sendFile(path.join(__dirname, 'videocall-client.js')));

  const CSS = `<style>
  .vc-wrap{max-width:980px;margin:0 auto}
  .vc-stage{position:relative;aspect-ratio:16/9;background:radial-gradient(ellipse at 50% 40%,rgba(79,209,255,.12),rgba(4,8,16,.95) 70%);border:1px solid var(--border);border-radius:20px;overflow:hidden}
  @media(max-width:640px){.vc-stage{aspect-ratio:3/4}}
  .vc-stage video.rem{width:100%;height:100%;object-fit:cover;display:block;background:#000}
  .vc-stage video.loc{position:absolute;right:12px;bottom:12px;width:26%;max-width:220px;aspect-ratio:3/4;object-fit:cover;border-radius:14px;border:2px solid rgba(255,255,255,.25);background:#111;transform:scaleX(-1);box-shadow:0 10px 30px rgba(0,0,0,.6)}
  .vc-ph{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;gap:10px;color:var(--text2)}
  .vc-ph .big{font-size:22px;font-weight:800;color:var(--text)}
  .vc-pulse{width:74px;height:74px;border-radius:50%;background:linear-gradient(135deg,#1e86e0,#7c5cff);display:grid;place-items:center;box-shadow:0 0 0 0 rgba(79,209,255,.6);animation:vcp 1.8s infinite}
  @keyframes vcp{0%{box-shadow:0 0 0 0 rgba(79,209,255,.55)}70%{box-shadow:0 0 0 26px rgba(79,209,255,0)}100%{box-shadow:0 0 0 0 rgba(79,209,255,0)}}
  .vc-bar{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;gap:10px;padding:12px;background:linear-gradient(transparent,rgba(0,0,0,.55))}
  .vc-bar button{width:52px;height:52px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(15,25,45,.8);color:#fff;font-size:20px;cursor:pointer}
  .vc-bar button.off{background:#ff5d6c;border-color:#ff5d6c}.vc-bar button.end{background:#e5394a;border-color:#e5394a;width:64px;border-radius:26px}
  .vc-tag{position:absolute;left:12px;top:12px;padding:5px 11px;border-radius:999px;background:rgba(0,0,0,.5);font-size:13px;color:#fff}
  .vc-ov{position:fixed;inset:0;z-index:9000;background:rgba(2,5,12,.82);display:flex;align-items:center;justify-content:center;padding:18px}
  .vc-ov .card{max-width:440px;width:100%;text-align:center}.vc-ov .btn{width:100%;justify-content:center;margin-top:10px}
  .vc-chat{margin-top:14px}.vc-msgs{height:240px;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:4px 2px 8px}
  .vc-m{max-width:78%;padding:9px 12px;border-radius:14px;font-size:14.5px;line-height:1.4;background:rgba(120,160,255,.1);border:1px solid var(--border);align-self:flex-start;white-space:pre-wrap;word-wrap:break-word}
  .vc-m.me{align-self:flex-end;background:linear-gradient(135deg,rgba(30,134,224,.35),rgba(124,92,255,.35));border-color:rgba(79,209,255,.35)}
  .vc-m small{display:block;font-size:11px;color:var(--text3);margin-bottom:2px}
  .vc-sys{align-self:center;font-size:12.5px;color:var(--text3)}
  .vc-in{display:flex;gap:8px}.vc-in input{flex:1}
  </style>`;
  const stage = (role) => `<div class="vc-stage" id="vc-stage"><video class="rem" id="vc-rem" playsinline autoplay></video><video class="loc" id="vc-loc" playsinline autoplay muted style="display:none"></video>
    <div class="vc-ph" id="vc-ph">${role === 'agent' ? '<div class="big">Připojte se k hovoru</div><div>Zákazník čeká na druhé straně.</div>' : '<div class="vc-pulse">🎥</div><div class="big">Spojujeme vás…</div><div>Za chvíli se připojí kompetentní osoba. Mezitím nám můžete napsat do chatu pod oknem.</div>'}</div>
    <span class="vc-tag" id="vc-tag" style="display:none"></span>
    <div class="vc-bar" id="vc-bar" style="display:none"><button id="vc-mic" title="Mikrofon">🎙️</button><button id="vc-cam" title="Kamera">📷</button><button id="vc-flip" title="Přepnout kameru" style="display:none">🔄</button><button class="end" id="vc-end" title="Ukončit hovor">📞</button></div></div>
    <div class="card vc-chat"><div class="vc-msgs" id="vc-msgs"></div><form class="vc-in" id="vc-form"><input id="vc-text" maxlength="2000" autocomplete="off" placeholder="Napište zprávu… (když se neslyšíme nebo nevidíme)"><button class="btn" type="submit">Odeslat</button></form></div>`;

  // ── stránka návštěvníka ──
  app.get('/videocall', (req, res) => {
    const a = req.account || {};
    const body = CSS + `<div class="vc-wrap"><div class="hero" style="padding-bottom:8px"><span class="eyebrow"><i></i>Videohovor</span><h1>Spojte se s <span class="g">kompetentní osobou</span></h1><p>Probereme váš záměr přímo s námi – přes kameru, nebo jen hlasem či chatem. Funguje v telefonu i v počítači, nic neinstalujete.</p></div>
      <form class="card" id="vc-start" style="max-width:560px">
        <label>Jméno a příjmení<input name="name" required maxlength="120" autocomplete="name" value="${esc(a.name || '')}"></label>
        <label>Telefon (pro případ, že by se spojení přerušilo)<input name="phone" type="tel" maxlength="40" autocomplete="tel" value="${esc(a.phone || '')}"></label>
        <label>S čím vám můžeme pomoci? (nepovinné)<input name="note" maxlength="300" placeholder="např. vlastní prádlomat, lokalita, financování…"></label>
        <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
        <button class="btn" type="submit" style="width:100%;justify-content:center;margin-top:16px">🎥 Spojit se teď</button>
        <p class="small muted" style="margin:10px 0 0">Kameru a mikrofon zapnete až ve chvíli, kdy se k hovoru připojíme – prohlížeč se vás na ně zeptá.</p>
        <div class="msg err" id="vc-err" style="display:none"></div></form>
      <div id="vc-call" style="display:none">${stage('visitor')}</div></div>
      <script>window.VC={role:'visitor'};</script><script src="/videocall/vc.js"></script>`;
    res.set('Cache-Control', 'no-store').type('html').send(render(req, layout({ title: 'Videohovor', desc: 'Spojte se s námi videohovorem', body })));
  });

  // ── stránka Jana / Tomáše (odkaz z notifikace) ──
  app.get('/videocall/agent/:room([a-f0-9]{20})', (req, res) => {
    const r = rooms.get(req.params.room); const who = auth(r, 'agent', req.query.k);
    let body;
    if (!r) body = '<div class="card" style="max-width:520px;margin:40px auto"><h1>Hovor už není aktivní</h1><p class="muted">Zákazník odešel nebo hovor skončil.</p></div>';
    else if (!who) body = '<div class="card" style="max-width:520px;margin:40px auto"><h1>Odkaz neplatí</h1><p class="muted">Otevřete hovor znovu z notifikace ve Velínu nebo v HolyOS.</p></div>';
    else {
      const v = r.visitor;
      body = CSS + `<div class="vc-wrap"><div class="row" style="justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px;margin:10px 0 12px"><div><div class="small muted">Videohovor z laundromats.eu</div><h1 style="margin:2px 0">${esc(v.name)}</h1><div class="muted">${[v.phone ? '<a href="tel:' + esc(v.phone) + '">' + esc(v.phone) + '</a>' : '', v.email ? esc(v.email) : '', r.lead_id ? 'kontakt #' + r.lead_id : ''].filter(Boolean).join(' · ')}</div></div>
        <button class="btn" id="vc-join">🎥 Připojit se s kamerou</button></div>
        ${stage('agent')}</div>
        <script>window.VC={role:'agent',room:${JSON.stringify(r.id)},k:${JSON.stringify(String(req.query.k))},me:${JSON.stringify(who.name)}};</script><script src="/videocall/vc.js"></script>`;
    }
    res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').type('html').send(render(req, layout({ title: 'Videohovor – ' + (r ? r.visitor.name : ''), body })));
  });
};
