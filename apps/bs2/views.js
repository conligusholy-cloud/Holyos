// BS2 — HTML šablony (server-side, bez frameworku). Mobile-first, funguje na iPhone/Android/Windows/Mac.

const { logoSvg } = require('./logo');
const { ico } = require('./icons');
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDT(d) { if (!d) return '—'; try { return new Date(d).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } }

const CSS = `
:root{--bg:#04060c;--card:rgba(14,22,40,.72);--card2:rgba(8,13,26,.85);--border:rgba(120,160,255,.14);--border2:rgba(120,160,255,.28);--text:#eaf2ff;--text2:#8ea2c2;--text3:#58698a;--accent:#1e86e0;--accent2:#4fd1ff;--vio:#7c5cff;--ok:#2fe3a0;--err:#ff5d6c;--blue:#4fd1ff}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent} html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;min-height:100vh;min-height:100dvh;overflow-x:hidden}
a{color:var(--blue)} .muted{color:var(--text2)} .small{font-size:12px}
#net{position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;opacity:.7}
.glow{position:fixed;border-radius:50%;filter:blur(90px);opacity:.45;z-index:0;pointer-events:none;animation:drift 18s ease-in-out infinite alternate}
.glow.a{width:620px;height:620px;left:-200px;top:-200px;background:radial-gradient(circle,rgba(30,134,224,.6),transparent 65%)}
.glow.b{width:560px;height:560px;right:-180px;bottom:-220px;background:radial-gradient(circle,rgba(124,92,255,.5),transparent 65%);animation-delay:-9s}
@keyframes drift{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(50px,30px,0) scale(1.1)}}
.gridfx{position:fixed;inset:auto 0 0 0;height:40vh;z-index:0;pointer-events:none;background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px);background-size:64px 64px;transform:perspective(600px) rotateX(62deg);transform-origin:top;mask-image:linear-gradient(to bottom,transparent,#000 35%,#000 70%,transparent);-webkit-mask-image:linear-gradient(to bottom,transparent,#000 35%,#000 70%,transparent)}
header,.banner,.tabs,main{position:relative;z-index:1}
header{position:sticky;top:0;z-index:5;background:rgba(4,6,12,.72);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--border);padding:10px 18px;padding-top:calc(10px + env(safe-area-inset-top));display:flex;align-items:center;gap:12px;flex-wrap:wrap}
header .brand{display:inline-flex;align-items:center;gap:10px;text-decoration:none;color:var(--text);font-weight:700;font-size:15px;letter-spacing:.02em}
header .brand .mark{display:inline-flex;filter:drop-shadow(0 6px 16px rgba(30,134,224,.45))}
header .brand span.v{background:linear-gradient(90deg,var(--accent2),var(--vio));-webkit-background-clip:text;background-clip:text;color:transparent}
header .tag{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--text2);border:1px solid var(--border);border-radius:999px;padding:3px 9px;background:rgba(255,255,255,.02)}
header nav{display:flex;gap:4px;margin-left:auto;flex-wrap:wrap} header nav a{display:inline-flex;align-items:center;gap:6px;color:var(--text2);text-decoration:none;padding:6px 10px;border-radius:9px;font-size:13.5px;border:1px solid transparent} header nav a.active,header nav a:hover{background:rgba(120,160,255,.08);border-color:var(--border);color:var(--text)}
main{padding:22px 18px calc(28px + env(safe-area-inset-bottom));max-width:1100px;margin:0 auto}
.banner{padding:34px 18px 26px}
.banner .in{max-width:1100px;margin:0 auto;display:flex;align-items:center;gap:16px}
.banner .ico{color:var(--accent2);width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,rgba(30,134,224,.35),rgba(124,92,255,.35));border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:24px;flex:none;box-shadow:0 10px 30px rgba(30,134,224,.25)}
.banner h1{margin:0;font-size:clamp(22px,3vw,30px);letter-spacing:-.02em;font-weight:800;background:linear-gradient(90deg,#fff 0%,var(--accent2) 60%,var(--vio) 100%);-webkit-background-clip:text;background-clip:text;color:transparent} .banner p{margin:3px 0 0;font-size:13.5px;color:var(--text2)}
.tabs{border-bottom:1px solid var(--border);overflow:auto;-webkit-overflow-scrolling:touch;background:rgba(4,6,12,.35);backdrop-filter:blur(8px)}
.tabs .in{max-width:1100px;margin:0 auto;display:flex;gap:2px;padding:0 10px;white-space:nowrap}
.tabs a{display:inline-flex;align-items:center;gap:7px;padding:12px 14px;color:var(--text2);text-decoration:none;font-weight:600;font-size:14px;border-bottom:2px solid transparent}
.tabs a .ico{opacity:.8}.tabs a.active .ico{opacity:1;filter:drop-shadow(0 0 6px rgba(79,209,255,.6))}.tabs a.active{color:var(--accent2);border-bottom-color:var(--accent2);text-shadow:0 0 18px rgba(79,209,255,.5)} .tabs a:hover{color:var(--text)}
.tabs .right{margin-left:auto;display:inline-flex;gap:2px}
h1{font-size:24px;margin:0 0 6px;letter-spacing:-.02em} h2{font-size:17px;margin:18px 0 8px}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:18px;margin-bottom:14px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 20px 60px rgba(0,0,0,.35)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.stat{background:var(--card2);border:1px solid var(--border);border-radius:14px;padding:14px 16px} .stat .v{font-size:26px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums} .stat .l{font-size:11.5px;color:var(--text2);text-transform:uppercase;letter-spacing:.06em}
label{display:block;font-size:12.5px;color:var(--text2);margin:12px 0 5px;letter-spacing:.02em}
input,select,textarea{width:100%;font:inherit;font-size:16px;color:var(--text);background:rgba(4,8,16,.8);border:1px solid rgba(120,160,255,.18);border-radius:11px;padding:12px 13px;outline:none;transition:border-color .2s,box-shadow .2s} input:focus,select:focus,textarea:focus{border-color:var(--accent2);box-shadow:0 0 0 4px rgba(79,209,255,.12),0 0 20px rgba(79,209,255,.15)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font:inherit;font-size:15px;font-weight:700;background:linear-gradient(90deg,var(--accent),#3a6cf5 55%,var(--vio));color:#fff;border:0;border-radius:12px;padding:12px 18px;cursor:pointer;text-decoration:none;min-height:44px;box-shadow:0 10px 28px rgba(58,108,245,.35);transition:transform .15s,box-shadow .15s}
.btn:hover{transform:translateY(-1px);box-shadow:0 14px 34px rgba(58,108,245,.5)}
.btn.full{width:100%} .btn.sec{background:rgba(120,160,255,.08);color:var(--text);border:1px solid var(--border2);box-shadow:none} .btn.danger{background:transparent;color:var(--err);border:1px solid rgba(255,93,108,.5);box-shadow:none} .btn.sm{padding:7px 11px;font-size:13px;min-height:34px;border-radius:9px} .btn:disabled{opacity:.5;cursor:default;transform:none}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.msg{padding:10px 12px;border-radius:10px;margin:10px 0;font-size:14px} .msg.err{background:rgba(255,93,108,.1);border:1px solid rgba(255,93,108,.4);color:#ffb3bb} .msg.ok{background:rgba(47,227,160,.1);border:1px solid rgba(47,227,160,.4);color:#a9f5d9}
.badge{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:2px 8px;border:1px solid} .badge.invited{color:var(--blue);border-color:rgba(79,209,255,.5)} .badge.active{color:var(--ok);border-color:rgba(47,227,160,.5)} .badge.blocked{color:var(--err);border-color:rgba(255,93,108,.5)} .badge.type-standard{color:var(--text2);border-color:var(--border2)} .badge.type-owner{color:var(--accent2);border-color:rgba(79,209,255,.5)} .badge.type-seller{color:#c4b5ff;border-color:rgba(124,92,255,.6);background:rgba(124,92,255,.1)}
.auth{max-width:440px;margin:6vh auto 0} .auth .logo{font-size:28px;font-weight:900;text-align:center;margin-bottom:4px} .auth .sub{text-align:center;color:var(--text2);margin-bottom:18px}
table{width:100%;border-collapse:collapse;font-size:14px} td.nm{max-width:200px;width:200px} td.nm b{display:block;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} @media (max-width:720px){td.nm,td.nm b{max-width:none;width:auto;white-space:normal}} th,td{text-align:left;padding:9px 8px;border-top:1px solid var(--border);vertical-align:top} th{color:var(--text2);font-size:11px;text-transform:uppercase;letter-spacing:.06em;border-top:0}
.tbl-wrap{overflow:auto;-webkit-overflow-scrolling:touch}
@media (max-width:720px){
  .cards tr{display:block;border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin-bottom:10px;background:var(--card2)} .cards thead{display:none}
  .cards td{display:block;border:0;padding:3px 0} .cards td[data-l]::before{content:attr(data-l) ": ";color:var(--text2);font-size:12px}
  .cards td.actions{padding-top:8px}
  .gridfx{display:none}
}
.list-item{display:flex;justify-content:space-between;gap:10px;padding:12px 0;border-top:1px solid var(--border)} .list-item:first-child{border-top:0}
code{background:var(--card2);border:1px solid var(--border);padding:1px 6px;border-radius:6px;font-size:13px}
.hero{padding:10px 0 22px}
.hero .eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--text2);border:1px solid var(--border);border-radius:999px;padding:5px 11px;background:rgba(255,255,255,.02)}
.hero .eyebrow i{width:6px;height:6px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 0 rgba(47,227,160,.7);animation:pulse 2s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(47,227,160,.7)}70%{box-shadow:0 0 0 9px rgba(47,227,160,0)}100%{box-shadow:0 0 0 0 rgba(47,227,160,0)}}
.hero h1{margin:14px 0 6px;font-size:clamp(28px,4vw,42px);line-height:1.08;letter-spacing:-.025em;font-weight:800}
.hero h1 .g{background:linear-gradient(90deg,#fff 0%,var(--accent2) 50%,var(--vio) 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{margin:0;color:var(--text2)}
.soon{display:flex;align-items:center;gap:10px;margin-top:14px;padding:10px 12px;border-radius:12px;border:1px dashed var(--border2);color:var(--text2);font-size:13px}
.soon b{color:var(--accent2)}
@media (prefers-reduced-motion:reduce){.glow,.hero .eyebrow i{animation:none}}
`;

