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
.helpbtn{position:fixed;right:18px;top:118px;z-index:40;width:44px;height:44px;border-radius:50%;border:1px solid rgba(79,209,255,.6);background:linear-gradient(135deg,rgba(30,134,224,.55),rgba(124,92,255,.55));color:#fff;font:800 20px/1 Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 10px 30px rgba(30,134,224,.35),0 0 0 6px rgba(79,209,255,.08);backdrop-filter:blur(10px);animation:helpbob 3.2s ease-in-out infinite;transition:transform .2s,box-shadow .2s}
.helpbtn:hover{animation-play-state:paused;transform:scale(1.08);box-shadow:0 14px 36px rgba(79,209,255,.45),0 0 0 8px rgba(79,209,255,.12)}
@keyframes helpbob{0%,100%{translate:0 0}50%{translate:0 -7px}}
@media(max-width:760px){.helpbtn{top:auto;bottom:18px;right:14px}}
.helpdlg{border:0;padding:0;background:transparent;max-width:min(92vw,560px);width:100%;color:var(--text)} .helpdlg::backdrop{background:rgba(2,4,10,.7);backdrop-filter:blur(6px)}
.helpdlg .hd-in{background:var(--card2);border:1px solid var(--border2);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 40px rgba(30,134,224,.2);overflow:hidden}
.helpdlg .hd-head{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--border)} .helpdlg .hd-head h2{margin:0;font-size:17px;flex:1;letter-spacing:-.01em}
.helpdlg .hd-q{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;background:linear-gradient(135deg,rgba(30,134,224,.55),rgba(124,92,255,.55));border:1px solid rgba(79,209,255,.5);flex:none}
.helpdlg .hd-x{background:transparent;border:0;color:var(--text2);font-size:16px;cursor:pointer;padding:6px;border-radius:8px} .helpdlg .hd-x:hover{color:var(--text);background:rgba(255,255,255,.06)}
.helpdlg .hd-body{padding:16px 18px 18px;font-size:14.5px;line-height:1.55;color:var(--text)} .helpdlg .hd-body p{margin:0 0 10px} .helpdlg .hd-body p:last-child{margin:0} .helpdlg .hd-body b{color:var(--accent2)}
.soon{display:flex;align-items:center;gap:10px;margin-top:14px;padding:10px 12px;border-radius:12px;border:1px dashed var(--border2);color:var(--text2);font-size:13px}
.soon b{color:var(--accent2)}
@media (prefers-reduced-motion:reduce){.glow,.hero .eyebrow i{animation:none}}
`;

// Hlavní layout aplikace (uživatel i admin) ve stejném vizuálu jako přihlášení.
// fx:true přidá animovanou síť uzlů (uživatelské stránky); záře + grid jsou vždy.
// Nápověda k sekcím (plovoucí otazník vpravo nahoře) — na Domů se nezobrazuje
const HELP = {
  products: { title: 'Prádlomaty', html: `<p>Tady vidíte prádlomaty, které si můžete pořídit, s cenou bez DPH i s DPH 21 %. Měnu (Kč / €) přepnete vpravo nahoře.</p>
    <p><b>Discount Credit (DC)</b> můžete uplatnit jako slevu: klikněte na <b>Uplatnit DC</b>, zadejte kolik chcete použít (maximum je u každého stroje uvedeno) a cena se hned přepočítá.</p>
    <p>Tlačítkem <b>Koupit</b> odešlete objednávku. Nic se neplatí hned — objednávku potvrdíme a ozveme se Vám s dalším postupem (smlouva, financování, termín).</p>` },
  mine: { title: 'Moje svoboda', html: `<p>Přehled prádlomatů, které jste si pořídili, a Vašich objednávek včetně stavu (čeká na potvrzení / potvrzeno / dodáno).</p>
    <p>U každého stroje najdete typ, cenu bez DPH a uplatněný Discount Credit. Čím víc strojů tady máte, tím víc se Vám prádlomaty násobí — proto „Moje svoboda".</p>` },
  credit: { title: 'Discount Credit', html: `<p><b>Discount Credit (DC)</b> je Váš interní kredit. 1 DC = 1 Kč slevy na nákup prádlomatu.</p>
    <p>DC se Vám připíše, když si člověk z Vašeho doporučení (registrovaný přes Váš odkaz) koupí prádlomat — výše se řídí procentem u konkrétního stroje v tabulce níže.</p>
    <p>Kredit uplatníte v sekci <b>Prádlomaty</b> tlačítkem Uplatnit DC. DC nelze vyplatit v hotovosti, slouží jen jako sleva.</p>` },
  net: { title: 'Partnerská síť', html: `<p>Seznam lidí z Vaší <b>první linie</b> (registrovali se přes Váš odkaz), kteří si už koupili prádlomat — včetně typu stroje, ceny a data nákupu.</p>
    <p>Z každého takového nákupu Vám vzniká Discount Credit. Čísla nahoře: kolik lidí jste doporučili, kolik z nich nakoupilo a kolik prádlomatů celkem.</p>` },
  team: { title: 'Moje doporučení', html: `<p>Váš <b>registrační odkaz</b> je jedinečný. Pošlete ho komukoli (WhatsApp, e-mail, zkopírovat) — kdo se přes něj zaregistruje, objeví se v tabulce níže jako Vaše doporučení.</p>
    <p>U každého vidíte stav účtu (čeká na aktivaci / aktivní) a zda už si pořídil prádlomat. Jakmile nakoupí, připíše se Vám Discount Credit a člověk se zobrazí i v <b>Partnerské síti</b>.</p>` },
  cmp: { title: 'Compounder', html: `<p>Tahle sekce popisuje, <b>jak přemýšlí správný Compounder</b> — člověk, kterému se jeho vlastní prádlomaty násobí.</p>
    <p>Nejsou to pravidla, která Vám někdo nařizuje. Je to způsob uvažování, který odděluje majitele jednoho stroje od majitele sítě. Projděte si zásady, vyzkoušejte si, co se stane s jedním prádlomatem v čase, a pak se rozhodněte, kolik jich chcete.</p>`},
  acc: { title: 'Můj účet', html: `<p>Vaše údaje (nick, jméno, e-mail) a změna hesla. Nick nebo e-mail používáte k přihlášení.</p>
    <p>Pokud heslo zapomenete, použijte na přihlašovací stránce odkaz <b>Zapomenuté heslo</b> — ozveme se Vám s obnovou přístupu.</p>` },
};
// Ikona prádlomatu — jednoduchý izometrický „3D" model (samoobslužná prací stanice s bubnem a panelem)
function pradlomatSvg(size = 300) {
  const h = Math.round(size * 0.7);
  return `<svg class="pm3d" width="${size}" height="${h}" viewBox="0 0 320 224" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="pmBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9dde3"/><stop offset="1" stop-color="#b9bfc8"/></linearGradient>
    <linearGradient id="pmSide" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b6470"/><stop offset="1" stop-color="#2f353e"/></linearGradient>
    <linearGradient id="pmTop" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#eef1f4"/><stop offset="1" stop-color="#c9ced6"/></linearGradient>
    <linearGradient id="pmCy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fd0f2"/><stop offset="1" stop-color="#2aa8d8"/></linearGradient>
    <radialGradient id="pmDrum" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#4a5666"/><stop offset=".55" stop-color="#1b2129"/><stop offset="1" stop-color="#0a0d12"/></radialGradient>
    <linearGradient id="pmRing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#9aa3ad"/><stop offset="1" stop-color="#e6e9ed"/></linearGradient>
    <linearGradient id="pmGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".18"/><stop offset="1" stop-color="#4fd1ff" stop-opacity=".06"/></linearGradient>
    <filter id="pmGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <ellipse cx="160" cy="206" rx="140" ry="12" fill="#4fd1ff" opacity=".14"/>
  <!-- tmavý bok s 18 KG -->
  <path d="M236 44 L292 62 L292 186 L236 200 Z" fill="url(#pmSide)" stroke="#232931" stroke-width="1.2"/>
  <text x="264" y="118" fill="#e9edf1" font-family="Inter,Arial,sans-serif" font-weight="900" font-size="26" text-anchor="middle" transform="skewY(14) translate(0 -62)">18</text>
  <text x="264" y="148" fill="#e9edf1" font-family="Inter,Arial,sans-serif" font-weight="900" font-size="26" text-anchor="middle" transform="skewY(14) translate(0 -62)">KG</text>
  <!-- střecha -->
  <path d="M30 40 L236 44 L292 62 L84 58 Z" fill="url(#pmTop)" stroke="#9aa3ad" stroke-width="1"/>
  <!-- čelo -->
  <rect x="30" y="40" width="206" height="160" fill="url(#pmBody)" stroke="#8d96a1" stroke-width="1.2"/>
  <!-- horní pruh PRÁDLOMAT 24/7 -->
  <rect x="30" y="40" width="206" height="22" fill="#c4cad2"/>
  <rect x="30" y="40" width="96" height="22" fill="url(#pmCy)"/>
  <path d="M126 40 L140 51 L126 62 Z" fill="url(#pmCy)"/>
  <circle cx="44" cy="51" r="6" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M41 53 q3 -6 6 0" stroke="#fff" stroke-width="1.5" fill="none"/>
  <text x="56" y="56" fill="#fff" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="12">PRÁDLOMAT</text>
  <text x="186" y="56" fill="#fff" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="12" text-anchor="middle" opacity=".95">24/7</text>
  <!-- popisky nad bubny -->
  <text x="98" y="84" fill="#6c7682" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="9" text-anchor="middle">PRAČKA</text>
  <text x="155" y="84" fill="#6c7682" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="9" text-anchor="middle">PRAČKA</text>
  <text x="212" y="84" fill="#6c7682" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="9" text-anchor="middle">SUŠIČKA</text>
  <!-- modré šipky -->
  <path d="M92 90 h12 v14 l-6 6 l-6 -6 Z" fill="url(#pmCy)" opacity=".9"/><path d="M149 90 h12 v18 l-6 6 l-6 -6 Z" fill="url(#pmCy)" opacity=".9"/><path d="M206 90 h12 v10 l-6 6 l-6 -6 Z" fill="url(#pmCy)" opacity=".9"/>
  <!-- terminál -->
  <rect x="42" y="78" width="22" height="34" rx="2" fill="#f4f6f8" stroke="#aab2bb"/><rect x="46" y="82" width="14" height="18" rx="1.5" fill="#1b2129"/><rect x="48" y="84" width="10" height="4" fill="#4fd1ff" opacity=".9"/>
  <rect x="46" y="104" width="14" height="4" rx="1" fill="#2f353e"/>
  <path d="M42 150 l11 -8 l11 8 M42 162 l11 -8 l11 8" stroke="url(#pmCy)" stroke-width="3" fill="none" opacity=".8"/>
  <!-- bubny: 8 kg, 18 kg, 18 kg -->
  <g><circle cx="98" cy="138" r="21" fill="url(#pmRing)"/><circle cx="98" cy="138" r="17" fill="#2f353e"/><circle cx="98" cy="138" r="14" fill="url(#pmDrum)"/><circle cx="92" cy="131" r="4" fill="#fff" opacity=".22"/><text x="98" y="141" fill="#fff" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="7" text-anchor="middle">8 kg</text></g>
  <g><circle cx="155" cy="134" r="28" fill="url(#pmRing)"/><circle cx="155" cy="134" r="23" fill="#2f353e"/><circle cx="155" cy="134" r="19" fill="url(#pmDrum)"/><circle cx="147" cy="125" r="5" fill="#fff" opacity=".22"/><text x="155" y="137" fill="#fff" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="8" text-anchor="middle">18 kg</text></g>
  <g><circle cx="212" cy="128" r="28" fill="url(#pmRing)"/><circle cx="212" cy="128" r="23" fill="#2f353e"/><circle cx="212" cy="128" r="19" fill="url(#pmDrum)"/><circle cx="204" cy="119" r="5" fill="#fff" opacity=".22"/><text x="212" y="131" fill="#fff" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="8" text-anchor="middle">18 kg</text></g>
  <!-- bublinky -->
  <g stroke="#5fd0f2" stroke-width="1.6" fill="none" opacity=".85"><circle cx="110" cy="178" r="6"/><circle cx="128" cy="186" r="4"/><circle cx="146" cy="176" r="8"/><circle cx="166" cy="188" r="5"/><circle cx="184" cy="178" r="7"/><circle cx="204" cy="188" r="4"/><circle cx="222" cy="176" r="6"/></g>
  <g stroke="#ffffff" stroke-width="1.4" fill="none" opacity=".8"><circle cx="120" cy="170" r="3"/><circle cx="158" cy="166" r="4"/><circle cx="196" cy="168" r="3"/><circle cx="214" cy="190" r="3"/></g>
  <!-- skleněné bočnice (přístřešek) -->
  <path d="M8 46 L30 40 L30 200 L8 206 Z" fill="url(#pmGlass)" stroke="#9fb6c8" stroke-width="1"/>
  <path d="M236 44 L250 60 L250 196 L236 200 Z" fill="url(#pmGlass)" stroke="#9fb6c8" stroke-width="1" opacity=".9"/>
  <circle cx="19" cy="118" r="9" fill="none" stroke="url(#pmCy)" stroke-width="2" filter="url(#pmGlow)"/><path d="M14 121 q5 -9 10 0" stroke="url(#pmCy)" stroke-width="2" fill="none"/>
  <!-- rám + sokl -->
  <path d="M8 46 L30 40 M8 206 L30 200" stroke="#6c7682" stroke-width="1.5"/>
  <rect x="26" y="200" width="214" height="8" fill="#1b2129"/><path d="M240 200 L292 186 L292 194 L240 208 Z" fill="#0f1317"/>
</svg>`;
}
function helpWidget(h) {
  if (!h) return '';
  return `<button type="button" class="helpbtn" onclick="document.getElementById('helpdlg').showModal()" aria-label="Nápověda k sekci ${esc(h.title)}" title="Jak tato sekce funguje?">?</button>
<dialog id="helpdlg" class="helpdlg" onclick="if(event.target===this)this.close()"><div class="hd-in"><div class="hd-head"><span class="hd-q">?</span><h2>${esc(h.title)} — jak to funguje</h2><button type="button" class="hd-x" onclick="document.getElementById('helpdlg').close()" aria-label="Zavřít">✕</button></div><div class="hd-body">${h.html}</div></div></dialog>`;
}
function layout({ title, body, nav = [], active = '', user = null, holyosUrl = '', banner = null, fx = false, help }) {
  const { AUTH_JS } = require('./auth-shell');
  const h = help === null ? null : (help || HELP[active] || null);
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
<main>${body}</main>${helpWidget(h)}${fx ? `<script>${AUTH_JS}</script>` : ''}</body></html>`;
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
  const nav = [USER_NAV[0], { id: 'cmp', href: '/compounder', label: 'Compounder', icon: 'sprout' }];
  if (s && s.user_type === 'seller') nav.push({ id: 'team', href: '/team', label: 'Moje doporučení', icon: 'users' });
  if (s && s.user_type === 'seller') nav.push({ id: 'net', href: '/sit', label: 'Partnerská síť', icon: 'network' });
  nav.push({ id: 'products', href: '/pradlomaty', label: 'Prádlomaty', icon: 'box' }, { id: 'mine', href: '/moje-pradlomaty', label: 'Moje svoboda', icon: 'sun' }, { id: 'credit', href: '/discount-credit', label: 'Discount Credit', icon: 'bolt' }, USER_NAV[1]);
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
  ${homeStory(s)}
  ` });
}
// Domů — příběh příležitosti Best Series 2.0 (zaknihování prádlomatu do leasingu). Texty doplňujeme postupně.
function homeStory(s) {
  const ownerHint = s && s.user_type === 'owner' ? 'Už prádlomat máte. Teď jde o to, kolik jich budete mít.' : 'Dnes už není otázka, jestli si prádlomat můžete dovolit.';
  return `
  <style>
  .st{max-width:1040px}
  .st .first{margin:6px 0 14px}
  .st .intro{display:flex;align-items:center;justify-content:space-between;gap:24px;margin:0 0 26px}
  .st .intro .intro-txt{flex:1;min-width:0} .st .intro .lead{margin:0}
  .st .intro .pm3d{flex:none;width:460px;height:auto;animation:pmfloat 5s ease-in-out infinite;filter:drop-shadow(0 24px 48px rgba(30,134,224,.45)) drop-shadow(0 0 30px rgba(79,209,255,.18))}
  @keyframes pmfloat{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-10px) rotate(1deg)}}
  @media(max-width:900px){.st .intro{flex-direction:column;align-items:flex-start} .st .intro .pm3d{width:min(100%,380px);align-self:center}}
  .st .first .k{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent2);font-weight:700}
  .st .first h2{margin:4px 0 0;font-size:clamp(34px,6vw,72px);line-height:1;letter-spacing:-.03em;font-weight:900;color:#fff;text-shadow:0 0 40px rgba(79,209,255,.25)}
  .st .first h2 .cp{background:linear-gradient(90deg,var(--accent2),var(--vio));-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 18px rgba(124,92,255,.45))}
  .st .lead{font-size:clamp(17px,2vw,21px);line-height:1.5;color:var(--text);max-width:760px;margin:0 0 26px}
  .st .lead b{color:var(--accent2)}
  .st .lead b.cp{background:linear-gradient(90deg,var(--accent2),var(--vio));-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:900}
  .st h2{font-size:clamp(20px,2.6vw,28px);letter-spacing:-.02em;margin:0 0 6px}
  .st .sec{margin:0 0 26px}
  .st .tl{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:0 0 26px}
  .st .tl .c{position:relative;padding:18px;border-radius:16px;border:1px solid var(--border);background:var(--card);backdrop-filter:blur(14px)}
  .st .tl .c .y{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--text3);font-weight:700}
  .st .tl .c .t{font-size:18px;font-weight:800;margin:6px 0 4px}
  .st .tl .c p{margin:0;color:var(--text2);font-size:13.5px;line-height:1.45}
  .st .tl .c.now{border-color:rgba(79,209,255,.55);box-shadow:0 0 0 1px rgba(79,209,255,.25),0 20px 60px rgba(30,134,224,.25)}
  .st .tl .c.now .y{color:var(--accent2)}
  .st .big{padding:26px;border-radius:20px;border:1px solid var(--border2);background:linear-gradient(135deg,rgba(30,134,224,.18),rgba(124,92,255,.16));position:relative;overflow:hidden;margin:0 0 26px}
  .st .big:before{content:'';position:absolute;inset:-40%;background:radial-gradient(circle at 20% 20%,rgba(79,209,255,.18),transparent 45%),radial-gradient(circle at 80% 80%,rgba(124,92,255,.2),transparent 45%);pointer-events:none}
  .st .big *{position:relative}
  .st .big .k{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent2);font-weight:700}
  .st .big h2{font-size:clamp(24px,3.4vw,38px);line-height:1.1;margin:8px 0 10px;background:linear-gradient(90deg,#fff,var(--accent2) 60%,var(--vio));-webkit-background-clip:text;background-clip:text;color:transparent}
  .st .big p{margin:0;font-size:16px;line-height:1.55;color:var(--text);max-width:720px}
  .st .cmp{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
  .st .cmp span{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;border:1px solid var(--border2);background:rgba(4,8,16,.5);font-size:14px;font-weight:600}
  .st .cmp span.hi{border-color:rgba(47,227,160,.6);color:var(--ok);box-shadow:0 0 18px rgba(47,227,160,.25)}
  .st .g3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:0 0 26px}
  .st .g3 .c{padding:18px;border-radius:16px;border:1px solid var(--border);background:var(--card)}
  .st .g3 .c .i{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--accent2);background:linear-gradient(135deg,rgba(30,134,224,.35),rgba(124,92,255,.35));border:1px solid var(--border2);margin-bottom:10px}
  .st .g3 .c b{font-size:16px;display:block;margin-bottom:4px}
  .st .g3 .c p{margin:0;color:var(--text2);font-size:13.5px;line-height:1.45}
  .st .rule{padding:22px 24px;border-radius:18px;border:1px solid rgba(255,93,108,.35);background:rgba(255,93,108,.06);margin:0 0 26px}
  .st .rule .k{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--err);font-weight:700}
  .st .rule h2{margin:6px 0 8px}
  .st .rule p{margin:0;color:var(--text);line-height:1.55;max-width:760px}
  .st .rule .old{text-decoration:line-through;color:var(--text3)}
  .st .cta{display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;padding:22px 24px;border-radius:18px;border:1px solid var(--border2);background:var(--card2)}
  .st .cta .q{font-size:clamp(18px,2.2vw,24px);font-weight:800;letter-spacing:-.02em}
  .st .cta .q small{display:block;font-size:14px;font-weight:500;color:var(--text2);margin-top:4px}
  @media(max-width:760px){.st .tl,.st .g3{grid-template-columns:1fr}}
  </style>
  <div class="st">
    <div class="first"><span class="k">Best Series 2.0</span><h2>První <span class="cp">Compounder</span> v&nbsp;Čechách</h2></div>
    <div class="intro"><div class="intro-txt"><p class="lead">Od roku <b>2018</b> stavěla skupina lidí Best Series. Osm let práce, překážek a budování důvěry. <b>24. 9. 2026</b> se to zlomilo. Do teď jsme tvořili Best Series — od <b>24. 9. 2026</b> tvoří <b>Best Series 2.0</b> z lidí <b class="cp">Compoundery</b>.</p><a class="btn" href="/compounder" style="margin-top:16px">Jak přemýšlí Compounder ${ICON.arrow}</a></div><img class="pm3d" src="/img/pradlomat.webp" alt="Prádlomat 24/7" width="460" height="350" loading="eager" decoding="async"></div>

    <div class="tl">
      <div class="c"><div class="y">2018 – 2026</div><div class="t">Best Series</div><p>Osm let tvrdé práce: vlastní výroba, servis, síť míst, konzistence. Důvěra, která se nedá koupit — jen odpracovat.</p></div>
      <div class="c"><div class="y">24. 9. 2026</div><div class="t">Zlom</div><p>Bankovní domy si všimly, že český prádlomat je skvělý stroj — a <b>zaknihovaly ho do leasingových produktů</b>.</p></div>
      <div class="c now"><div class="y">25. 9. 2026 → dnes</div><div class="t">Best Series 2.0 → Compounder</div><p>Best Series 2.0 právě teď vrací několikanásobně větší hodnotu než kdy jindy. Vytváří z Vás Compoundery. <b>Kdo je Compounder?</b> Ten, komu se jeho vlastní prádlomaty násobí. <b>Jste to Vy!</b></p></div>
    </div>

    <div class="big">
      <div class="k">Co se stalo převratného</div>
      <h2>Banky berou prádlomat jako hodnotnou zástavu.</h2>
      <p>Umí ho zafinancovat jako auto nebo bagr — a v praxi lépe než nemovitost, protože si na sebe umí vydělat. Na konkrétní produkt tak přestal být strop. ${esc(ownerHint)}</p>
      <div class="cmp"><span>🚗 auto</span><span>🚜 bagr</span><span>🏠 nemovitost</span><span class="hi">🧺 prádlomat</span></div>
    </div>

    <div class="g3">
      <div class="c"><div class="i">${ico('bolt', 20)}</div><b>Páka</b><p>Nemusíte mít celou částku. Stroj je zástava sám o sobě a splácí se z vlastního výdělku.</p></div>
      <div class="c"><div class="i">${ico('sun', 20)}</div><b>Rychlost</b><p>Odpadá nejdelší fáze — šetření na další stroj. Rozhoduje, jak rychle najdete další dobré místo.</p></div>
      <div class="c"><div class="i">${ico('network', 20)}</div><b>Duplikace</b><p>Linková výroba + financování = stejný model se opakuje. Jeden prádlomat je začátek, ne cíl.</p></div>
    </div>

    <div class="rule">
      <div class="k">Pravidla hry se změnila</div>
      <h2>Už nejde o peníze. Jde o čas.</h2>
      <p><span class="old">Kolik prádlomatů si můžete dovolit?</span> → <b>Kolik prádlomatů stihnete mít, než si toho všimnou ostatní?</b> Dnes je to podpultová informace. Dříve nebo později si jí všimne někdo další a přiveze sem konkurenční stroj — zvlášť když jsme bankovní domy přesvědčili, že prádlomat je produkt, který stojí za financování. Záleží, kdo u toho bude.</p>
    </div>

    <div class="cta">
      <div class="q">Kolik prádlomatů chcete?<small>Ukažte, že jste dobrý partner — a limit přestane být číslo.</small></div>
      <a class="btn" href="/pradlomaty">Vybrat prádlomat ${ICON.arrow}</a>
    </div>
  </div>`;
}
// Compounder — jak přemýšlí správný Compounder (statická stránka, texty doplňujeme)
function supporterCompounder(s) {
  const P = [
    ['01', 'Nekupuje stroj. Kupuje čas.', 'Prádlomat nepotřebuje obsluhu, pracuje 24/7 a vydělává, i když spíte. Compounder počítá, kolik hodin svého života si každým strojem koupí zpátky — ne jen kolik korun.'],
    ['02', 'První stroj neslouží k utrácení. Slouží k pořízení druhého.', 'Výnos z prvního prádlomatu jde na splátku a zálohu dalšího. Spotřeba přijde až ve chvíli, kdy síť vydělává víc, než stačíte utratit. To je rozdíl mezi majitelem a Compounderem.'],
    ['03', 'Používá páku, ne úspory.', 'Bankovní domy berou prádlomat jako zástavu. Compounder nečeká, až našetří — nechá stroj, ať si na sebe vydělá sám, a své peníze používá jen tam, kde banka nemůže.'],
    ['04', 'Nemyslí na jeden stroj. Myslí na linku.', 'Jeden prádlomat je experiment. Pět prádlomatů je příjem. Dvacet je svoboda. Compounder se od začátku rozhoduje tak, aby šlo každé další místo zopakovat stejně — stejná smlouva, stejný servis, stejný proces.'],
    ['05', 'Místo je důležitější než stroj.', 'Stroj je vždycky stejný. Rozdíl dělá místo: lidé, průchod, parkování, konkurence. Compounder tráví čas hledáním dobrých míst, protože ví, že stroj dodáme my a místo si musí najít sám.'],
    ['06', 'Hraje na čas, ne na dokonalost.', 'Pravidla se změnila 24. 9. 2026 — dnes je to podpultová informace. Compounder ví, že okno nebude otevřené věčně, a radši má tři stroje teď než pět „až to bude ideální".'],
    ['07', 'Nedrží informaci pro sebe.', 'Lidé, které přivede, kupují vedle něj — ne proti němu. Každý další Compounder v okolí zvedá povědomí o prádlomatech, a tím i obrat všech. Proto má svůj doporučovací odkaz a Discount Credit.'],
    ['08', 'Měří, co se násobí.', 'Počet strojů. Měsíční obrat na stroj. Kolik strojů si síť sama zaplatí ročně. Compounder zná svoje tři čísla zpaměti a každé rozhodnutí poměřuje tím, jestli je zvedne.'],
  ];
  const steps = [['Rok 1', 1, 'první stroj si splácí sám'], ['Rok 2', 2, 'výnos z prvního = záloha na druhý'], ['Rok 3', 4, 'dva stroje platí dva další'], ['Rok 4', 8, 'síť roste rychleji než Vaše výdaje'], ['Rok 5', 16, 'linka — svoboda']];
  // Fáze Compoundera — doplňujeme postupně
  const PHASES = [
    { no: '1', k: 'Vztah s bankovním domem', title: 'Sblížení', visual: 'pilots', lead: 'Stejně jako mezi lidmi je i mezi Vámi a bankovním domem potřeba vybudovat vztah. Teď jste pro něj <b>nový partner</b> — a potřebuje Vás trochu poznat. Strategie je jednoduchá: <b>začněte jedním prvním prádlomatem</b> — verze MINI, ideálně bez financování.',
      points: [
        ['box', 'Jeden první prádlomat', 'Začněte <b>jedním strojem</b>. Ne třemi, ne pěti. Jeden stroj na jednom místě dá všechna data, která potřebujete — a nic Vás nenutí dělat další rozhodnutí dřív, než budete vědět.'],
        ['bolt', 'Verze MINI, ideálně bez financování', 'Pro první stroj doporučujeme <b>verzi MINI</b> a nejlépe ji <b>koupit za vlastní</b>. Žádná splátka, stroj od prvního dne vydělává jen Vám — a pro banku je to první důkaz, že to myslíte vážně.'],
        ['check', 'Pokud financování, pak s maximální akontací', 'Když první stroj přece jen financujete, dejte <b>co nejvyšší akontaci</b>. Čím víc vložíte, tím lépe Vás banka čte: nižší riziko, lepší podmínky pro další kola.'],
        ['sun', 'Tomuto stroji říkáme Pilot', 'Pilot slouží především k jednomu: <b>ověřit správné místo</b>. Stroj je vždycky stejný — rozdíl dělá lokalita. Pilot ji otestuje naostro.'],
      ],
      timeline: [['Den 0', 'Pilot v provozu'], ['1–6 měsíců', 'sběr dat o místě: obrat, vytížení, opakovaní zákazníci'], ['~6 měsíců', 'místo se verifikuje — nebo Pilota přemístíme jinam']],
      note: 'Dle statistik víme zhruba <b>po 6 měsících</b>, jestli se místo verifikuje, nebo je potřeba stroj přemístit na jiné místo. Díky tomu nikdy nerozšiřujete síť na místě, které nefunguje — a banka vidí, že rozhodujete podle čísel.' },
    { no: '2', k: 'Po 6 měsících', title: 'Násobení', visual: 'scale', lead: 'Uplynulo 6 měsíců. Už víte, <b>kteří Piloti místo verifikovali</b> a kteří ne. Od této chvíle se mění pravidla: na ověřené místo jde další stroj <b>100 % zafinancovaný</b> (0 % akontace) — stroj splácí sám sebe a ještě něco zbývá.',
      points: [
        ['check', 'Verifikované místo = stroj 100 % zafinancovaný', 'Na místo, které prokázalo čísla, dodáme <b>další prádlomat 100 % zafinancovaný bankou</b> — 0 % akontace. Nic nevkládáte — stroj si na sebe vydělá a splátku pokryje z vlastního obratu.'],
        ['network', 'Neverifikované místo = počkat, nebo přemístit', 'Pilot, který místo neověřil, buď ještě chvíli počká, nebo ho <b>přesuneme na nové místo</b>. Nic se neztrácí — stroj jede dál, jen jinde.'],
        ['box', 'Přistavujete další a další', 'Každé ověřené místo unese víc strojů a každý nový Pilot otevírá další místo. Síť roste z vlastních výnosů, ne z Vašich úspor.'],
        ['sun', 'Po pěti letech zůstane všechno Vám', 'Máte dobré místo, víte, kolik tam vyděláte, a víte, že se prádlomat sám zaplatí. Po splacení <b>je stroj i jeho výnos Váš</b> — každý měsíc, napořád.'],
      ],
      decision: true,
      note: 'Tady je potřeba udělat důležité rozhodnutí: <b>Kolik prádlomatů vlastně chci?</b> 3, 5, 10 nebo 100? Otázka nezní, kolik si můžete dovolit — ale <b>kolik peněz chcete mít pravidelně měsíčně za 5 let</b>.' },
  ];
  return layout({ title: 'Compounder', user: s.nick, nav: userNav(s), active: 'cmp', fx: true, body: `
  <style>
  .cp .hero2{margin:22px 0 26px;max-width:860px}
  .cp .hero2 .k{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent2);font-weight:700}
  .cp .hero2 h1{margin:4px 0 10px;font-size:clamp(30px,5vw,56px);line-height:1.02;letter-spacing:-.03em;font-weight:900}
  .cp .hero2 h1 .g{background:linear-gradient(90deg,var(--accent2),var(--vio));-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp .hero2 p{margin:0;font-size:clamp(16px,1.8vw,19px);line-height:1.55;color:var(--text)}
  .cp .def{display:flex;gap:16px;align-items:flex-start;padding:18px 20px;border-radius:18px;border:1px solid rgba(79,209,255,.4);background:linear-gradient(135deg,rgba(30,134,224,.16),rgba(124,92,255,.14));margin:0 0 26px;max-width:860px}
  .cp .def .q{flex:none;width:46px;height:46px;border-radius:14px;display:flex;align-items:center;justify-content:center;color:var(--accent2);background:rgba(4,8,16,.5);border:1px solid var(--border2)}
  .cp .def b{display:block;font-size:17px;margin-bottom:4px}
  .cp .def p{margin:0;color:var(--text);line-height:1.5}
  .cp .ladder{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:0 0 10px}
  .cp .ladder .r{padding:16px 12px;border-radius:16px;border:1px solid var(--border);background:var(--card);text-align:center;position:relative}
  .cp .ladder .r .y{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--text3);font-weight:700}
  .cp .ladder .r .n{font-size:clamp(28px,4vw,44px);font-weight:900;letter-spacing:-.03em;line-height:1.1;margin:4px 0;background:linear-gradient(180deg,#fff,var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp .ladder .r .t{font-size:12px;color:var(--text2);line-height:1.35}
  .cp .ladder .r:last-child{border-color:rgba(47,227,160,.55);box-shadow:0 0 30px rgba(47,227,160,.18)} .cp .ladder .r:last-child .n{background:linear-gradient(180deg,#fff,var(--ok));-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp .note{font-size:12.5px;color:var(--text3);margin:0 0 28px;max-width:860px}
  .cp h2.sec{font-size:clamp(20px,2.6vw,28px);letter-spacing:-.02em;margin:0 0 14px}
  .cp .pr{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:0 0 28px}
  .cp .pr .c{padding:20px;border-radius:16px;border:1px solid var(--border);background:var(--card);display:flex;gap:16px;transition:border-color .2s,transform .2s}
  .cp .pr .c:hover{border-color:rgba(79,209,255,.5);transform:translateY(-2px)}
  .cp .pr .c .no{flex:none;font-size:30px;font-weight:900;letter-spacing:-.04em;line-height:1;background:linear-gradient(180deg,var(--accent2),var(--vio));-webkit-background-clip:text;background-clip:text;color:transparent;min-width:46px}
  .cp .pr .c b{display:block;font-size:16.5px;margin:2px 0 6px;letter-spacing:-.01em}
  .cp .pr .c p{margin:0;color:var(--text2);font-size:14px;line-height:1.5}
  .cp .vs{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:0 0 28px}
  .cp .vs .c{padding:18px 20px;border-radius:16px;border:1px solid var(--border);background:var(--card)}
  .cp .vs .c.b{border-color:rgba(47,227,160,.5)} .cp .vs .c .h{font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;margin-bottom:10px} .cp .vs .c.a .h{color:var(--text3)} .cp .vs .c.b .h{color:var(--ok)}
  .cp .vs ul{margin:0;padding:0;list-style:none} .cp .vs li{padding:7px 0;border-top:1px solid var(--border);font-size:14px;line-height:1.4} .cp .vs li:first-child{border-top:0} .cp .vs .c.a li{color:var(--text2)}
  .cp .ph{margin:0 0 28px;padding:26px 28px;border-radius:22px;border:1px solid rgba(79,209,255,.3);background:linear-gradient(135deg,rgba(30,134,224,.12),rgba(124,92,255,.1));position:relative;overflow:hidden}
  .cp .ph:before{content:'';position:absolute;inset:-40%;background:radial-gradient(circle at 15% 15%,rgba(79,209,255,.16),transparent 45%);pointer-events:none}
  .cp .ph>*{position:relative}
  .cp .ph-head{display:flex;gap:20px;align-items:flex-start;margin-bottom:20px}
  .cp .ph-no{flex:none;width:76px;height:76px;border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,rgba(30,134,224,.5),rgba(124,92,255,.5));border:1px solid rgba(79,209,255,.5);box-shadow:0 14px 40px rgba(30,134,224,.35)}
  .cp .ph-no span{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#dff3ff;font-weight:700} .cp .ph-no b{font-size:34px;line-height:1;letter-spacing:-.03em;color:#fff}
  .cp .ph-k{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent2);font-weight:700}
  .cp .ph-head h2{margin:4px 0 8px;font-size:clamp(24px,3.2vw,36px);letter-spacing:-.025em}
  .cp .ph-head p{margin:0;color:var(--text);line-height:1.55;max-width:760px;font-size:15.5px}
  .cp .pilots{margin:4px 0 22px;padding:18px 18px 14px;border-radius:18px;border:1px solid var(--border);background:radial-gradient(ellipse at 50% 100%,rgba(79,209,255,.14),transparent 60%),rgba(4,8,16,.45)}
  .cp .pl-row{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;align-items:end}
  .cp .pl-row.one{grid-template-columns:1fr;justify-items:center} .cp .pl-row.one .pl{width:min(100%,520px)}
  .cp .pl{position:relative;text-align:center;animation:pmfloat 5s ease-in-out infinite}
  .cp .pl img{width:100%;height:auto;filter:drop-shadow(0 22px 36px rgba(0,0,0,.65)) drop-shadow(0 0 26px rgba(79,209,255,.25))}
  .cp .pl .pl-tag{position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);padding:5px 12px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:linear-gradient(135deg,var(--accent),var(--vio));box-shadow:0 8px 24px rgba(30,134,224,.45);white-space:nowrap}
  .cp .pl .pl-mini{position:absolute;top:6px;right:6px;padding:3px 8px;border-radius:999px;font-size:10.5px;font-weight:800;letter-spacing:.1em;color:var(--accent2);border:1px solid rgba(79,209,255,.5);background:rgba(4,8,16,.75)}
  .cp .pl-cap{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;justify-content:center;margin-top:22px;font-size:13.5px;color:var(--text)}
  .cp .pl-cap span{display:inline-flex;align-items:center;gap:8px} .cp .pl-cap i{width:8px;height:8px;border-radius:50%;background:var(--accent2);box-shadow:0 0 10px var(--accent2)}
  .cp .pl-cap .pl-arrow{color:var(--text3);font-size:18px} .cp .pl-cap .pl-goal{color:var(--ok);font-weight:700}
  @keyframes pmfloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
  @media(max-width:760px){.cp .pl-row{grid-template-columns:1fr;gap:26px} .cp .pl img{max-width:300px}}
  .cp .scale{display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin:4px 0 22px}
  .cp .sc-col{padding:16px;border-radius:18px;border:1px solid var(--border);background:rgba(4,8,16,.45);display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:12px;position:relative}
  .cp .sc-col.ok{border-color:rgba(47,227,160,.45);background:radial-gradient(ellipse at 50% 100%,rgba(47,227,160,.12),transparent 60%),rgba(4,8,16,.45)}
  .cp .sc-col.wait{border-color:rgba(245,158,11,.4)}
  .cp .sc-h{width:100%;display:flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700} .cp .sc-h i{width:8px;height:8px;border-radius:50%}
  .cp .sc-col.ok .sc-h{color:var(--ok)} .cp .sc-col.ok .sc-h i{background:var(--ok);box-shadow:0 0 10px var(--ok)}
  .cp .sc-col.wait .sc-h{color:#f59e0b} .cp .sc-col.wait .sc-h i{background:#f59e0b;box-shadow:0 0 10px #f59e0b}
  .cp .sc-m{position:relative;width:38%;min-width:150px;text-align:center;animation:pmfloat 5s ease-in-out infinite} .cp .sc-m.new{animation-delay:-2s} .cp .sc-col.wait .sc-m{width:52%}
  .cp .sc-m img{width:100%;height:auto;filter:drop-shadow(0 18px 30px rgba(0,0,0,.65)) drop-shadow(0 0 22px rgba(79,209,255,.22))}
  .cp .sc-m.dim img{filter:grayscale(.7) brightness(.7) drop-shadow(0 18px 30px rgba(0,0,0,.65))}
  .cp .sc-m .pl-tag{position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);padding:5px 12px;border-radius:999px;font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:linear-gradient(135deg,var(--accent),var(--vio));white-space:nowrap;box-shadow:0 8px 24px rgba(30,134,224,.45)}
  .cp .sc-m .pl-tag.z{background:linear-gradient(135deg,#1ea97c,var(--ok));box-shadow:0 8px 24px rgba(47,227,160,.4)} .cp .sc-m .pl-tag.g{background:#3a4454;box-shadow:none}
  .cp .sc-plus{font-size:34px;font-weight:900;color:var(--ok);text-shadow:0 0 18px rgba(47,227,160,.6)} .cp .sc-arrow{font-size:28px;color:#f59e0b}
  .cp .sc-t{width:100%;text-align:center;font-size:13px;color:var(--text2);margin-top:10px}
  .cp .dec{margin-top:14px;padding:20px 22px;border-radius:18px;border:1px solid rgba(124,92,255,.45);background:linear-gradient(135deg,rgba(124,92,255,.14),rgba(30,134,224,.1))}
  .cp .dec-q{font-size:clamp(20px,2.6vw,28px);font-weight:900;letter-spacing:-.02em;margin-bottom:12px}
  .cp .dec-opts{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
  .cp .dec-o{font:inherit;font-weight:800;font-size:20px;min-width:72px;padding:12px 18px;border-radius:14px;border:1px solid var(--border2);background:rgba(4,8,16,.6);color:var(--text2);cursor:pointer;transition:all .2s}
  .cp .dec-o:hover{color:var(--text);border-color:rgba(79,209,255,.5)} .cp .dec-o.on{color:#fff;background:linear-gradient(135deg,var(--accent),var(--vio));border-color:transparent;box-shadow:0 10px 30px rgba(30,134,224,.4);transform:translateY(-2px)}
  .cp .dec-out{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:14px;background:rgba(4,8,16,.5);border:1px solid var(--border);margin-bottom:12px}
  .cp .dec-k{display:block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--text3);font-weight:700}
  .cp .dec-out b{display:block;font-size:clamp(22px,3vw,32px);letter-spacing:-.02em;line-height:1.1;background:linear-gradient(180deg,#fff,var(--ok));-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp .dec-s{display:block;font-size:13px;color:var(--text2);margin-top:2px}
  .cp .dec-ask{font-size:15px;line-height:1.5;color:var(--text)} .cp .dec-ask b{color:var(--accent2)}
  @media(max-width:760px){.cp .scale{grid-template-columns:1fr}}
  .cp .ph-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:18px}
  .cp .ph-grid .c{padding:16px 18px;border-radius:16px;border:1px solid var(--border);background:rgba(4,8,16,.55)}
  .cp .ph-grid .i{width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;color:var(--accent2);background:linear-gradient(135deg,rgba(30,134,224,.35),rgba(124,92,255,.35));border:1px solid var(--border2);margin-bottom:10px}
  .cp .ph-grid b{display:block;font-size:15.5px;margin-bottom:4px} .cp .ph-grid p{margin:0;color:var(--text2);font-size:13.5px;line-height:1.5} .cp .ph-grid p b{display:inline;color:var(--accent2);font-size:inherit}
  .cp .ph-tl{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
  .cp .ph-tl .s{position:relative;padding:14px 14px 14px 52px;border-radius:14px;border:1px dashed var(--border2);background:rgba(4,8,16,.4)}
  .cp .ph-tl .s i{position:absolute;left:14px;top:14px;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-style:normal;font-weight:800;font-size:12px;color:#fff;background:linear-gradient(135deg,var(--accent),var(--vio))}
  .cp .ph-tl .s b{display:block;font-size:14px} .cp .ph-tl .s span{font-size:12.5px;color:var(--text2);line-height:1.4}
  .cp .ph-tl .s:last-child{border-color:rgba(47,227,160,.5)} .cp .ph-tl .s:last-child i{background:linear-gradient(135deg,#1ea97c,var(--ok))}
  .cp .ph-note{margin:0;padding:12px 16px;border-radius:12px;background:rgba(47,227,160,.07);border:1px solid rgba(47,227,160,.3);color:var(--text);font-size:14px;line-height:1.5} .cp .ph-note b{color:var(--ok)}
  .cp .ph-head p b{color:var(--accent2)}
  @media(max-width:760px){.cp .ph{padding:20px 18px} .cp .ph-grid,.cp .ph-tl{grid-template-columns:1fr} .cp .ph-head{flex-direction:column;gap:12px}}
  .cp .cta{display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;padding:22px 24px;border-radius:18px;border:1px solid var(--border2);background:var(--card2)}
  .cp .cta .q{font-size:clamp(18px,2.2vw,24px);font-weight:800;letter-spacing:-.02em} .cp .cta .q small{display:block;font-size:14px;font-weight:500;color:var(--text2);margin-top:4px}
  @media(max-width:760px){.cp .ladder{grid-template-columns:repeat(2,1fr)} .cp .pr,.cp .vs{grid-template-columns:1fr}}
  </style>
  <div class="cp">
    <div class="hero2"><div class="k">Best Series 2.0</div><h1>Jak přemýšlí <span class="g">správný Compounder</span></h1>
      <p>Compounder není titul. Je to způsob uvažování. Stejný stroj, stejná cena, stejná smlouva — a přesto jeden člověk skončí s jedním prádlomatem a druhý se sítí. Rozdíl je jen v hlavě.</p></div>

    ${PHASES.map(ph => `<section class="ph">
      <div class="ph-head"><div class="ph-no"><span>Fáze</span><b>${ph.no}</b></div><div><div class="ph-k">${esc(ph.k)}</div><h2>${esc(ph.title)}</h2><p>${ph.lead}</p></div></div>
      ${ph.visual === 'pilots' ? `<div class="pilots"><div class="pl-row one"><div class="pl"><img src="/img/pradlomat-mini.webp?v=3" alt="Pilot MINI" loading="lazy" decoding="async"><span class="pl-tag">Pilot — Váš první prádlomat</span><span class="pl-mini">MINI · ideálně bez financování</span></div></div><div class="pl-cap"><span><i></i>1 stroj · verze MINI · za vlastní (nebo s max. akontací)</span><span class="pl-arrow">→</span><span class="pl-goal">cíl: ověřit místo do ~6 měsíců</span></div></div>` : ''}
      ${ph.visual === 'scale' ? `<div class="scale"><div class="sc-col ok"><div class="sc-h"><i></i>Místo verifikováno</div><div class="sc-m"><img src="/img/pradlomat-mini.webp?v=3" alt="Pilot MINI" loading="lazy" decoding="async"><span class="pl-tag">Pilot</span></div><div class="sc-plus">+</div><div class="sc-m new"><img src="/img/pradlomat.webp" alt="Další stroj" loading="lazy" decoding="async"><span class="pl-tag z">100 % zafinancovaný</span></div><div class="sc-t">stroj splácí sám sebe — a ještě něco zbývá</div></div>
        <div class="sc-col wait"><div class="sc-h"><i></i>Místo neverifikováno</div><div class="sc-m dim"><img src="/img/pradlomat-mini.webp?v=3" alt="Pilot MINI" loading="lazy" decoding="async"><span class="pl-tag g">Pilot</span></div><div class="sc-arrow">⟶</div><div class="sc-t">počkat · nebo přemístit na nové místo a verifikovat znovu</div></div></div>` : ''}
      <div class="ph-grid">${ph.points.map(pt => `<div class="c"><div class="i">${ico(pt[0], 20)}</div><b>${esc(pt[1])}</b><p>${pt[2]}</p></div>`).join('')}</div>
      ${ph.timeline ? `<div class="ph-tl">${ph.timeline.map((t, i) => `<div class="s"><i>${i + 1}</i><b>${esc(t[0])}</b><span>${esc(t[1])}</span></div>`).join('')}</div>` : ''}
      ${ph.note ? `<p class="ph-note">${ph.note}</p>` : ''}
      ${ph.decision ? `<div class="dec"><div class="dec-q">Kolik prádlomatů vlastně chci?</div><div class="dec-opts">${[3, 5, 10, 100].map((n, i) => `<button type="button" class="dec-o${i === 1 ? ' on' : ''}" data-n="${n}" onclick="for(const b of this.parentNode.children)b.classList.remove('on');this.classList.add('on');document.getElementById('dec-n').textContent=this.dataset.n">${n}</button>`).join('')}</div>
        <div class="dec-out"><div><span class="dec-k">za 5 let</span><b><span id="dec-n">5</span> prádlomatů</b><span class="dec-s">splacených · Vašich · každý měsíc vydělávají jen Vám</span></div></div>
        <div class="dec-ask">Otázka tedy nezní „kolik strojů", ale: <b>Kolik peněz chcete mít pravidelně měsíčně za 5 let?</b></div></div>` : ''}
    </section>`).join('')}

    <div class="cta"><div class="q">Tak kolik jich chcete?<small>Jeden je začátek. Rozhodnutí, jestli budete Compounder, děláte u druhého.</small></div><a class="btn" href="/pradlomaty">Vybrat prádlomat ${ICON.arrow}</a></div>
  </div>` });
}
// Přepínač zobrazovací měny (CZK / EUR) — ukládá se u uživatele
const curOf = (s) => (s && s.currency === 'EUR' ? 'EUR' : 'CZK');
const curSw = (s, back) => `<form method="post" action="/currency" style="margin:0;display:inline-flex;gap:0;border:1px solid var(--border2);border-radius:999px;overflow:hidden"><input type="hidden" name="back" value="${esc(back)}">
  ${['CZK', 'EUR'].map(c => `<button type="submit" name="cur" value="${c}" class="btn sm ${curOf(s) === c ? '' : 'sec'}" style="border-radius:0;border:0;min-width:64px">${c === 'CZK' ? 'Kč' : '€'}</button>`).join('')}</form>`;
