// BS2 — HTML šablony (server-side, bez frameworku). Mobile-first, funguje na iPhone/Android/Windows/Mac.

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDT(d) { if (!d) return '—'; try { return new Date(d).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } }

const CSS = `
:root{--bg:#0c1826;--card:#13233a;--card2:#0e1e33;--border:#1f3453;--text:#e9f0f7;--text2:#9db6cd;--accent:#1e86e0;--accent2:#4aa3ea;--ok:#22c55e;--err:#ef4444;--blue:#4aa3ea}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent} html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;min-height:100vh;min-height:100dvh}
a{color:var(--blue)} .muted{color:var(--text2)} .small{font-size:12px}
header{position:sticky;top:0;z-index:5;background:rgba(15,18,32,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--border);padding:10px 16px;padding-top:calc(10px + env(safe-area-inset-top));display:flex;align-items:center;gap:10px;flex-wrap:wrap}
header .brand{font-weight:800;font-size:17px;letter-spacing:.02em;text-decoration:none;color:var(--text)} header .tag{font-size:11px;color:var(--accent2);border:1px solid var(--accent2);border-radius:999px;padding:1px 8px}
header nav{display:flex;gap:4px;margin-left:auto;flex-wrap:wrap} header nav a{color:var(--text2);text-decoration:none;padding:6px 10px;border-radius:8px;font-size:14px} header nav a.active,header nav a:hover{background:var(--card2);color:var(--text)}
main{padding:18px 16px calc(24px + env(safe-area-inset-bottom));max-width:1100px;margin:0 auto}
.banner{background:linear-gradient(135deg,#1e86e0 0%,#1565b8 100%);color:#fff;padding:18px 16px}
.banner .in{max-width:1100px;margin:0 auto;display:flex;align-items:center;gap:14px}
.banner .ico{width:46px;height:46px;border-radius:12px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:24px;flex:none}
.banner h1{margin:0;font-size:20px;color:#fff} .banner p{margin:2px 0 0;font-size:13px;color:rgba(255,255,255,.85)}
.tabs{background:var(--card2);border-bottom:1px solid var(--border);overflow:auto;-webkit-overflow-scrolling:touch}
.tabs .in{max-width:1100px;margin:0 auto;display:flex;gap:2px;padding:0 8px;white-space:nowrap}
.tabs a{display:inline-flex;align-items:center;gap:6px;padding:12px 14px;color:var(--text2);text-decoration:none;font-weight:600;font-size:14px;border-bottom:2px solid transparent}
.tabs a.active{color:var(--accent2);border-bottom-color:var(--accent2)} .tabs a:hover{color:var(--text)}
.tabs .right{margin-left:auto;display:inline-flex;gap:2px}
h1{font-size:22px;margin:0 0 6px} h2{font-size:17px;margin:18px 0 8px}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.stat{background:var(--card2);border-radius:12px;padding:12px 14px} .stat .v{font-size:24px;font-weight:800} .stat .l{font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.04em}
label{display:block;font-size:13px;color:var(--text2);margin:10px 0 4px}
input,select,textarea{width:100%;font:inherit;font-size:16px;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px 12px;outline:none} input:focus,select:focus{border-color:var(--accent)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font:inherit;font-size:15px;font-weight:700;background:var(--accent);color:#fff;border:0;border-radius:12px;padding:12px 16px;cursor:pointer;text-decoration:none;min-height:44px}
.btn.full{width:100%} .btn.sec{background:var(--card2);color:var(--text);border:1px solid var(--border)} .btn.danger{background:transparent;color:var(--err);border:1px solid rgba(239,68,68,.5)} .btn.sm{padding:7px 10px;font-size:13px;min-height:34px;border-radius:9px} .btn:disabled{opacity:.5;cursor:default}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.msg{padding:10px 12px;border-radius:10px;margin:10px 0;font-size:14px} .msg.err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4)} .msg.ok{background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.4)}
.badge{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:2px 8px;border:1px solid} .badge.invited{color:var(--blue);border-color:rgba(74,163,234,.5)} .badge.active{color:var(--ok);border-color:rgba(34,197,94,.5)} .badge.blocked{color:var(--err);border-color:rgba(239,68,68,.5)}
.auth{max-width:420px;margin:6vh auto 0} .auth .logo{font-size:28px;font-weight:900;text-align:center;margin-bottom:4px} .auth .sub{text-align:center;color:var(--text2);margin-bottom:18px}
table{width:100%;border-collapse:collapse;font-size:14px} th,td{text-align:left;padding:9px 8px;border-top:1px solid var(--border);vertical-align:top} th{color:var(--text2);font-size:11px;text-transform:uppercase;letter-spacing:.04em;border-top:0}
.tbl-wrap{overflow:auto;-webkit-overflow-scrolling:touch}
/* mobil: tabulka podporovatelů jako karty */
@media (max-width:720px){
  .cards tr{display:block;border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin-bottom:10px;background:var(--card2)} .cards thead{display:none}
  .cards td{display:block;border:0;padding:3px 0} .cards td[data-l]::before{content:attr(data-l) ": ";color:var(--text2);font-size:12px}
  .cards td.actions{padding-top:8px}
}
.list-item{display:flex;justify-content:space-between;gap:10px;padding:12px 0;border-top:1px solid var(--border)} .list-item:first-child{border-top:0}
code{background:var(--card2);padding:1px 6px;border-radius:6px;font-size:13px}
`;