// Hlavní layout aplikace (uživatel i admin) ve stejném vizuálu jako přihlášení.
// fx:true přidá animovanou síť uzlů (uživatelské stránky); záře + grid jsou vždy.
function layout({ title, body, nav = [], active = '', user = null, holyosUrl = '', banner = null, fx = false }) {
  const { AUTH_JS } = require('./auth-shell');
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#04060c">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} · Best Series 2.0</title><link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style></head>
<body>${fx ? '<canvas id="net" aria-hidden="true"></canvas>' : ''}<div class="glow a"></div><div class="glow b"></div><div class="gridfx" aria-hidden="true"></div>
<header><a class="brand" href="/"><span class="mark">${logoSvg(32, 'h')}</span>Best Series&nbsp;<span class="v">2.0</span></a><span class="tag">soukromé</span>
<nav>${holyosUrl ? `<a href="${holyosUrl}">${ico('back', 15)} HolyOS</a>` : ''}${user ? `<a href="/logout" title="Odhlásit">${esc(user)} ${ico('logout', 15)}</a>` : ''}</nav></header>
${banner ? `<div class="banner"><div class="in"><div class="ico">${ico(banner.icon || 'lock', 26)}</div><div><h1>${esc(banner.title)}</h1>${banner.subtitle ? `<p>${esc(banner.subtitle)}</p>` : ''}</div></div></div>` : ''}
${nav.length ? `<div class="tabs"><div class="in">${nav.filter(n => !n.right).map(n => `<a href="${n.href}" class="${n.id === active ? 'active' : ''}">${n.icon ? ico(n.icon, 16) + ' ' : ''}${n.label}</a>`).join('')}<span class="right">${nav.filter(n => n.right).map(n => `<a href="${n.href}" class="${n.id === active ? 'active' : ''}">${n.icon ? ico(n.icon, 16) + ' ' : ''}${n.label}</a>`).join('')}</span></div></div>` : ''}
<main>${body}</main>${fx ? `<script>${AUTH_JS}</script>` : ''}</body></html>`;
}

// ── Veřejné / uživatel ──────────────────────────────────────────────────
// Přihlášení a aktivace mají vlastní prémiový vizuál (auth-shell.js) — bez hlavičky aplikace.
const { authShell, ICON } = require('./auth-shell');
function field({ name, type = 'text', value = '', icon, placeholder = '', auto = '', extra = '', eye = false }) {
  return `<div class="f">${ICON[icon] || ''}<input name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${auto ? `autocomplete="${auto}"` : ''} ${extra}>${eye ? `<button type="button" data-eye aria-label="Zobrazit heslo">${ICON.eye}</button>` : ''}</div>`;
}
function loginPage({ error = '', info = '', login = '', members = null } = {}) {
  return authShell({ title: 'Přihlášení', members, esc, card: `
    <h2>Přihlášení</h2><p class="sub">Pokračuj do svého účtu</p>
    ${error ? `<div class="msg err">${esc(error)}</div>` : ''}${info ? `<div class="msg ok">${esc(info)}</div>` : ''}
    <form method="post" action="/login" novalidate>
      <label>Nick nebo e-mail</label>${field({ name: 'login', value: login, icon: 'user', placeholder: 'tvůj nick', auto: 'username', extra: 'autocapitalize="none" autocorrect="off" spellcheck="false" required autofocus' })}
      <label>Heslo <a href="/forgot">Zapomenuté heslo</a></label>${field({ name: 'password', type: 'password', icon: 'lock', placeholder: '••••••••', auto: 'current-password', extra: 'required', eye: true })}
      <button class="btn" type="submit">Přihlásit se ${ICON.arrow}</button>
    </form>
    <div class="sec">${ICON.shield} Zabezpečené přihlášení</div>
    <p class="foot">Přihlášením souhlasíš s podmínkami členství</p>` });
}
function activatePage({ step = 'email', email = '', error = '', name = '', nick = '' } = {}) {
  const inner = step === 'email' ? `
    <h2>Aktivace účtu</h2><p class="sub">Zadej e-mail, na který jsi u nás veden. Pokud ho známe, vytvoříš si nick a heslo.</p>
    ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
    <form method="post" action="/activate" novalidate><label>E-mail</label>${field({ name: 'email', type: 'email', value: email, icon: 'mail', placeholder: 'jmeno@email.cz', auto: 'email', extra: 'inputmode="email" autocapitalize="none" required autofocus' })}
    <button class="btn" type="submit">Pokračovat ${ICON.arrow}</button></form>` : `
    <h2>Ahoj${name ? ' ' + esc(name) : ''}</h2><p class="sub">E-mail <b>${esc(email)}</b> známe. Zvol si nick a heslo pro přihlašování.</p>
    ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
    <form method="post" action="/activate/finish"><input type="hidden" name="email" value="${esc(email)}">
      <label>Nick</label>${field({ name: 'nick', value: nick, icon: 'user', placeholder: '3–30 znaků, písmena/čísla/._-', auto: 'username', extra: 'autocapitalize="none" autocorrect="off" minlength="3" maxlength="30" pattern="[A-Za-z0-9._\\-]{3,30}" required' })}
      <label>Heslo</label>${field({ name: 'password', type: 'password', icon: 'lock', placeholder: 'min. 8 znaků', auto: 'new-password', extra: 'minlength="8" required', eye: true })}
      <label>Heslo znovu</label>${field({ name: 'password2', type: 'password', icon: 'lock', placeholder: 'pro kontrolu', auto: 'new-password', extra: 'minlength="8" required', eye: true })}
      <button class="btn" type="submit">Vytvořit účet a přihlásit ${ICON.arrow}</button></form>`;
  return authShell({ title: 'Aktivace účtu', esc, card: inner + `<p class="foot"><a href="/login">${ico('back', 14)} zpět na přihlášení</a></p>` });
}
// Registrace přes referenční odkaz prodejce (/join/<code>)
function joinPage({ code, seller, f = {}, error = '' }) {
  const who = [seller.first_name, seller.last_name].filter(Boolean).join(' ') || seller.nick;
  return authShell({ title: 'Registrace', esc, card: `
    <h2>Vytvoř si účet</h2><p class="sub">Pozvánka od <b>${esc(who)}</b>. Po registraci uvidíš nabídku prádlomatů a svůj účet.</p>
    ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
    <form method="post" action="/join/${esc(code)}" novalidate>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><label>Jméno</label>${field({ name: 'first_name', value: f.first_name || '', icon: 'user', placeholder: 'Jan', auto: 'given-name', extra: 'required autofocus' })}</div>
        <div><label>Příjmení</label>${field({ name: 'last_name', value: f.last_name || '', icon: 'user', placeholder: 'Novák', auto: 'family-name', extra: 'required' })}</div>
      </div>
      <label>E-mail</label>${field({ name: 'email', type: 'email', value: f.email || '', icon: 'mail', placeholder: 'jmeno@email.cz', auto: 'email', extra: 'inputmode="email" autocapitalize="none" required' })}
      <label>Telefon <span style="color:var(--ink3)">(nepovinné)</span></label>${field({ name: 'phone', type: 'tel', value: f.phone || '', icon: 'phone', placeholder: '+420 …', auto: 'tel', extra: 'inputmode="tel"' })}
      <label>Nick</label>${field({ name: 'nick', value: f.nick || '', icon: 'user', placeholder: '3–30 znaků, písmena/čísla/._-', auto: 'username', extra: 'autocapitalize="none" autocorrect="off" minlength="3" maxlength="30" required' })}
      <label>Heslo</label>${field({ name: 'password', type: 'password', icon: 'lock', placeholder: 'min. 8 znaků', auto: 'new-password', extra: 'minlength="8" required', eye: true })}
      <label>Heslo znovu</label>${field({ name: 'password2', type: 'password', icon: 'lock', placeholder: 'pro kontrolu', auto: 'new-password', extra: 'minlength="8" required', eye: true })}
      <button class="btn" type="submit">Vytvořit účet ${ICON.arrow}</button>
    </form>
    <p class="foot">Už účet máš? <a href="/login">Přihlas se</a></p>` });
}
function forgotPage({ email = '', error = '', done = false } = {}) {
  return authShell({ title: 'Zapomenuté heslo', esc, card: done ? `
    <h2>Zpráva přijata</h2><p class="sub">Pokud e-mail <b>${esc(email)}</b> známe, ozveme se ti s dalším postupem. Obvykle do jednoho pracovního dne.</p>
    <p class="foot"><a href="/login">${ico('back', 14)} zpět na přihlášení</a></p>` : `
    <h2>Zapomenuté heslo</h2><p class="sub">Zadej e-mail, pod kterým jsi u nás veden. Postaráme se o obnovu přístupu.</p>
    ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
    <form method="post" action="/forgot" novalidate><label>E-mail</label>${field({ name: 'email', type: 'email', value: email, icon: 'mail', placeholder: 'jmeno@email.cz', auto: 'email', extra: 'inputmode="email" autocapitalize="none" required autofocus' })}
    <button class="btn" type="submit">Požádat o obnovu ${ICON.arrow}</button></form>
    <p class="foot"><a href="/login">${ico('back', 14)} zpět na přihlášení</a></p>` });
}
const USER_NAV = [{ id: 'home', href: '/', label: 'Domů', icon: 'home' }, { id: 'acc', href: '/password', label: 'Můj účet', icon: 'user', right: true }];
// Prodejci (user_type = seller) mají navíc záložku Můj tým
const userNav = (s) => {
  const nav = [USER_NAV[0]];
  if (s && s.user_type === 'seller') nav.push({ id: 'team', href: '/team', label: 'Moje doporučení', icon: 'users' });
  nav.push({ id: 'products', href: '/pradlomaty', label: 'Prádlomaty', icon: 'box' }, USER_NAV[1]);
  return nav;
};
function supporterHome(s, offers = [], extra = {}) {
  const fullName = [s.first_name, s.last_name].filter(Boolean).join(' ');
  return layout({ title: 'Domů', user: s.nick, nav: userNav(s), active: 'home', fx: true, body: `
  <div class="hero">
    <div class="eyebrow"><i></i>Účet · aktivní</div>
    <h1><span class="g">Vítej, ${esc(require('./vocative').vocativeName(s.first_name, s.last_name) || s.nick)}</span></h1>
    <p>${esc(fullName)}${fullName ? ' · ' : ''}${esc(s.email)}</p>
  </div>
  <div class="card" style="max-width:640px"><h2 style="margin-top:0">Soukromá sekce</h2><p class="muted" style="margin:0">Tvůj prostor v Best Series 2.0. Obsah právě připravujeme — jakmile bude co ukázat, uvidíš to tady jako první.</p>
    <div class="soon"><span style="color:var(--accent2);display:inline-flex">${ico('bolt', 18)}</span><span>Brzy: <b>novinky</b>, <b>výhody pro členy</b> a <b>přehled podpory</b></span></div></div>
  ` });
}
function supporterProducts(s, offers = []) {
  return layout({ title: 'Prádlomaty', user: s.nick, nav: userNav(s), active: 'products', fx: true, body: `
  <h2 style="margin:22px 0 10px;display:flex;align-items:center;gap:8px">${ico('box', 18)} Prádlomaty, které si můžeš pořídit</h2>
  <div class="grid">${offers.map(p => { const vat = (v) => (v == null ? null : Math.round(Number(v) * 1.21)); return `
    <div class="card" style="margin:0"><b style="font-size:16px">${esc(p.name_cs)}</b>
      <div style="margin-top:12px;font-size:24px;font-weight:800;letter-spacing:-.02em">${money(vat(p.price_czk), 'Kč')}</div>
      <div class="small muted">cena s DPH 21 %</div>
    </div>`; }).join('')}</div>
  ${offers.length ? '' : '<p class="muted">Momentálně nemáme žádnou nabídku.</p>'}` });
}
function supporterTeam(s, { team = [], refUrl = '' } = {}) {
  return layout({ title: 'Moje doporučení', user: s.nick, nav: userNav(s), active: 'team', fx: true, body: `
  <h2 style="margin:22px 0 10px;display:flex;align-items:center;gap:8px">${ico('users', 18)} Moje doporučení — lidé, které jsem přivedl</h2>
  <div class="card" style="margin-bottom:12px">
    <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between">
      <div style="min-width:0;flex:1"><div class="small muted" style="letter-spacing:.08em;text-transform:uppercase">Můj registrační odkaz</div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px"><input id="refurl" readonly value="${esc(refUrl || '')}" onclick="this.select()" style="font-size:14px;padding:10px 12px"><button class="btn sm" type="button" onclick="navigator.clipboard.writeText(document.getElementById('refurl').value).then(()=>{this.textContent='Zkopírováno';setTimeout(()=>this.textContent='Kopírovat',1500)})">Kopírovat</button></div>
        <div class="small muted" style="margin-top:6px">Pošli ho komukoli — kdo se přes něj zaregistruje, objeví se tady mezi tvými doporučeními.</div></div>
      <div class="row">
        <a class="btn sec sm" href="https://wa.me/?text=${encodeURIComponent('Přidej se ke mně v Best Series 2.0 a pořiď si prádlomat: ' + (refUrl || ''))}" target="_blank" rel="noopener">WhatsApp</a>
        <a class="btn sec sm" href="mailto:?subject=${encodeURIComponent('Pozvánka do Best Series 2.0')}&body=${encodeURIComponent('Ahoj, přidej se ke mně v Best Series 2.0 a pořiď si prádlomat. Registrace tady: ' + (refUrl || ''))}">E-mail</a>
      </div>
    </div>
  </div>
  <div class="card tbl-wrap">${(team || []).length ? `<table class="cards"><thead><tr><th>Jméno</th><th>E-mail</th><th>Telefon</th><th>Registrace</th><th>Stav účtu</th><th>Objednávky</th></tr></thead><tbody>
    ${team.map(r => `<tr><td data-l="Jméno" class="nm"><b>${esc([r.first_name, r.last_name].filter(Boolean).join(' ') || r.nick || '—')}</b>${r.nick ? `<div class="small muted">${esc(r.nick)}</div>` : ''}</td>
      <td data-l="E-mail"><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></td><td data-l="Telefon">${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '<span class="muted">—</span>'}</td>
      <td data-l="Registrace" class="small muted">${fmtDT(r.activated_at || r.created_at)}</td>
      <td data-l="Stav"><span class="badge ${esc(r.status)}">${r.status === 'active' ? 'aktivní' : r.status === 'blocked' ? 'blokován' : 'čeká na aktivaci'}</span>${r.user_type === 'owner' ? ' <span class="badge type-owner">koupil prádlomat</span>' : ''}</td>
      <td data-l="Objednávky" class="small muted">${r.user_type === 'owner' ? 'prádlomat pořízen' : 'zatím bez objednávky'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted" style="margin:0">Zatím nikdo. Pošli svůj odkaz — první registrace se tu objeví hned.</p>'}</div>` });
}
function passwordPage({ s, nick, error = '', ok = '' }) {
  const u = s || { nick };
  const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ');
  return layout({ title: 'Můj účet', user: u.nick, nav: userNav(u), active: 'acc', fx: true, body: `
  <h1 style="margin-bottom:14px">Můj účet</h1>
  <div class="grid">
    <div class="card"><h2 style="margin-top:0">Údaje</h2>
      <div class="list-item"><span class="muted">Nick</span><b>${esc(u.nick)}</b></div>
      ${fullName ? `<div class="list-item"><span class="muted">Jméno</span><span>${esc(fullName)}</span></div>` : ''}
      <div class="list-item"><span class="muted">E-mail</span><span>${esc(u.email || '')}</span></div>
      <div class="list-item"><span class="muted">Účet aktivní od</span><span>${fmtDT(u.activated_at)}</span></div>
      <div class="list-item"><span class="muted">Poslední přihlášení</span><span>${fmtDT(u.last_login_at)}</span></div>
    </div>
    <div class="card"><h2 style="margin-top:0">Změna hesla</h2>
    ${error ? `<div class="msg err">${esc(error)}</div>` : ''}${ok ? `<div class="msg ok">${esc(ok)}</div>` : ''}
    <form method="post" action="/password"><label>Současné heslo</label><input name="old" type="password" autocomplete="current-password" required>
    <label>Nové heslo (min. 8)</label><input name="password" type="password" autocomplete="new-password" minlength="8" required>
    <label>Nové heslo znovu</label><input name="password2" type="password" autocomplete="new-password" minlength="8" required>
    <div style="height:14px"></div><button class="btn full" type="submit">Uložit nové heslo</button></form></div>
  </div>` });
}

// ── Admin (Tomáš, Jan přes SSO) ─────────────────────────────────────────────
const ADMIN_NAV = [
  { id: 'dash', href: '/admin', label: 'Přehled', icon: 'chart' },
  { id: 'sup', href: '/admin/supporters', label: 'Uživatelé', icon: 'users' },
  { id: 'prod', href: '/admin/products', label: 'Produkty', icon: 'box' },
  { id: 'imp', href: '/admin/import', label: 'Import', icon: 'upload', right: true },
];
function adminLayout(title, active, admin, body, holyosUrl) {
  return layout({ title, active, nav: ADMIN_NAV, user: admin.name || admin.username, holyosUrl, body,
    banner: { icon: 'users', title: 'Uživatelé', subtitle: 'Správa uživatelů Best Series 2.0, jejich přístupů a dalších agend na jednom místě' } });
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
  <p class="muted small">Přihlašovací stránka pro uživatele: <code>${esc(process.env.BS2_PUBLIC_URL || 'https://www.bestseries2.cz')}/login</code> — první přihlášení přes <code>/activate</code> (e-mail musí být v seznamu).</p>`, holyosUrl);
}
// Sloupce seznamu: základní (pevně Jméno) + volitelné základní + libovolné údaje z importu. Výběr je v cookie bs2_cols.
const BASE_COLS = [
  { key: 'email', label: 'E-mail', render: (r) => `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` },
  { key: 'nick', label: 'Nick', render: (r) => r.nick ? esc(r.nick) : '<span class="muted">—</span>' },
  { key: 'status', label: 'Stav', render: (r) => `<span class="badge ${esc(r.status)}">${r.status === 'active' ? 'aktivní' : r.status === 'blocked' ? 'blokován' : 'čeká na aktivaci'}</span>` },
  { key: 'user_type', label: 'Typ uživatele', render: (r) => typeBadge(r.user_type) },
  { key: 'last_login_at', label: 'Poslední přihlášení', render: (r) => `<span class="muted small">${fmtDT(r.last_login_at)}</span>` },
  { key: 'activated_at', label: 'Aktivován', render: (r) => `<span class="muted small">${fmtDT(r.activated_at)}</span>` },
  { key: 'created_at', label: 'Vytvořen v BS2', render: (r) => `<span class="muted small">${fmtDT(r.created_at)}</span>` },
  { key: 'source', label: 'Zdroj importu', render: (r) => `<span class="muted small">${esc(r.source || '—')}</span>` },
];
const DEFAULT_COLS = ['email', 'nick', 'user_type', 'status', 'last_login_at'];
// Typ uživatele: standard = stávající, owner = koupil prádlomat, seller = může prodávat
const USER_TYPE_LABEL = { standard: 'Stávající', owner: 'Koupil prádlomat', seller: 'Může prodávat' };
const typeBadge = (t) => { const k = USER_TYPE_LABEL[t] ? t : 'standard'; return `<span class="badge type-${k}">${USER_TYPE_LABEL[k]}</span>`; };
const typeSelect = (cur, name = 'user_type') => `<select name="${name}" style="width:auto">${Object.keys(USER_TYPE_LABEL).map(k => `<option value="${k}"${(cur || 'standard') === k ? ' selected' : ''}>${USER_TYPE_LABEL[k]}</option>`).join('')}</select>`;
const EXTRA_PRIO = ['active', 'pozice', 'level', 'obrat', 'profit', 'podil', 'visit', 'date', 'country', 'currency', 'lang', 'vip', 'founder_terms_accepted_at', 'id'];
function adminSupporters({ admin, rows, qstr = '', status = '', utype = '', total, msg = '', holyosUrl, cols = DEFAULT_COLS, extraKeys = [] }) {
  const baseSel = BASE_COLS.filter(c => cols.includes(c.key));
  const extraSel = cols.filter(k => k.startsWith('x:')).map(k => k.slice(2)).filter(k => extraKeys.includes(k));
  const sortedExtra = extraKeys.slice().sort((a, b) => { const ia = EXTRA_PRIO.indexOf(a), ib = EXTRA_PRIO.indexOf(b); return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b); });
  const head = '<th>Jméno</th>' + baseSel.map(c => `<th>${esc(c.label)}</th>`).join('') + extraSel.map(k => `<th title="údaj z importu">${esc(k)}</th>`).join('') + '<th></th>';
  const rowsHtml = rows.map(r => `<tr>
    <td data-l="Jméno" class="nm"><b title="${esc([r.last_name, r.first_name].filter(Boolean).join(' '))}">${esc([r.last_name, r.first_name].filter(Boolean).join(' ') || '—')}</b></td>
    ${baseSel.map(c => `<td data-l="${esc(c.label)}">${c.render(r)}</td>`).join('')}
    ${extraSel.map(k => { const v = r.extra ? r.extra[k] : null; return `<td data-l="${esc(k)}" class="small" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(v == null ? '' : v)}">${v == null || v === '' ? '<span class="muted">—</span>' : esc(v)}</td>`; }).join('')}
    <td class="actions"><div class="row"><a class="btn sec sm" href="/admin/supporters/${r.id}">Detail</a></div></td></tr>`).join('');
  const colCount = 2 + baseSel.length + extraSel.length;
  const picker = `
  <details class="colpick" id="colpick"><summary class="btn sec" title="Vybrat sloupce tabulky" style="padding:10px 12px">${ico('settings', 18)}</summary>
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
  return adminLayout('Uživatelé', 'sup', admin, `
  <style>
    .colpick{position:relative} .colpick summary{list-style:none;cursor:pointer;display:inline-flex} .colpick summary::-webkit-details-marker{display:none}
    .colpick-pop{position:absolute;right:0;top:calc(100% + 6px);z-index:20;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;width:min(560px,calc(100vw - 32px));box-shadow:0 12px 40px rgba(0,0,0,.5)}
    .colpick-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px} @media (max-width:600px){.colpick-grid{grid-template-columns:1fr}}
    .colpick-h{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--text2);margin-bottom:6px}
    .colpick-i{display:flex;align-items:center;gap:8px;font-size:14px;margin:0;padding:5px 0;color:var(--text);cursor:pointer} .colpick-i input{width:auto;margin:0}
    .colpick-scroll{max-height:40vh;overflow:auto;padding-right:4px}
  </style>
  <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
    <h1 style="margin:0">Uživatelé <span class="muted" style="font-size:14px;font-weight:500">${total}</span></h1>
    <div class="row"><a class="btn" href="/admin/import">${ico('upload', 17)} Import CSV / Excel</a><a class="btn sec" href="/admin/supporters/new">+ Přidat ručně</a>${picker}</div>
  </div>
  ${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}
  <form method="get" class="row" style="margin:10px 0 14px">
    <input name="q" value="${esc(qstr)}" placeholder="Hledat jméno / e-mail / nick…" style="flex:1;min-width:200px">
    <select name="status" style="width:auto"><option value="">Všechny stavy</option><option value="invited"${status === 'invited' ? ' selected' : ''}>Čeká na aktivaci</option><option value="active"${status === 'active' ? ' selected' : ''}>Aktivní</option><option value="blocked"${status === 'blocked' ? ' selected' : ''}>Blokovaní</option></select>
    <select name="type" style="width:auto"><option value="">Všechny typy</option>${Object.keys(USER_TYPE_LABEL).map(k => `<option value="${k}"${utype === k ? ' selected' : ''}>${USER_TYPE_LABEL[k]}</option>`).join('')}</select>
    <button class="btn sec" type="submit">Vyhledat</button>
  </form>
  <div class="card tbl-wrap"><table class="cards"><thead><tr>${head}</tr></thead><tbody>${rowsHtml || `<tr><td colspan="${colCount}" class="muted">Nic nenalezeno.</td></tr>`}</tbody></table></div>
  <script>document.addEventListener('click',function(e){var d=document.getElementById('colpick');if(d&&d.open&&!d.contains(e.target))d.removeAttribute('open');});</script>`, holyosUrl);
}
// Produkty: aktivní stroje z prodejního ceníku HolyOS (název + cena), jen čtení
const money = (v, c) => (v == null ? '<span class="muted">—</span>' : esc(Number(v).toLocaleString('cs-CZ', { maximumFractionDigits: 2 }) + ' ' + c));
function adminProducts({ admin, rows = [], error = '', msg = '', holyosUrl }) {
  const groups = {};
  for (const p of rows) { const k = [p.model_version, p.model_variant].filter(Boolean).join(' · ') || 'Ostatní'; (groups[k] = groups[k] || []).push(p); }
  const body = Object.keys(groups).map(k => `<h2 style="margin:18px 0 8px;font-size:15px;color:var(--text2)">${esc(k)}</h2>
    <div class="card tbl-wrap"><table class="cards"><thead><tr><th>Název</th><th>Typ stroje</th><th>Cena CZK</th><th>Cena EUR</th><th>Kamion CZK</th><th>Kamion EUR</th><th style="text-align:right">Nabízet uživatelům</th></tr></thead><tbody>
    ${groups[k].map(p => `<tr><td data-l="Název"><b>${esc(p.name_cs)}</b></td><td data-l="Typ stroje" class="small">${esc(p.machine_code || '—')}</td>
      <td data-l="Cena CZK">${money(p.price_czk, 'Kč')}</td><td data-l="Cena EUR">${money(p.price_eur, '€')}</td>
      <td data-l="Kamion CZK">${money(p.truck_price_czk, 'Kč')}</td><td data-l="Kamion EUR">${money(p.truck_price_eur, '€')}</td>
      <td data-l="Nabízet" class="actions" style="text-align:right"><form method="post" action="/admin/products/${p.id}/offer" style="display:inline"><input type="hidden" name="on" value="${p.offered ? '0' : '1'}"><button type="submit" class="sw ${p.offered ? 'on' : ''}" title="${p.offered ? 'Uživatelé tento stroj vidí — kliknutím skryješ' : 'Skryto — kliknutím zobrazíš uživatelům'}"><i></i><span>${p.offered ? 'Aktivní' : 'Skryto'}</span></button></form></td></tr>`).join('')}
    </tbody></table></div>`).join('');
  return adminLayout('Produkty', 'prod', admin, `
  <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
    <h1 style="margin:0">Produkty <span class="muted" style="font-size:14px;font-weight:500">${rows.length}</span></h1>
    <a class="btn sec sm" href="/admin/products?refresh=1">↻ Načíst znovu</a>
  </div>
  <p class="muted" style="margin-top:0">Typy prádlomatů a jejich ceny bez DPH — aktivní položky z prodejního ceníku HolyOS (úpravy se dělají tam). Přepínačem <b>Nabízet uživatelům</b> určíš, které stroje uvidí uživatelé BS2 na své domovské stránce.</p>
  <style>.sw{display:inline-flex;align-items:center;gap:8px;background:transparent;border:0;cursor:pointer;color:var(--text2);font:inherit;font-size:12.5px;font-weight:600;padding:4px 0}.sw i{width:38px;height:22px;border-radius:999px;background:rgba(120,160,255,.14);border:1px solid var(--border2);position:relative;transition:background .2s}.sw i::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--text2);transition:left .2s,background .2s}.sw.on{color:var(--ok)}.sw.on i{background:linear-gradient(90deg,var(--accent),var(--vio));border-color:transparent;box-shadow:0 0 14px rgba(58,108,245,.5)}.sw.on i::after{left:18px;background:#fff}</style>
  ${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}${error ? `<div class="msg err">${esc(error)}</div>` : ''}
  ${body || (error ? '' : '<p class="muted">V ceníku nejsou žádné aktivní stroje.</p>')}`, holyosUrl);
}
function adminSupporterDetail({ admin, s, msg = '', error = '', holyosUrl, isNew = false, firstLine = [] }) {
  const PRIO = ['active', 'pozice', 'level', 'obrat', 'profit', 'podil', 'visit', 'date', 'country', 'currency', 'lang', 'vip', 'founder_terms_accepted_at', 'id'];
  const HIDE_IN_LIST = /^(password|hash|secret|loggin_token|login_token|aed)$/i; // technické hodnoty ze starého systému — uložené jsou, jen se nezobrazují v detailu
  const keys = s && s.extra ? Object.keys(s.extra).filter(k => !HIDE_IN_LIST.test(k)).sort((a, b) => { const ia = PRIO.indexOf(a), ib = PRIO.indexOf(b); return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b); }) : [];
  const extra = keys.length ? keys.map(k => `<div class="list-item"><span class="muted">${esc(k)}</span><span style="text-align:right;word-break:break-all">${esc(s.extra[k])}</span></div>`).join('') : '<p class="muted small">Žádné další údaje.</p>';
  return adminLayout(isNew ? 'Nový uživatel' : 'Detail', 'sup', admin, `
  <p><a href="/admin/supporters">${ico('back', 15)} seznam</a></p>
  <h1>${isNew ? 'Nový uživatel' : esc([s.last_name, s.first_name].filter(Boolean).join(' ') || s.email)}</h1>
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
        ${isNew ? '' : `<label>Typ uživatele</label>${typeSelect(s.user_type)}<div class="small muted" style="margin-top:4px">Stávající · Koupil prádlomat · Může prodávat</div>`}
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
        <form method="post" action="/admin/supporters/${s.id}/password" onsubmit="return confirm('Vygenerovat nové dočasné heslo? Nick zůstane, staré heslo přestane platit.')"><button class="btn sm" type="submit">${ico('key', 16)} Nové heslo</button></form>
        <form method="post" action="/admin/supporters/${s.id}/${s.status === 'blocked' ? 'unblock' : 'block'}"><button class="btn ${s.status === 'blocked' ? 'sec' : 'danger'} sm" type="submit">${s.status === 'blocked' ? ico('check', 16) + ' Odblokovat' : ico('block', 16) + ' Blokovat'}</button></form>
        <form method="post" action="/admin/supporters/${s.id}/delete" onsubmit="return confirm('Opravdu smazat uživatele ' + ${JSON.stringify(s.email)} + '?')"><button class="btn danger sm" type="submit">${ico('trash', 16)} Smazat</button></form>
      </div>
    </div></details>
    <details class="card sec" data-sec="import" open><summary><span>Další údaje z importu <span class="muted small">(${keys.length})</span></span><span class="chev">▶</span></summary><div class="sec-body">${extra}</div></details>`}
  </div>
  ${isNew ? '' : `<details class="card sec" data-sec="linie" open style="margin-top:12px"><summary><span>První linie <span class="muted small">(${firstLine.length}) — kdo má v poli tab3 nick „${esc(s.nick || '—')}"</span></span><span class="chev">▶</span></summary><div class="sec-body">
    ${!s.nick ? '<p class="muted small">Uživatel nemá nick, první linii nelze určit.</p>' : firstLine.length ? `<div class="tbl-wrap"><table class="cards"><thead><tr><th>Jméno</th><th>Nick</th><th>E-mail</th><th>Stav</th><th>Registrace</th><th>Level</th><th>Obrat</th><th></th></tr></thead><tbody>${firstLine.map(r => `<tr>
      <td data-l="Jméno" class="nm"><b title="${esc([r.last_name, r.first_name].filter(Boolean).join(' '))}">${esc([r.last_name, r.first_name].filter(Boolean).join(' ') || '—')}</b></td>
      <td data-l="Nick">${r.nick ? esc(r.nick) : '<span class="muted">—</span>'}</td>
      <td data-l="E-mail"><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></td>
      <td data-l="Stav"><span class="badge ${esc(r.status)}">${r.status === 'active' ? 'aktivní' : r.status === 'blocked' ? 'blokován' : 'čeká na aktivaci'}</span></td>
      <td data-l="Registrace" class="small">${esc((r.extra && r.extra.date) || '—')}</td>
      <td data-l="Level" class="small">${esc((r.extra && r.extra.level) || '—')}</td>
      <td data-l="Obrat" class="small">${esc((r.extra && r.extra.obrat) || '—')}</td>
      <td class="actions"><div class="row"><a class="btn sec sm" href="/admin/supporters/${r.id}">Detail</a></div></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Nikoho nepřivedl.</p>'}
  </div></details>`}
  <script>
  // Sbalení sekcí se pamatuje (localStorage), stejné pro všechny uživatele
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
      <a class="btn sec" href="/admin/supporters">Zobrazit uživatele</a></div>`;
  }
  return adminLayout('Import', 'imp', admin, `
  <h1>Import uživatelů</h1>
  <p class="muted">Nahraj CSV nebo Excel (.xlsx/.xls) ze staré databáze — importuje se <b>1:1, všechny sloupce</b>. Klíčem je <b>e-mail</b>. Sloupce <code>memb/nick</code> a <code>password</code> (bcrypt) se přenesou jako nick a heslo, takže se uživatelé <b>přihlásí rovnou starými údaji</b>; ostatní sloupce se uloží jako další údaje. Existující záznam se jen doplní (nick ani heslo nastavené v BS2 se nepřepíší).</p>
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

module.exports = { DEFAULT_COLS, esc, layout, loginPage, activatePage, forgotPage, joinPage, supporterHome, supporterTeam, supporterProducts, passwordPage, adminDash, adminSupporters, adminProducts, adminSupporterDetail, adminImport, errorPage };