// cena s DPH 21 % v měně uživatele (EUR bere cenu EUR z ceníku)
const vatPrice = (p, cur) => { const b = cur === 'EUR' ? p.price_eur : p.price_czk; return b == null ? null : Math.round(Number(b) * 1.21); };
function supporterProducts(s, offers = [], { balance = 0, msg = '' } = {}) {
  const cur = curOf(s), sym = cur === 'EUR' ? '€' : 'Kč';
  const bal = Math.max(0, Math.floor(Number(balance) || 0));
  const fmt = (n) => Math.round(n).toLocaleString('cs-CZ');
  return layout({ title: 'Prádlomaty', user: s.nick, nav: userNav(s), active: 'products', fx: true, body: `
  <div class="row" style="justify-content:space-between;align-items:center;margin:22px 0 10px"><h2 style="margin:0;display:flex;align-items:center;gap:8px">${ico('box', 18)} Prádlomaty, které si můžeš pořídit</h2>${curSw(s, '/pradlomaty')}</div>
  ${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}
  <form id="orderf" method="post" action="/order" style="display:none"><input name="item"><input name="dc"></form>
  <div class="card" style="margin:0 0 14px;display:flex;flex-wrap:wrap;gap:18px;align-items:center;justify-content:space-between">
    <div><div class="small muted">Dostupné Discount Credit</div><div style="font-size:28px;font-weight:800;letter-spacing:-.02em"><span id="dc-left">${fmt(bal)}</span> <span style="font-size:18px">DC</span></div></div>
    <div class="small muted" style="max-width:520px">DC můžeš použít jako slevu na prádlomat. Klikni na <b>Uplatnit DC</b>, zadej kolik chceš uplatnit — cena se hned přepočítá. Tlačítkem <b>Koupit</b> odešleš objednávku, kterou potvrdíme.</div>
  </div>
  <div class="grid" id="dc-grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))">${offers.map(p => { const net = cur === 'EUR' ? p.price_eur : p.price_czk; const minB = cur === 'EUR' ? p.min_price_eur : p.min_price_czk; const minN = minB == null ? 0 : Number(minB); let room = net == null ? 0 : Math.max(0, Math.round(Number(net) - minN)); if (p.dc_use_pct != null && net != null) room = Math.min(room, Math.floor(Number(net) * Number(p.dc_use_pct) / 100)); return `
    <div class="card dc-card" style="margin:0" data-price="${net == null ? '' : Number(net)}" data-room="${room}"><b style="font-size:16px">${esc(p.name_cs)}</b>
      <div class="dc-price" style="margin-top:12px;font-size:24px;font-weight:800;letter-spacing:-.02em">${money(net, sym)}</div>
      <div class="small muted">cena bez DPH</div>
      <div class="small muted" style="opacity:.8">${money(vatPrice(p, cur), sym)} s DPH 21 %</div>
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)" class="small"><span class="muted">Maximální sleva z DC:</span> ${p.dc_use_pct == null && minB == null ? '<span class="muted">zatím nenastaveno</span>' : room > 0 ? `<b style="color:var(--ok)">${esc(Math.round(room).toLocaleString('cs-CZ'))} DC</b>` : '<span class="muted">nelze uplatnit</span>'}</div>
      ${room > 0 && net != null ? `<div class="small" style="margin-top:4px"><span class="muted">Cena po odečtení slevy:</span> <b>${money(Math.round(Number(net) - room), sym)}</b> <span class="muted">bez DPH · ${money(Math.round((Number(net) - room) * 1.21), sym)} s DPH</span></div>` : ''}
      ${net != null ? `<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><button type="button" class="btn sec sm dc-toggle"${bal > 0 && room > 0 ? '' : ' disabled style="opacity:.5;cursor:not-allowed" title="' + (bal > 0 ? 'Na tento prádlomat nelze DC uplatnit' : 'Nemáš žádné DC') + '"'}>Uplatnit DC</button><button type="button" class="btn sm dc-buy" data-item="${p.id}" data-name="${esc(p.name_cs)}">Koupit</button></div>` : ''}
      ${net != null && bal > 0 && room > 0 ? `<div class="dc-panel" style="display:none;margin-top:12px"><div style="display:flex;gap:8px;align-items:center"><input type="number" class="dc-in" min="0" max="${Math.min(bal, room)}" step="1" value="0" inputmode="numeric" style="width:120px;padding:8px 10px;text-align:right"><span class="muted">DC</span><button type="button" class="btn sec sm dc-max">Max</button></div>
      <div class="dc-after small" style="margin-top:8px;display:none">Po slevě: <b class="dc-new"></b> bez DPH <span class="muted">(<span class="dc-gross"></span> s DPH · ušetříš <span class="dc-saved"></span>)</span></div>
      ${minN > 0 ? `<div class="small muted" style="margin-top:6px">Nejnižší možná cena: ${money(minN, sym)} bez DPH</div>` : ''}</div>` : ''}
    </div>`; }).join('')}</div>
  ${offers.length ? '' : '<p class="muted">Momentálně nemáme žádnou nabídku.</p>'}
  <script>
  (function(){
    var total=${bal}, sym=${JSON.stringify(sym)};
    var cards=[].slice.call(document.querySelectorAll('.dc-card'));
    function fmt(n){return Math.round(n).toLocaleString('cs-CZ');}
    function used(except){var u=0;cards.forEach(function(c){if(c===except)return;var i=c.querySelector('.dc-in');if(i)u+=Math.max(0,parseInt(i.value,10)||0);});return u;}
    function recalc(){
      var u=0;
      cards.forEach(function(c){
        var i=c.querySelector('.dc-in'); if(!i)return;
        var price=parseFloat(c.getAttribute('data-price'))||0, room=parseFloat(c.getAttribute('data-room'));if(isNaN(room))room=price;
        var other=used(c), cap=Math.max(0,Math.min(room,total-other));
        var val=Math.max(0,parseInt(i.value,10)||0); if(val>cap){val=cap;i.value=cap;}
        i.max=cap; u+=val;
        var box=c.querySelector('.dc-after');
        if(val>0){box.style.display='block';c.querySelector('.dc-new').textContent=fmt(price-val)+' '+sym;c.querySelector('.dc-gross').textContent=fmt((price-val)*1.21)+' '+sym;c.querySelector('.dc-saved').textContent=fmt(val)+' '+sym;}else box.style.display='none';
      });
      document.getElementById('dc-left').textContent=fmt(total-u);
    }
    cards.forEach(function(c){
      var tg=c.querySelector('.dc-toggle'), pn=c.querySelector('.dc-panel');
      if(tg&&pn&&!tg.disabled)tg.addEventListener('click',function(){var open=pn.style.display==='none';pn.style.display=open?'block':'none';tg.textContent=open?'Skrýt DC':'Uplatnit DC';if(!open){var inp=pn.querySelector('.dc-in');inp.value=0;recalc();}});
      var buy=c.querySelector('.dc-buy');
      if(buy)buy.addEventListener('click',function(){
        var inp=c.querySelector('.dc-in'), val=(inp&&c.querySelector('.dc-panel').style.display!=='none')?Math.max(0,parseInt(inp.value,10)||0):0;
        var price=parseFloat(c.getAttribute('data-price'))||0;
        var txt='Objednat '+buy.getAttribute('data-name')+'?\n\nCena bez DPH: '+fmt(price-val)+' '+sym+(val>0?'\nUplatněno DC: '+fmt(val):'')+'\n\nObjednávku potvrdíme.';
        if(!confirm(txt))return;
        var f=document.getElementById('orderf');f.item.value=buy.getAttribute('data-item');f.dc.value=val;f.submit();
      });
    });
    cards.forEach(function(c){var i=c.querySelector('.dc-in'); if(!i)return;
      i.addEventListener('input',recalc);
      c.querySelector('.dc-max').addEventListener('click',function(){var room=parseFloat(c.getAttribute('data-room'));if(isNaN(room))room=parseFloat(c.getAttribute('data-price'))||0;i.value=Math.max(0,Math.min(room,total-used(c)));recalc();});
    });
  })();
  </script>` });
}
const PURCHASE_STATUS = { ordered: 'Objednáno', production: 'Ve výrobě', delivered: 'Dodáno', running: 'V provozu' };
const MODEL_L = { L1: 'L1 — nejkratší', L2: 'L2', L3: 'L3', L4: 'L4 — nejdelší' };
function supporterCredit(s, { rows = [], sellable = [], rate = 25 } = {}) {
  const cur = curOf(s), sym = cur === 'EUR' ? '€' : 'Kč', k = cur === 'EUR' ? 1 / (Number(rate) || 25) : 1;
  const conv = (x) => Math.round(Number(x) * k * 100) / 100;
  const bal = rows.reduce((a, r) => a + Number(r.amount_czk), 0) * k;
  return layout({ title: 'Discount Credit', user: s.nick, nav: userNav(s), active: 'credit', fx: true, body: `
  <div class="row" style="justify-content:space-between;align-items:center;margin:22px 0 10px"><h2 style="margin:0;display:flex;align-items:center;gap:8px">${ico('bolt', 18)} Discount Credit</h2>${curSw(s, '/discount-credit')}</div>
  <div class="card" style="max-width:420px"><div class="small muted">Dostupný kredit</div><div style="font-size:34px;font-weight:800;letter-spacing:-.02em">${money(bal, 'DC')}</div></div>
  <h3 style="margin:20px 0 8px">Prádlomaty, které mohu prodávat</h3>
  <div class="card tbl-wrap">${sellable.length ? `<table class="cards"><thead><tr><th>Prádlomat</th><th>Cena bez DPH</th><th>Discount Credit</th></tr></thead><tbody>
    ${sellable.map(p => { const vat = vatPrice(p, cur); const net = cur === 'EUR' ? p.price_eur : p.price_czk; const pct = Number(p.credit_pct || 0); return `<tr><td data-l="Prádlomat"><b>${esc(p.name_cs)}</b></td><td data-l="Cena bez DPH">${money(net, sym)}</td><td data-l="Discount Credit">${pct > 0 && net != null ? `<b style="color:var(--ok)">+${money(Math.round(Number(net) * pct) / 100, 'DC')}</b>` : '<span class="muted">—</span>'}</td></tr>`; }).join('')}</tbody></table>
    <p class="small muted" style="margin:10px 0 0">Credit se připíše, když člověk z tvého doporučení zakoupí prádlomat.</p>`
    : '<p class="muted" style="margin:0">Momentálně není nastavena žádná nabídka.</p>'}</div>
  <h3 style="margin:20px 0 8px">Historie</h3>
  <div class="card tbl-wrap">${rows.length ? `<table class="cards"><thead><tr><th>Datum</th><th>Popis</th><th>Částka</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td data-l="Datum" class="small muted">${fmtDT(r.created_at)}</td><td data-l="Popis">${esc(r.note || '—')}</td><td data-l="Částka"><b style="color:${Number(r.amount_czk) < 0 ? 'var(--err)' : 'var(--ok)'}">${Number(r.amount_czk) > 0 ? '+' : ''}${money(conv(r.amount_czk), 'DC')}</b></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted" style="margin:0">Zatím žádné pohyby na kreditním účtu.</p>'}</div>` });
}
function supporterMine(s, { rows = [], orders = [], msg = '' } = {}) {
  const sum = rows.reduce((acc, r) => acc + (r.price_czk == null ? 0 : Number(r.price_czk)), 0);
  const dt = (d) => (d ? new Date(d).toLocaleDateString('cs-CZ') : '—');
  const info = (l, val) => (val ? `<div class="list-item"><span class="muted">${l}</span><span style="text-align:right">${val}</span></div>` : '');
  const cards = rows.map(r => { const m = r.machine || {}; return `
    <div class="card" style="margin:0"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><b style="font-size:17px">${esc(r.product_name)}</b><span class="badge ${r.status === 'running' ? 'active' : 'invited'}">${esc(PURCHASE_STATUS[r.status] || r.status)}</span></div>
      <div style="font-size:22px;font-weight:800;margin:10px 0 6px">${money(r.price_czk, 'Kč')} <span class="small muted" style="font-weight:500">bez DPH</span></div>
      ${info('Datum nákupu', esc(dt(r.purchased_at)))}
      ${info('Typ stroje', esc(m.machine_code || ''))}
      ${info('Model', esc([m.model_version && (MODEL_L[m.model_version] || m.model_version), m.model_variant === 'H1' ? 'nižší (H1)' : m.model_variant === 'H2' ? 'standard (H2)' : m.model_variant].filter(Boolean).join(' · ')))}
      ${info('Sériové číslo', esc(r.serial_no || ''))}
      ${info('Umístění', esc(r.location || ''))}
      ${info('Poznámka', esc(r.note || ''))}
    </div>`; }).join('');
  return layout({ title: 'Moje svoboda', user: s.nick, nav: userNav(s), active: 'mine', fx: true, body: `
  <h2 style="margin:22px 0 10px;display:flex;align-items:center;gap:8px">${ico('sun', 18)} Moje svoboda — prádlomaty, které jsem si koupil</h2>
  <div class="grid" style="margin-bottom:12px">
    <div class="card" style="margin:0"><div class="small muted">Počet prádlomatů</div><div style="font-size:26px;font-weight:800">${rows.length}</div></div>
    <div class="card" style="margin:0"><div class="small muted">Investováno celkem (bez DPH)</div><div style="font-size:26px;font-weight:800">${money(sum, 'Kč')}</div></div>
  </div>
  ${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}
  ${orders.length ? `<h3 style="margin:0 0 8px">Moje objednávky</h3><div class="card tbl-wrap" style="margin-bottom:14px"><table class="cards"><thead><tr><th>Datum</th><th>Prádlomat</th><th>Cena bez DPH</th><th>Uplatněno DC</th><th>Stav</th></tr></thead><tbody>${orders.map(o => `<tr><td data-l="Datum" class="small muted">${fmtDT(o.created_at)}</td><td data-l="Prádlomat"><b>${esc(o.product_name)}</b></td><td data-l="Cena bez DPH">${money(o.final_net, o.currency === 'EUR' ? '€' : 'Kč')}</td><td data-l="Uplatněno DC">${Number(o.dc_used) > 0 ? esc(Number(o.dc_used).toLocaleString('cs-CZ')) + ' DC' : '<span class="muted">—</span>'}</td><td data-l="Stav"><span class="badge ${o.status === 'confirmed' ? 'active' : o.status === 'cancelled' ? 'blocked' : 'invited'}">${o.status === 'confirmed' ? 'potvrzeno' : o.status === 'cancelled' ? 'zrušeno' : 'čeká na potvrzení'}</span></td></tr>`).join('')}</tbody></table></div>` : ''}
  ${rows.length ? `<div class="grid">${cards}</div>` : '<div class="card"><p class="muted" style="margin:0">Zatím tu nemáš žádný prádlomat. Jakmile si nějaký pořídíš, objeví se tady.</p></div>'}` });
}
function supporterNetwork(s, { rows = [], lineCount = 0 } = {}) {
  const buyers = new Set(rows.map(r => r.id)).size;
  return layout({ title: 'Partnerská síť', user: s.nick, nav: userNav(s), active: 'net', fx: true, body: `
  <h2 style="margin:22px 0 10px;display:flex;align-items:center;gap:8px">${ico('network', 18)} Partnerská síť — kdo z mé první linie si koupil prádlomat</h2>
  <div class="grid" style="margin-bottom:12px">
    <div class="card" style="margin:0"><div class="small muted">Moje doporučení</div><div style="font-size:26px;font-weight:800">${lineCount}</div></div>
    <div class="card" style="margin:0"><div class="small muted">Kupující</div><div style="font-size:26px;font-weight:800">${buyers}</div></div>
    <div class="card" style="margin:0"><div class="small muted">Prádlomatů celkem</div><div style="font-size:26px;font-weight:800">${rows.length}</div></div>
  </div>
  <div class="card tbl-wrap">${rows.length ? `<table class="cards"><thead><tr><th>Jméno</th><th>E-mail</th><th>Telefon</th><th>Prádlomat</th><th>Cena</th><th>Datum nákupu</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td data-l="Jméno" class="nm"><b>${esc([r.first_name, r.last_name].filter(Boolean).join(' ') || r.nick || '—')}</b>${r.nick ? `<div class="small muted">${esc(r.nick)}</div>` : ''}</td>
      <td data-l="E-mail"><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></td>
      <td data-l="Telefon">${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '<span class="muted">—</span>'}</td>
      <td data-l="Prádlomat"><b>${esc(r.product_name)}</b></td>
      <td data-l="Cena">${money(r.price_czk, 'Kč')}</td>
      <td data-l="Datum nákupu" class="small muted">${r.purchased_at ? new Date(r.purchased_at).toLocaleDateString('cs-CZ') : '—'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted" style="margin:0">Zatím nikdo z tvé první linie prádlomat nekoupil. Jakmile se to stane, objeví se tady včetně typu stroje.</p>'}</div>` });
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
  { id: 'ord', href: '/admin/orders', label: 'Objednávky', icon: 'check' },
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
// Kolik firmě zbyde: prodejní cena (bez DPH) − sleva (využití DC, % z ceny) − provize (Discount Credit, % z ceny bez DPH po slevě) − minimální cena (= výrobní náklad)
const leftOver = (p, cur, sym) => {
  const price = cur === 'czk' ? p.price_czk : p.price_eur, cost = cur === 'czk' ? p.min_price_czk : p.min_price_eur;
  if (price == null) return '';
  if (cost == null) return `<div class="small muted">zadej min. cenu (${sym})</div>`;
  const P = Number(price), disc = P * Number(p.dc_use_pct || 0) / 100, paid = P - disc;
  const comm = paid * Number(p.credit_pct || 0) / 100, net = paid - comm, left = net - Number(cost);
  const pct = paid ? Math.round(left / paid * 1000) / 10 : 0;
  const tip = `Cena ${Math.round(P).toLocaleString('cs-CZ')} − sleva ${Math.round(disc).toLocaleString('cs-CZ')} − provize ${Math.round(comm).toLocaleString('cs-CZ')} − náklad ${Math.round(Number(cost)).toLocaleString('cs-CZ')} ${sym}`;
  return `<div title="${esc(tip)}" style="${left < 0 ? 'color:var(--err)' : ''}"><b>${money(Math.round(left), sym)}</b> <span class="small muted">(${esc(String(pct).replace('.', ','))} %)</span></div>`;
};
// Max. sleva = o kolik % lze cenu snížit až na minimální cenu (obě bez DPH)
const maxDisc = (price, min, sym) => { if (price == null || min == null || !Number(price)) return ''; const diff = Number(price) - Number(min); const pct = Math.round(diff / Number(price) * 1000) / 10; return `<div style="${diff < 0 ? 'color:var(--err)' : ''}"><b>${esc(String(pct).replace('.', ','))} %</b> <span class="small muted">(${money(diff, sym)})</span></div>`; };
// Kolik DC lze využít: % z ceny bez DPH, nejvýš však po minimální cenu
const dcUse = (p) => { if (p.dc_use_pct == null) return '<div class="small muted" style="margin-top:4px">bez omezení (jen min. cena)</div>'; const pct = Number(p.dc_use_pct); const f = (price, min, sym) => { if (price == null) return ''; let dc = Number(price) * pct / 100; if (min != null) dc = Math.min(dc, Math.max(0, Number(price) - Number(min))); return `<div class="small muted">= ${money(Math.round(dc), 'DC')} <span style="opacity:.7">(${sym})</span></div>`; }; return '<div style="margin-top:4px">' + f(p.price_czk, p.min_price_czk, 'Kč') + f(p.price_eur, p.min_price_eur, '€') + '</div>'; };
function adminOrders({ admin, rows = [], msg = '', holyosUrl, status = '', counts = {} }) {
  const sy = (o) => (o.currency === 'EUR' ? '€' : 'Kč');
  const st = (o) => `<span class="badge ${o.status === 'confirmed' ? 'active' : o.status === 'cancelled' ? 'blocked' : 'invited'}">${o.status === 'confirmed' ? 'potvrzeno' : o.status === 'cancelled' ? 'zrušeno' : 'čeká na potvrzení'}</span>`;
  return adminLayout('Objednávky', 'ord', admin, `
  <h1 style="margin:0 0 6px">Objednávky <span class="muted" style="font-size:14px;font-weight:500">${rows.length}</span></h1>
  <p class="muted" style="margin-top:0">Objednávky odeslané uživateli tlačítkem <b>Koupit</b>. Potvrzením vznikne nákup a prodejci se připíše provize v DC. Zrušením se uživateli vrátí uplatněné DC.</p>
  ${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}
  <div class="row" style="gap:8px;margin:10px 0 12px">${[['', 'Všechny', (counts.new || 0) + (counts.confirmed || 0) + (counts.cancelled || 0)], ['new', 'Čekají na potvrzení', counts.new || 0], ['confirmed', 'Potvrzené', counts.confirmed || 0], ['cancelled', 'Zrušené', counts.cancelled || 0]].map(([k, l, n]) => `<a class="btn sm ${status === k ? '' : 'sec'}" href="/admin/orders${k ? '?status=' + k : ''}">${l} <span style="opacity:.7">${n}</span></a>`).join('')}</div>
  <div class="card tbl-wrap">${rows.length ? `<table class="cards"><thead><tr><th>Datum</th><th>Uživatel</th><th>Prádlomat</th><th>Cena bez DPH</th><th>Uplatněno DC</th><th>Stav</th><th></th></tr></thead><tbody>
    ${rows.map(o => `<tr><td data-l="Datum" class="small muted">${fmtDT(o.created_at)}</td>
      <td data-l="Uživatel"><a href="/admin/supporters/${o.supporter_id}"><b>${esc([o.last_name, o.first_name].filter(Boolean).join(' ') || o.email)}</b></a><div class="small muted">${esc(o.nick || '')}</div></td>
      <td data-l="Prádlomat"><b>${esc(o.product_name)}</b></td>
      <td data-l="Cena bez DPH">${money(o.final_net, sy(o))} <span class="small muted">(ceník ${money(o.price_net, sy(o))})</span></td>
      <td data-l="Uplatněno DC">${Number(o.dc_used) > 0 ? esc(Number(o.dc_used).toLocaleString('cs-CZ')) + ' DC' : '<span class="muted">—</span>'}</td>
      <td data-l="Stav">${st(o)}</td>
      <td class="actions">${o.status === 'new' ? `<div class="row"><form method="post" action="/admin/orders/${o.id}/confirm" style="margin:0"><button class="btn sm" type="submit">Potvrdit</button></form><form method="post" action="/admin/orders/${o.id}/cancel" onsubmit="return confirm('Zrušit objednávku a vrátit DC?')" style="margin:0"><button class="btn danger sm" type="submit">Zrušit</button></form></div>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted" style="margin:0">Zatím žádné objednávky.</p>'}</div>`, holyosUrl);
}
function adminProducts({ admin, rows = [], error = '', msg = '', holyosUrl, rate = 25 }) {
  const groups = {};
  for (const p of rows) { const k = [p.model_version, p.model_variant].filter(Boolean).join(' · ') || 'Ostatní'; (groups[k] = groups[k] || []).push(p); }
  const body = Object.keys(groups).map((k, gi) => `<h2 style="margin:18px 0 8px;font-size:15px;color:var(--text2)">${esc(k)}</h2><form id="gf${gi}" method="post" action="/admin/products/save-group" style="display:none"></form>
    <div class="card tbl-wrap"><table class="cards"><thead><tr><th>Název</th><th>Cena CZK</th><th>Cena EUR</th><th>Discount Credit</th><th>Minimální cena bez DPH</th><th title="Prodejní cena − sleva (využití DC) − provize (Discount Credit) − minimální cena (bráno jako výrobní náklad)">Zbývá mi</th><th>Může být využito DC</th><th style="text-align:right">Nabízet uživatelům</th></tr></thead><tbody>
    ${groups[k].map(p => `<tr><td data-l="Název"><b>${esc(p.name_cs)}</b></td>
      <td data-l="Cena CZK">${money(p.price_czk, 'Kč')}</td><td data-l="Cena EUR">${money(p.price_eur, '€')}</td>
      <td data-l="Discount Credit"><div style="display:flex;align-items:center;gap:6px"><input form="gf${gi}" name="credit_pct_${p.id}" inputmode="decimal" value="${Number(p.credit_pct || 0)}" style="width:70px;padding:7px 8px;text-align:right"><span class="muted">%</span></div>${p.price_czk != null && Number(p.credit_pct) > 0 ? `<div class="small muted" style="margin-top:4px">= ${money(Math.round(Number(p.price_czk) * Number(p.credit_pct)) / 100, 'DC')} za prodej</div>` : ''}</td>
      <td data-l="Minimální cena"><div style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;align-items:center;gap:6px"><input form="gf${gi}" name="min_czk_${p.id}" inputmode="decimal" value="${p.min_price_czk != null ? Number(p.min_price_czk) : ''}" placeholder="—" style="width:110px;padding:7px 8px;text-align:right"><span class="muted">Kč</span></div>
        <div style="display:flex;align-items:center;gap:6px"><input form="gf${gi}" name="min_eur_${p.id}" inputmode="decimal" value="${p.min_price_eur != null ? Number(p.min_price_eur) : ''}" placeholder="—" style="width:110px;padding:7px 8px;text-align:right"><span class="muted">€</span></div></div></td>
      <td data-l="Zbývá mi">${leftOver(p, 'czk', 'Kč')}${leftOver(p, 'eur', '€')}</td>
      <td data-l="Může být využito DC"><div style="display:flex;align-items:center;gap:6px"><input form="gf${gi}" name="dc_use_pct_${p.id}" inputmode="decimal" value="${p.dc_use_pct != null ? Number(p.dc_use_pct) : ''}" placeholder="—" style="width:70px;padding:7px 8px;text-align:right"><span class="muted">%</span></div>
        ${dcUse(p)}</td>
      <td data-l="Nabízet" class="actions" style="text-align:right"><form method="post" action="/admin/products/${p.id}/offer" style="display:inline"><input type="hidden" name="on" value="${p.offered ? '0' : '1'}"><button type="submit" class="sw ${p.offered ? 'on' : ''}" title="${p.offered ? 'Uživatelé tento stroj vidí — kliknutím skryješ' : 'Skryto — kliknutím zobrazíš uživatelům'}"><i></i><span>${p.offered ? 'Aktivní' : 'Skryto'}</span></button></form></td></tr>`).join('')}
    </tbody></table>
    <div style="display:flex;justify-content:flex-end;padding:12px 4px 4px"><button class="btn sm" type="submit" form="gf${gi}">Uložit</button></div></div>`).join('');
  return adminLayout('Produkty', 'prod', admin, `
  <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
    <h1 style="margin:0">Produkty <span class="muted" style="font-size:14px;font-weight:500">${rows.length}</span></h1>
    <a class="btn sec sm" href="/admin/products?refresh=1">↻ Načíst znovu</a>
  </div>
  <p class="muted" style="margin-top:0">Typy prádlomatů a jejich ceny bez DPH — aktivní položky z prodejního ceníku HolyOS (úpravy se dělají tam). <b>Discount Credit</b> = kolik % z ceny bez DPH získá prodejce, když jeho doporučený zákazník koupí tento typ. <b>Může být využito DC</b> = kolik % z ceny bez DPH lze uhradit pomocí DC. Přepínačem <b>Nabízet uživatelům</b> určíš, které stroje uvidí uživatelé BS2 na své domovské stránce.</p>
  <style>.sw{display:inline-flex;align-items:center;gap:8px;background:transparent;border:0;cursor:pointer;color:var(--text2);font:inherit;font-size:12.5px;font-weight:600;padding:4px 0}.sw i{width:38px;height:22px;border-radius:999px;background:rgba(120,160,255,.14);border:1px solid var(--border2);position:relative;transition:background .2s}.sw i::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--text2);transition:left .2s,background .2s}.sw.on{color:var(--ok)}.sw.on i{background:linear-gradient(90deg,var(--accent),var(--vio));border-color:transparent;box-shadow:0 0 14px rgba(58,108,245,.5)}.sw.on i::after{left:18px;background:#fff}</style>
  <form method="post" action="/admin/settings/eur-rate" class="row" style="margin:6px 0 12px;gap:8px;align-items:center"><span class="muted">Kurz pro zobrazení v eurech: 1 € =</span><input name="rate" inputmode="decimal" value="${esc(String(rate).replace('.', ','))}" style="width:90px;padding:7px 8px;text-align:right"><span class="muted">Kč</span><button class="btn sec sm" type="submit">Uložit</button><span class="small muted">(přepočítává se jím kredit z Kč do €; ceny prádlomatů se berou z EUR ceníku)</span></form>
  ${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}${error ? `<div class="msg err">${esc(error)}</div>` : ''}
  ${body || (error ? '' : '<p class="muted">V ceníku nejsou žádné aktivní stroje.</p>')}`, holyosUrl);
}
function adminSupporterDetail({ admin, s, msg = '', error = '', holyosUrl, isNew = false, firstLine = [], purchases = [], machines = [], credits = [] }) {
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
        ${isNew ? '' : `<label>Typ uživatele</label>${typeSelect(s.user_type)}<div class="small muted" style="margin-top:4px">Stávající · Koupil prádlomat · Může prodávat</div>
        <label style="margin-top:12px">Discount Credit (zůstatek)</label><div style="display:flex;gap:8px;align-items:center"><input name="dc_balance" inputmode="decimal" value="${credits.reduce((a, c) => a + Number(c.amount_czk), 0).toLocaleString('cs-CZ').replace(/\u00a0/g, ' ')}" style="max-width:180px;text-align:right;font-weight:700"><span class="muted">DC</span></div><div class="small muted" style="margin-top:4px">Přepiš číslo a ulož — rozdíl se zapíše jako pohyb do historie DC níže a hned se promítne do účtu uživatele.</div>`}
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
  ${isNew ? '' : `<details class="card sec" data-sec="nakupy" open style="margin-top:12px"><summary><span>Prádlomaty (nákupy) <span class="muted small">(${purchases.length})</span></span><span class="chev">▶</span></summary><div class="sec-body">
    ${purchases.length ? purchases.map(p => `<form method="post" action="/admin/purchases/${p.id}" class="card" style="margin:0 0 10px;padding:12px">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:8px"><span><b>${esc(p.product_name)}</b> <span class="muted small">${p.purchased_at ? new Date(p.purchased_at).toLocaleDateString('cs-CZ') : ''}</span></span><span>${p.price_czk != null ? money(p.price_czk, 'Kč') : ''}</span></div>
      <div class="row" style="gap:10px;align-items:flex-end">
        <div style="width:150px"><label>Stav</label><select name="status">${Object.keys(PURCHASE_STATUS).map(k => `<option value="${k}"${p.status === k ? ' selected' : ''}>${PURCHASE_STATUS[k]}</option>`).join('')}</select></div>
        <div style="flex:1;min-width:140px"><label>Sériové číslo</label><input name="serial_no" value="${esc(p.serial_no || '')}"></div>
        <div style="flex:1;min-width:160px"><label>Umístění</label><input name="location" value="${esc(p.location || '')}" placeholder="adresa / lokalita"></div>
        <div style="flex:1;min-width:160px"><label>Poznámka</label><input name="note" value="${esc(p.note || '')}"></div>
        <button class="btn sm" type="submit">Uložit</button>
        <button class="btn danger sm" type="submit" formaction="/admin/purchases/${p.id}/delete" formnovalidate onclick="return confirm('Smazat nákup?')">${ico('trash', 14)}</button>
      </div></form>`).join('') : '<p class="muted small">Zatím žádný nákup.</p>'}
    <form method="post" action="/admin/supporters/${s.id}/purchases" style="margin-top:12px">
      <div class="row" style="align-items:flex-end;gap:10px">
        <div style="flex:2;min-width:200px"><label>Prádlomat z ceníku</label><select name="item"><option value="">— vybrat —</option>${machines.map(m => `<option value="${m.id}">${esc(m.name_cs)}${m.price_czk != null ? ' — ' + Number(m.price_czk).toLocaleString('cs-CZ') + ' Kč' : ''}</option>`).join('')}</select></div>
        <div style="flex:1;min-width:140px"><label>nebo vlastní název</label><input name="custom" placeholder="jiný typ"></div>
        <div style="width:150px"><label>Cena Kč (prázdné = z ceníku)</label><input name="price" inputmode="decimal"></div>
        <div style="width:150px"><label>Datum</label><input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      </div>
      <div style="height:10px"></div><button class="btn sm" type="submit">+ Přidat nákup</button>
    </form>
  </div></details>`}
  ${isNew ? '' : `<details class="card sec" data-sec="credit" open style="margin-top:12px"><summary><span>Discount Credit <span class="muted small">(zůstatek ${money(credits.reduce((a, c) => a + Number(c.amount_czk), 0), 'DC')})</span></span><span class="chev">▶</span></summary><div class="sec-body">
    ${credits.length ? credits.map(c => `<div class="list-item"><span>${esc(c.note || '—')} <span class="muted small">${fmtDT(c.created_at)}</span></span><span style="display:flex;gap:10px;align-items:center"><b>${Number(c.amount_czk) > 0 ? '+' : ''}${money(c.amount_czk, 'DC')}</b><form method="post" action="/admin/credits/${c.id}/delete" onsubmit="return confirm('Smazat pohyb?')" style="margin:0"><button class="btn danger sm" type="submit">${ico('trash', 14)}</button></form></span></div>`).join('') : '<p class="muted small">Žádné pohyby.</p>'}
    <form method="post" action="/admin/supporters/${s.id}/credits" class="row" style="margin-top:12px;align-items:flex-end;gap:10px">
      <div style="width:170px"><label>Částka DC (− = čerpání)</label><input name="amount" inputmode="decimal" required></div>
      <div style="flex:1;min-width:200px"><label>Popis</label><input name="note" placeholder="např. bonus za doporučení"></div>
      <button class="btn sm" type="submit">+ Zapsat</button>
    </form>
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

module.exports = { DEFAULT_COLS, esc, layout, loginPage, activatePage, forgotPage, joinPage, supporterHome, supporterCompounder, supporterTeam, supporterNetwork, supporterMine, supporterCredit, supporterProducts, passwordPage, adminDash, adminSupporters, adminProducts, adminOrders, adminSupporterDetail, adminImport, errorPage };