function layout({ title, body, nav = [], active = '', user = null, holyosUrl = '', banner = null }) {
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0f1220">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} · BS2</title><style>${CSS}</style></head>
<body><header><a class="brand" href="/">BS2</a><span class="tag">soukromé</span>
<nav>${holyosUrl ? `<a href="${holyosUrl}">← HolyOS</a>` : ''}${user ? `<a href="/logout" title="Odhlásit">${esc(user)} ⎋</a>` : ''}</nav></header>
${banner ? `<div class="banner"><div class="in"><div class="ico">${banner.icon || '🔒'}</div><div><h1>${esc(banner.title)}</h1>${banner.subtitle ? `<p>${esc(banner.subtitle)}</p>` : ''}</div></div></div>` : ''}
${nav.length ? `<div class="tabs"><div class="in">${nav.filter(n => !n.right).map(n => `<a href="${n.href}" class="${n.id === active ? 'active' : ''}">${n.icon ? n.icon + ' ' : ''}${n.label}</a>`).join('')}<span class="right">${nav.filter(n => n.right).map(n => `<a href="${n.href}" class="${n.id === active ? 'active' : ''}">${n.icon ? n.icon + ' ' : ''}${n.label}</a>`).join('')}</span></div></div>` : ''}
<main>${body}</main></body></html>`;
}

// ── Veřejné / podporovatel ──────────────────────────────────────────────────
function loginPage({ error = '', info = '', login = '' } = {}) {
  return layout({ title: 'Přihlášení', body: `
  <div class="auth"><div class="logo">BS2</div><div class="sub">Soukromá sekce Best Series pro podporovatele</div>
  <div class="card">
    ${error ? `<div class="msg err">${esc(error)}</div>` : ''}${info ? `<div class="msg ok">${esc(info)}</div>` : ''}
    <form method="post" action="/login">
      <label>Nick nebo e-mail</label><input name="login" value="${esc(login)}" autocomplete="username" autocapitalize="none" autocorrect="off" required>
      <label>Heslo</label><input name="password" type="password" autocomplete="current-password" required>
      <div style="height:14px"></div><button class="btn full" type="submit">Přihlásit</button>
    </form>
    <p class="muted small" style="margin:14px 0 0;text-align:center">Jsi tu poprvé? <a href="/activate">Aktivovat účet e-mailem</a></p>
  </div></div>` });
}
function activatePage({ step = 'email', email = '', error = '', name = '', nick = '' } = {}) {
  const inner = step === 'email' ? `
    <p class="muted small">Zadej e-mail, na který jsi u nás veden. Pokud ho v seznamu máme, vytvoříš si nick a heslo.</p>
    <form method="post" action="/activate"><label>E-mail</label><input name="email" type="email" value="${esc(email)}" autocomplete="email" inputmode="email" autocapitalize="none" required>
    <div style="height:14px"></div><button class="btn full" type="submit">Pokračovat</button></form>` : `
    <p class="muted small">Ahoj${name ? ' ' + esc(name) : ''}, e-mail <b>${esc(email)}</b> známe. Zvol si nick a heslo pro přihlašování.</p>
    <form method="post" action="/activate/finish"><input type="hidden" name="email" value="${esc(email)}">
      <label>Nick (3–30 znaků, písmena/čísla/._-)</label><input name="nick" value="${esc(nick)}" autocomplete="username" autocapitalize="none" autocorrect="off" minlength="3" maxlength="30" pattern="[A-Za-z0-9._\\-]{3,30}" required>
      <label>Heslo (min. 8 znaků)</label><input name="password" type="password" autocomplete="new-password" minlength="8" required>
      <label>Heslo znovu</label><input name="password2" type="password" autocomplete="new-password" minlength="8" required>
      <div style="height:14px"></div><button class="btn full" type="submit">Vytvořit účet a přihlásit</button></form>`;
  return layout({ title: 'Aktivace účtu', body: `
  <div class="auth"><div class="logo">BS2</div><div class="sub">První přihlášení podporovatele</div>
  <div class="card">${error ? `<div class="msg err">${esc(error)}</div>` : ''}${inner}
  <p class="muted small" style="margin:14px 0 0;text-align:center"><a href="/login">← zpět na přihlášení</a></p></div></div>` });
}
const USER_NAV = [{ id: 'home', href: '/', label: 'Domů', icon: '🏠' }, { id: 'acc', href: '/password', label: 'Můj účet', icon: '👤', right: true }];
function supporterHome(s) {
  return layout({ title: 'Domů', user: s.nick, nav: USER_NAV, active: 'home', banner: { icon: '🔒', title: 'Soukromá sekce Best Series', subtitle: 'Prostor pro naše podporovatele' }, body: `
  <h1>Vítej, ${esc(s.nick)} 👋</h1>
  <p class="muted">${esc([s.first_name, s.last_name].filter(Boolean).join(' '))} · ${esc(s.email)}</p>
  <div class="grid">
    <div class="card"><h2 style="margin-top:0">🔒 Soukromá sekce</h2><p class="muted">Obsah pro podporovatele připravujeme. Zatím můžeš zkontrolovat svůj účet.</p></div>
    <div class="card"><h2 style="margin-top:0">Můj účet</h2>
      <div class="list-item"><span class="muted">Nick</span><b>${esc(s.nick)}</b></div>
      <div class="list-item"><span class="muted">E-mail</span><span>${esc(s.email)}</span></div>
      <div class="list-item"><span class="muted">Účet aktivní od</span><span>${fmtDT(s.activated_at)}</span></div>
      <div style="margin-top:12px"><a class="btn sec sm" href="/password">Změnit heslo</a></div>
    </div>
  </div>` });
}
function passwordPage({ nick, error = '', ok = '' }) {
  return layout({ title: 'Změna hesla', user: nick, nav: USER_NAV, active: 'acc', banner: { icon: '🔒', title: 'Soukromá sekce Best Series', subtitle: 'Prostor pro naše podporovatele' }, body: `
  <div class="auth" style="margin-top:10px"><div class="card"><h2 style="margin-top:0">Změna hesla</h2>
  ${error ? `<div class="msg err">${esc(error)}</div>` : ''}${ok ? `<div class="msg ok">${esc(ok)}</div>` : ''}
  <form method="post" action="/password"><label>Současné heslo</label><input name="old" type="password" autocomplete="current-password" required>
  <label>Nové heslo (min. 8)</label><input name="password" type="password" autocomplete="new-password" minlength="8" required>
  <label>Nové heslo znovu</label><input name="password2" type="password" autocomplete="new-password" minlength="8" required>
  <div style="height:14px"></div><button class="btn full" type="submit">Uložit</button></form>
  <p class="small" style="margin:14px 0 0;text-align:center"><a href="/">← domů</a></p></div></div>` });
}

// ── Admin (Tomáš, Jan přes SSO) ─────────────────────────────────────────────
const ADMIN_NAV = [
  { id: 'dash', href: '/admin', label: 'Přehled', icon: '📊' },
  { id: 'sup', href: '/admin/supporters', label: 'Podporovatelé', icon: '👥' },
  { id: 'imp', href: '/admin/import', label: 'Import', icon: '⬆️', right: true },
];
function adminLayout(title, active, admin, body, holyosUrl) {
  return layout({ title, active, nav: ADMIN_NAV, user: admin.name || admin.username, holyosUrl, body,
    banner: { icon: '👥', title: 'Podporovatelé', subtitle: 'Správa podporovatelů Best Series, jejich přístupů a dalších agend na jednom místě' } });
}
function adminDash({ admin, stats, recent, holyosUrl }) {
  return adminLayout('Přehled', 'dash', admin, `
  <p class="muted" style="margin-top:0">Přihlášen přes HolyOS jako <b>${esc(admin.name)}</b>.</p>
  <div class="grid">
    <div class="stat"><div class="v">${stats.total}</div><div class="l">Celkem</div></div>
    <div class="stat"><div class="v" style="color:var(--ok)">${stats.active}</div><div class="l">Aktivní (mají nick + heslo)</div></div>
    <div class="stat"><div class="v" style="color:var(--blue)">${stats.invited}</div><div class="l">Čeká na první přihlášení</div></div>
    <div class="stat"><div class="v" style="color:var(--err)">${stats.blocked}</div><div class="l">Blokovaní</div></div>
  </div>

  <div class="card"><h2 style="margin-top:0">Poslední přihlášení</h2>
  ${recent.length ? recent.map(r => `<div class="list-item"><span><b>${esc(r.nick || '—')}</b> <span class="muted">${esc(r.email)}</span></span><span class="muted small">${fmtDT(r.last_login_at)}</span></div>`).join('') : '<p class="muted">Zatím se nikdo nepřihlásil.</p>'}</div>
  <p class="muted small">Přihlašovací stránka pro podporovatele: <code>${esc(process.env.BS2_PUBLIC_URL || 'https://www.bestseries2.cz')}/login</code> — první přihlášení přes <code>/activate</code> (e-mail musí být v seznamu).</p>`, holyosUrl);
}
// Sloupce seznamu: základní (pevně Jméno) + volitelné základní + libovolné údaje z importu. Výběr je v cookie bs2_cols.
const BASE_COLS = [
  { key: 'email', label: 'E-mail', render: (r) => `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` },
  { key: 'nick', label: 'Nick', render: (r) => r.nick ? esc(r.nick) : '<span class="muted">—</span>' },
  { key: 'status', label: 'Stav', render: (r) => `<span class="badge ${esc(r.status)}">${r.status === 'active' ? 'aktivní' : r.status === 'blocked' ? 'blokován' : 'čeká na aktivaci'}</span>` },
  { key: 'last_login_at', label: 'Poslední přihlášení', render: (r) => `<span class="muted small">${fmtDT(r.last_login_at)}</span>` },
  { key: 'activated_at', label: 'Aktivován', render: (r) => `<span class="muted small">${fmtDT(r.activated_at)}</span>` },
  { key: 'created_at', label: 'Vytvořen v BS2', render: (r) => `<span class="muted small">${fmtDT(r.created_at)}</span>` },
  { key: 'source', label: 'Zdroj importu', render: (r) => `<span class="muted small">${esc(r.source || '—')}</span>` },
];
const DEFAULT_COLS = ['email', 'nick', 'status', 'last_login_at'];
const EXTRA_PRIO = ['active', 'pozice', 'level', 'obrat', 'profit', 'podil', 'visit', 'date', 'country', 'currency', 'lang', 'vip', 'founder_terms_accepted_at', 'id'];
function adminSupporters({ admin, rows, qstr = '', status = '', total, msg = '', holyosUrl, cols = DEFAULT_COLS, extraKeys = [] }) {
  const baseSel = BASE_COLS.filter(c => cols.includes(c.key));
  const extraSel = cols.filter(k => k.startsWith('x:')).map(k => k.slice(2)).filter(k => extraKeys.includes(k));
  const sortedExtra = extraKeys.slice().sort((a, b) => { const ia = EXTRA_PRIO.indexOf(a), ib = EXTRA_PRIO.indexOf(b); return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b); });
  const head = '<th>Jméno</th>' + baseSel.map(c => `<th>${esc(c.label)}</th>`).join('') + extraSel.map(k => `<th title="údaj z importu">${esc(k)}</th>`).join('') + '<th></th>';
  const rowsHtml = rows.map(r => `<tr>
    <td data-l="Jméno"><b>${esc([r.last_name, r.first_name].filter(Boolean).join(' ') || '—')}</b></td>
    ${baseSel.map(c => `<td data-l="${esc(c.label)}">${c.render(r)}</td>`).join('')}
    ${extraSel.map(k => { const v = r.extra ? r.extra[k] : null; return `<td data-l="${esc(k)}" class="small" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(v == null ? '' : v)}">${v == null || v === '' ? '<span class="muted">—</span>' : esc(v)}</td>`; }).join('')}
    <td class="actions"><div class="row"><a class="btn sec sm" href="/admin/supporters/${r.id}">Detail</a></div></td></tr>`).join('');
  const colCount = 2 + baseSel.length + extraSel.length;
  const picker = `
  <details class="colpick" id="colpick"><summary class="btn sec" title="Vybrat sloupce tabulky" style="padding:10px 12px">⚙️</summary>
    <form method="post" action="/admin/supporters/columns" class="colpick-pop">
      <input type="hidden" name="back" value="${esc('/admin/supporters?q=' + encodeURIComponent(qstr) + '&status=' + encodeURIComponent(status))}">
      <div class="colpick-grid">
        <div><div class="colpick-h">Základní</div>
          <label class="colpick-i"><input type="checkbox" checked disabled> Jméno</label>
          ${BASE_COLS.map(c => `<label class="colpick-i"><input type="checkbox" name="cols" value="${c.key}"${cols.includes(c.key) ? ' checked' : ''}> ${esc(c.label)}</label>`).join('')}
        </div>
        <div><div class="colpick-h">Údaje z importu <span class="muted">(${sortedExtra.length})</span></div>
          <div class="colpick-scroll">${sortedExtra.map(k => `<label class="colpick-i"><input type="checkbox" name="cols" value="x:${esc(k)}"${cols.includes('x:' + k) ? ' checked' : ''}> ${esc(k)}</label>`).join('') || '<span class="muted small">Zatím žádné (naimportuj data).</span>'}</div>
        </div>
      </div>
      <div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn sec sm" type="submit" name="reset" value="1">Výchozí</button><button class="btn sm" type="submit">Uložit sloupce</button></div>
    </form></details>`;
  return adminLayout('Podporovatelé', 'sup', admin, `
  <style>
    .colpick{position:relative} .colpick summary{list-style:none;cursor:pointer;display:inline-flex} .colpick summary::-webkit-details-marker{display:none}
    .colpick-pop{position:absolute;right:0;top:calc(100% + 6px);z-index:20;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;width:min(560px,calc(100vw - 32px));box-shadow:0 12px 40px rgba(0,0,0,.5)}
    .colpick-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px} @media (max-width:600px){.colpick-grid{grid-template-columns:1fr}}
    .colpick-h{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--text2);margin-bottom:6px}
    .colpick-i{display:flex;align-items:center;gap:8px;font-size:14px;margin:0;padding:5px 0;color:var(--text);cursor:pointer} .colpick-i input{width:auto;margin:0}
    .colpick-scroll{max-height:40vh;overflow:auto;padding-right:4px}
  </style>
  <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
    <h1 style="margin:0">Podporovatelé <span class="muted" style="font-size:14px;font-weight:500">${total}</span></h1>
    <div class="row"><a class="btn" href="/admin/import">⬆ Import CSV / Excel</a><a class="btn sec" href="/admin/supporters/new">+ Přidat ručně</a>${picker}</div>
  </div>
  ${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}
  <form method="get" class="row" style="margin:10px 0 14px">
    <input name="q" value="${esc(qstr)}" placeholder="Hledat jméno / e-mail / nick…" style="flex:1;min-width:200px">
    <select name="status" style="width:auto"><option value="">Všechny stavy</option><option value="invited"${status === 'invited' ? ' selected' : ''}>Čeká na aktivaci</option><option value="active"${status === 'active' ? ' selected' : ''}>Aktivní</option><option value="blocked"${status === 'blocked' ? ' selected' : ''}>Blokovaní</option></select>
    <button class="btn sec" type="submit">Filtrovat</button>
  </form>
  <div class="card tbl-wrap"><table class="cards"><thead><tr>${head}</tr></thead><tbody>${rowsHtml || `<tr><td colspan="${colCount}" class="muted">Nic nenalezeno.</td></tr>`}</tbody></table></div>
  <script>document.addEventListener('click',function(e){var d=document.getElementById('colpick');if(d&&d.open&&!d.contains(e.target))d.removeAttribute('open');});</script>`, holyosUrl);
}
function adminSupporterDetail({ admin, s, msg = '', error = '', holyosUrl, isNew = false }) {
  const PRIO = ['active', 'pozice', 'level', 'obrat', 'profit', 'podil', 'visit', 'date', 'country', 'currency', 'lang', 'vip', 'founder_terms_accepted_at', 'id'];
  const HIDE_IN_LIST = /^(password|hash|secret|loggin_token|login_token|aed)$/i; // technické hodnoty ze starého systému — uložené jsou, jen se nezobrazují v detailu
  const keys = s && s.extra ? Object.keys(s.extra).filter(k => !HIDE_IN_LIST.test(k)).sort((a, b) => { const ia = PRIO.indexOf(a), ib = PRIO.indexOf(b); return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b); }) : [];
  const extra = keys.length ? keys.map(k => `<div class="list-item"><span class="muted">${esc(k)}</span><span style="text-align:right;word-break:break-all">${esc(s.extra[k])}</span></div>`).join('') : '<p class="muted small">Žádné další údaje.</p>';
  return adminLayout(isNew ? 'Nový podporovatel' : 'Detail', 'sup', admin, `
  <p><a href="/admin/supporters">← seznam</a></p>
  <h1>${isNew ? 'Nový podporovatel' : esc([s.last_name, s.first_name].filter(Boolean).join(' ') || s.email)}</h1>
  ${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}${error ? `<div class="msg err">${esc(error)}</div>` : ''}
  <style>
    .sec{padding:0} .sec>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;font-size:17px;font-weight:700;user-select:none}
    .sec>summary::-webkit-details-marker{display:none} .sec>summary .chev{transition:transform .2s;color:var(--text2);font-size:13px} .sec[open]>summary .chev{transform:rotate(90deg)}
    .sec>.sec-body{padding:0 16px 16px} .sec:not([open])>summary{padding-bottom:14px}
    .grid-sec{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;align-items:start}
  </style>
  <div class="grid-sec">
    <details class="card sec" data-sec="udaje" open><summary>Údaje <span class="chev">▶</span></summary><div class="sec-body">
      <form method="post" action="${isNew ? '/admin/supporters/new' : '/admin/supporters/' + s.id}">
        <label>E-mail (klíč pro první přihlášení)</label><input name="email" type="email" value="${esc(s ? s.email : '')}" required>
        <label>Jméno</label><input name="first_name" value="${esc(s ? s.first_name : '')}">
        <label>Příjmení</label><input name="last_name" value="${esc(s ? s.last_name : '')}">
        <div style="height:12px"></div><button class="btn" type="submit">${isNew ? 'Vytvořit' : 'Uložit'}</button>
      </form>
    </div></details>
    ${isNew ? '' : `<details class="card sec" data-sec="ucet" open><summary>Účet <span class="chev">▶</span></summary><div class="sec-body">
      <div class="list-item"><span class="muted">Stav</span><span class="badge ${esc(s.status)}">${s.status}</span></div>
      <div class="list-item"><span class="muted">Nick</span><b>${esc(s.nick || '—')}</b></div>
      <div class="list-item"><span class="muted">Aktivován</span><span>${fmtDT(s.activated_at)}</span></div>
      <div class="list-item"><span class="muted">Poslední přihlášení</span><span>${fmtDT(s.last_login_at)}</span></div>
      <div class="list-item"><span class="muted">Import</span><span class="small">${esc(s.source || '—')} ${s.imported_at ? '· ' + fmtDT(s.imported_at) : ''}</span></div>
      <div class="row" style="margin-top:12px">
        <form method="post" action="/admin/supporters/${s.id}/reset" onsubmit="return confirm('Smazat nick i heslo? Podporovatel si účet znovu aktivuje e-mailem.')"><button class="btn sec sm" type="submit">↺ Reset přihlášení</button></form>
        <form method="post" action="/admin/supporters/${s.id}/${s.status === 'blocked' ? 'unblock' : 'block'}"><button class="btn ${s.status === 'blocked' ? 'sec' : 'danger'} sm" type="submit">${s.status === 'blocked' ? '✓ Odblokovat' : '⛔ Blokovat'}</button></form>
        <form method="post" action="/admin/supporters/${s.id}/delete" onsubmit="return confirm('Opravdu smazat podporovatele ' + ${JSON.stringify(s.email)} + '?')"><button class="btn danger sm" type="submit">🗑 Smazat</button></form>
      </div>
    </div></details>
    <details class="card sec" data-sec="import" open><summary><span>Další údaje z importu <span class="muted small">(${keys.length})</span></span><span class="chev">▶</span></summary><div class="sec-body">${extra}</div></details>`}
  </div>
  <script>
  // Sbalení sekcí se pamatuje (localStorage), stejné pro všechny podporovatele
  (function(){var KEY='bs2.detail.sections';var st={};try{st=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
    document.querySelectorAll('details.sec').forEach(function(d){var k=d.getAttribute('data-sec');if(st[k]===false)d.removeAttribute('open');
      d.addEventListener('toggle',function(){st[k]=d.open;try{localStorage.setItem(KEY,JSON.stringify(st))}catch(e){}});});})();
  </script>`, holyosUrl);
}
function adminImport({ admin, result = null, error = '', holyosUrl, job = null }) {
  let res = '';
  if (job && !job.done) {
    const pct = job.total ? Math.round(job.processed / job.total * 100) : 0;
    res = `<div class="card" id="imp-progress" data-job="${esc(job.id)}"><h2 style="margin-top:0">Import běží… <span class="muted small">${esc(job.result.file)}</span></h2>
      <div style="background:var(--card2);border-radius:999px;height:14px;overflow:hidden;border:1px solid var(--border)"><div id="imp-bar" style="height:100%;width:${pct}%;background:linear-gradient(90deg,#1e86e0,#4aa3ea);transition:width .4s"></div></div>
      <div class="row" style="justify-content:space-between;margin-top:8px"><span><b id="imp-pct">${pct} %</b> · <span id="imp-done">${job.processed}</span> / ${job.total} řádků</span><span class="muted small" id="imp-eta">odhad…</span></div>
      <div class="grid" style="margin-top:12px"><div class="stat"><div class="v" style="color:var(--ok)" id="imp-created">${job.result.created}</div><div class="l">Nových</div></div><div class="stat"><div class="v" style="color:var(--blue)" id="imp-updated">${job.result.updated}</div><div class="l">Aktualizováno</div></div><div class="stat"><div class="v" style="color:var(--err)" id="imp-skipped">${job.result.skipped}</div><div class="l">Přeskočeno</div></div></div>
      <p class="muted small" style="margin:10px 0 0">Stránku můžeš nechat otevřenou; po dokončení se zobrazí výsledek. Import běží na serveru i kdybys ji zavřel.</p></div>
    <script>
    (function(){var id=document.getElementById('imp-progress').getAttribute('data-job'),t0=Date.now(),p0=${job.processed};
      function tick(){fetch('/admin/import/status/'+id,{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){
        if(j.error&&!j.total){document.getElementById('imp-eta').textContent=j.error;return;}
        var pct=j.total?Math.round(j.processed/j.total*100):0;document.getElementById('imp-bar').style.width=pct+'%';document.getElementById('imp-pct').textContent=pct+' %';
        document.getElementById('imp-done').textContent=j.processed;document.getElementById('imp-created').textContent=j.created;document.getElementById('imp-updated').textContent=j.updated;document.getElementById('imp-skipped').textContent=j.skipped;
        var el=(Date.now()-t0)/1000,done=j.processed-p0;if(done>0&&j.total>j.processed){var eta=Math.round((j.total-j.processed)/(done/el));document.getElementById('imp-eta').textContent='zbývá ~'+(eta>90?Math.ceil(eta/60)+' min':eta+' s');}
        if(j.done){document.getElementById('imp-eta').textContent='hotovo, načítám výsledek…';setTimeout(function(){location.replace('/admin/import?job='+id)},600);return;}
        setTimeout(tick,1000);}).catch(function(){setTimeout(tick,2000)});}
      setTimeout(tick,800);})();
    </script>`;
  }
  if (result) {
    res = `<div class="card"><h2 style="margin-top:0">Výsledek importu „${esc(result.file)}"</h2>
      <div class="grid"><div class="stat"><div class="v">${result.rows}</div><div class="l">Řádků</div></div><div class="stat"><div class="v" style="color:var(--ok)">${result.created}</div><div class="l">Nových</div></div><div class="stat"><div class="v" style="color:var(--blue)">${result.updated}</div><div class="l">Aktualizováno</div></div><div class="stat"><div class="v" style="color:var(--err)">${result.skipped}</div><div class="l">Přeskočeno (neplatný / duplicitní e-mail)</div></div>${result.with_password != null ? `<div class="stat"><div class="v" style="color:var(--ok)">${result.with_password}</div><div class="l">S přeneseným heslem (přihlásí se hned)</div></div>` : ''}${result.nick_conflicts ? `<div class="stat"><div class="v" style="color:var(--accent2)">${result.nick_conflicts}</div><div class="l">Kolize nicku (zvolí si nový)</div></div>` : ''}</div>
      <p class="muted small">Rozpoznané sloupce: e-mail = <code>${esc(result.map.email || '?')}</code>, jméno = <code>${esc(result.map.first_name || '—')}</code>, příjmení = <code>${esc(result.map.last_name || '—')}</code>${result.map.full_name ? `, celé jméno = <code>${esc(result.map.full_name)}</code>` : ''}. ${result.map.nick ? `, nick = <code>${esc(result.map.nick)}</code>` : ''}${result.map.password ? `, heslo = <code>${esc(result.map.password)}</code>` : ''}. Všechny ostatní sloupce (${result.extraCols.length}) uloženy 1:1 jako další údaje.</p>
      ${result.errors.length ? `<div class="msg err"><b>Problémy (${result.errors.length}):</b><br>${result.errors.slice(0, 20).map(esc).join('<br>')}${result.errors.length > 20 ? '<br>…' : ''}</div>` : ''}
      <a class="btn sec" href="/admin/supporters">Zobrazit podporovatele</a></div>`;
  }
  return adminLayout('Import', 'imp', admin, `
  <h1>Import podporovatelů</h1>
  <p class="muted">Nahraj CSV nebo Excel (.xlsx/.xls) ze staré databáze — importuje se <b>1:1, všechny sloupce</b>. Klíčem je <b>e-mail</b>. Sloupce <code>memb/nick</code> a <code>password</code> (bcrypt) se přenesou jako nick a heslo, takže se podporovatelé <b>přihlásí rovnou starými údaji</b>; ostatní sloupce se uloží jako další údaje. Existující záznam se jen doplní (nick ani heslo nastavené v BS2 se nepřepíší).</p>
  ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
  <div class="card"><form method="post" action="/admin/import" enctype="multipart/form-data">
    <label>Soubor (CSV, XLSX, XLS — max 20 MB)</label><input type="file" name="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required>
    <label><input type="checkbox" name="dry" value="1" style="width:auto;margin-right:6px">Jen vyzkoušet (nic neukládat)</label>
    <div style="height:12px"></div><button class="btn" type="submit">Importovat</button></form></div>
  ${res}`, holyosUrl);
}
function errorPage(title, text, back = '/') {
  return layout({ title, body: `<div class="auth"><div class="card"><h2 style="margin-top:0">${esc(title)}</h2><p class="muted">${esc(text)}</p><a class="btn full" href="${back}">Pokračovat</a></div></div>` });
}

module.exports = { DEFAULT_COLS, esc, layout, loginPage, activatePage, supporterHome, passwordPage, adminDash, adminSupporters, adminSupporterDetail, adminImport, errorPage };
