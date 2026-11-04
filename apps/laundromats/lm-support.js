// Laundromats — Podpora Laundromats (chat přihlášeného uživatele s podporou). Data žijí v HolyOS
// (lm_support_messages, /api/auth/lm/support/*), odpovídá se z administrace (/admin/meetings → Podpora)
// nebo z Velínu (aplikace LM podpora). Nezávislé na podpoře BS2.
'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const { layout, esc } = require('./lm-layout');

module.exports = function mountSupport(app, ctx) {
  const { HOLYOS_URL, LM_SECRET, requireAccount, requireAdmin, render } = ctx;
  const BASE = '/api/auth/lm/support';
  const tok = () => jwt.sign({ aud: 'holyos-api', iss: 'laundromats' }, LM_SECRET, { expiresIn: '1m' });
  async function hos(method, p, body, raw) {
    if (!LM_SECRET) { const e = new Error('Chybí LM_SSO_SECRET'); e.status = 500; throw e; }
    const r = await fetch(HOLYOS_URL + BASE + p, { method, headers: Object.assign({ Authorization: 'Bearer ' + tok() }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    if (raw) return r;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || ('Podpora ' + r.status)); e.status = r.status >= 500 ? 502 : r.status; throw e; }
    return j;
  }
  const J = (fn) => (req, res) => Promise.resolve(fn(req, res)).then((j) => res.set('Cache-Control', 'no-store').json(j)).catch((e) => res.status(e.status || 502).json({ error: e.message || 'Podpora je dočasně nedostupná.' }));
  const big = express.json({ limit: '15mb' });
  const pipeFile = async (res, r) => {
    if (!r.ok) return res.status(404).end();
    ['content-type', 'content-disposition'].forEach((h) => { const v = r.headers.get(h); if (v) res.set(h, v); });
    res.set('X-Content-Type-Options', 'nosniff').set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; sandbox").set('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(await r.arrayBuffer()));
  };

  // ── Uživatel ──
  app.get('/cesta/podpora', requireAccount, (req, res) => {
    const body = req.account ? PAGE(req.account) : `<div class="card" style="max-width:560px;margin:30px auto"><h1 style="margin-top:0">Podpora Laundromats</h1><p class="muted">Jste přihlášen jako správce. Konverzace s uživateli najdete v <a href="/admin/meetings">administraci → Podpora</a> nebo ve Velínu v aplikaci LM podpora.</p></div>`;
    res.status(200).set('Cache-Control', 'no-store').type('html').send(render(req, layout({ title: 'Podpora Laundromats', body })));
  });
  app.get('/api/cesta/support/state', requireAccount, J(async (req) => {
    if (!req.account) return { online: false, msgs: [] };
    const a = parseInt(req.query.after, 10);
    return hos('GET', '/user/' + req.account.id + '/state' + (Number.isFinite(a) ? '?after=' + a : ''));
  }));
  app.post('/api/cesta/support/send', requireAccount, big, J(async (req) => {
    if (!req.account) { const e = new Error('Pište prosím z uživatelského účtu.'); e.status = 400; throw e; }
    const b = req.body || {};
    const j = await hos('POST', '/user/' + req.account.id + '/send', { body: String(b.body || '').slice(0, 4000), file: b.file && b.file.data ? { name: String(b.file.name || ''), data: String(b.file.data) } : undefined });
    if (ctx.trackServer) ctx.trackServer(req, 'support_message', {});
    return j;
  }));
  app.get('/cesta/podpora/file/:id(\\d+)', requireAccount, async (req, res) => {
    if (!req.account) return res.status(404).end();
    try { await pipeFile(res, await hos('GET', '/user/' + req.account.id + '/file/' + req.params.id, null, true)); } catch (e) { res.status(502).end(); }
  });

  // ── Administrace ──
  app.get('/admin/api/support/threads', requireAdmin, J(() => hos('GET', '/threads')));
  app.get('/admin/api/support/threads/:id(\\d+)', requireAdmin, J((req) => { const a = parseInt(req.query.after, 10); return hos('GET', '/threads/' + req.params.id + (Number.isFinite(a) ? '?after=' + a : '')); }));
  app.post('/admin/api/support/threads/:id(\\d+)/send', requireAdmin, big, J((req) => { const b = req.body || {}; return hos('POST', '/threads/' + req.params.id + '/send', { body: String(b.body || '').slice(0, 4000), file: b.file && b.file.data ? b.file : undefined, agent_name: (req.admin && req.admin.name) || undefined }); }));
  app.post('/admin/api/support/online', requireAdmin, J((req) => hos('POST', '/online', { online: !!(req.body || {}).online, agent: (req.body || {}).agent })));
  app.get('/admin/support/file/:id(\\d+)', requireAdmin, async (req, res) => { try { await pipeFile(res, await hos('GET', '/file/' + req.params.id, null, true)); } catch (e) { res.status(502).end(); } });

  return { unread: async (accId) => { try { return (await hos('GET', '/user/' + accId + '/unread')).unread || 0; } catch (e) { return 0; } } };
};

function PAGE(acc) {
  return `<style>
.sp-wrap{max-width:760px;margin:10px auto 0}.sp-head{display:flex;align-items:center;gap:12px;margin:0 0 12px}.sp-head h1{margin:0;font-size:26px}
.sp-dot{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text2);border:1px solid var(--border);border-radius:999px;padding:4px 10px}.sp-dot i{width:8px;height:8px;border-radius:50%;background:#64748b}.sp-dot.on i{background:#2fe3a0;box-shadow:0 0 8px #2fe3a0}
.sp-log{height:min(56vh,520px);overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;border-radius:16px}
.sp-m{max-width:78%;padding:10px 13px;border-radius:14px;line-height:1.45;font-size:14.5px;white-space:pre-wrap;word-wrap:break-word}
.sp-m.user{align-self:flex-end;background:linear-gradient(135deg,#1e86e0,#7c5cff);color:#fff;border-bottom-right-radius:4px}
.sp-m.agent{align-self:flex-start;background:rgba(255,255,255,.06);border:1px solid var(--border);border-bottom-left-radius:4px}
.sp-m .who{font-size:11.5px;font-weight:700;color:#9fe6ff;margin-bottom:3px}.sp-m .t{font-size:11px;opacity:.65;margin-top:4px;text-align:right}
.sp-m img{max-width:100%;max-height:260px;border-radius:10px;display:block;margin-top:6px;cursor:zoom-in}.sp-m a.f{color:inherit;text-decoration:underline}
.sp-empty{margin:auto;text-align:center;color:var(--text2);max-width:420px}
.sp-off{margin:10px 0 0;padding:10px 13px;border-radius:12px;border:1px solid rgba(250,204,21,.35);background:rgba(250,204,21,.08);font-size:13.5px}
.sp-form{display:flex;gap:8px;align-items:flex-end;margin-top:12px}.sp-form textarea{flex:1;min-height:46px;max-height:160px;resize:vertical;margin:0}
.sp-att{display:none;font-size:13px;color:var(--text2);margin-top:6px}.sp-att button{background:none;border:0;color:#ff8f8f;cursor:pointer}
.sp-ic{flex:none;width:46px;height:46px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--text);cursor:pointer;font-size:18px}
.sp-err{color:#ff8f8f;font-size:13px;min-height:16px;margin-top:6px}
</style>
<div class="sp-wrap"><div class="sp-head"><h1>Podpora Laundromats</h1><span class="sp-dot" id="sp-st"><i></i><span>…</span></span></div>
<p class="muted" style="margin:0 0 12px">Dobrý den ${esc(String(acc.name || '').split(/\s+/)[0])}, napište nám cokoli k prádlomatům, ekonomice nebo vašemu místu. Můžete přiložit i fotku nebo PDF.</p>
<div class="card sp-log" id="sp-log"><div class="sp-empty" id="sp-empty">Zatím tu nejsou žádné zprávy. Napište nám první — odpovíme co nejdříve.</div></div>
<div class="sp-off" id="sp-off" hidden>Podpora teď není online. Zprávu nám klidně napište — odpovíme co nejdříve a dáme vám vědět e-mailem.</div>
<form class="sp-form" id="sp-form"><button type="button" class="sp-ic" id="sp-pick" title="Přiložit soubor">📎</button><input type="file" id="sp-file" accept="image/*,application/pdf" hidden>
<textarea id="sp-text" placeholder="Napište zprávu… (Enter odešle, Shift+Enter nový řádek)" maxlength="4000"></textarea><button class="btn" type="submit" id="sp-send">Odeslat</button></form>
<div class="sp-att" id="sp-att"></div><div class="sp-err" id="sp-err"></div></div>
<script>${CLIENT}</script>`;
}

const CLIENT = String.raw`(function(){var d=document,log=d.getElementById('sp-log'),emp=d.getElementById('sp-empty'),st=d.getElementById('sp-st'),off=d.getElementById('sp-off'),tx=d.getElementById('sp-text'),fi=d.getElementById('sp-file'),att=d.getElementById('sp-att'),er=d.getElementById('sp-err'),bt=d.getElementById('sp-send');
var last=0,seen={},file=null,first=true;
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function tm(s){var x=new Date(s);return x.toLocaleDateString('cs-CZ',{day:'numeric',month:'numeric'})+' '+x.toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'});}
function add(m){if(seen[m.id])return;seen[m.id]=1;if(m.id>last)last=m.id;emp.style.display='none';var el=d.createElement('div');el.className='sp-m '+(m.sender==='agent'?'agent':'user');
  var h=(m.sender==='agent'?'<div class="who">'+esc(m.agent_name||'Podpora Laundromats')+'</div>':'');var fileOnly=m.file_name&&m.body==='📎 '+m.file_name;
  if(!fileOnly)h+=esc(m.body);
  if(m.file_name){var u='/cesta/podpora/file/'+m.id;h+=/^image\//.test(m.file_type||'')?'<a href="'+u+'" target="_blank" rel="noopener"><img src="'+u+'" alt="'+esc(m.file_name)+'"></a>':'<div><a class="f" href="'+u+'" target="_blank" rel="noopener">📎 '+esc(m.file_name)+'</a></div>';}
  el.innerHTML=h+'<div class="t">'+tm(m.created_at)+'</div>';log.appendChild(el);}
function stick(){log.scrollTop=log.scrollHeight;}
function state(on){st.className='sp-dot'+(on?' on':'');st.lastChild.textContent=on?'podpora je online':'podpora offline';off.hidden=!!on;}
function poll(){fetch('/api/cesta/support/state'+(first?'':'?after='+last),{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(j){if(!j||!j.msgs)return;var was=log.scrollHeight-log.scrollTop-log.clientHeight<60;var newAgent=false;j.msgs.forEach(function(m){if(!seen[m.id]&&m.sender==='agent'&&!first)newAgent=true;add(m);});state(!!j.online);if(first||was||newAgent)stick();if(newAgent&&d.hidden){d.title='💬 Nová zpráva · Podpora';}first=false;}).catch(function(){});}
d.addEventListener('visibilitychange',function(){if(!d.hidden)d.title='Podpora Laundromats · Laundromats';});
function setFile(f){if(f&&f.size>10*1024*1024){er.textContent='Soubor je větší než 10 MB.';return;}file=f||null;att.style.display=file?'block':'none';att.innerHTML=file?'📎 '+esc(file.name)+' <button type="button" id="sp-x">odebrat</button>':'';if(file)d.getElementById('sp-x').onclick=function(){setFile(null);fi.value='';};}
d.getElementById('sp-pick').onclick=function(){fi.click();};fi.onchange=function(){setFile(fi.files[0]);};
tx.addEventListener('paste',function(e){var it=(e.clipboardData||{}).items||[];for(var i=0;i<it.length;i++){if(it[i].kind==='file'){var f=it[i].getAsFile();if(f){setFile(new File([f],f.name&&f.name!=='image.png'?f.name:'snimek-'+Date.now()+'.png',{type:f.type}));e.preventDefault();}}}});
tx.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();d.getElementById('sp-form').requestSubmit();}});
function b64(f){return new Promise(function(ok,ko){var r=new FileReader();r.onload=function(){ok(String(r.result).split(',')[1]||'');};r.onerror=ko;r.readAsDataURL(f);});}
d.getElementById('sp-form').addEventListener('submit',function(e){e.preventDefault();var text=tx.value.trim();if(!text&&!file)return;er.textContent='';bt.disabled=true;bt.textContent='Odesílám…';
  (file?b64(file):Promise.resolve(null)).then(function(data){return fetch('/api/cesta/support/send',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:text,file:data?{name:file.name,data:data}:undefined})});})
  .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Odeslání se nepodařilo.');return j;});})
  .then(function(j){tx.value='';setFile(null);fi.value='';if(j.msg)add(j.msg);stick();try{window.lmTrack&&lmTrack('support_send',{});}catch(_){}})
  .catch(function(x){er.textContent=x.message||'Odeslání se nepodařilo.';}).finally(function(){bt.disabled=false;bt.textContent='Odeslat';});});
poll();setInterval(function(){if(!d.hidden)poll();},4000);setInterval(function(){if(d.hidden)poll();},20000);})();`;
