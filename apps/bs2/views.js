// BS2 — HTML šablony (server-side, bez frameworku). Mobile-first, funguje na iPhone/Android/Windows/Mac.

const { logoSvg } = require('./logo');
const { ico } = require('./icons');
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDT(d) { if (!d) return '—'; try { return new Date(d).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } }

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
header .presence{margin:0 0 0 auto}
@media(max-width:700px){body header{padding:6px 10px;padding-top:calc(6px + env(safe-area-inset-top));gap:6px 8px;row-gap:4px}body header .brand{font-size:14px;order:0}body header .brand .mark svg{width:26px;height:26px}body header .tag,body header .brand+.tag{display:none}body header nav{order:1;margin-left:auto;gap:2px;flex:1 1 calc(100% - 170px);justify-content:flex-end}body header nav a{padding:6px 7px;font-size:13px}body header nav a span:not(.ic){display:none}body header nav a.suplink{position:relative}body header .presence{order:2;flex:0 0 auto;font-size:11px;padding:2px 8px;margin:0 auto 0 0}body header .ver{order:3;margin:0 0 0 auto;padding:0;font-size:10.5px;flex:1 1 auto;text-align:right;display:block;overflow:visible}}
header .brand{display:inline-flex;align-items:center;gap:10px;text-decoration:none;color:var(--text);font-weight:700;font-size:15px;letter-spacing:.02em}
header .envsw{display:inline-flex;border:1px solid var(--border2,rgba(120,160,255,.3));border-radius:999px;overflow:hidden;margin-right:6px;font-size:12.5px;font-weight:700}header .envsw a{padding:6px 12px;color:var(--text2);text-decoration:none;display:inline-flex;gap:6px;align-items:center}header .envsw a.on{background:linear-gradient(90deg,rgba(30,134,224,.55),rgba(124,92,255,.55));color:#fff}header .envsw a:not(.on):hover{color:#fff;background:rgba(120,160,255,.12)}@media(max-width:560px){header .envsw a span{display:none}}
header .ver{margin:0 auto;padding:0 12px;font-size:11.5px;color:var(--text2);opacity:.75;white-space:nowrap;letter-spacing:.01em;text-align:center;overflow:hidden;text-overflow:ellipsis}header .ver b{color:var(--text);font-weight:600}@media(max-width:820px){header .ver .vd{display:none}}
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
@media(max-width:700px){.tabs{position:sticky;top:var(--hh,52px);z-index:4;background:rgba(4,6,12,.86);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}}
.tabs .in{max-width:1100px;margin:0 auto;display:flex;gap:2px;padding:0 10px;white-space:nowrap}
.tabs a{display:inline-flex;align-items:center;gap:7px;padding:12px 14px;color:var(--text2);text-decoration:none;font-weight:600;font-size:14px;border-bottom:2px solid transparent}
.tabs a .ico{opacity:.8}.tabs a.active .ico{opacity:1;filter:drop-shadow(0 0 6px rgba(79,209,255,.6))}.tabs a.active{color:var(--accent2);border-bottom-color:var(--accent2);text-shadow:0 0 18px rgba(79,209,255,.5)} .tabs a:hover{color:var(--text)}
.tabs .right{margin-left:auto;display:inline-flex;gap:2px}
/* Menu bez vodorovného posuvníku: na počítači se zalomí do více řádků, v mobilu se posouvá prstem bez viditelné lišty */
.tabs{scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}
@media(min-width:701px){.tabs{overflow:visible}.tabs .in{flex-wrap:wrap;white-space:normal;row-gap:0}.tabs a{white-space:nowrap}}
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
.badge{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:2px 8px;border:1px solid} .badge.invited{color:var(--blue);border-color:rgba(79,209,255,.5)} .badge.active{color:var(--ok);border-color:rgba(47,227,160,.5)} .badge.blocked{color:var(--err);border-color:rgba(255,93,108,.5)} .badge.type-new{color:#2fe3a0;border-color:rgba(47,227,160,.5);background:rgba(47,227,160,.1)} .badge.type-standard{color:var(--text2);border-color:var(--border2)} .badge.type-owner{color:var(--accent2);border-color:rgba(79,209,255,.5)} .badge.type-seller{color:#c4b5ff;border-color:rgba(124,92,255,.6);background:rgba(124,92,255,.1)}
.auth{max-width:440px;margin:6vh auto 0} .auth .logo{font-size:28px;font-weight:900;text-align:center;margin-bottom:4px} .auth .sub{text-align:center;color:var(--text2);margin-bottom:18px}
table{width:100%;border-collapse:collapse;font-size:14px} td.nm{max-width:200px;width:200px} td.nm b{display:block;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} @media (max-width:720px){td.nm,td.nm b{max-width:none;width:auto;white-space:normal}} th,td{text-align:left;padding:9px 8px;border-top:1px solid var(--border);vertical-align:top} th{color:var(--text2);font-size:11px;text-transform:uppercase;letter-spacing:.06em;border-top:0}
.tbl-wrap{overflow:auto;-webkit-overflow-scrolling:touch}
td.actions{white-space:nowrap} td.actions .row{flex-wrap:nowrap} td.actions .btn{white-space:nowrap}
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
.suplink{position:relative;display:inline-flex;align-items:center;gap:6px} .sup-dot{width:9px;height:9px;border-radius:50%;background:#64748b;display:inline-block;box-shadow:0 0 0 2px rgba(4,6,12,.9)} .sup-dot.on{background:var(--ok);box-shadow:0 0 0 2px rgba(4,6,12,.9),0 0 10px var(--ok)}
.newdot{display:inline-block;width:9px;height:9px;margin-left:7px;border-radius:50%;background:#2ee59d;box-shadow:0 0 0 0 rgba(46,229,157,.7);vertical-align:middle;animation:newdotp 1.6s infinite}@keyframes newdotp{0%{box-shadow:0 0 0 0 rgba(46,229,157,.7)}70%{box-shadow:0 0 0 9px rgba(46,229,157,0)}100%{box-shadow:0 0 0 0 rgba(46,229,157,0)}}
.paydot{display:inline-block;width:9px;height:9px;margin-left:7px;border-radius:50%;background:#ff4d5e;vertical-align:middle;animation:paydotb 1s infinite}@keyframes paydotb{0%,100%{opacity:1;box-shadow:0 0 10px 2px rgba(255,77,94,.9)}50%{opacity:.25;box-shadow:none}}
.paynow{display:inline-block;padding:3px 9px;border-radius:999px;background:#e5222f;color:#fff;font-size:11px;font-weight:800;letter-spacing:.03em;animation:paydotb 1s infinite}
.sup-badge[hidden]{display:none!important} .sup-badge{position:absolute;top:-6px;right:-10px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--err);color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 0 12px rgba(255,93,108,.6)}
.sp-wrap{max-width:820px} .sp-log{display:flex;flex-direction:column;gap:8px;min-height:260px;max-height:60vh;overflow:auto;padding:14px;border:1px solid var(--border);border-radius:16px;background:rgba(4,8,16,.5)}
.sp-m{max-width:78%;padding:9px 13px;border-radius:14px;font-size:14.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word} .sp-m small{display:block;font-size:10.5px;opacity:.6;margin-top:3px}
.sp-m.user{align-self:flex-end;background:linear-gradient(135deg,rgba(30,134,224,.55),rgba(124,92,255,.5));border-bottom-right-radius:4px} .sp-m.agent{align-self:flex-start;background:rgba(120,160,255,.12);border:1px solid var(--border);border-bottom-left-radius:4px}
.sp-clip{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:11px;border:1px solid var(--border2);background:rgba(4,8,16,.6);cursor:pointer;font-size:18px;flex:none} .sp-clip input{display:none} .sp-clip:hover{border-color:var(--accent2)}
.sp-att{margin-top:6px} .sp-att img{max-width:260px;max-height:200px;border-radius:10px;border:1px solid var(--border2);display:block} .sp-att a{color:var(--accent2);font-size:13px}
.sp-off{padding:14px 16px;border-radius:14px;border:1px solid rgba(245,158,11,.5);background:rgba(245,158,11,.08);font-size:14px}
.sp-on{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--ok)} .sp-av{border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:5px;border:1px solid rgba(255,255,255,.25)} .sp-on i{width:9px;height:9px;border-radius:50%;background:var(--ok);box-shadow:0 0 10px var(--ok)}
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
.svc-split{display:grid;grid-template-columns:1.15fr 1fr;gap:14px;align-items:stretch} .svc-own{display:flex;flex-direction:column;gap:12px;padding:12px;border-radius:18px;border:1px dashed rgba(79,209,255,.35)} .svc-own>.card{margin:0}
.svc-h{display:flex;flex-direction:column;gap:2px;padding:2px 4px 0} .svc-h>b{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent2)} .svc-h>span{font-size:12.5px;color:var(--text2);line-height:1.4}
.svc-free{border-color:rgba(47,227,160,.5);background:linear-gradient(135deg,rgba(47,227,160,.1),rgba(14,22,40,.72))} .svc-free .svc-h>b{color:var(--ok)}
@media(max-width:860px){.svc-split{grid-template-columns:1fr}}
.svc-locked .btn:not(.dc-toggle){opacity:.45;cursor:not-allowed;pointer-events:none;filter:grayscale(.5)} .svc-locked .dc-toggle{opacity:.45;pointer-events:none} .svc-locked input[type=range]{opacity:.6}
.svc-inc{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:5px} .svc-inc li{font-size:13.5px;color:var(--text2);line-height:1.4} .svc-inc li b{color:var(--text)}
.svc-own.dim,.svc-free.dim{opacity:.35;filter:grayscale(.6);transition:opacity .3s} .svc-own.dim .btn,.svc-free.dim .btn{pointer-events:none}
.pfo{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:12px;border:1px solid var(--border2);background:rgba(4,8,16,.5);cursor:pointer;transition:border-color .2s,background .2s} .pfo input{display:none} .pfo>b{font-size:14px} .pfo>span{font-size:12px;color:var(--text2);line-height:1.4} .pfo>span b{color:var(--text)} .pfo.on{border-color:var(--ok);background:rgba(47,227,160,.08);box-shadow:0 0 0 1px rgba(47,227,160,.3)}
@media(max-width:640px){.pfc{grid-template-columns:1fr!important}}
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

// ── AI chat pro přihlášené uživatele: samostatná stránka /ai-chat (záložka v liště). ──
const AICHAT_CSS = `.aic-wrap{max-width:860px;margin:18px auto 0;display:flex;flex-direction:column;height:calc(100vh - 250px);min-height:420px;background:var(--card);border:1px solid var(--border2);border-radius:20px;backdrop-filter:blur(14px);overflow:hidden}
.aic-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--border);background:linear-gradient(90deg,rgba(30,134,224,.25),rgba(124,92,255,.2))}
.aic-head b{flex:1;font-size:17px}.aic-head button{background:none;border:1px solid var(--border2);border-radius:999px;color:var(--text2);cursor:pointer;font-size:13px;padding:6px 12px}
.aic-log{flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.aic-m{max-width:80%;padding:10px 14px;border-radius:16px;font-size:15px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.aic-m.u{align-self:flex-end;background:rgba(79,209,255,.18)}.aic-m.a{align-self:flex-start;background:rgba(255,255,255,.07)}.aic-m.e{color:#ff8a8a}
.aic-in{display:flex;gap:10px;padding:12px;border-top:1px solid var(--border)}
.aic-in input{flex:1;font-size:16px;padding:12px 14px}.aic-in button{padding:0 22px;border-radius:12px;border:0;background:linear-gradient(90deg,var(--accent),var(--vio));color:#fff;font-weight:700;cursor:pointer}
.aic-in button:disabled{opacity:.5}
.aic-note{font-size:11px;color:var(--text2);text-align:center;padding:0 10px 10px}
@media(max-width:760px){.aic-wrap{height:calc(100vh - 210px);border-radius:14px;margin-top:10px}.aic-m{max-width:92%}}`;
const AICHAT_JS = `(function(){
var log=document.getElementById('aic-log'),inp=document.getElementById('aic-in'),send=document.getElementById('aic-send'),cfg=null,hist=[];
try{ hist=JSON.parse(sessionStorage.getItem('aic_hist')||'[]'); }catch(e){ hist=[]; }
function save(){ try{ sessionStorage.setItem('aic_hist',JSON.stringify(hist.slice(-20))); }catch(e){} }
function rich(el,text){ el.textContent=String(text).split('*').join('').split(String.fromCharCode(96)).join('').split('### ').join('').split('## ').join(''); }
function add(role,text,cls){ var d=document.createElement('div'); d.className='aic-m '+(role==='user'?'u':'a')+(cls?' '+cls:''); rich(d,text); log.appendChild(d); log.scrollTop=log.scrollHeight; return d; }
function draw(){ log.innerHTML=''; if(cfg&&cfg.greeting) add('assistant',cfg.greeting); hist.forEach(function(m){ add(m.role,m.content); }); }
function off(msg,admin){ inp.disabled=true; send.disabled=true; inp.placeholder='Chat je vypnutý'; log.innerHTML=''; var m=add('assistant',msg); if(admin){ var l=document.createElement('a'); l.href='/admin/ai-chat'; l.textContent='→ Otevřít nastavení AI chatu'; l.style.cssText='display:block;margin-top:8px;color:var(--accent2)'; m.appendChild(l); } }
fetch('/api/ai-chat/config',{credentials:'same-origin'}).then(function(r){ return r.ok?r.json():null; }).then(function(c){
  if(!c){ off('Chat se nepodařilo načíst.'); return; }
  cfg=c; document.getElementById('aic-name').textContent=c.name||'Asistent';
  if(!c.enabled){ off(c.reason?('⚠️ '+c.reason+' (Tuto zprávu vidí jen správce.)'):'Chat teď není dostupný.',!!c.reason); return; }
  draw(); inp.focus();
}).catch(function(){ off('Chat se nepodařilo načíst.'); });
document.getElementById('aic-new').addEventListener('click',function(){ hist=[]; save(); draw(); inp.focus(); });
async function go(){
  var t=inp.value.trim(); if(!t||send.disabled) return; if(t.length>1500){ add('assistant','Zpráva je příliš dlouhá (max. 1 500 znaků).','e'); return; }
  inp.value=''; add('user',t); hist.push({role:'user',content:t}); save(); send.disabled=true; var w=add('assistant','…');
  try{
    var r=await fetch('/api/ai-chat',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:hist.slice(-12)})});
    var j=await r.json().catch(function(){ return {}; });
    if(!r.ok||j.error){ w.textContent=j.error||'Chat je teď nedostupný, zkus to prosím za chvíli.'; w.classList.add('e'); hist.pop(); save(); }
    else { rich(w,j.reply||'(prázdná odpověď)'); hist.push({role:'assistant',content:j.reply||''}); save(); }
  }catch(e){ w.textContent='Chyba spojení, zkus to prosím znovu.'; w.classList.add('e'); hist.pop(); save(); }
  send.disabled=false; log.scrollTop=log.scrollHeight; inp.focus();
}
send.addEventListener('click',go); inp.addEventListener('keydown',function(e){ if(e.key==='Enter') go(); });
})();`;
function aiChatPage(s) {
  return layout({ title: 'AI chat', user: s.nick, nav: userNav(s), active: 'aichat', fx: true, body: `<style>${AICHAT_CSS}</style>
  <div class="aic-wrap"><div class="aic-head">${ico('chat', 20)}<b id="aic-name">Asistent</b><button type="button" id="aic-new">Nový rozhovor</button></div>
  <div class="aic-log" id="aic-log"></div><div class="aic-in"><input id="aic-in" placeholder="Napiš dotaz…" maxlength="1500" autocomplete="off"><button type="button" id="aic-send">Poslat</button></div>
  <div class="aic-note">Odpovídá AI — důležité údaje si prosím ověř u našeho týmu.</div></div><script>${AICHAT_JS}</script>` });
}
let BUILD = null;
function setBuild(b) { BUILD = b; }
// Štítek „právě si prohlíží N" – na všech stránkách (veřejné, přihlášení, aplikace). Anonymní stránky pingují samy,
// přihlášení uživatelé jsou započteni přes sledovací skript. Při změně čísla štítek zazáří.
const PRESENCE_HTML = `<span class="presence" id="presence" title="Právě online + aktivní lidé za posledních 60 minut (klouzavé okno)"><i></i>právě si prohlíží <b id="pr-hour">–</b></span>`;
const PRESENCE_CSS = `.presence{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;border:1px solid rgba(47,227,160,.35);background:rgba(47,227,160,.08);color:#a9f5d9;font-size:12px;font-weight:500;white-space:nowrap;transition:box-shadow .3s,background .3s;font-family:inherit}.presence i{width:7px;height:7px;border-radius:50%;background:#2fe3a0;box-shadow:0 0 8px #2fe3a0;animation:prpulse 2s infinite}.presence b{font-weight:800;color:#fff}.presence.flash{box-shadow:0 0 0 2px rgba(47,227,160,.5),0 0 22px rgba(47,227,160,.75);background:rgba(47,227,160,.22)}.presence.flash b{text-shadow:0 0 10px #2fe3a0}@keyframes prpulse{0%,100%{opacity:1}50%{opacity:.45}}`;
const PRESENCE_JS = `(function(){var el=document.getElementById('presence');if(!el)return;var h=document.getElementById('pr-hour'),last='';
var sid;try{sid=localStorage.getItem('bs2pv');if(!sid){sid=Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem('bs2pv',sid);}}catch(e){sid='x'+Date.now();}
function ping(){if(window.__bs2t)return;try{fetch('/api/presence/ping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sid:sid,path:location.pathname}),keepalive:true});}catch(e){}}
function upd(){fetch('/api/presence',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(j){if(!j)return;var v=(j.total!=null?j.total:j.hour);var k=String(v);h.textContent=v;if(last&&k!==last){el.classList.add('flash');setTimeout(function(){el.classList.remove('flash');},1400);}last=k;}).catch(function(){});}
ping();setTimeout(upd,400);setInterval(function(){if(document.visibilityState==='visible'){ping();upd();}},15000);})();`;
function presenceWidget() { return { html: PRESENCE_HTML, css: PRESENCE_CSS, js: PRESENCE_JS }; }
function buildBadge() {
  if (!BUILD) return '';
  let when = '';
  try { when = new Date(BUILD.at).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { when = ''; }
  return `<span class="ver" title="Aktuální verze ${esc(BUILD.version)}${BUILD.sha ? ' · ' + esc(BUILD.sha) : ''}">Verze <b>${esc(BUILD.version)}</b><span class="vd"> · poslední aktualizace ${esc(when)}</span></span>`;
}
// Plovoucí tlačítko „Nápad na vylepšení“ + okno s textovým polem (jen pro přihlášené uživatele)
const IDEA_WIDGET = `<div id="idea-m" style="display:none;position:fixed;inset:0;z-index:95;background:rgba(2,6,16,.72);backdrop-filter:blur(3px);align-items:center;justify-content:center;padding:16px"><div class="card" style="width:min(520px,100%);margin:0;box-shadow:0 30px 80px rgba(0,0,0,.6)">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><b style="font-size:18px">💡 Nápad na vylepšení</b><button type="button" id="idea-x" class="btn sec sm" aria-label="Zavřít">✕</button></div>
  <p class="muted small" style="margin:6px 0 10px">Co by mohlo být v Best Series 2.0 lepší nebo co ti chybí? Napiš nám to, každý nápad čteme.</p>
  <textarea id="idea-t" rows="6" maxlength="3000" placeholder="Tvůj nápad…" style="width:100%;box-sizing:border-box;resize:vertical"></textarea>
  <div id="idea-msg" class="small" style="margin-top:8px;min-height:18px"></div>
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button type="button" id="idea-c" class="btn sec">Zrušit</button><button type="button" id="idea-s" class="btn">Odeslat</button></div>
</div></div>
<script>(function(){var m=document.getElementById('idea-m'),t=document.getElementById('idea-t'),g=document.getElementById('idea-msg'),s=document.getElementById('idea-s');if(!m)return;
function open(){m.style.display='flex';g.textContent='';t.focus();}function close(){m.style.display='none';}
[].forEach.call(document.querySelectorAll('.idea-open'),function(x){x.addEventListener('click',function(e){e.preventDefault();open();});});document.getElementById('idea-x').addEventListener('click',close);document.getElementById('idea-c').addEventListener('click',close);m.addEventListener('click',function(e){if(e.target===m)close();});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&m.style.display==='flex')close();});
s.addEventListener('click',function(){var v=t.value.trim();if(v.length<3){g.style.color='var(--err,#ff5d6c)';g.textContent='Napiš prosím alespoň pár slov.';return;}s.disabled=true;
fetch('/api/suggestion',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:v,page:location.pathname})}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});}).then(function(x){s.disabled=false;if(x.ok){t.value='';g.style.color='var(--ok,#2fe3a0)';g.textContent='Díky! Tvůj nápad jsme přijali.';setTimeout(close,1400);}else{g.style.color='var(--err,#ff5d6c)';g.textContent=(x.j&&x.j.error)||'Nepodařilo se odeslat.';}}).catch(function(){s.disabled=false;g.style.color='var(--err,#ff5d6c)';g.textContent='Chyba připojení, zkus to znovu.';});});})();</script>`;
function layout({ title, body, nav = [], active = '', user = null, holyosUrl = '', banner = null, fx = false, help }) {
  const { AUTH_JS } = require('./auth-shell');
  const h = help === null ? null : (help || HELP[active] || null);
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#04060c">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} · Best Series 2.0</title><link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}${PRESENCE_CSS}</style></head>
<body>${fx ? '<canvas id="net" aria-hidden="true"></canvas>' : ''}<div class="glow a"></div><div class="glow b"></div><div class="gridfx" aria-hidden="true"></div>
<header><a class="brand" href="/"><span class="mark">${logoSvg(32, 'h')}</span>Best Series&nbsp;<span class="v">2.0</span></a><span class="tag">soukromé</span>
${PRESENCE_HTML}${buildBadge()}<nav><!--BS2-SWITCH-->${fx && user && !holyosUrl ? `<a href="#" class="idea-open" title="Nápad na vylepšení" data-track="Nápad na vylepšení (lišta)" style="display:inline-flex;align-items:center;gap:6px;color:#ffd9a0"><span class="ic" aria-hidden="true">💡</span> <span>Nápad</span></a>` : ''}${fx && user && !holyosUrl ? `<a href="/podpora" id="sup-link" class="suplink${active === 'podpora' ? ' on' : ''}" title="Živá podpora">${ico('chat', 16)} <span>Podpora</span><i id="sup-dot" class="sup-dot off"></i><b id="sup-badge" class="sup-badge" hidden>0</b></a>` : ''}${fx && user ? `<a href="/password" class="acc-link${active === 'acc' ? ' on' : ''}" title="Můj účet · ${esc(user)}">${ico('user', 15)} <span>${esc(user)}</span></a>` : ''}${holyosUrl ? `<a href="${holyosUrl}">${ico('back', 15)} HolyOS</a>` : ''}${user && !fx ? `<a href="/logout" title="Odhlásit">${esc(user)} ${ico('logout', 15)}</a>` : ''}</nav></header>
${fx && user && !holyosUrl ? `<script>(function(){function f(){fetch('/api/support/state',{credentials:'same-origin'}).then(function(r){return r.ok?r.json():null}).then(function(j){if(!j)return;var d=document.getElementById('sup-dot'),b=document.getElementById('sup-badge'),l=document.getElementById('sup-link');if(d){d.className='sup-dot '+(j.online?'on':'off');}if(b){b.hidden=!j.unread;b.textContent=j.unread;}if(l)l.title=j.online?'Živá podpora — online':'Živá podpora — momentálně offline';}).catch(function(){});}f();setInterval(f,20000);})();</script>` : ''}
${banner ? `<div class="banner"><div class="in"><div class="ico">${ico(banner.icon || 'lock', 26)}</div><div><h1>${esc(banner.title)}</h1>${banner.subtitle ? `<p>${esc(banner.subtitle)}</p>` : ''}</div></div></div>` : ''}
${nav.length ? `<div class="tabs"><div class="in">${nav.filter(n => !n.right && !(fx && user && n.id === 'acc')).map(n => `<a href="${n.href}" class="${n.id === active ? 'active' : ''}">${n.icon ? ico(n.icon, 16) + ' ' : ''}${n.label}${n.pay ? '<i class="paydot" title="Čeká na zaplacení"></i>' : ''}${n.dot ? '<i class="newdot" title="Máte nový doklad"></i>' : ''}</a>`).join('')}<span class="right">${nav.filter(n => n.right && !(fx && user && n.id === 'acc')).map(n => `<a href="${n.href}" class="${n.id === active ? 'active' : ''}">${n.icon ? ico(n.icon, 16) + ' ' : ''}${n.label}</a>`).join('')}</span></div></div>` : ''}
<main>${body}</main><script>(function(){var h=document.querySelector('header');if(h){var m=function(){document.documentElement.style.setProperty('--hh',h.offsetHeight+'px');};m();addEventListener('resize',m);addEventListener('orientationchange',function(){setTimeout(m,250);});setTimeout(m,300);}
// Vodorovně posuvné menu: po načtení stránky zůstat na stejném místě jako před kliknutím (aktivní záložka zůstává vidět)
var t=document.querySelector('.tabs');if(!t)return;try{var k='bs2tabs:'+location.pathname.split('/')[1];var saved=sessionStorage.getItem('bs2tabsx');if(saved!=null){t.scrollLeft=+saved;}var act=t.querySelector('a.active,.active');if(act){var r=act.getBoundingClientRect(),tr=t.getBoundingClientRect();if(r.left<tr.left||r.right>tr.right){act.scrollIntoView({block:'nearest',inline:'center'});}}t.addEventListener('scroll',function(){try{sessionStorage.setItem('bs2tabsx',String(t.scrollLeft));}catch(e){}},{passive:true});}catch(e){}})();</script>${helpWidget(h)}${fx ? `<script>${AUTH_JS}</script>` : ''}<script>${PRESENCE_JS}</script>${fx && user && !holyosUrl ? `<script>${require('./stats-track').TRACK_JS}</script>` + IDEA_WIDGET : ''}</body></html>`;
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
    <p class="foot">Přihlášením souhlasíš s <a href="/vop">obchodními podmínkami</a></p>` });
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
      ${vopCheck(false)}${gdprCheck(false)}
      <button class="btn" type="submit">Vytvořit účet a přihlásit ${ICON.arrow}</button></form>`;
  return authShell({ title: 'Aktivace účtu', esc, card: inner + `<p class="foot"><a href="/login">${ico('back', 14)} zpět na přihlášení</a></p>` });
}
const GDPR_HTML = `<h1>Souhlas se zpracováním osobních údajů</h1>
<p>Udělením tohoto souhlasu se zpracováním osobních údajů poskytujete souhlas k tomu, aby <b>Best Series s.r.o.</b> (provozovatel platformy <b>Best Series 2.0</b>, <a href="https://www.bestseries2.cz">www.bestseries2.cz</a>, dále jako „správce“) zpracovávala Vaše osobní údaje dle dále uvedených podmínek.</p>
<h3>Rozsah zpracování Vašich osobních údajů</h3>
<p>Správce bude Vaše osobní údaje zpracovávat v rozsahu, v jakém jste je poskytli při registraci do Best Series 2.0 a v souvislosti s marketingovými aktivitami správce, konkrétně s přihlášením odběru mailových, tištěných nebo telefonických sdělení. Správce bude zpracovávat především jméno, příjmení, e‑mail, telefonní číslo, nick, adresu bydliště nebo adresu provozovny, název organizace a pracovní pozici.</p>
<h3>Účel zpracování Vašich osobních údajů</h3>
<p>Správce bude Vaše osobní údaje zpracovávat za účelem vedení Vašeho uživatelského účtu v Best Series 2.0 a za účely přímého marketingu (tj. nabízení produktů a služeb správce či třetích osob) včetně zasílání obchodních sdělení ve smyslu zákona č. 480/2004 Sb., o některých službách informační společnosti, a analýzy Vašeho chování týkajícího se těchto obchodních sdělení za účelem personalizace nabídky služeb.</p>
<h3>Právní základ zpracování osobních údajů</h3>
<p>Právním základem zpracování je tento Váš souhlas a skutečnost, že Vaše osobní údaje jsou nezbytné pro naplnění jednotlivých účelů přímého marketingu, jejichž odběr jste přihlásili. Osobní údaje jsou zpracovávány v souladu s Obecným nařízením o ochraně osobních údajů – Nařízením Evropského parlamentu a Rady (EU) 2016/679 ze dne 27. 4. 2016 (dále jako „GDPR“).</p>
<h3>Doba, po níž budou Vaše osobní údaje zpracovávány</h3>
<p>Správce bude Vaše osobní údaje zpracovávat v souvislosti s účelem přímého marketingu po dobu neurčitou od zaškrtnutí ve webovém rozhraní a následné registrace do Best Series 2.0 (<a href="https://www.bestseries2.cz">www.bestseries2.cz</a>, <a href="https://www.bestseries.cz">www.bestseries.cz</a>, <a href="https://www.bestseries.com">www.bestseries.com</a>); souhlas trvá do té doby, dokud jej neodvoláte.</p>
<h3>Odvolání souhlasu se zpracováním osobních údajů</h3>
<p>Tento Váš dobrovolně udělený souhlas se zpracováním osobních údajů můžete kdykoli bezplatně odvolat, a to prostřednictvím zaslání e‑mailu na adresu <a href="mailto:info@bestseries.cz">info@bestseries.cz</a>. Odvolání souhlasu je rovněž možné přímo z každého Vám zaslaného obchodního sdělení e‑mailem. Odvoláním souhlasu není dotčena zákonnost zpracování vycházejícího ze souhlasu, který byl dán před jeho odvoláním. Odvolání souhlasu též nemá vliv na zpracování osobních údajů, které správce zpracovává na základě jiného právního základu, než je souhlas.</p>
<h3>Osoby s přístupem k Vašim osobním údajům</h3>
<p>K Vašim osobním údajům bude mít přístup správce, jeho zaměstnanci a případně též třetí osoby – zpracovatelé, kteří poskytují vhodné záruky a jejichž zpracování splňuje všechny požadavky GDPR a kteří budou dostatečně chránit Vaše práva a Vaše osobní údaje. Těmito osobami jsou zejména právní a marketingoví poradci. Tyto osoby však budou mít přístup k těmto údajům jen po dobu nezbytně nutnou a v nezbytně nutném rozsahu, pokud to bude nutné pro poskytnutí služby a splnění zákonných požadavků.</p>
<h3>Kontaktní údaje správce</h3>
<p>Správce můžete kontaktovat na e‑mailu <a href="mailto:info@bestseries.cz">info@bestseries.cz</a>. Správce je oprávněn požadovat prokázání Vaší totožnosti za účelem zamezení přístupu neoprávněných osob k Vašim osobním údajům. Za účelem zvyšování kvality služeb a uchovávání záznamů o plnění právních povinností správce může být veškerá komunikace mezi Vámi a správcem monitorována.</p>
<h3>Vaše práva související s ochranou Vašich osobních údajů</h3>
<p>Máte právo kdykoliv odvolat svůj souhlas, opravit či doplnit osobní údaje, požadovat omezení zpracování, vznést námitku či stížnost proti zpracování osobních údajů, požadovat přenesení údajů, přístup ke svým osobním údajům, být informován o porušení zabezpečení osobních údajů, výmaz a další práva stanovená v GDPR.</p>
<h3>Právo vznést námitku</h3>
<p>Máte právo vznést námitku proti zpracování Vašich osobních údajů, jestliže je správce zpracovává pro účely přímého marketingu. Námitku je nutné podat správci. V případě, že vznesete námitku proti zpracování za účelem přímého marketingu, správce osobní údaje v tomto rozsahu dále nezpracovává, pokud neprokáže závažné oprávněné důvody pro zpracování, které převažují nad Vašimi zájmy nebo právy a svobodami, nebo pro určení, výkon nebo obhajobu právních nároků. Bližší informace o tomto právu obsahuje zejména čl. 21 GDPR.</p>
<h3>Právo podat stížnost u dozorového úřadu</h3>
<p>Kdykoliv můžete podat stížnost týkající se zpracování Vašich osobních údajů nebo neplnění povinností správce plynoucích z GDPR k dozorovému úřadu. Dozorovým úřadem je v ČR Úřad pro ochranu osobních údajů, se sídlem Pplk. Sochora 27, 170 00 Praha 7, <a href="https://www.uoou.cz">www.uoou.cz</a>.</p>
<h3>Povinnost poskytnout osobní údaje. Následky neposkytnutí osobních údajů</h3>
<p>Vaše osobní údaje poskytujete zcela dobrovolně. Nemáte žádnou povinnost je poskytnout. V případě, že Vaše osobní údaje neposkytnete, nehrozí Vám žádná sankce. Nicméně pokud osobní údaje správci neposkytnete, nebude Vám moci založit uživatelský účet v Best Series 2.0 ani posílat jednotlivá obchodní sdělení, ke kterým se přihlašujete (např. bez Vaší e‑mailové adresy Vám správce nebude schopen zaslat informace o nabídce prádlomatů nebo o změnách v platformě). Je však zcela na Vašem uvážení, zda chcete tato sdělení odebírat, či nikoliv.</p>`;
const VOP_HTML = require('./vop');
function consentPage({ name = '', error = '' } = {}) {
  return authShell({ title: 'Souhlas s podmínkami', esc, card: `
    <h2>Než budeš pokračovat</h2><p class="sub">${name ? 'Ahoj ' + esc(name) + '. ' : ''}Při prvním přihlášení potřebujeme tvůj souhlas s podmínkami.</p>
    ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
    <form method="post" action="/souhlas" novalidate>
      ${vopCheck(false)}${gdprCheck(false)}
      <button class="btn" type="submit">Souhlasím a pokračuji ${ICON.arrow}</button></form>
    <p class="foot"><a href="/logout">Odhlásit se</a></p>` });
}
function vopPage() {
  return authShell({ title: 'Všeobecné obchodní podmínky', esc, card: `<div class="gdpr">${VOP_HTML}</div><p class="foot"><a href="javascript:history.back()">${ico('back', 14)} zpět</a> · <a href="/login">přihlášení</a></p>`, wide: true });
}
function gdprPage() {
  return authShell({ title: 'Souhlas se zpracováním osobních údajů', esc, card: `<div class="gdpr">${GDPR_HTML}</div><p class="foot"><a href="javascript:history.back()">${ico('back', 14)} zpět</a> · <a href="/login">přihlášení</a></p>`, wide: true });
}
const LT = require('./location-terms');
function locVopPage() { return authShell({ title: 'Obchodní podmínky – Prověření lokality', esc, card: `<div class="gdpr">${LT.LOC_VOP_HTML}</div><p class="foot"><a href="javascript:history.back()">${ico('back', 14)} zpět</a> · <a href="/location">Prověření lokality</a></p>`, wide: true }); }
function locGdprPage() { return authShell({ title: 'Ochrana osobních údajů – Prověření lokality', esc, card: `<div class="gdpr">${LT.LOC_GDPR_HTML}</div><p class="foot"><a href="javascript:history.back()">${ico('back', 14)} zpět</a> · <a href="/location">Prověření lokality</a></p>`, wide: true }); }
const vopCheck = (checked) => `<label class="gdpr-chk"><input type="checkbox" name="vop" value="1" required${checked ? ' checked' : ''}> <span>Souhlasím se <a href="/vop" target="_blank">všeobecnými obchodními podmínkami</a> Best Series 2.0</span></label>`;
const gdprCheck = (checked) => `<label class="gdpr-chk"><input type="checkbox" name="gdpr" value="1" required${checked ? ' checked' : ''}> <span>Souhlasím se <a href="/gdpr" target="_blank">zpracováním osobních údajů</a> společností Best Series s.r.o. (Best Series 2.0)</span></label>`;
// Registrace přes referenční odkaz prodejce (/join/<code>)
function joinPage({ code, seller, f = {}, error = '' }) {
  const who = [seller.first_name, seller.last_name].filter(Boolean).join(' ') || seller.nick;
  return authShell({ title: 'Registrace', esc, card: `
    <h2>Vytvoř si účet</h2><p class="sub">Pozvánka od <b>${esc(who)}</b>. Po registraci uvidíš nabídku prádlomatů a svůj účet.</p>
    ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
    <form method="post" action="/join/${esc(code)}" novalidate>
      <label>Jméno</label>${field({ name: 'first_name', value: f.first_name || '', icon: 'user', placeholder: 'Jan', auto: 'given-name', extra: 'required autofocus' })}
      <label>Příjmení</label>${field({ name: 'last_name', value: f.last_name || '', icon: 'user', placeholder: 'Novák', auto: 'family-name', extra: 'required' })}
      <label>E-mail</label>${field({ name: 'email', type: 'email', value: f.email || '', icon: 'mail', placeholder: 'jmeno@email.cz', auto: 'email', extra: 'inputmode="email" autocapitalize="none" required' })}
      <label>Telefon <span style="color:var(--ink3)">(nepovinné)</span></label>${field({ name: 'phone', type: 'tel', value: f.phone || '', icon: 'phone', placeholder: '+420 …', auto: 'tel', extra: 'inputmode="tel"' })}
      <label>Nick</label>${field({ name: 'nick', value: f.nick || '', icon: 'user', placeholder: '3–30 znaků, písmena/čísla/._-', auto: 'username', extra: 'autocapitalize="none" autocorrect="off" minlength="3" maxlength="30" required' })}
      <label>Heslo</label>${field({ name: 'password', type: 'password', icon: 'lock', placeholder: 'min. 8 znaků', auto: 'new-password', extra: 'minlength="8" required', eye: true })}
      <label>Heslo znovu</label>${field({ name: 'password2', type: 'password', icon: 'lock', placeholder: 'pro kontrolu', auto: 'new-password', extra: 'minlength="8" required', eye: true })}
      ${vopCheck(!!f.vop)}${gdprCheck(!!f.gdpr)}
      <button class="btn" type="submit">Vytvořit účet ${ICON.arrow}</button>
    </form>
    <p class="foot">Už účet máš? <a href="/login">Přihlas se</a></p>` });
}
function resetPage({ token = '', nick = '', error = '', invalid = false } = {}) {
  return authShell({ title: 'Nové heslo', esc, card: invalid ? `
    <h2>Odkaz už neplatí</h2><p class="sub">Odkaz pro obnovu hesla vypršel nebo už byl použit. Vyžádej si prosím nový.</p>
    <p class="foot"><a href="/forgot">Zapomenuté heslo</a> · <a href="/login">přihlášení</a></p>` : `
    <h2>Nové heslo</h2><p class="sub">${nick ? 'Účet <b>' + esc(nick) + '</b>. ' : ''}Zvol si nové heslo (aspoň 8 znaků).</p>
    ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
    <form method="post" action="/reset/${esc(token)}" novalidate>
      <label>Nové heslo</label>${field({ name: 'password', type: 'password', icon: 'lock', placeholder: 'min. 8 znaků', auto: 'new-password', extra: 'minlength="8" required autofocus', eye: true })}
      <label>Heslo znovu</label>${field({ name: 'password2', type: 'password', icon: 'lock', placeholder: 'pro kontrolu', auto: 'new-password', extra: 'minlength="8" required', eye: true })}
      <button class="btn" type="submit">Uložit heslo ${ICON.arrow}</button></form>
    <p class="foot"><a href="/login">${ico('back', 14)} zpět na přihlášení</a></p>` });
}
function forgotPage({ email = '', error = '', done = false } = {}) {
  return authShell({ title: 'Zapomenuté heslo', esc, card: done ? `
    <h2>Zpráva přijata</h2><p class="sub">Pokud e-mail <b>${esc(email)}</b> v systému máme, právě jsme na něj poslali odkaz pro nastavení nového hesla. Platí 1 hodinu. Nic nepřišlo? Zkontroluj spam.</p>
    <p class="foot"><a href="/login">${ico('back', 14)} zpět na přihlášení</a></p>` : `
    <h2>Zapomenuté heslo</h2><p class="sub">Zadej e-mail, pod kterým jsi u nás veden. Pošleme ti odkaz pro nastavení nového hesla.</p>
    ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
    <form method="post" action="/forgot" novalidate><label>E-mail</label>${field({ name: 'email', type: 'email', value: email, icon: 'mail', placeholder: 'jmeno@email.cz', auto: 'email', extra: 'inputmode="email" autocapitalize="none" required autofocus' })}
    <button class="btn" type="submit">Poslat odkaz na e-mail ${ICON.arrow}</button></form>
    <p class="foot"><a href="/login">${ico('back', 14)} zpět na přihlášení</a></p>` });
}
const USER_NAV = [{ id: 'home', href: '/', label: 'Domů', icon: 'home' }, { id: 'acc', href: '/password', label: 'Můj účet', icon: 'user', right: true }];
// Prodejci (user_type = seller) mají navíc záložku Můj tým
const userNav = (s) => {
  if (s && s.user_type === 'location') return [{ id: 'loc', href: '/lokalita', label: 'Moje lokality', icon: 'box' }, { id: 'anal', href: '/lokalita/analyza', label: 'Vyhledávač míst', icon: 'network' }, USER_NAV[1]];
  const nav = [USER_NAV[0], { id: 'cmp', href: '/compounder', label: 'Compounder', icon: 'sprout' }, { id: 'products', href: '/pradlomaty', label: 'Prádlomaty', icon: 'box' }];
  if (s && ['seller', 'standard'].includes(s.user_type)) nav.push({ id: 'team', href: '/team', label: 'Moje doporučení', icon: 'users' });
  if (s && ['seller', 'standard'].includes(s.user_type)) nav.push({ id: 'net', href: '/sit', label: 'Partnerská síť', icon: 'network' });
  nav.push({ id: 'mine', href: '/moje-pradlomaty', label: 'Moje svoboda', icon: 'sun', dot: !!(s && s.new_docs > 0), pay: !!(s && s.unpaid_docs > 0) }, { id: 'credit', href: '/discount-credit', label: 'Discount Credit', icon: 'bolt' });
  if (s && s.ai_chat_on) nav.push({ id: 'aichat', href: '/ai-chat', label: 'AI chat', icon: 'chat' });
  nav.push(USER_NAV[1]);
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
    <div class="intro"><div class="intro-txt"><p class="lead">Od roku <b>2018</b> stavěla skupina lidí Best Series. Osm let práce, překážek a budování důvěry. <b>24. 9. 2026</b> se to zlomilo. Do teď jsme tvořili Best Series — od <b>24. 9. 2026</b> tvoří <b>Best Series 2.0</b> z lidí <b class="cp">Compoundery</b>.</p><a class="btn" href="/compounder" style="margin-top:16px">Jak přemýšlí Compounder ${ICON.arrow}</a></div><img class="pm3d" src="/img/pradlomat.webp?v=2" alt="Prádlomat 24/7" width="460" height="350" loading="eager" decoding="async"></div>

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
    { no: '0', k: 'Jak to vlastně funguje', title: 'Prádlomat po spuštění', visual: 'how', lead: 'Než se pustíme do strategie, podívejte se, co se děje, když prádlomat <b>uvedete do chodu</b>. Stojí na dobrém místě, je otevřený <b>24 hodin denně, 7 dní v týdnu</b> — a nepotřebuje žádnou obsluhu. Zákazník přijde, zaplatí, vypere nebo usuší. Peníze jdou na Váš účet.',
      points: [] },
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
      note: 'Tady je potřeba udělat důležité rozhodnutí: <b>Kolik prádlomatů vlastně chci?</b> 3, 5, 10 nebo 100? Otázka nezní, kolik si můžete dovolit — ale <b>kolik peněz chcete mít pravidelně měsíčně za 5 let, až se doplatí financování</b>.' },
    { no: '3', k: 'Pořád dokola', title: 'Smyčka', visual: 'loop', lead: 'Fáze 3 je v podstatě <b>opakování fází 1 a 2</b>. Pilotem ověříte místo, na ověřené místo dodáme 100 % zafinancovaný stroj, Pilota přesunete na nové místo a ověřujete znovu. <b>A tak pořád dokola.</b> Jediné, co je na Vás: kolik opakování uděláte.',
      points: [
        ['network', '1 · Pilot na nové místo', 'Pilota (stále ten samý MINI) postavíte na nové místo — začíná kolo.'],
        ['sun', '2 · Pilot ověřuje místo', 'Jeden stroj MINI, náběhová křivka, čísla rozhodnou.'],
        ['check', '3 · Místo verifikováno', 'Obrat a vytížení potvrdily, že místo funguje.'],
        ['box', '4 · Dodáme zafinancovaný stroj', 'Na ověřené místo jde prádlomat 100 % zafinancovaný. Splácí se sám — a Pilot jede na další místo. Každé kolo = +1 stroj, který je po splacení Váš.'],
      ] },
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
  .cp .how{margin:4px 0 22px;padding:14px;border-radius:18px;border:1px solid var(--border);background:radial-gradient(ellipse at 50% 100%,rgba(79,209,255,.12),transparent 60%),rgba(4,8,16,.45)}
  .cp .how-stage{position:relative;width:min(100%,440px);margin:0 auto;aspect-ratio:1000/820;overflow:visible;min-height:560px}
  .cp .how-mach{position:absolute;inset:0}
  .cp .how-img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 24px 40px rgba(0,0,0,.7)) drop-shadow(0 0 30px rgba(79,209,255,.25))}
  .cp .how-w8{width:9%!important}
  .cp .how-d{position:absolute;width:12%;aspect-ratio:1;transform:translate(-50%,-50%);pointer-events:none}
  .cp .how-d i{position:absolute;inset:0;border-radius:50%;border:3px solid rgba(79,209,255,.0);transition:border-color .3s}
  .cp .how-d span{position:absolute;left:50%;top:106%;transform:translateX(-50%);white-space:nowrap;font-size:10px;font-weight:700;color:#fff;background:rgba(4,8,16,.7);padding:1px 6px;border-radius:999px;opacity:0;transition:opacity .3s} .cp .how-d.on span{opacity:1}
  .cp .how-d.on i{border-color:rgba(79,209,255,.85);box-shadow:0 0 22px rgba(79,209,255,.55),inset 0 0 18px rgba(79,209,255,.25);border-top-color:#fff;animation:howspin .7s linear infinite}
  .cp .how-s.on i{border-color:rgba(245,158,11,.9);box-shadow:0 0 22px rgba(245,158,11,.55),inset 0 0 18px rgba(245,158,11,.25);border-top-color:#fff;animation:howspin 1s linear infinite}
  @keyframes howspin{to{transform:rotate(360deg)}}
  .cp .how-cust,.cp .how-bag{position:absolute;line-height:1;transform:translate(-50%,-50%);opacity:0;filter:drop-shadow(0 6px 10px rgba(0,0,0,.7));z-index:3}
  .cp .how-cust{width:22%;aspect-ratio:1/2} .cp .how-cust.flip svg{transform:scaleX(-1)} .cp .how-cust svg{width:100%;height:100%;display:block;animation:howbob .7s ease-in-out infinite}
  @keyframes howbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3%)}}
  .cp .how-bag{font-size:30px;z-index:4}
  .cp .how-tag{position:absolute;transform:translate(-50%,-100%);padding:5px 10px;border-radius:999px;background:rgba(4,8,16,.85);border:1px solid rgba(79,209,255,.45);color:#fff;font-size:12px;font-weight:700;white-space:nowrap;opacity:0;transition:opacity .3s,left .5s,top .5s;z-index:5;pointer-events:none}
  .cp .how-door{position:absolute;left:2%;bottom:6%;width:9%;height:40%;border-radius:8px;border:1px dashed rgba(79,209,255,.35);display:flex;align-items:flex-end;justify-content:center;font-size:10px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase;padding-bottom:4px}
  .cp .how-clock{position:absolute;left:-32%;top:0;width:24%;text-align:center;z-index:6}
  .cp .how-clock svg{width:100%;height:auto;display:block;filter:drop-shadow(0 10px 24px rgba(0,0,0,.6)) drop-shadow(0 0 16px rgba(79,209,255,.2))}
  .cp .how-clock .hc-txt{margin-top:6px} .cp .how-clock .hc-txt b{display:block;font-size:clamp(16px,2.2vw,24px);letter-spacing:-.02em;color:#fff} .cp .how-clock .hc-txt span{font-size:11px;color:var(--text2);letter-spacing:.14em;text-transform:uppercase}
  .cp .how-acc{position:absolute;right:-34%;top:0;width:210px;box-sizing:border-box;white-space:nowrap;padding:10px 14px;border-radius:14px;background:rgba(4,8,16,.85);border:1px solid rgba(47,227,160,.45);box-shadow:0 14px 34px rgba(0,0,0,.5),0 0 24px rgba(47,227,160,.15);text-align:right;z-index:6;backdrop-filter:blur(8px)}
  .cp .how-acc b{display:block;font-size:clamp(20px,2.6vw,30px);letter-spacing:-.02em;line-height:1.1;background-image:linear-gradient(180deg,#fff,var(--ok));-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp .how-coins{position:absolute;inset:0;pointer-events:none;z-index:5} .cp .how-coins .coin{position:absolute;transform:translate(-50%,-50%);font-style:normal;font-weight:900;color:var(--ok);text-shadow:0 0 12px rgba(47,227,160,.7);animation:howcoin 1.8s ease-out forwards}
  @keyframes howcoin{0%{opacity:0;margin-top:0;transform:translate(-50%,-50%) scale(.6)}20%{opacity:1;transform:translate(-50%,-50%) scale(1.15)}100%{opacity:0;margin-top:-120px;margin-left:120px;transform:translate(-50%,-50%) scale(.9)}}
  .cp .how-cas{position:absolute;right:-34%;top:26%;width:210px;display:flex;flex-direction:column;gap:6px;z-index:6}
  .cp .how-cas .cs,.cp .how-cas button{opacity:0;transform:translateY(-14px) scale(.96);transition:opacity .45s,transform .45s cubic-bezier(.2,1.3,.4,1)} .cp .how-cas .in{opacity:1;transform:none}
  .cp .how-cas .cs{display:flex;flex-direction:column;align-items:flex-end;text-align:right;padding:7px 12px;box-sizing:border-box;width:100%;border-radius:12px;background:rgba(4,8,16,.85);border:1px solid var(--border2);backdrop-filter:blur(8px);box-shadow:0 10px 24px rgba(0,0,0,.45)}
  .cp .how-cas .cs small{display:block;font-size:10.5px;color:var(--text2);line-height:1.35;margin-top:3px} .cp .how-cas .cs small i{font-style:normal;color:#fff} .cp .how-cas .cs b{font-size:clamp(18px,2.2vw,24px);letter-spacing:-.02em;color:#fff;margin-top:2px;white-space:nowrap}
  .cp .how-cas .cs.m{border-color:rgba(245,158,11,.4)} .cp .how-cas .cs.m b{color:#f59e0b}
  .cp .how-cas .cs.r{border-color:rgba(47,227,160,.6);background:rgba(47,227,160,.12);box-shadow:0 10px 30px rgba(47,227,160,.25)} .cp .how-cas .cs.r b{font-size:22px;background-image:linear-gradient(180deg,#fff,var(--ok));-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp .how-cas .cs.r.neg{border-color:rgba(239,68,68,.7);background:rgba(239,68,68,.14);box-shadow:0 10px 30px rgba(239,68,68,.3)} .cp .how-cas .cs.r.neg b{background-image:linear-gradient(180deg,#fff,#ef4444);text-shadow:0 0 14px rgba(239,68,68,.6)}
  .cp .how-cas button{align-self:stretch}
  .cp .how-foot{display:flex;flex-wrap:wrap;gap:10px 22px;justify-content:center;margin-top:28px;position:relative;z-index:7;font-size:12.5px;color:var(--text2)} .cp .how-foot b{color:var(--accent2)}
  /* Telefon: stejné rozložení jako na počítači (hodiny vlevo, stroj uprostřed, karty vpravo), celé zmenšené podle šířky (zoom nastaví skript) */
  @media(max-width:700px){.cp .how{padding:10px 4px;overflow:hidden} .cp .how-stage{width:440px;max-width:none;min-height:560px} .cp .how-foot{margin-top:14px;font-size:12px;gap:6px 14px} .cp .how-clock{left:-21%;width:22%} .cp .how-clock .hc-txt b{font-size:24px} .cp .how-clock .hc-txt span{font-size:12px} .cp .how-acc,.cp .how-cas{right:-21%;width:200px} .cp .how-acc b{font-size:32px} .cp .how-acc .dec-k,.cp .how-cas .cs .dec-k{font-size:11px} .cp .how-acc .dec-s{font-size:14px} .cp .how-cas .cs b{font-size:27px} .cp .how-cas .cs small{font-size:12.5px} .cp .how-cas .cs.r b{font-size:27px} .cp .how-tag{font-size:14px}}
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
  @media(max-width:760px){.cp .pl-row{grid-template-columns:1fr;gap:20px} .cp .pl img{max-width:220px} .cp .pl .pl-tag{font-size:10.5px;padding:4px 10px} .cp .pl .pl-mini{font-size:9.5px;padding:2px 7px}}
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
  .cp .loopwrap{display:flex;flex-direction:column;gap:18px;align-items:stretch;margin:4px 0 22px}
  .cp .loop{position:relative;aspect-ratio:1;max-width:560px;margin:0 auto;width:100%}
  .cp .loop-svg{width:100%;height:100%;display:block}
  .cp .loop-dash{animation:lpspin 30s linear infinite;transform-origin:210px 210px}
  @keyframes lpspin{to{transform:rotate(360deg)}}
  .cp .ln{position:absolute;width:170px;padding:10px 12px;border-radius:14px;border:1px solid var(--border2);background:rgba(4,8,16,.85);backdrop-filter:blur(8px);box-shadow:0 14px 30px rgba(0,0,0,.45);text-align:center}
  .cp .ln i{position:absolute;top:-12px;left:50%;transform:translateX(-50%);width:24px;height:24px;border-radius:50%;font-style:normal;font-weight:800;font-size:12px;color:#fff;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--accent),var(--vio));box-shadow:0 0 14px rgba(79,209,255,.5)}
  .cp .ln b{display:block;font-size:13px;line-height:1.25;margin-top:4px} .cp .ln span{font-size:11px;color:var(--text2)}
  .cp .ln.n1{top:2%;left:50%;transform:translateX(-50%)} .cp .ln.n2{top:50%;right:-4%;transform:translateY(-50%)} .cp .ln.n3{bottom:2%;left:50%;transform:translateX(-50%);border-color:rgba(47,227,160,.55)} .cp .ln.n3 i{background:linear-gradient(135deg,#1ea97c,var(--ok))} .cp .ln.n4{top:50%;left:-4%;transform:translateY(-50%)}
  .cp .lp-img{position:absolute;left:50%;top:14%;width:84px;height:auto;transform:translate(-50%,-50%);opacity:0;pointer-events:none;filter:drop-shadow(0 14px 22px rgba(0,0,0,.7)) drop-shadow(0 0 14px rgba(79,209,255,.35));z-index:3;will-change:left,top,transform,opacity}
  .cp #lp-flex{width:110px}
  .cp .lp-pilot{display:flex;flex-direction:column;align-items:center;gap:2px;width:92px;filter:none}
  .cp .lp-pilot img{width:84px;height:auto;filter:drop-shadow(0 14px 22px rgba(0,0,0,.7)) drop-shadow(0 0 14px rgba(79,209,255,.35));position:relative;z-index:1}
  .cp .lp-pilot .lp-ring{position:absolute;left:50%;top:40%;width:110px;height:110px;margin:-55px 0 0 -55px;border-radius:50%;border:1.5px dashed rgba(79,209,255,.55);animation:lpspin 14s linear infinite;z-index:0}
  .cp .lp-pilot .lp-tag{white-space:nowrap;font-size:9.5px;font-weight:800;letter-spacing:.1em;padding:3px 8px;border-radius:999px;color:#fff;background:linear-gradient(135deg,var(--accent),var(--vio));box-shadow:0 6px 16px rgba(30,134,224,.45);position:relative;z-index:1}
  .cp .lp-stamp{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-14deg);padding:4px 10px;border:3px solid var(--ok);border-radius:8px;color:var(--ok);font-weight:900;font-size:13px;letter-spacing:.14em;background:rgba(4,8,16,.7);opacity:0;pointer-events:none;z-index:4;text-shadow:0 0 10px rgba(47,227,160,.6);box-shadow:0 0 18px rgba(47,227,160,.4)}
  .cp .ln{z-index:2}
  .cp .lp-income{position:absolute;right:-4%;bottom:4%;z-index:4;padding:10px 14px;border-radius:14px;border:1px solid rgba(47,227,160,.45);background:rgba(4,8,16,.8);backdrop-filter:blur(8px);box-shadow:0 14px 34px rgba(0,0,0,.5),0 0 24px rgba(47,227,160,.15);text-align:right;min-width:170px}
  .cp .lp-income .k{display:block;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--text3);font-weight:700}
  .cp .lp-income b{display:block;font-size:clamp(20px,2.6vw,28px);letter-spacing:-.02em;line-height:1.1;background-image:linear-gradient(180deg,#fff,var(--ok));-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp .lp-income .s{display:block;font-size:10.5px;color:var(--text2);margin-top:2px}
  .cp .lp-income.bump{animation:incbump .5s cubic-bezier(.2,1.4,.4,1)} @keyframes incbump{0%{transform:scale(1)}40%{transform:scale(1.08);box-shadow:0 14px 34px rgba(0,0,0,.5),0 0 40px rgba(47,227,160,.45)}100%{transform:scale(1)}}
  @media(max-width:900px){.cp .loop{margin-bottom:92px} .cp .lp-income{right:auto;left:50%;bottom:-88px;transform:translateX(-50%);text-align:center;min-width:200px}}
  .cp .loop-fleet{margin-top:6px;padding:10px 12px;border-radius:14px;border:1px dashed var(--border2);background:rgba(4,8,16,.4)}
  .cp .lf-h{display:flex;align-items:center;justify-content:space-between;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--text3);font-weight:700;margin-bottom:6px} .cp .lf-h b{font-size:14px;color:var(--ok);letter-spacing:0}
  .cp .lf-row{display:flex;flex-wrap:wrap;gap:6px;min-height:44px;align-items:flex-end}
  .cp .lf-row{justify-content:center;--lfw:80px} .cp .lf-m{width:var(--lfw);height:auto;transition:width .6s ease;filter:drop-shadow(0 8px 14px rgba(0,0,0,.6)) drop-shadow(0 0 10px rgba(79,209,255,.3));animation:lfpop .5s cubic-bezier(.2,1.4,.4,1) both}
  @keyframes lfpop{from{transform:translateY(-14px) scale(.4);opacity:0}to{transform:none;opacity:1}}
  .cp .rep{padding:20px 22px;border-radius:18px;border:1px solid rgba(79,209,255,.4);background:linear-gradient(135deg,rgba(30,134,224,.14),rgba(124,92,255,.1))}
  .cp .rep-q{font-size:clamp(20px,2.4vw,26px);font-weight:900;letter-spacing:-.02em} .cp .rep-sub{color:var(--text2);font-size:13.5px;margin:4px 0 14px} .cp .rep-sub b{color:var(--accent2)}
  .cp .rep input[type=range]{width:100%;accent-color:#4fd1ff;margin:0 0 14px}
  .cp .rep-out{display:flex;flex-wrap:wrap;gap:14px 22px;align-items:flex-start;padding:14px 16px;border-radius:14px;background:rgba(4,8,16,.5);border:1px solid var(--border)}
  .cp .rep-out b{display:block;font-size:clamp(22px,3vw,32px);letter-spacing:-.02em;line-height:1.1;background-image:linear-gradient(180deg,#fff,var(--ok));-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp .rep-money{margin-left:auto;text-align:right} .cp .rep-money b{background-image:linear-gradient(180deg,#fff,var(--accent2))}
  .cp .rep-dots{display:flex;flex-wrap:wrap;gap:5px;margin-top:12px;align-items:center} .cp .rep-dots i{width:14px;height:14px;border-radius:4px;background:linear-gradient(135deg,var(--accent),var(--vio));box-shadow:0 0 8px rgba(79,209,255,.4)} .cp .rep-dots i:first-child{background:linear-gradient(135deg,#1ea97c,var(--ok))} .cp .rep-dots em{font-style:normal;font-size:12px;color:var(--text2);margin-left:4px}
  @media(max-width:900px){.cp .ln{width:128px} .cp .ln.n2{right:-2%} .cp .ln.n4{left:-2%}}
  .cp .dec{margin-top:14px;padding:20px 22px;border-radius:18px;border:1px solid rgba(124,92,255,.45);background:linear-gradient(135deg,rgba(124,92,255,.14),rgba(30,134,224,.1))}
  .cp .dec-q{font-size:clamp(20px,2.6vw,28px);font-weight:900;letter-spacing:-.02em;margin-bottom:12px}
  .cp .dec-opts{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
  .cp .dec-o{font:inherit;font-weight:800;font-size:20px;min-width:72px;padding:12px 18px;border-radius:14px;border:1px solid var(--border2);background:rgba(4,8,16,.6);color:var(--text2);cursor:pointer;transition:all .2s}
  @media(max-width:700px){.cp .dec-opts{flex-wrap:nowrap;gap:6px} .cp .dec-o{flex:1 1 0;min-width:0;padding:10px 4px;font-size:18px}}
  .cp .dec-o:hover{color:var(--text);border-color:rgba(79,209,255,.5)} .cp .dec-o.on{color:#fff;background:linear-gradient(135deg,var(--accent),var(--vio));border-color:transparent;box-shadow:0 10px 30px rgba(30,134,224,.4);transform:translateY(-2px)}
  .cp .dec-money{margin-left:auto;text-align:right} .cp .dec-money b{background-image:linear-gradient(180deg,#fff,var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
  @media(max-width:640px){.cp .dec-out{flex-direction:column;align-items:flex-start} .cp .dec-money{margin-left:0;text-align:left}}
  .cp .dec-out{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 16px;border-radius:14px;background:rgba(4,8,16,.5);border:1px solid var(--border);margin-bottom:12px}
  .cp .dec-k{display:block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--text3);font-weight:700}
  .cp .dec-out b{display:block;font-size:clamp(22px,3vw,32px);letter-spacing:-.02em;line-height:1.1;background:linear-gradient(180deg,#fff,var(--ok));-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp .dec-s{display:block;font-size:13px;color:var(--text2);margin-top:2px}
  .cp .dec-ask{font-size:15px;line-height:1.5;color:var(--text)} .cp .dec-ask b{color:var(--accent2)}
  @media(max-width:760px){.cp .scale{grid-template-columns:1fr}}
  /* Telefon: oba stroje vedle sebe s plusem jako na počítači, jen menší (žádné zalamování pod sebe) */
  @media(max-width:700px){.cp .sc-col{flex-wrap:wrap;gap:6px 4px;padding:12px 8px 14px}.cp .sc-h{flex:0 0 100%;margin-bottom:2px}.cp .sc-col .sc-m{width:40%;min-width:0;flex:0 0 40%}.cp .sc-col.wait .sc-m{width:48%;flex-basis:48%}.cp .sc-plus{font-size:24px;flex:0 0 28px;text-align:center}.cp .sc-arrow{font-size:22px;flex:0 0 28px;text-align:center}.cp .sc-m .pl-tag{font-size:10px;padding:3px 9px;letter-spacing:.04em;white-space:nowrap}.cp .sc-t{flex:0 0 100%;font-size:12.5px;margin-top:4px}}
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
      ${ph.visual === 'how' ? `<div class="how">
        <div class="how-stage">
          <div class="how-mach">
          <img class="how-img" src="/img/pradlomat-mini.webp?v=3" alt="Prádlomat MINI" loading="lazy" decoding="async">
          <div class="how-d how-w" id="how-w"><i></i><span>Pračka 18 kg</span></div>
          <div class="how-d how-s" id="how-s"><i></i><span>Sušička</span></div>
          <div class="how-cust" id="how-cust"><svg viewBox="0 0 60 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="hcB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fd1ff"/><stop offset="1" stop-color="#1e86e0"/></linearGradient></defs><circle cx="30" cy="16" r="12" fill="#f3c6a0"/><path d="M18 14c2-10 22-10 24 0-4-4-20-4-24 0z" fill="#3b2a20"/><path d="M14 44c0-10 8-14 16-14s16 4 16 14l-2 34H16z" fill="url(#hcB)"/><path d="M12 36l-8 30 7 2 7-26z" fill="#f3c6a0"/><path d="M48 36l8 30-7 2-7-26z" fill="#f3c6a0"/><path d="M17 76l-2 40h10l4-36zM43 76l2 40H35l-4-36z" fill="#1b2a44"/><path d="M12 116h14v4H12zM34 116h14v4H34z" fill="#0b1220"/><g class="hc-walk"><animateTransform attributeName="transform" type="rotate" values="-6 30 78;6 30 78;-6 30 78" dur=".7s" repeatCount="indefinite"/></g></svg></div>
          <div class="how-bag" id="how-bag">🧺</div>
          <div class="how-tag" id="how-tag"></div>
          <div class="how-coins" id="how-coins"></div>
          </div>
          <div class="how-clock" aria-hidden="true"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="rgba(4,8,16,.8)" stroke="rgba(79,209,255,.5)" stroke-width="2"/>${Array.from({ length: 12 }, (_, i) => `<line x1="50" y1="8" x2="50" y2="${i % 3 === 0 ? 15 : 12}" stroke="${i % 3 === 0 ? '#fff' : 'rgba(255,255,255,.45)'}" stroke-width="${i % 3 === 0 ? 2.5 : 1.5}" transform="rotate(${i * 30} 50 50)"/>`).join('')}<circle id="hc-day" cx="50" cy="50" r="46" fill="none" stroke="rgba(79,209,255,.35)" stroke-width="4" stroke-dasharray="289" stroke-dashoffset="289" transform="rotate(-90 50 50)"/><line id="hc-h" x1="50" y1="50" x2="50" y2="26" stroke="#fff" stroke-width="4" stroke-linecap="round"/><line id="hc-m" x1="50" y1="50" x2="50" y2="14" stroke="#4fd1ff" stroke-width="2.5" stroke-linecap="round"/><circle cx="50" cy="50" r="3" fill="#4fd1ff"/></svg><div class="hc-txt"><b id="hc-t">06:00</b><span id="hc-d">den 1</span></div></div>
          <div class="how-acc"><span class="dec-k">průměrná tržba za den</span><b><span id="how-sum">0</span> Kč</b><span class="dec-s" id="how-n">0 zákazníků</span></div>
          <div class="how-cas" id="how-cas">
          <div class="cs in"><span class="dec-k">tržba za měsíc</span><b id="hs-m">0 Kč</b><small>s DPH<br>bez DPH <i id="hs-mn">0 Kč</i></small></div>
          <div class="cs m in"><span class="dec-k">náklady za měsíc</span><b id="hs-cost">− 5 000 Kč</b><small>bez DPH<br>nájem 5 000 Kč<br>servis 13 % <i id="hs-serv">0 Kč</i><br>energie <i id="hs-en">0 Kč</i><i id="hs-env" hidden></i></small></div>
          <div class="cs r in"><span class="dec-k">zbude Vám měsíčně</span><b id="hs-res">− 6 050 Kč</b><small>s DPH<br>bez DPH <i id="hs-resn">− 5 000 Kč</i></small></div>
          <button type="button" class="btn sec sm" id="hs-again" onclick="location.reload()">↻ Spustit znovu</button>
        </div>
        </div>
        <div class="how-foot"><span>🕐 <b id="how-clock">06:00</b> · prádlomat běží 24/7</span><span>📡 vše vidíte v telefonu</span><span>🔧 servis = Best Series</span></div>
        <script>(function(){var how=document.querySelector('.cp .how'),st=document.querySelector('.cp .how-stage');if(!how||!st)return;
function fit(){if(window.innerWidth>700){st.style.transform='';st.style.marginLeft='';st.style.marginBottom='';st.style.width='';return;}
st.style.width='440px';st.style.transform='none';st.style.marginLeft='0';st.style.marginBottom='0';
var r=st.getBoundingClientRect(),minL=r.left,maxR=r.right;st.querySelectorAll('.how-clock,.how-acc,.how-cas').forEach(function(el){var b=el.getBoundingClientRect();if(b.width>0){minL=Math.min(minL,b.left);maxR=Math.max(maxR,b.right);}});
var full=Math.max(440,maxR-minL),left=r.left-minL,nat=st.offsetHeight||560;
var cs=getComputedStyle(how);var w=how.clientWidth-(parseFloat(cs.paddingLeft)||0)-(parseFloat(cs.paddingRight)||0)-4;var s=Math.min(1,w/full);
st.style.transformOrigin='top left';st.style.transform='scale('+s+')';st.style.marginLeft=Math.max(0,(w-full*s)/2+left*s)+'px';st.style.marginBottom=(-nat*(1-s))+'px';
// korekce podle skutečné polohy po zmenšení: obsah zarovnat na střed rámečku, nikdy nepřetéct vpravo
var hr=how.getBoundingClientRect(),cl=hr.left+(parseFloat(cs.paddingLeft)||0),cr=hr.right-(parseFloat(cs.paddingRight)||0);
for(var k=0;k<2;k++){var r2=st.getBoundingClientRect(),a=r2.left,b=r2.right;st.querySelectorAll('.how-clock,.how-acc,.how-cas').forEach(function(el){var q=el.getBoundingClientRect();if(q.width>0){a=Math.min(a,q.left);b=Math.max(b,q.right);}});
var cw=b-a,avail=cr-cl;if(cw>avail+1){s=s*avail/cw;st.style.transform='scale('+s+')';st.style.marginBottom=(-nat*(1-s))+'px';continue;}
var shift=(cl+(avail-cw)/2)-a;st.style.marginLeft=(parseFloat(st.style.marginLeft)+shift)+'px';}}
fit();addEventListener('resize',fit);addEventListener('orientationchange',function(){setTimeout(fit,250);});setTimeout(fit,300);setTimeout(fit,1200);})();</script>
      </div>
      <script>(function(){
        var $=function(id){return document.getElementById(id);};
        var cust=$('how-cust'),bag=$('how-bag'),w=$('how-w'),sd=$('how-s'),tag=$('how-tag'),sum=$('how-sum'),n=$('how-n'),clk=$('how-clock'),coins=$('how-coins');
        if(!cust)return;
        // pozice v % plochy obrázku: pračka 18 kg a sušička (bubny na fotce), vchod vlevo
        function put(el,p,extra){ el.style.left=p.x+'%'; el.style.top=p.y+'%'; if(extra) el.style.transform=extra; }
        var W={x:40,y:52},S={x:60,y:49},IN={x:-14,y:58},OUT={x:-14,y:58};
        put(w,W); put(sd,S);
        function say(t,p){ tag.textContent=t; tag.style.opacity=t?1:0; if(p){ tag.style.left=p.x+'%'; tag.style.top=(p.y-16)+'%'; } }
        var SPEED=70; // ms na jednu simulovanou minutu → 24 h ≈ 100 s
        var total=0,cnt=0,min=6*60,T0=performance.now()-6*60*SPEED,PR=[[400,'praní s aviváží 350 Kč',1],[400,'praní 300 Kč',2],[500,'praní s aviváží 350 Kč',3]];
        function fmt(m){ var h=Math.floor(m/60)%24,mm=m%60; return (h<10?'0':'')+h+':'+(mm<10?'0':'')+mm; }
        var hcH=document.getElementById('hc-h'),hcM=document.getElementById('hc-m'),hcT=document.getElementById('hc-t'),hcD=document.getElementById('hc-d'),hcDay=document.getElementById('hc-day'),dayNo=1,lastM=0,dayTotal=0;
        var stopped=false;
        var fmtK=function(x){ return Math.round(x).toLocaleString('cs-CZ')+' Kč'; };
        function monthCalc(){ var day=total, m=day*30.5, mn=m/1.21, serv=m*0.13, en=mn*0.095, env=en*1.15, res=mn-5000-serv-en;
          document.getElementById('hs-m').textContent=fmtK(m); document.getElementById('hs-mn').textContent=fmtK(mn);
          document.getElementById('hs-cost').textContent='− '+fmtK(5000+serv+en); document.getElementById('hs-serv').textContent=fmtK(serv); document.getElementById('hs-en').textContent=fmtK(en); document.getElementById('hs-env').textContent=fmtK(env); var rb=document.getElementById('hs-res'), resV=res*1.21; rb.textContent=(resV<0?'− ':'')+fmtK(Math.abs(resV)); document.getElementById('hs-resn').textContent=(res<0?'− ':'')+fmtK(Math.abs(res)); rb.parentNode.classList.toggle('neg',res<0); }
        monthCalc(); // výchozí stav (záporné = červeně)
        function finishDay(){ if(stopped) return; stopped=true; hcT.textContent='24:00'; hcD.textContent='konec dne'; clk.textContent='24:00'; hcDay.setAttribute('stroke-dashoffset','0'); say(''); monthCalc(); document.getElementById('hs-again').classList.add('in'); }
        function face(m){ if(stopped) return; if(m>=1440){ finishDay(); return; } var mm=m%1440, mi=Math.floor(mm); lastM=mm;
          hcH.setAttribute('transform','rotate('+((mm/60)%12)*30+' 50 50)'); hcM.setAttribute('transform','rotate('+(mm%60)*6+' 50 50)'); hcT.textContent=fmt(mi); hcDay.setAttribute('stroke-dashoffset',String(289-289*(mm/1440))); clk.textContent=fmt(mi); }
        function wait(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }
        function simWait(minutes){ return wait(minutes*SPEED); }
        (function clockLoop(){ if(stopped) return; var f=(performance.now()-T0)/SPEED; min=Math.floor(f); face(f); requestAnimationFrame(clockLoop); })();
        async function customer(){
          if(stopped){ cust.style.opacity=0; bag.style.opacity=0; return; }
          var pr=PR[cnt%PR.length]; cnt++; var WW=W, ring=w, cycles=pr[2];
          await simWait(3+Math.random()*8);
          cust.classList.remove('flip'); cust.style.transition='none'; bag.style.transition='none'; put(cust,IN); put(bag,{x:IN.x+8,y:IN.y+10}); cust.style.opacity=1; bag.style.opacity=1; await wait(50);
          cust.style.transition='left 2.2s linear, top 2.2s linear, opacity .4s'; bag.style.transition='left 2.2s linear, top 2.2s linear, opacity .4s, transform .6s';
          put(cust,{x:WW.x-15,y:58}); put(bag,{x:WW.x-5,y:72}); say('přichází s prádlem',{x:20,y:70}); await simWait(5);
          say('platí: '+pr[1]+' + sušení '+cycles+'×50 Kč',{x:WW.x-6,y:WW.y-14}); await simWait(3);
          bag.style.transition='left .7s ease-in, top .7s ease-in, transform .7s, opacity .4s'; put(bag,{x:WW.x,y:WW.y},'translate(-50%,-50%) scale(.4)'); await wait(700); bag.style.opacity=0;
          ring.classList.add('on'); say('pere… 40 min',{x:WW.x,y:WW.y-16}); await simWait(40); ring.classList.remove('on');
          var END=WW;
          bag.style.transition='none'; put(bag,{x:WW.x,y:WW.y},'translate(-50%,-50%) scale(.4)'); bag.style.opacity=1; await wait(30);
          bag.style.transition='left .9s ease-in-out, top .9s ease-in-out, transform .9s'; put(bag,{x:S.x,y:S.y},'translate(-50%,-50%) scale(.4)'); say('do sušičky',{x:(WW.x+S.x)/2,y:S.y-16}); await wait(950);
          for(var cy=1;cy<=cycles;cy++){ sd.classList.add('on'); say('suší… '+cy+'/'+cycles+' · 15 min',{x:S.x,y:S.y-16}); await simWait(15); sd.classList.remove('on'); if(cy<cycles) await simWait(1); }
          END=S;
          // platba se připíše
          var c=document.createElement('em'); c.className='coin'; c.textContent='+'+pr[0]+' Kč'; c.style.left=END.x+'%'; c.style.top=END.y+'%'; coins.appendChild(c); setTimeout(function(){ c.remove(); },1800);
          if(stopped){ cust.style.opacity=0; bag.style.opacity=0; return; }
          total+=pr[0]; var shown=parseInt(sum.textContent.replace(/\\s/g,''),10)||0, st=Date.now(); (function tw(){ var k=Math.min(1,(Date.now()-st)/700); sum.textContent=Math.round(shown+(total-shown)*k).toLocaleString('cs-CZ'); if(k<1) requestAnimationFrame(tw); })();
          n.textContent=cnt+' zákazník'+(cnt===1?'':cnt<5?'ci':'ů'); monthCalc();
          // odchází s čistým prádlem
          bag.style.transition='left .6s ease-out, top .6s ease-out, transform .6s'; put(bag,{x:END.x+8,y:72},'translate(-50%,-50%) scale(1)'); cust.style.transition='left .6s, top .6s'; put(cust,{x:END.x,y:58}); say('hotovo ✓',{x:END.x,y:END.y-14}); await wait(700);
          cust.style.transition='left 2s linear, top 2s linear, opacity .5s'; bag.style.transition='left 2s linear, top 2s linear, opacity .5s'; cust.classList.add('flip'); put(cust,OUT); put(bag,{x:OUT.x-8,y:OUT.y+10}); await wait(1600); cust.style.opacity=0; bag.style.opacity=0; say('');
          await simWait(10+Math.random()*25); if(!stopped) customer();
        }
        customer();
      })();</script>` : ''}
      ${ph.visual === 'loop' ? `<div class="loopwrap"><div class="loop">
        <svg viewBox="0 0 420 420" class="loop-svg" aria-hidden="true">
          <defs><linearGradient id="lpG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4fd1ff"/><stop offset="1" stop-color="#7c5cff"/></linearGradient>
          <marker id="lpA" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#4fd1ff"/></marker></defs>
          <circle cx="210" cy="210" r="150" fill="none" stroke="rgba(79,209,255,.12)" stroke-width="26"/>
          <circle cx="210" cy="210" r="150" fill="none" stroke="url(#lpG)" stroke-width="3" stroke-dasharray="10 12" class="loop-dash"/>
          <path d="M210 60 A150 150 0 0 1 360 210" fill="none" stroke="url(#lpG)" stroke-width="3" marker-end="url(#lpA)" class="loop-arc"/>
          <path d="M360 210 A150 150 0 0 1 210 360" fill="none" stroke="url(#lpG)" stroke-width="3" marker-end="url(#lpA)" class="loop-arc"/>
          <path d="M210 360 A150 150 0 0 1 60 210" fill="none" stroke="url(#lpG)" stroke-width="3" marker-end="url(#lpA)" class="loop-arc"/>
          <path d="M60 210 A150 150 0 0 1 210 60" fill="none" stroke="url(#lpG)" stroke-width="3" marker-end="url(#lpA)" class="loop-arc"/>
          <circle id="loop-dot" cx="210" cy="60" r="5" fill="#4fd1ff" style="filter:drop-shadow(0 0 6px #4fd1ff)"/>
          <text x="210" y="200" text-anchor="middle" fill="#8ea2c2" font-size="12" font-weight="700" letter-spacing="2">SMYČKA</text>
          <text x="210" y="232" text-anchor="middle" fill="#fff" font-size="26" font-weight="900">∞</text>
        </svg>
        <div class="ln n1"><i>2</i><b>Pilot ověřuje místo</b><span>náběhová křivka</span></div>
        <div class="ln n2"><i>3</i><b>Místo verifikováno</b><span>čísla sedí</span></div>
        <div class="ln n3"><i>4</i><b>Dodáme zafinancovaný stroj</b><span>100 %</span></div>
        <div class="ln n4"><i>1</i><b>Pilot na nové místo</b><span>start každého kola</span></div>
        <div id="lp-mini" class="lp-img lp-pilot"><i class="lp-ring"></i><img src="/img/pradlomat-mini.webp?v=3" alt="Pilot MINI"><span class="lp-tag">PILOT · stále ten samý MINI</span></div>
        <img id="lp-flex" class="lp-img" src="/img/pradlomat.webp?v=2" alt="Zafinancovaný stroj">
        <div id="lp-stamp" class="lp-stamp">VERIFIKOVÁNO</div>
        <div class="lp-income"><span class="k">Měsíční příjem</span><b><span id="lp-inc">0</span> Kč</b><span class="s">25 000 Kč × <span id="lp-inc-n">0</span> strojů · odhad</span></div>
      </div>
      <div class="loop-fleet"><div class="lf-h"><span>Vaše flotila</span><b id="lf-n">0</b></div><div class="lf-row" id="lf-row"></div></div>
      <script>(function(){
var loop=document.querySelector('.cp .loop'),dot=document.getElementById('loop-dot'),mini=document.getElementById('lp-mini'),flex=document.getElementById('lp-flex'),stamp=document.getElementById('lp-stamp'),row=document.getElementById('lf-row'),n=document.getElementById('lf-n');
if(!loop||!dot||!mini||!flex||!row)return;
var A=4000,B=2600,C=2200,D=2400,T=A+B+C+D,start=performance.now(),count=0,dropped=false;
var incEl=document.getElementById('lp-inc'),incN=document.getElementById('lp-inc-n'),incBox=document.querySelector('.lp-income'),incShown=0,incTarget=0;
function incTick(){if(incShown<incTarget){incShown=Math.min(incTarget,incShown+Math.max(500,(incTarget-incShown)*0.12));incEl.textContent=Math.round(incShown).toLocaleString('cs-CZ');requestAnimationFrame(incTick);}}
function pos(deg){var a=deg*Math.PI/180;return {x:210+150*Math.sin(a),y:210-150*Math.cos(a)};}
function place(el,p,scale,op,dy){el.style.left=(p.x/420*100)+'%';el.style.top=((p.y+(dy||0))/420*100)+'%';el.style.transform='translate(-50%,-50%) scale('+(scale||1)+')';el.style.opacity=op==null?1:op;}
function hide(el){el.style.opacity=0;}
var ease=function(x){return x<.5?2*x*x:1-Math.pow(-2*x+2,2)/2;};
function tick(now){
  var t=(now-start)%T;
  if(t<A){ // bod 4 → 1 → 2: tečka + MINI jedou spolu
    var ang=270+180*ease(t/A),p=pos(ang);dot.setAttribute('cx',p.x.toFixed(1));dot.setAttribute('cy',p.y.toFixed(1));place(mini,p,1,1);hide(flex);stamp.style.opacity=0;stamp.style.transform='translate(-50%,-50%) rotate(-14deg) scale(2)';dropped=false;
  }else if(t<A+B){ // bod 2: MINI vyroste, razítko, výměna za FLEX
    var q=(t-A)/B,p=pos(90);dot.setAttribute('cx',p.x.toFixed(1));dot.setAttribute('cy',p.y.toFixed(1));
    var grow=Math.min(1,q/.3),sw=q<.6?0:(q-.6)/.4;
    place(mini,p,1+.5*grow-.5*sw,1);place(flex,p,1,sw);
    stamp.style.left=(p.x/420*100)+'%';stamp.style.top=(p.y/420*100)+'%';
    var st=q<.25?0:Math.min(1,(q-.25)/.15);stamp.style.opacity=q<.85?st:Math.max(0,1-(q-.85)/.15);stamp.style.transform='translate(-50%,-50%) rotate(-14deg) scale('+(2-st)+')';
  }else{ // bod 2 → 3 → 4: FLEX po kružnici do bodu 3 a propadne do flotily; MINI zároveň jede z bodu 2 středem kruhu do bodu 4 — dorazí ve stejný okamžik jako tečka
    var u=(t-A-B)/(C+D),p2=pos(90),p4=pos(270),mq=ease(u);place(mini,{x:p2.x+(p4.x-p2.x)*mq,y:p2.y+(p4.y-p2.y)*mq},1,1);stamp.style.opacity=0;
    if(t<A+B+C){ var q=ease((t-A-B)/C),ang=90+90*q,p=pos(ang);dot.setAttribute('cx',p.x.toFixed(1));dot.setAttribute('cy',p.y.toFixed(1));place(flex,p,1,1); }
    else{ var q=(t-A-B-C)/D,ang=180+90*ease(q),p=pos(ang);dot.setAttribute('cx',p.x.toFixed(1));dot.setAttribute('cy',p.y.toFixed(1));
      var p3=pos(180),dq=Math.min(1,q/.6);place(flex,p3,1-.4*dq,1-dq,dq*dq*140);
      if(!dropped&&q>=.45){dropped=true;count++;var im=document.createElement('img');im.src='/img/pradlomat.webp?v=2';im.alt='';im.className='lf-m';row.appendChild(im);n.textContent=count;var w=count<=10?80:count<=20?56:count<=40?40:count<=80?30:22;row.style.setProperty('--lfw',w+'px');incTarget=count*25000;incN.textContent=count;incBox.classList.remove('bump');void incBox.offsetWidth;incBox.classList.add('bump');incTick();} }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
})();</script>
      <div class="rep"><div class="rep-q">Kolik opakování uděláte?</div><div class="rep-sub">Každé kolo smyčky = <b>+1 prádlomat</b>, který je po splacení Váš.</div>
        <input type="range" id="rep-r" min="1" max="100" value="10" oninput="var n=+this.value;document.getElementById('rep-n').textContent=n;document.getElementById('rep-k').textContent=(n+1);document.getElementById('rep-m').textContent=((n+1)*25000).toLocaleString('cs-CZ');document.getElementById('rep-dots').innerHTML=Array.from({length:Math.min(n+1,60)},function(){return '<i></i>'}).join('')+((n+1)>60?'<em>+'+((n+1)-60)+'</em>':'')">
        <div class="rep-out"><div><span class="dec-k">opakování</span><b><span id="rep-n">10</span>×</b></div><div><span class="dec-k">prádlomatů celkem</span><b><span id="rep-k">11</span></b><span class="dec-s">Pilot + 1 za každé kolo</span></div><div class="rep-money"><span class="dec-k">měsíčně pro Vás</span><b><span id="rep-m">275 000</span> Kč</b><span class="dec-s">odhad · 25 000 Kč / stroj</span></div></div>
        <div class="rep-dots" id="rep-dots">${Array.from({ length: 11 }, () => '<i></i>').join('')}</div>
      </div></div>` : ''}
      ${ph.visual === 'scale' ? `<div class="scale"><div class="sc-col ok"><div class="sc-h"><i></i>Místo verifikováno</div><div class="sc-m"><img src="/img/pradlomat-mini.webp?v=3" alt="Pilot MINI" loading="lazy" decoding="async"><span class="pl-tag">Pilot</span></div><div class="sc-plus">+</div><div class="sc-m new"><img src="/img/pradlomat.webp?v=2" alt="Další stroj" loading="lazy" decoding="async"><span class="pl-tag z">100 % zafinancovaný</span></div><div class="sc-t">stroj splácí sám sebe — a ještě něco zbývá</div></div>
        <div class="sc-col wait"><div class="sc-h"><i></i>Místo neverifikováno</div><div class="sc-m dim"><img src="/img/pradlomat-mini.webp?v=3" alt="Pilot MINI" loading="lazy" decoding="async"><span class="pl-tag g">Pilot</span></div><div class="sc-arrow">⟶</div><div class="sc-t">počkat · nebo přemístit na nové místo a verifikovat znovu</div></div></div>` : ''}
      ${ph.points.length ? `<div class="ph-grid">${ph.points.map(pt => `<div class="c"><div class="i">${ico(pt[0], 20)}</div><b>${esc(pt[1])}</b><p>${pt[2]}</p></div>`).join('')}</div>` : ''}
      ${ph.timeline ? `<div class="ph-tl">${ph.timeline.map((t, i) => `<div class="s"><i>${i + 1}</i><b>${esc(t[0])}</b><span>${esc(t[1])}</span></div>`).join('')}</div>` : ''}
      ${ph.note ? `<p class="ph-note">${ph.note}</p>` : ''}
      ${ph.decision ? `<div class="dec"><div class="dec-q">Kolik prádlomatů vlastně chci?</div><div class="dec-opts">${[3, 5, 10, 100].map((n, i) => `<button type="button" class="dec-o${i === 1 ? ' on' : ''}" data-n="${n}" onclick="for(const b of this.parentNode.children)b.classList.remove('on');this.classList.add('on');document.getElementById('dec-n').textContent=this.dataset.n;document.getElementById('dec-m').textContent=(this.dataset.n*25000).toLocaleString('cs-CZ')">${n}</button>`).join('')}</div>
        <div class="dec-out"><div><span class="dec-k">za 5 let</span><b><span id="dec-n">5</span> prádlomatů</b><span class="dec-s">splacených · Vašich · každý měsíc vydělávají jen Vám</span></div><div class="dec-money"><span class="dec-k">měsíčně pro Vás</span><b><span id="dec-m">125 000</span> Kč</b><span class="dec-s">odhad při dodržení postupu · 25 000 Kč čistého na jeden prádlomat měsíčně</span></div></div>
        <div class="dec-ask">Otázka tedy nezní „kolik strojů", ale: <b>Kolik peněz chcete mít pravidelně měsíčně za 5 let, až se doplatí financování?</b></div></div>` : ''}
    </section>`).join('')}

  </div>` });
}
// ── Živá podpora — stránka uživatele ──
function supportPage(s, { online = false, msgs = [], agent = '', photos = {} } = {}) {
  const av = (n, sz) => photos[n] ? `<img class="sp-av" src="${esc(photos[n])}" alt="" style="width:${sz}px;height:${sz}px">` : '';
  const last = msgs.length ? msgs[msgs.length - 1].id : 0;
  return layout({ title: 'Podpora', user: s.nick, nav: userNav(s), active: 'podpora', fx: true, help: null, body: `
  <div class="sp-wrap">
    <div class="row" style="justify-content:space-between;align-items:center;margin:22px 0 10px;flex-wrap:wrap;gap:10px"><h2 style="margin:0;display:flex;align-items:center;gap:8px">${ico('chat', 18)} Živá podpora</h2>
      <span id="sp-state">${online ? `<span class="sp-on"><i></i>${av(agent, 30)}Online — odpovídá ${esc(agent || 'živý člověk')}</span>` : '<span class="muted small">● Podpora je momentálně offline</span>'}</span></div>
    <div class="sp-off" id="sp-offbox" style="${online ? 'display:none' : ''}"><b>Teď tu nikdo není.</b> Živá podpora je momentálně offline — jakmile bude kolega online, zelená tečka u ikony Podpora se rozsvítí a budete moct psát.</div>
    <div class="sp-log" id="sp-log" style="margin-top:12px">${msgs.length ? msgs.map(m => `<div class="sp-m ${m.sender === 'agent' ? 'agent' : 'user'}">${esc(m.body)}${m.file_name ? `<div class="sp-att">${/^image\//.test(m.file_type || '') ? `<a href="/support/file/${m.id}" target="_blank"><img src="/support/file/${m.id}" alt="${esc(m.file_name)}"></a>` : `<a href="/support/file/${m.id}?dl=1">📎 ${esc(m.file_name)}</a>`}</div>` : ''}<small>${m.sender === 'agent' ? av(m.agent_name, 18) + esc(m.agent_name || 'Podpora') + ' · ' : ''}${esc(fmtDT(m.created_at))}</small></div>`).join('') : '<div class="muted small" style="margin:auto">Zatím žádné zprávy. Napište nám, s čím můžeme pomoci.</div>'}</div>
    <form id="sp-f" style="display:flex;gap:8px;margin-top:10px;align-items:center"><label class="sp-clip" title="Přiložit screenshot nebo soubor (max 10 MB) — screenshot jde i vložit Ctrl+V"><input type="file" id="sp-file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip" ${online ? '' : 'disabled'}>📎</label><input id="sp-in" placeholder="${online ? 'Napište zprávu… (screenshot vložte Ctrl+V)' : 'Podpora je offline'}" ${online ? '' : 'disabled'} maxlength="2000" style="flex:1"><button class="btn" type="submit" id="sp-send" ${online ? '' : 'disabled'}>Odeslat</button></form>
    <div id="sp-prev" class="small muted" style="margin-top:6px;display:none"></div>
  </div>
  <script>(function(){
    var log=document.getElementById('sp-log'),f=document.getElementById('sp-f'),inp=document.getElementById('sp-in'),btn=document.getElementById('sp-send'),st=document.getElementById('sp-state'),since=${JSON.stringify(last)},online=${online ? 'true' : 'false'};
    function esc(t){return String(t).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]});}
    function beep(){ try{ var C=window.AudioContext||window.webkitAudioContext; if(!C)return; var c=beep.ctx||(beep.ctx=new C()); if(c.state==='suspended')c.resume(); var t=c.currentTime; [[880,0],[1320,.12]].forEach(function(p){ var o=c.createOscillator(),g=c.createGain(); o.type='sine'; o.frequency.value=p[0]; g.gain.setValueAtTime(0,t+p[1]); g.gain.linearRampToValueAtTime(.25,t+p[1]+.02); g.gain.exponentialRampToValueAtTime(.001,t+p[1]+.25); o.connect(g).connect(c.destination); o.start(t+p[1]); o.stop(t+p[1]+.3); }); }catch(e){} }
    document.addEventListener('click',function(){ try{ var C=window.AudioContext||window.webkitAudioContext; if(C&&!beep.ctx) beep.ctx=new C(); }catch(e){} },{once:true});
    function add(m){ var e=log.querySelector('.muted'); if(e)e.remove(); var d=document.createElement('div'); d.className='sp-m '+(m.sender==='agent'?'agent':'user'); d.innerHTML=esc(m.body)+(m.file_name?'<div class="sp-att">'+(/^image\\//.test(m.file_type||'')?'<a href="/support/file/'+m.id+'" target="_blank"><img src="/support/file/'+m.id+'" alt=""></a>':'<a href="/support/file/'+m.id+'?dl=1">📎 '+esc(m.file_name)+'</a>')+'</div>':'')+'<small>'+(m.sender==='agent'?av(m.agent_name,18)+esc(m.agent_name||'Podpora')+' · ':'')+new Date(m.created_at).toLocaleString('cs-CZ',{day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})+'</small>'; log.appendChild(d); log.scrollTop=log.scrollHeight; if(m.id>since) since=m.id; }
    var agent=${JSON.stringify(agent || '')}, photos=${JSON.stringify(photos || {})};
    function av(n,sz){ return photos[n]?'<img class="sp-av" src="'+esc(photos[n])+'" alt="" style="width:'+sz+'px;height:'+sz+'px">':''; }
    function setOnline(o,a){ if(a!==undefined&&a!==agent){ agent=a; if(online) st.innerHTML='<span class="sp-on"><i></i>'+av(agent,30)+'Online — odpovídá '+esc(agent||'živý člověk')+'</span>'; } if(o===online)return; online=o; inp.disabled=!o; btn.disabled=!o; inp.placeholder=o?'Napište zprávu…':'Podpora je offline'; st.innerHTML=o?'<span class="sp-on"><i></i>'+av(agent,30)+'Online — odpovídá '+esc(agent||'živý člověk')+'</span>':'<span class="muted small">● Podpora je momentálně offline</span>'; var ob=document.getElementById('sp-offbox'); if(ob) ob.style.display=o?'none':''; }
    log.scrollTop=log.scrollHeight;
    var fileEl=document.getElementById('sp-file'), prev=document.getElementById('sp-prev'), pending=null;
    function setFile(fl){ pending=fl||null; if(pending){ prev.style.display=''; prev.innerHTML='📎 '+esc(pending.name)+' ('+Math.round(pending.size/1024)+' kB) <a href="#" id="sp-unfile" style="color:var(--err)">odebrat</a>'; document.getElementById('sp-unfile').onclick=function(e){ e.preventDefault(); setFile(null); fileEl.value=''; }; } else { prev.style.display='none'; prev.innerHTML=''; } }
    fileEl.addEventListener('change',function(){ setFile(fileEl.files[0]); });
    document.addEventListener('paste',function(e){ if(!online)return; var it=(e.clipboardData||{}).items||[]; for(var i=0;i<it.length;i++){ if(it[i].type.indexOf('image/')===0){ var b=it[i].getAsFile(); setFile(new File([b],'screenshot-'+Date.now()+'.png',{type:b.type})); e.preventDefault(); break; } } });
    f.addEventListener('submit',async function(e){ e.preventDefault(); var t=inp.value.trim(); if((!t&&!pending)||!online)return; if(pending&&pending.size>10*1024*1024){ alert('Soubor je větší než 10 MB.'); return; } btn.disabled=true;
      try{ var fd=new FormData(); fd.append('body',t); if(pending) fd.append('file',pending,pending.name); var r=await fetch('/api/support/send',{method:'POST',credentials:'same-origin',body:fd}); var j=await r.json(); if(!r.ok){ alert(j.error||'Odeslání selhalo'); if(r.status===403) setOnline(false); } else { inp.value=''; setFile(null); fileEl.value=''; add(j.msg); } }catch(e){ alert('Odeslání selhalo'); }
      btn.disabled=!online; inp.focus(); });
    async function poll(){ try{ var r=await fetch('/api/support/state?after='+since,{credentials:'same-origin',cache:'no-store'}); if(!r.ok)return; var j=await r.json(); if(j.photos) Object.assign(photos,j.photos); setOnline(!!j.online, j.agent||''); var nw=(j.msgs||[]).filter(function(m){ return m.id>since; }); nw.forEach(add); if(nw.some(function(m){ return m.sender==='agent'; })) beep(); }catch(e){} }
    setInterval(poll,3000); document.addEventListener('visibilitychange',function(){ if(!document.hidden) poll(); });
  })();</script>` });
}
// ── Živá podpora — admin ──
function adminSupport({ admin, online = false, threads = [], who = null, msgs = [], holyosUrl, msg = '', agents = [], agent = '', order = null }) {
  const last = msgs.length ? msgs[msgs.length - 1].id : 0;
  const nm = (t) => [t.first_name, t.last_name].filter(Boolean).join(' ') || t.nick || t.email;
  return adminLayout('Podpora', 'sup2', admin, `
  <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px"><h1 style="margin:0">Živá podpora</h1>
    <form method="post" action="/admin/podpora/online" class="row" style="gap:10px;align-items:center;margin:0;flex-wrap:wrap">
      <span class="${online ? 'sp-on' : 'muted small'}">${online ? `<i></i>ONLINE jako <b>${esc(agent || admin.name || 'Podpora')}</b> — uživatelé mohou psát` : '● OFFLINE — uživatelé psát nemohou'}</span>
      ${online ? '' : `<select name="agent" style="width:auto;padding:8px 10px"><option value="">— kdo obsluhuje podporu —</option>${agents.map(a => `<option value="${esc(a.name)}"${a.name === agent ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}${!agents.some(a => a.name === (admin.name || '')) && admin.name ? `<option value="${esc(admin.name)}">${esc(admin.name)}</option>` : ''}</select>`}
      <input type="hidden" name="online" value="${online ? '0' : '1'}"><button class="btn sm ${online ? 'sec' : ''}" type="submit">${online ? 'Přejít offline' : 'Jít online'}</button></form></div>
  <details class="card" style="margin:0 0 12px;padding:10px 14px"><summary style="cursor:pointer;font-weight:700">👤 Profily lidí na podpoře <span class="muted small">(${agents.length})</span></summary>
    <div class="small muted" style="margin:6px 0 8px">Jméno, pod kterým uživatel uvidí odpovědi („Online — odpovídá Jana"). Při přechodu online vyberete, kdo zrovna obsluhuje.</div>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:8px">${agents.map(a => `<form method="post" action="/admin/podpora/agents" style="margin:0"><span class="badge type-owner" style="padding:6px 10px">${esc(a.name)}${a.name === agent ? ' · aktivní' : ''} <button type="submit" name="remove" value="${esc(a.name)}" title="Odebrat" style="background:none;border:0;color:var(--err);cursor:pointer;font-size:14px;margin-left:4px">×</button></span></form>`).join('') || '<span class="muted small">Zatím žádný profil.</span>'}</div>
    <form method="post" action="/admin/podpora/agents" class="row" style="gap:8px;margin:0"><input name="add" placeholder="Jméno (např. Jana Nováková)" maxlength="60" required style="width:260px"><button class="btn sm" type="submit">Přidat profil</button></form>
  </details>
  ${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}
  <div style="display:grid;grid-template-columns:300px 1fr;gap:14px;align-items:start">
    <div class="card" id="sp-threads" style="margin:0;padding:8px;max-height:70vh;overflow:auto">${threads.length ? threads.map(t => `<a href="/admin/podpora?u=${t.id}" style="display:block;padding:10px 12px;border-radius:12px;text-decoration:none;color:var(--text);${who && who.id === t.id ? 'background:rgba(79,209,255,.12);' : ''}"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${esc(nm(t))}</b>${t.unread ? `<span class="sup-badge" style="position:static">${t.unread}</span>` : ''}</div><div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.last_body || '')}</div><div class="small muted">${esc(fmtDT(t.last_at))}</div></a>`).join('') : '<p class="muted small" style="margin:8px">Zatím žádné konverzace.</p>'}</div>
    <div class="card" style="margin:0">${who ? `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><div><b style="font-size:16px">${esc(nm(who))}</b><div class="small muted">${esc(who.email || '')}${who.phone ? ' · ' + esc(who.phone) : ''} · <a href="/admin/supporters/${who.id}">detail uživatele</a></div></div></div>
      ${order ? `<div class="msg ok" style="margin:0 0 10px">Píšete k <b>objednávce č. ${order.id}</b> (${esc(order.product_name)}). Uživateli přijde e-mail, že má novou zprávu v chatu k této objednávce.</div>` : ''}
      <div class="sp-log" id="sp-log" style="max-height:50vh">${msgs.length ? msgs.map(m => `<div class="sp-m ${m.sender === 'agent' ? 'user' : 'agent'}">${esc(m.body)}${m.file_name ? `<div class="sp-att">${/^image\//.test(m.file_type || '') ? `<a href="/support/file/${m.id}" target="_blank"><img src="/support/file/${m.id}" alt="${esc(m.file_name)}"></a>` : `<a href="/support/file/${m.id}?dl=1">📎 ${esc(m.file_name)}</a>`}</div>` : ''}<small>${m.sender === 'agent' ? esc(m.agent_name || 'Podpora') + ' · ' : esc(nm(who)) + ' · '}${esc(fmtDT(m.created_at))}</small></div>`).join('') : '<div class="muted small" style="margin:auto">Bez zpráv.</div>'}</div>
      <form id="sp-af" method="post" action="/admin/podpora/${who.id}/send" style="display:flex;gap:8px;margin-top:10px;align-items:center">${order ? `<input type="hidden" name="order_id" id="sp-aord" value="${order.id}">` : ''}<label class="sp-clip" title="Přiložit screenshot nebo soubor (max 10 MB) — screenshot jde i vložit Ctrl+V"><input type="file" id="sp-afile">📎</label><input id="sp-ain" name="body" placeholder="Odpověď uživateli… (screenshot vložte Ctrl+V)" maxlength="4000" autofocus autocomplete="off" style="flex:1"><button class="btn" type="submit" id="sp-abtn">Odeslat</button></form>
      <div id="sp-aprev" class="small muted" style="margin-top:6px;display:none"></div>
      <script>(function(){ var log=document.getElementById('sp-log'),since=${JSON.stringify(last)},f=document.getElementById('sp-af'),inp=document.getElementById('sp-ain'),btn=document.getElementById('sp-abtn'); log.scrollTop=log.scrollHeight;
        function esc(t){return String(t).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]});}
        function beep(){ try{ var C=window.AudioContext||window.webkitAudioContext; if(!C)return; var c=beep.ctx||(beep.ctx=new C()); if(c.state==='suspended')c.resume(); var t=c.currentTime; [[880,0],[1320,.12]].forEach(function(p){ var o=c.createOscillator(),g=c.createGain(); o.type='sine'; o.frequency.value=p[0]; g.gain.setValueAtTime(0,t+p[1]); g.gain.linearRampToValueAtTime(.25,t+p[1]+.02); g.gain.exponentialRampToValueAtTime(.001,t+p[1]+.25); o.connect(g).connect(c.destination); o.start(t+p[1]); o.stop(t+p[1]+.3); }); }catch(e){} }
        document.addEventListener('click',function(){ try{ var C=window.AudioContext||window.webkitAudioContext; if(C&&!beep.ctx) beep.ctx=new C(); }catch(e){} },{once:true});
        var lastUnread=null, baseTitle=document.title;
        function add(m){ if(m.id<=since)return; var e=log.querySelector('.muted'); if(e)e.remove(); var d=document.createElement('div'); d.className='sp-m '+(m.sender==='agent'?'user':'agent'); d.innerHTML=esc(m.body)+(m.file_name?'<div class="sp-att">'+(/^image\\//.test(m.file_type||'')?'<a href="/support/file/'+m.id+'" target="_blank"><img src="/support/file/'+m.id+'" alt=""></a>':'<a href="/support/file/'+m.id+'?dl=1">📎 '+esc(m.file_name)+'</a>')+'</div>':'')+'<small>'+(m.sender==='agent'?esc(m.agent_name||'Podpora'):${JSON.stringify(nm(who))})+' · '+new Date(m.created_at).toLocaleString('cs-CZ',{day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})+'</small>'; log.appendChild(d); log.scrollTop=log.scrollHeight; since=m.id; }
        var fileEl=document.getElementById('sp-afile'), prev=document.getElementById('sp-aprev'), pending=null;
        function setFile(fl){ pending=fl||null; if(pending){ prev.style.display=''; prev.innerHTML='📎 '+esc(pending.name)+' ('+Math.round(pending.size/1024)+' kB) <a href="#" id="sp-aunfile" style="color:var(--err)">odebrat</a>'; document.getElementById('sp-aunfile').onclick=function(e){ e.preventDefault(); setFile(null); fileEl.value=''; }; } else { prev.style.display='none'; prev.innerHTML=''; } }
        fileEl.addEventListener('change',function(){ setFile(fileEl.files[0]); });
        document.addEventListener('paste',function(e){ var it=(e.clipboardData||{}).items||[]; for(var i=0;i<it.length;i++){ if(it[i].type.indexOf('image/')===0){ var b=it[i].getAsFile(); setFile(new File([b],'screenshot-'+Date.now()+'.png',{type:b.type})); e.preventDefault(); break; } } });
        f.addEventListener('submit',async function(e){ e.preventDefault(); var t=inp.value.trim(); if(!t&&!pending)return; btn.disabled=true; try{ var fd=new FormData(); fd.append('body',t); var oi=document.getElementById('sp-aord'); if(oi) fd.append('order_id',oi.value); if(pending) fd.append('file',pending,pending.name); var r=await fetch(f.action,{method:'POST',headers:{'Accept':'application/json'},body:fd}); var j=await r.json(); if(r.ok&&j.msg){ inp.value=''; setFile(null); fileEl.value=''; add(j.msg); } else alert('Odeslání selhalo'); }catch(e){ alert('Odeslání selhalo'); } btn.disabled=false; inp.focus(); });
        async function poll(){ try{ var r=await fetch('/admin/podpora/poll?u=${who.id}&after='+since,{cache:'no-store'}); if(!r.ok)return; var j=await r.json(); var nw=(j.msgs||[]).filter(function(m){ return m.id>since; }); nw.forEach(add); var fromUser=nw.some(function(m){ return m.sender==='user'; });
          var u=Number(j.unread||0); if(fromUser||(lastUnread!==null&&u>lastUnread)) beep(); if(lastUnread!==null&&u!==lastUnread&&!fromUser){ var sb=document.getElementById('sp-threads'); if(sb) sb.innerHTML='<p class="muted small" style="margin:8px">Nové zprávy v jiné konverzaci — <a href="/admin/podpora">obnovit seznam</a></p>'+sb.innerHTML; } lastUnread=u; document.title=(u?'('+u+') ':'')+baseTitle; }catch(e){} }
        setInterval(poll,3000); })();</script>` : '<p class="muted">Vyberte konverzaci vlevo.</p>'}</div>
  </div>`, holyosUrl);
}
// Přepínač zobrazovací měny (CZK / EUR) — ukládá se u uživatele
const curOf = (s) => (s && s.currency === 'EUR' ? 'EUR' : 'CZK');
const curSw = (s, back) => `<form method="post" action="/currency" style="margin:0;display:inline-flex;gap:0;border:1px solid var(--border2);border-radius:999px;overflow:hidden"><input type="hidden" name="back" value="${esc(back)}">
  ${['CZK', 'EUR'].map(c => `<button type="submit" name="cur" value="${c}" class="btn sm ${curOf(s) === c ? '' : 'sec'}" style="border-radius:0;border:0;min-width:64px">${c === 'CZK' ? 'Kč' : '€'}</button>`).join('')}</form>`;
// cena s DPH 21 % v měně uživatele (EUR bere cenu EUR z ceníku)
const vatPrice = (p, cur) => { const b = cur === 'EUR' ? p.price_eur : p.price_czk; return b == null ? null : Math.round(Number(b) * 1.21); };

// Úvodní interaktivní grafika na stránce Prádlomaty: animace hledání místa, bagr s přípojkami, provoz za 13 % z obratu
// a kalkulačka „čím víc DC, tím menší cena" s fotkou prádlomatu FLEX.
function valueHero({ flex = null, sym = 'Kč' } = {}) {
  const HR = (flex && flex.R) || 1; // kolik DC (Kč) odpovídá 1 jednotce zobrazené měny
  // ── Scéna 1: hledání místa (lidé z Best Series prohledávají mapu a označí parcelu) ──
  const person = (kt, kp, path, color) => `<g><circle r="3.4" cy="-9" fill="#ffd9b0"/><rect x="-3.6" y="-6" width="7.2" height="9" rx="2.4" fill="${color}"/><rect x="-3.6" y="-1.5" width="7.2" height="1.8" fill="#fff" opacity=".85"/><animateMotion dur="8s" repeatCount="indefinite" calcMode="linear" keyTimes="${kt}" keyPoints="${kp}" path="${path}"/></g>`;
  const sceneFind = `<svg viewBox="0 0 240 150" class="vh-svg" role="img" aria-label="Lidé z Best Series hledají vhodné místo"><rect width="240" height="150" rx="12" fill="#0a1426"/>
    <g><rect x="160" y="74" width="70" height="40" rx="4" fill="#1c3b6e" stroke="#4fa3ff" stroke-width=".8"/><path d="M178 76v26M192 76v26M206 76v26M220 76v26" stroke="#7fb4ff" stroke-width=".7" opacity=".5"/><rect x="164" y="77" width="12" height="12" rx="3" fill="#1e86e0"/><text x="170" y="87" font-size="9.500" fill="#fff" text-anchor="middle" font-weight="800">P</text><text x="195" y="111" font-size="5.500" fill="#a9ccff" text-anchor="middle">Parkoviště</text></g>
    <g fill="#16294a" stroke="#22407a" stroke-width=".6"><rect x="9.5" y="9.5" width="17.0" height="19.5" rx="1.5"/><rect x="9.5" y="32.0" width="17.0" height="19.5" rx="1.5"/><rect x="29.5" y="9.5" width="17.0" height="19.5" rx="1.5"/><rect x="29.5" y="32.0" width="17.0" height="19.5" rx="1.5"/><rect x="49.5" y="9.5" width="17.0" height="19.5" rx="1.5"/><rect x="49.5" y="32.0" width="17.0" height="19.5" rx="1.5"/><rect x="77.5" y="9.5" width="14.5" height="19.5" rx="1.5"/><rect x="77.5" y="32.0" width="14.5" height="19.5" rx="1.5"/><rect x="95.0" y="9.5" width="14.5" height="19.5" rx="1.5"/><rect x="95.0" y="32.0" width="14.5" height="19.5" rx="1.5"/><rect x="112.5" y="9.5" width="14.5" height="19.5" rx="1.5"/><rect x="112.5" y="32.0" width="14.5" height="19.5" rx="1.5"/><rect x="130.0" y="9.5" width="14.5" height="19.5" rx="1.5"/><rect x="130.0" y="32.0" width="14.5" height="19.5" rx="1.5"/><rect x="155.5" y="9.5" width="17.5" height="19.5" rx="1.5"/><rect x="155.5" y="32.0" width="17.5" height="19.5" rx="1.5"/><rect x="176.0" y="9.5" width="17.5" height="19.5" rx="1.5"/><rect x="176.0" y="32.0" width="17.5" height="19.5" rx="1.5"/><rect x="196.5" y="9.5" width="17.5" height="19.5" rx="1.5"/><rect x="196.5" y="32.0" width="17.5" height="19.5" rx="1.5"/><rect x="217.0" y="9.5" width="17.5" height="19.5" rx="1.5"/><rect x="217.0" y="32.0" width="17.5" height="19.5" rx="1.5"/><rect x="9.5" y="67.5" width="17.0" height="18.0" rx="1.5"/><rect x="9.5" y="88.5" width="17.0" height="18.0" rx="1.5"/><rect x="29.5" y="67.5" width="17.0" height="18.0" rx="1.5"/><rect x="29.5" y="88.5" width="17.0" height="18.0" rx="1.5"/><rect x="49.5" y="67.5" width="17.0" height="18.0" rx="1.5"/><rect x="49.5" y="88.5" width="17.0" height="18.0" rx="1.5"/><rect x="77.5" y="67.5" width="14.5" height="18.0" rx="1.5"/><rect x="77.5" y="88.5" width="14.5" height="18.0" rx="1.5"/><rect x="95.0" y="67.5" width="14.5" height="18.0" rx="1.5"/><rect x="95.0" y="88.5" width="14.5" height="18.0" rx="1.5"/><rect x="112.5" y="67.5" width="14.5" height="18.0" rx="1.5"/><rect x="112.5" y="88.5" width="14.5" height="18.0" rx="1.5"/><rect x="130.0" y="67.5" width="14.5" height="18.0" rx="1.5"/><rect x="130.0" y="88.5" width="14.5" height="18.0" rx="1.5"/><rect x="9.5" y="119.5" width="17.0" height="23.0" rx="1.5"/><rect x="29.5" y="119.5" width="17.0" height="23.0" rx="1.5"/><rect x="49.5" y="119.5" width="17.0" height="23.0" rx="1.5"/><rect x="77.5" y="119.5" width="14.5" height="23.0" rx="1.5"/><rect x="95.0" y="119.5" width="14.5" height="23.0" rx="1.5"/><rect x="112.5" y="119.5" width="14.5" height="23.0" rx="1.5"/><rect x="130.0" y="119.5" width="14.5" height="23.0" rx="1.5"/><rect x="155.5" y="121.5" width="17.5" height="21.0" rx="1.5"/><rect x="176.0" y="121.5" width="17.5" height="21.0" rx="1.5"/><rect x="196.5" y="121.5" width="17.5" height="21.0" rx="1.5"/><rect x="217.0" y="121.5" width="17.5" height="21.0" rx="1.5"/></g>
    <g fill="none" stroke="#223a66" stroke-linecap="round"><path d="M0 59 H240" stroke-width="8"/><path d="M150 0 V150" stroke-width="8"/><path d="M72 0 V150" stroke-width="5"/><path d="M0 112 H240" stroke-width="5"/><path d="M150 92 H240" stroke-width="5"/></g>
    <g fill="none" stroke="#5f7fb8" stroke-width=".8" stroke-dasharray="4 4" opacity=".7"><path d="M0 59 H240"/><path d="M150 0 V150"/></g>
    <g font-size="5.500" fill="#7f97c4" opacity=".85"><text x="18" y="57">Hlavní</text><text x="153" y="20" transform="rotate(90 153 20)">Průmyslová</text></g>
    <rect x="78" y="119" width="66" height="25" rx="4" fill="#14452f"/><g fill="#1f7a4d" stroke="#2fe3a0" stroke-width=".4"><circle cx="84" cy="126" r="3.2"/><circle cx="94" cy="138" r="3.2"/><circle cx="104" cy="127" r="3.2"/><circle cx="116" cy="137" r="3.2"/><circle cx="126" cy="126" r="3.2"/><circle cx="138" cy="136" r="3.2"/><circle cx="132" cy="131" r="3.2"/><circle cx="90" cy="131" r="3.2"/></g>
    <g><rect x="158" y="12" width="74" height="38" rx="3" fill="#2a2f66" stroke="#5560d6" stroke-width=".8"/><rect x="170" y="24" width="24" height="16" fill="#e8ecff"/><path d="M167 24h30l-3-7h-24z" fill="#ff5470"/><rect x="179" y="31" width="6" height="9" fill="#2a2f66"/><text x="204" y="35" font-size="6.500" fill="#cfd6ff" font-weight="700">Obchod</text></g>
    <g><rect x="80" y="12" width="62" height="38" rx="3" fill="#3a2f45" stroke="#8a6fb0" stroke-width=".8"/><path d="M100 42V28l6-6 6 6v14z" fill="#d9c9f0"/><rect x="104" y="12.500" width="4" height="9" fill="#d9c9f0"/><path d="M102.500 15.500h7" stroke="#d9c9f0" stroke-width="1.600"/><path d="M106 12.500v-4" stroke="#d9c9f0" stroke-width="1.600"/><rect x="123" y="30" width="12" height="12" fill="#b9a4d8"/><text x="115" y="48" font-size="5.500" fill="#cdbfe6" text-anchor="middle">Kostel</text></g>
    <g><rect x="12" y="120" width="52" height="22" rx="3" fill="#3a2e1a" stroke="#d0a23a" stroke-width=".8"/><rect x="17" y="125" width="8" height="11" rx="1.500" fill="#ffd23f"/><rect x="19" y="127" width="4" height="3" fill="#3a2e1a"/><text x="38" y="140" font-size="5" fill="#f0d68a" text-anchor="middle">Čerp. stanice</text>
    ${flex && flex.img ? `<image class="vh-chk2" href="${flex.img}" x="30" y="121" width="26" height="16" preserveAspectRatio="xMidYMid meet"/>` : `<g class="vh-chk2"><rect x="34" y="123" width="14" height="13" rx="2" fill="#1b2e57" stroke="#3a6cf5" stroke-width=".8"/><circle cx="41" cy="130" r="3.500" fill="#0a1426" stroke="#4fd1ff"/></g>`}
    <g class="vh-chk2"><circle cx="58" cy="125" r="5" fill="#2fe3a0"/><path d="M55.500 125l2 2 3.500-4" fill="none" stroke="#04141a" stroke-width="1.400" stroke-linecap="round" stroke-linejoin="round"/></g></g>
    <g><rect x="158" y="124" width="74" height="18" rx="3" fill="#1f3a4a" stroke="#3a8bb0" stroke-width=".8"/><circle cx="170" cy="133" r="4" fill="#4fd1ff"/><text x="200" y="135" font-size="5.500" fill="#b8e6f7" text-anchor="middle">Škola</text></g>
    <text x="111" y="132" font-size="5" fill="#bff3d9" text-anchor="middle" opacity=".0">Park</text>
    <g fill="#0a1426" opacity=".0"></g>
    <rect class="vh-lot" x="160" y="74" width="70" height="40" rx="5" fill="#2fe3a0" fill-opacity="0" stroke="#2fe3a0" stroke-width="1.5" stroke-dasharray="4 3"/>
    ${person('0;.12;.2;.34;.42;.66;1', '0;.124;.124;.463;.463;1;1', 'M10 59 H37 H111 H150 V92 H195', '#1e86e0')}${person('0;.3;.4;.56;1', '0;.4;.4;1;1', 'M10 59 H72 V112 H38 V122', '#7c5cff')}
    <g class="vh-x vh-x1" stroke="#ff5470" stroke-width="3" stroke-linecap="round"><path d="M29 22l16 16M45 22l-16 16"/></g>
    <g class="vh-x vh-x2" stroke="#ff5470" stroke-width="3" stroke-linecap="round"><path d="M103 79l16 16M119 79l-16 16"/></g>
    ${flex && flex.img ? `<image class="vh-chk" href="${flex.img}" x="178" y="79" width="44" height="30" preserveAspectRatio="xMidYMid meet"/>` : `<g class="vh-chk"><rect x="182" y="82" width="30" height="24" rx="3" fill="#1b2e57" stroke="#3a6cf5"/><rect x="180" y="82" width="30" height="6" rx="2" fill="#1e86e0"/><circle cx="195" cy="98" r="5" fill="#0a1426" stroke="#4fd1ff" stroke-width="1.5"/></g>`}
    <g class="vh-chk"><circle cx="220" cy="80" r="9" fill="#2fe3a0"/><path d="M215 80l4 4 7-8" fill="none" stroke="#04141a" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round"/></g>
  </svg>`;

  // ── Scéna 2: bagr kope výkop pro přípojky (voda + elektřina) až k prádlomatu ──
  const sceneDig = `<svg viewBox="0 0 240 150" class="vh-svg" role="img" aria-label="Bagr vykope přípojky, položí se zámková dlažba a auto s rukou usadí prádlomat"><rect width="240" height="150" rx="12" fill="#0a1426"/>
    <rect x="0" y="70" width="240" height="80" fill="#2a2018"/><rect x="0" y="70" width="240" height="5" fill="#2d6b4a"/>
    <rect x="0" y="75" width="240" height="75" fill="url(#vhg)" opacity=".5"/>
    <defs><linearGradient id="vhg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2b1e"/><stop offset="1" stop-color="#1a130d"/></linearGradient></defs>
    <path class="vh-trench" d="M65 100 H208" fill="none" stroke="#120d09" stroke-width="20" stroke-linecap="round" pathLength="143"/>
    <path class="vh-water" d="M65 94 H188 V70" fill="none" stroke="#4fd1ff" stroke-width="2.800" stroke-linecap="round" stroke-linejoin="round" pathLength="200"/>
    <path class="vh-drain" d="M65 100 H198 V70" fill="none" stroke="#b79a73" stroke-width="3.600" stroke-linecap="round" stroke-linejoin="round" pathLength="200"/>
    <path class="vh-elec" d="M65 106 H208 V70" fill="none" stroke="#ffd23f" stroke-width="2.800" stroke-linecap="round" stroke-linejoin="round" pathLength="200"/>
    <g class="vh-pavg"><rect class="vh-pav" style="animation-delay:5.00s" x="164.0" y="62" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:5.07s" x="174.3" y="62" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:5.14s" x="184.6" y="62" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:5.21s" x="194.9" y="62" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:5.28s" x="205.2" y="62" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:5.35s" x="215.5" y="62" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:5.42s" x="225.8" y="62" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:5.49s" x="164.0" y="66" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:5.56s" x="174.3" y="66" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:5.63s" x="184.6" y="66" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:5.70s" x="194.9" y="66" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:5.77s" x="205.2" y="66" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:5.84s" x="215.5" y="66" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:5.91s" x="225.8" y="66" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:5.98s" x="164.0" y="70" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:6.05s" x="174.3" y="70" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:6.12s" x="184.6" y="70" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:6.19s" x="194.9" y="70" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:6.26s" x="205.2" y="70" width="9" height="3.4" rx="0.8" fill="#8a8f98"/><rect class="vh-pav" style="animation-delay:6.33s" x="215.5" y="70" width="9" height="3.4" rx="0.8" fill="#6e737c"/><rect class="vh-pav" style="animation-delay:6.40s" x="225.8" y="70" width="9" height="3.4" rx="0.8" fill="#8a8f98"/></g>
    ${flex && flex.img ? `<image class="vh-box" href="${flex.img}" x="166" y="10" width="70" height="60" preserveAspectRatio="xMidYMax meet"/>` : `<g class="vh-box"><rect x="188" y="26" width="44" height="44" rx="5" fill="#1b2e57" stroke="#3a6cf5"/><rect x="188" y="26" width="44" height="9" rx="3" fill="#3a6cf5"/><circle cx="203" cy="52" r="7" fill="#0a1426" stroke="#4fd1ff"/><circle cx="219" cy="52" r="7" fill="#0a1426" stroke="#4fd1ff"/></g>`}
    <g font-size="8.500" fill="#b8c6e0"><circle cx="22" cy="136" r="3" fill="#4fd1ff"/><text x="29" y="139">voda</text><circle cx="78" cy="136" r="3" fill="#b79a73"/><text x="85" y="139">odpad</text><circle cx="140" cy="136" r="3" fill="#ffd23f"/><text x="147" y="139">elektřina</text></g>
    <g class="vh-exc"><rect x="-17" y="-8" width="34" height="9" rx="4.500" fill="#2b3b5e"/><rect x="-13" y="-21" width="28" height="13" rx="2" fill="#f5b82e"/><rect x="-13" y="-33" width="15" height="13" rx="2" fill="#f5b82e"/><rect x="-10" y="-30" width="9" height="7" rx="1" fill="#a9d8ff"/>
      <g transform="translate(13 -19)"><g><animateTransform attributeName="transform" type="rotate" values="-10;16;-10" dur="1s" repeatCount="indefinite"/><line x1="0" y1="0" x2="22" y2="-11" stroke="#f5b82e" stroke-width="4.500" stroke-linecap="round"/><line x1="22" y1="-11" x2="33" y2="14" stroke="#e8a417" stroke-width="3.800" stroke-linecap="round"/><path d="M33 14l8-3-3 9z" fill="#aab6d0"/></g></g>
      <animateMotion dur="12s" repeatCount="indefinite" calcMode="linear" keyTimes="0;0.3;0.34;0.44;1" keyPoints="0;0.514;0.514;1;1" path="M22 70 H165 H300"/></g>
    <g class="vh-truck"><rect x="-38" y="-14" width="52" height="12" rx="2" fill="#2b3b5e"/><rect x="14" y="-20" width="20" height="18" rx="3" fill="#3a6cf5"/><rect x="18" y="-17" width="10" height="7" rx="1" fill="#a9d8ff"/><circle cx="-26" cy="0" r="5" fill="#111"/><circle cx="-6" cy="0" r="5" fill="#111"/><circle cx="24" cy="0" r="5" fill="#111"/>
      <g class="vh-crane"><line x1="-10" y1="-14" x2="-10" y2="-50" stroke="#f5b82e" stroke-width="4" stroke-linecap="round"/><line x1="-10" y1="-50" x2="75" y2="-62" stroke="#f5b82e" stroke-width="3.5" stroke-linecap="round"/><line class="vh-hook" x1="75" y1="-62" x2="75" y2="-62" stroke="#dfe6f2" stroke-width="1.2"/></g>
      <animateMotion dur="12s" repeatCount="indefinite" calcMode="linear" keyTimes="0;0.5;0.62;0.9;1" keyPoints="0;0;0.5;0.5;1" path="M-70 70 H126 H-70"/></g>
  </svg>`;

  // ── Scéna 3: provoz za 13 % z obratu ──
  const sceneRun = `<svg viewBox="0 0 240 150" class="vh-svg" role="img" aria-label="Provoz za 13 procent z obratu"><rect width="240" height="150" rx="12" fill="#0a1426"/>
    <g transform="translate(76 75) rotate(-90)"><circle r="34" fill="none" stroke="#1b2c52" stroke-width="14"/><circle class="vh-arc" r="34" fill="none" stroke="#2fe3a0" stroke-width="14" stroke-linecap="butt" pathLength="100" stroke-dasharray="0 100"/></g>
    <text x="76" y="76" text-anchor="middle" font-size="19" font-weight="800" fill="#eaf2ff">13 %</text><text x="76" y="90" text-anchor="middle" font-size="8.500" fill="#8ea2c2">z obratu</text>
    <g><rect class="vh-b" x="136" y="40" width="20" height="85" rx="3" fill="#2a4478" style="--h:85"/><rect class="vh-b" x="162" y="20" width="20" height="105" rx="3" fill="#3a6cf5" style="--h:105"/><rect class="vh-b" x="188" y="8" width="20" height="117" rx="3" fill="#7c5cff" style="--h:117"/>
      <rect class="vh-b13" x="188" y="8" width="20" height="15" rx="3" fill="#2fe3a0"/></g>
    <path d="M130 125 H214" stroke="#2b4a86" stroke-width="1.500"/>
  </svg>`;

  const scene = (n, title, text, svg, tag) => `<div class="vh-step"><div class="vh-sc">${svg}<span class="vh-num">${n}</span></div><b>${title}</b><span>${text}</span>${tag ? `<em>${tag}</em>` : ''}</div>`;

  // ── Kalkulačka: FLEX + posuvník DC ──
  let calc = '';
  if (flex && flex.net > 0) {
    const room = Math.max(0, Math.floor((flex.room || 0) * HR)); // maximum v DC
    const step = Math.max(1, Math.round(room / 100));
    calc = `<div class="vh-calc">
      <div class="vh-cimg">${flex.img ? `<img src="${flex.img}" alt="${esc(flex.name)}">` : ''}</div>
      <div class="vh-cbody">
        <div class="vh-ct"><span class="vh-n4">4</span><span>DC snižuje cenu — čím víc DC, tím menší cena</span></div>
        <div class="vh-nm">${esc(flex.name)}</div>
        <div class="vh-price"><b id="vh-new">${Math.round(flex.net).toLocaleString('cs-CZ')}</b> <small>${sym} bez DPH</small> <s id="vh-old">${Math.round(flex.net).toLocaleString('cs-CZ')} ${sym}</s></div>
        <div class="vh-sl"><span class="small muted">Uplatněné DC</span><b id="vh-dc">0 DC</b></div>
        <input type="range" id="vh-r" min="0" max="${room}" step="${step}" value="0" aria-label="Kolik DC uplatnit" ${room ? '' : 'disabled'}>
        <div class="vh-cmp"><div class="vh-row"><span>Pořizovací cena</span><div class="vh-bar"><i id="vh-b1" style="width:100%"></i></div></div><div class="vh-row"><span>Doba návratnosti</span><div class="vh-bar"><i id="vh-b2" class="g" style="width:100%"></i></div></div></div>
        <div class="vh-sv" id="vh-sv">Posuň posuvník a uvidíš, o kolik se zlevní prádlomat.</div>
      </div>
    </div>
    <script>(function(){var NET=${JSON.stringify(Math.round(flex.net))},ROOM=${JSON.stringify(room)},SYM=${JSON.stringify(sym)},R=${JSON.stringify(HR)};
      var r=document.getElementById('vh-r');if(!r)return;var nw=document.getElementById('vh-new'),dcE=document.getElementById('vh-dc'),bd=document.createElement('i'),b1=document.getElementById('vh-b1'),b2=document.getElementById('vh-b2'),sv=document.getElementById('vh-sv'),old=document.getElementById('vh-old');
      function f(n){return Math.round(n).toLocaleString('cs-CZ');}
      var shown=NET,raf=null,touched=false;
      function paint(v){var dc=Math.max(0,Math.min(ROOM,v)),dcc=dc/R,pr=NET-dcc,pct=NET>0?dcc/NET*100:0;
        nw.textContent=f(pr);dcE.textContent=f(dc)+' DC';bd.textContent='−'+(Math.round(pct*10)/10).toLocaleString('cs-CZ')+' %';bd.style.transform='scale('+(1+Math.min(pct,40)/200)+')';
        b1.style.width=(NET>0?pr/NET*100:100)+'%';b2.style.width=(NET>0?pr/NET*100:100)+'%';old.style.opacity=dc>0?'.7':'0';
        sv.innerHTML=dc>0?('Ušetříš <b>'+f(dcc)+' '+SYM+'</b> už při nákupu'+(R!==1?' ('+f(dc)+' DC)':'')+'.'):'Posuň posuvník a uvidíš, o kolik se zlevní prádlomat.';}
      function go(to){cancelAnimationFrame(raf);var from=shown,t0=null,d=Math.min(900,200+Math.abs(to-from)/Math.max(1,ROOM)*700);(function st(ts){if(t0==null)t0=ts;var k=Math.min(1,(ts-t0)/d),e=1-Math.pow(1-k,3);shown=from+(to-from)*e;paint(shown);r.value=shown;if(k<1)raf=requestAnimationFrame(st);})(performance.now());}
      shown=0;paint(0);
      r.addEventListener('input',function(){touched=true;cancelAnimationFrame(raf);shown=+r.value;paint(shown);});
      [].forEach.call(document.querySelectorAll('.vh-q button'),function(b){b.addEventListener('click',function(){touched=true;go(ROOM*(+b.getAttribute('data-p'))/100);});});
      if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting&&!touched){io.disconnect();setTimeout(function(){if(!touched)go(ROOM*0.6);},600);}});},{threshold:.5});io.observe(document.querySelector('.vh-calc'));}
    })();</script>`;
  }

  return `<style>
  .vh{position:relative;overflow:hidden;margin:22px 0 18px;padding:24px 22px 22px;border-radius:20px;border:1px solid var(--border2);background:radial-gradient(900px 260px at 0% 0%,rgba(30,134,224,.22),transparent 60%),radial-gradient(700px 260px at 100% 100%,rgba(124,92,255,.22),transparent 60%),var(--card2);box-shadow:0 24px 70px rgba(0,0,0,.4)}
  .vh h2{margin:0 0 4px;font-size:clamp(20px,2.6vw,28px);letter-spacing:-.02em;font-weight:800;line-height:1.15;background:linear-gradient(90deg,#fff 0%,var(--accent2) 55%,var(--vio) 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
  .vh .vh-sub{margin:0 0 18px;color:var(--text2);font-size:14px;max-width:760px}
  .vh-flow{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
  .vh-step{position:relative;display:flex;flex-direction:column;gap:6px;padding:12px 12px 14px;border-radius:16px;background:rgba(10,18,36,.7);border:1px solid var(--border)}
  .vh-step:not(:last-child)::after{content:"";position:absolute;top:34%;right:-17px;width:18px;height:2px;background:linear-gradient(90deg,var(--accent2),var(--vio));opacity:.85}
  .vh-step:not(:last-child)::before{content:"";position:absolute;top:calc(34% - 4px);right:-18px;border:5px solid transparent;border-left:7px solid var(--vio)}
  .vh-sc{position:relative;border-radius:12px;overflow:hidden;border:1px solid var(--border);line-height:0}.vh-svg{width:100%;height:auto;display:block}
  .vh-num{position:absolute;top:8px;left:8px;width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--vio));color:#fff;font-weight:800;font-size:13px;line-height:24px;text-align:center;box-shadow:0 4px 14px rgba(30,134,224,.5)}
  .vh-step b{font-size:16px;letter-spacing:-.01em;margin-top:6px}.vh-step span{font-size:13px;color:var(--text2);line-height:1.4}
  .vh-step em{font-style:normal;align-self:flex-start;margin-top:4px;font-size:12px;font-weight:800;color:var(--ok);background:rgba(47,227,160,.12);border:1px solid rgba(47,227,160,.35);padding:3px 9px;border-radius:999px}
  .vh-step .vh-num{font-size:13px;color:#fff}
  .vh-x{opacity:0;animation:vhx1 8s ease infinite}.vh-x2{animation-name:vhx2}
  .vh-lot{animation:vhlot 8s ease infinite}.vh-chk{opacity:0;animation:vhchk 8s ease infinite}.vh-chk2{opacity:0;animation:vhchk2 8s ease infinite}
  @keyframes vhx1{0%,18%{opacity:0}22%,92%{opacity:1}100%{opacity:0}}
  @keyframes vhx2{0%,40%{opacity:0}44%,92%{opacity:1}100%{opacity:0}}
  @keyframes vhlot{0%,66%{fill-opacity:0}72%,94%{fill-opacity:.28}100%{fill-opacity:0}}
  @keyframes vhchk2{0%,56%{opacity:0}64%,94%{opacity:1}100%{opacity:0}}
  @keyframes vhchk{0%,68%{opacity:0}76%,94%{opacity:1}100%{opacity:0}}
  .vh-trench{stroke-dasharray:143;animation:vhdig 12s linear infinite}.vh-water,.vh-drain,.vh-elec{stroke-dasharray:200;animation:vhpipe 12s linear infinite}.vh-drain{animation-delay:.05s}.vh-elec{animation-delay:.1s}
  @keyframes vhdig{0%{stroke-dashoffset:143}30%,96%{stroke-dashoffset:0}100%{stroke-dashoffset:0;opacity:0}}
  @keyframes vhpipe{0%,4%{stroke-dashoffset:200}31%,96%{stroke-dashoffset:0}100%{stroke-dashoffset:0;opacity:0}}
  .vh-pav{opacity:0;animation:vhpav 12s linear infinite}@keyframes vhpav{0%{opacity:0;transform:translateY(-6px)}3%,96%{opacity:1;transform:none}100%{opacity:0}}
  .vh-box{opacity:0;transform-box:fill-box;animation:vhbox 12s linear infinite}@keyframes vhbox{0%,62%{opacity:0;transform:translateY(-46px)}66%{opacity:1;transform:translateY(-46px)}80%{opacity:1;transform:translateY(0)}86%,96%{opacity:1;transform:translateY(0);filter:drop-shadow(0 0 7px #4fd1ff)}100%{opacity:0;transform:translateY(0)}}
  .vh-hook{animation:vhhook 12s linear infinite}@keyframes vhhook{0%,62%{y2:-62px}66%{y2:-62px}80%{y2:-10px}84%,100%{y2:-62px}}
  .vh-arc{animation:vharc 6s ease infinite}@keyframes vharc{0%{stroke-dasharray:0 100}25%,92%{stroke-dasharray:13 100}100%{stroke-dasharray:0 100}}
  .vh-b{transform-box:fill-box;transform-origin:50% 100%;animation:vhgrow 6s ease infinite}.vh-b:nth-of-type(2){animation-delay:.12s}.vh-b:nth-of-type(3){animation-delay:.24s}
  @keyframes vhgrow{0%{transform:scaleY(.05)}25%,92%{transform:scaleY(1)}100%{transform:scaleY(.05)}}
  .vh-b13{transform-box:fill-box;transform-origin:50% 0;animation:vhb13 6s ease infinite}@keyframes vhb13{0%,25%{opacity:0;transform:scaleY(.05)}35%,92%{opacity:1;transform:scaleY(1)}100%{opacity:0}}
  .vh-calc{margin-top:18px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:20px;align-items:center;padding:18px;border-radius:18px;background:rgba(6,12,26,.72);border:1px solid var(--border2)}
  .vh-cimg{position:relative;display:flex;align-items:center;justify-content:center;min-height:180px;border-radius:14px;background:radial-gradient(ellipse at 50% 60%,rgba(79,209,255,.16),transparent 70%)}
  .vh-cimg img{width:100%;max-width:420px;height:auto;object-fit:contain;filter:drop-shadow(0 18px 30px rgba(0,0,0,.55));transition:transform .4s}.vh-calc:hover .vh-cimg img{transform:scale(1.03)}
  .vh-badge{position:absolute;top:6px;right:6px;font-weight:800;font-size:18px;color:#04141a;background:linear-gradient(135deg,#2fe3a0,#4fd1ff);padding:7px 13px;border-radius:999px;box-shadow:0 8px 24px rgba(47,227,160,.4);transition:transform .2s}
  .vh-ct{display:flex;gap:10px;align-items:center;font-weight:800;font-size:16px}.vh-n4{width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--vio));color:#fff;text-align:center;line-height:26px;font-size:13px;flex:none}
  .vh-nm{margin:8px 0 2px;color:var(--text2);font-size:14px}.vh-price{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.vh-price b{font-size:clamp(28px,4vw,40px);font-weight:800;letter-spacing:-.02em}.vh-price small{color:var(--text2);font-size:13px}.vh-price s{color:var(--text3);font-size:14px;transition:opacity .3s}
  .vh-sl{display:flex;justify-content:space-between;align-items:baseline;margin-top:12px}.vh-sl b{color:var(--ok);font-size:16px}
  #vh-r{-webkit-appearance:none;appearance:none;width:100%;height:10px;border-radius:999px;background:linear-gradient(90deg,var(--accent),var(--vio));padding:0;border:0;margin:8px 0 10px;cursor:pointer;outline:none;box-shadow:0 0 18px rgba(58,108,245,.3)}
  #vh-r::-webkit-slider-thumb{-webkit-appearance:none;width:26px;height:26px;border-radius:50%;background:#fff;border:3px solid var(--accent2);box-shadow:0 4px 14px rgba(0,0,0,.5),0 0 0 6px rgba(79,209,255,.2)}
  #vh-r::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:#fff;border:3px solid var(--accent2)}
  .vh-q{display:flex;gap:6px;flex-wrap:wrap}.vh-q button{font:inherit;font-size:13px;font-weight:700;color:var(--text);background:rgba(120,160,255,.1);border:1px solid var(--border2);border-radius:999px;padding:6px 13px;cursor:pointer;min-height:34px}.vh-q button:hover{background:rgba(79,209,255,.18)}
  .vh-cmp{margin-top:14px;display:grid;gap:9px}.vh-row{display:grid;grid-template-columns:124px 1fr;gap:10px;align-items:center;font-size:12.5px;color:var(--text2)}
  .vh-bar{height:18px;border-radius:7px;background:rgba(120,160,255,.1);overflow:hidden}.vh-bar i{display:block;height:100%;border-radius:7px;background:linear-gradient(90deg,#3a4a6e,#6a7fae);transition:width .08s linear}.vh-bar i.g{background:linear-gradient(90deg,var(--accent),#3a6cf5 55%,var(--vio))}
  .vh-sv{margin-top:12px;font-size:13.5px;color:var(--text2);min-height:38px}.vh-sv b{color:var(--ok)}
  @media(max-width:900px){.vh-flow{grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}.vh-step::after,.vh-step::before{display:none!important}.vh-calc{grid-template-columns:1fr}}
  @media(max-width:520px){.vh-row{grid-template-columns:100px 1fr}}
  @media(prefers-reduced-motion:reduce){.vh-x,.vh-lot,.vh-chk,.vh-chk2,.vh-trench,.vh-water,.vh-elec,.vh-box,.vh-arc,.vh-b,.vh-b13{animation:none!important}.vh-x,.vh-chk,.vh-chk2,.vh-b13{opacity:1}.vh-arc{stroke-dasharray:13 100}.vh-trench,.vh-water,.vh-drain,.vh-elec{stroke-dashoffset:0}}
  </style>
  <section class="vh">
    <h2>Prádlomat nekupujete sami. Best Series zařídí všechno ostatní.</h2>
    <p class="vh-sub">Od prvního místa po provoz hotového stroje. Vy si vyberete prádlomat, my se postaráme o zbytek.</p>
    <div class="vh-flow">
      ${scene(1, 'Zařídíme místo', 'Naši lidé najdou a vyhodnotí vhodnou lokalitu pro váš prádlomat.', sceneFind)}
      ${scene(2, 'Vytvoříme přípojky', 'Zajistíme a vybudujeme přípojky vody, odpadu a elektřiny až k prádlomatu.', sceneDig)}
      ${scene(3, 'Provozujeme za 13 % z obratu', 'Postaráme se o provoz. Platíte jen z toho, co stroj skutečně vydělá.', sceneRun, '13 % z obratu')}
    </div>
    ${calc}
  </section>`;
}
function supporterProducts(s, offers = [], { balance = 0, rate = 25, msg = '', services = [], hasMachine = true } = {}) {
  const cur = curOf(s), sym = cur === 'EUR' ? '€' : 'Kč';
  const R = cur === 'EUR' ? (Number(rate) || 25) : 1; // kolik DC (Kč) odpovídá 1 jednotce zobrazené měny
  const bal = Math.max(0, Math.floor(Number(balance) || 0));
  const fmt = (n) => Math.round(n).toLocaleString('cs-CZ');
  // Prádlomat FLEX pro interaktivní kalkulačku v úvodní grafice (cena, max. využitelné DC, fotka)
  const flexOffer = offers.find(p => /flex/i.test(p.name_cs || '') && (cur === 'EUR' ? p.price_eur : p.price_czk) != null) || null;
  let flexData = null;
  if (flexOffer) {
    const fnet = Number(cur === 'EUR' ? flexOffer.price_eur : flexOffer.price_czk);
    const fminB = cur === 'EUR' ? flexOffer.min_price_eur : flexOffer.min_price_czk;
    let froom = Math.max(0, Math.round(fnet - (fminB == null ? 0 : Number(fminB))));
    if (flexOffer.dc_use_pct != null) froom = Math.min(froom, Math.floor(fnet * Number(flexOffer.dc_use_pct) / 100));
    flexData = { name: flexOffer.name_cs, net: fnet, room: froom, img: productImg(flexOffer), R };
  }
  return layout({ title: 'Prádlomaty', user: s.nick, nav: userNav(s), active: 'products', fx: true, body: `
  ${valueHero({ flex: flexData, sym })}
  <div class="row" style="justify-content:space-between;align-items:center;margin:22px 0 10px"><h2 style="margin:0;display:flex;align-items:center;gap:8px">${ico('box', 18)} Prádlomaty, které si můžeš pořídit</h2>${curSw(s, '/pradlomaty')}</div>
  ${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}
  <form id="orderf" method="post" action="/order" style="display:none"><input name="item"><input name="dc"><input name="years"></form>
  <div id="dcm" style="display:none;position:fixed;inset:0;z-index:90;background:rgba(2,6,16,.72);backdrop-filter:blur(3px);align-items:center;justify-content:center;padding:16px"><div class="card" style="width:min(460px,100%);margin:0;box-shadow:0 30px 80px rgba(0,0,0,.6)">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><b style="font-size:18px">Uplatnit Discount Credit</b><button type="button" id="dcm-x" class="btn sec sm" aria-label="Zavřít">✕</button></div>
    <div class="muted small" id="dcm-name" style="margin:2px 0 14px"></div>
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px"><span class="muted small">Kolik DC uplatnit</span><span class="muted small">max. <b id="dcm-cap"></b> DC</span></div>
    <div style="display:flex;gap:10px;align-items:center;margin:8px 0 6px"><input type="range" id="dcm-r" min="0" max="0" step="1" value="0" style="flex:1;accent-color:var(--accent,#4fd1ff)"><input type="number" id="dcm-n" min="0" step="1" value="0" inputmode="numeric" style="width:110px;padding:8px 10px;text-align:right"></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px"><button type="button" class="btn sec sm" data-pct="0">0</button><button type="button" class="btn sec sm" data-pct="25">25 %</button><button type="button" class="btn sec sm" data-pct="50">50 %</button><button type="button" class="btn sec sm" data-pct="75">75 %</button><button type="button" class="btn sec sm" data-pct="100">Max</button></div>
    <div style="border-top:1px solid var(--border);padding-top:12px;display:grid;gap:6px;font-size:14px">
      <div style="display:flex;justify-content:space-between"><span class="muted">Původní cena bez DPH</span><span id="dcm-p0"></span></div>
      <div style="display:flex;justify-content:space-between"><span class="muted">Sleva z DC</span><b id="dcm-sv" style="color:var(--ok)"></b></div>
      <div style="display:flex;justify-content:space-between;font-size:17px"><b>Cena po slevě bez DPH</b><b id="dcm-p1"></b></div>
      <div style="display:flex;justify-content:space-between"><span class="muted">s DPH 21 %</span><span id="dcm-p2"></span></div>
      <div style="display:flex;justify-content:space-between"><span class="muted">Zbude ti DC</span><span id="dcm-left"></span></div>
      <div class="muted small" id="dcm-min"></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button type="button" id="dcm-cancel" class="btn sec">Zrušit</button><button type="button" id="dcm-ok" class="btn">Použít</button></div>
  </div></div>
  <div class="card" style="margin:0 0 14px;display:flex;flex-wrap:wrap;gap:18px;align-items:center;justify-content:space-between">
    <div><div class="small muted">Dostupné Discount Credit</div><div style="font-size:28px;font-weight:800;letter-spacing:-.02em"><span id="dc-left">${fmt(bal)}</span> <span style="font-size:18px">DC</span></div></div>
    <div class="small muted" style="max-width:520px">DC můžeš použít jako slevu na prádlomat. Klikni na <b>Uplatnit DC</b>, zadej kolik chceš uplatnit — cena se hned přepočítá. Tlačítkem <b>Koupit</b> odešleš objednávku, kterou potvrdíme.</div>
  </div>
  <div class="grid" id="dc-grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))">${offers.map(p => { const net = cur === 'EUR' ? p.price_eur : p.price_czk; const minB = cur === 'EUR' ? p.min_price_eur : p.min_price_czk; const minN = minB == null ? 0 : Number(minB); let room = net == null ? 0 : Math.max(0, Math.round(Number(net) - minN)); if (p.dc_use_pct != null && net != null) room = Math.min(room, Math.floor(Number(net) * Number(p.dc_use_pct) / 100)); return `
    <div class="card dc-card" style="margin:0" data-price="${net == null ? '' : Number(net)}" data-room="${room}">${productImg(p) ? `<div style="margin:-6px -6px 12px;padding:10px;border-radius:14px;background:radial-gradient(ellipse at 50% 100%,rgba(79,209,255,.16),transparent 65%)"><img src="${productImg(p)}" alt="${esc(p.name_cs)}" loading="lazy" decoding="async" style="display:block;width:100%;height:170px;object-fit:contain;filter:drop-shadow(0 16px 28px rgba(0,0,0,.6))"></div>` : ''}<b style="font-size:16px">${esc(p.name_cs)}</b>
      <div class="dc-price" style="margin-top:12px;font-size:24px;font-weight:800;letter-spacing:-.02em">${money(net, sym)}</div>
      <div class="small muted">cena bez DPH</div>
      <div class="small muted" style="opacity:.8">${money(vatPrice(p, cur), sym)} s DPH 21 %</div>
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)" class="small"><span class="muted">Maximální sleva z DC:</span> ${p.dc_use_pct == null && minB == null ? '<span class="muted">zatím nenastaveno</span>' : room > 0 ? `<b style="color:var(--ok)">${esc(Math.floor(room * R).toLocaleString('cs-CZ'))} DC</b>${cur === 'EUR' ? ` <span class="muted">(= ${money(Math.round(room), sym)})</span>` : ''}` : '<span class="muted">nelze uplatnit</span>'}</div>
      ${room > 0 && net != null ? `<div class="small" style="margin-top:4px"><span class="muted">Cena po odečtení slevy:</span> <b>${money(Math.round(Number(net) - room), sym)}</b> <span class="muted">bez DPH · ${money(Math.round((Number(net) - room) * 1.21), sym)} s DPH</span></div>` : ''}
      ${net != null ? `<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><button type="button" class="btn sec sm dc-toggle"${bal > 0 && room > 0 ? '' : ' disabled style="opacity:.5;cursor:not-allowed" title="' + (bal > 0 ? 'Na tento prádlomat nelze DC uplatnit' : 'Nemáš žádné DC') + '"'}>Uplatnit DC</button><button type="button" class="btn sm dc-buy" data-item="${p.id}" data-name="${esc(p.name_cs)}">Koupit</button></div>` : ''}
      ${net != null && bal > 0 && room > 0 ? `<div class="dc-panel" style="margin-top:12px"><div style="display:none"><input type="number" class="dc-in" min="0" max="${Math.min(bal, Math.floor(room * R))}" step="1" value="0" inputmode="numeric" style="width:120px;padding:8px 10px;text-align:right"><span class="muted">DC</span><button type="button" class="btn sec sm dc-max">Max</button></div>
      <div class="dc-after small" style="margin-top:8px;display:none">Po slevě: <b class="dc-new"></b> bez DPH <span class="muted">(<span class="dc-gross"></span> s DPH · ušetříš <span class="dc-saved"></span>)</span></div>
</div>` : ''}
    </div>`; }).join('')}</div>
  ${offers.length ? '' : '<p class="muted">Momentálně nemáme žádnou nabídku.</p>'}
  ${!hasMachine && services.length ? `<div class="card" style="margin:26px 0 0;border-color:rgba(245,158,11,.5);background:rgba(245,158,11,.07)"><b>🔒 Služby a záruku lze objednat až po koupi prádlomatu.</b><div class="small muted" style="margin-top:4px">Nejdřív si vyberte prádlomat výše — pak se tlačítka Koupit / Poptat odemknou.</div></div>` : ''}
  ${['services', 'warranty'].map(sec => { const list = services.filter(x => (x.section || 'services') === sec && !x.hidden_card); return list.length ? `<div class="${hasMachine ? '' : 'svc-locked'}"><h2 style="margin:30px 0 10px;display:flex;align-items:center;gap:8px">${ico(sec === 'warranty' ? 'lock' : 'sprout', 18)} ${sec === 'warranty' ? 'Záruka a servis' : 'Služby'}</h2>
  ${sec === 'services' ? `<div class="card svc-q" style="margin:0 0 14px"><b style="font-size:16px">Chcete mít místo ve své správě, nebo ve správě Best Series?</b>
    <div class="pfc" id="svc-mgmt" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
      <label class="pfo on"><input type="radio" name="svc-mgmt" value="own" checked><b>Ve své správě</b><span>Místo i přípojky jsou <b>Vaše</b>. Pokud místo neumíte najít, zaplatíte si Najít místo; pokud neumíte udělat přípojky, zaplatíte si Přípojky. DC nelze uplatnit.</span></label>
      <label class="pfo"><input type="radio" name="svc-mgmt" value="bs"><b>Ve správě Best Series</b><span>Místo i přípojky zajistí Best Series na vlastní smlouvu — <b>zdarma</b>. Místo není Vaše, nemáte k němu právní vazbu.</span></label>
    </div></div>
  <div class="svc-split"><div class="svc-own" id="svc-own"><div class="svc-h"><b>Ve své správě</b><span>Objednejte jen to, co neumíte zajistit sami.</span></div>` : `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))">`}${list.map(sv => {
    const net = sv.net;
    if (sv.mode === 'percent') return `<div class="card" style="margin:0;display:flex;flex-direction:column"><b style="font-size:17px">${esc(sv.name)}</b><p class="small muted" style="margin:8px 0 0">${esc(sv.desc || '')}</p>
      <div style="margin-top:14px;font-size:24px;font-weight:800;letter-spacing:-.02em">${esc(String(sv.percent).replace('.', ','))} % z obratu</div><div class="small muted">cena včetně DPH · počítá se z obratu prádlomatu${sv.no_dc ? ' · <b style="color:#f59e0b">DC nelze uplatnit</b>' : ' · DC půjde uplatnit'}</div>
      ${sv.key === 'service_contract' ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)"><div class="small muted" style="letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px">Co servis zahrnuje</div><ul class="svc-inc">
        <li>📞 <b>Infolinka 24/7</b> — zákazníci volají nám, ne Vám</li>
        <li>💻 <b>Softwarová podpora</b> v hodnotě 100 EUR / měsíc</li>
        <li>🔧 <b>Pravidelná údržba</b> prádlomatu</li>
        <li>🧴 <b>Detergenty</b> včetně jejich <b>doplňování</b></li>
        <li>👷 <b>Práce servisního technika</b> při závadě</li>
      </ul></div>` : ''}
      <div style="margin-top:auto;padding-top:14px;display:flex;justify-content:flex-end"><button type="button" class="btn sm svc-quote" data-item="svc:${sv.key}" data-name="${esc(sv.name)}" data-ask="Mám zájem o službu: ${esc(sv.name)}?">Mám zájem</button></div></div>`;
    if (net == null) return `<div class="card" style="margin:0;display:flex;flex-direction:column"><b style="font-size:17px">${esc(sv.name)}</b><p class="small muted" style="margin:8px 0 0">${esc(sv.desc || '')}</p>
      <div style="margin-top:14px;font-size:20px;font-weight:800;letter-spacing:-.01em">Individuální nacenění</div><div class="small muted">Cena se vytvoří podle konkrétní situace. Po odeslání poptávky se ti ozveme s nabídkou.${sv.no_dc ? ' <b style="color:#f59e0b">DC nelze uplatnit.</b>' : ' DC půjde uplatnit.'}</div>
      <div style="margin-top:auto;padding-top:14px;display:flex;justify-content:flex-end"><button type="button" class="btn sm svc-quote" data-item="svc:${sv.key}" data-name="${esc(sv.name)}">Poptat nacenění</button></div></div>`;
    const room = Math.max(0, Math.floor(net * (sv.dc_use_pct == null ? 100 : Number(sv.dc_use_pct)) / 100));
    const yr = sv.per_year_net ? { per: Number(sv.per_year_net), min: sv.years_min || 2, max: sv.years_max || 5, free: sv.free_years || 0 } : null;
    return `<div class="card dc-card" style="margin:0;display:flex;flex-direction:column" data-price="${net}" data-room="${room}"${yr ? ` data-per="${yr.per}" data-free="${yr.free}" data-pct="${sv.dc_use_pct == null ? 100 : Number(sv.dc_use_pct)}"` : ''}><b style="font-size:17px">${esc(sv.name)}</b><p class="small muted" style="margin:8px 0 0">${esc(sv.desc || '')}</p>
      ${yr ? `<div class="wy" style="margin-top:12px"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="small muted">Délka prodloužení</span><b class="wy-n" style="color:var(--accent2)">${yr.min} roky</b></div><input type="range" class="wy-r" min="${yr.min}" max="${yr.max}" step="1" value="${yr.min}" style="width:100%;accent-color:#4fd1ff;margin:6px 0 2px"><div class="small muted" style="display:flex;justify-content:space-between"><span>${yr.min} roky</span><span>1. rok zdarma · ${money(yr.per, sym)} / další rok</span><span>${yr.max} let</span></div><div class="small wy-paid" style="margin-top:4px;color:var(--text2)"></div></div>` : ''}
      <div style="margin-top:14px;font-size:24px;font-weight:800;letter-spacing:-.02em"><span class="dc-price">${money(net, sym)}</span></div><div class="small muted">cena bez DPH · <span class="dc-vat">${money(Math.round(net * 1.21), sym)}</span> s DPH 21 %</div>
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)" class="small"><span class="muted">Maximálně z DC:</span> ${room > 0 ? `<b class="dc-room" style="color:var(--ok)">${esc(fmt(Math.floor(room * R)))} DC</b>` : '<span class="muted">nelze uplatnit</span>'}</div>
      <div style="margin-top:auto;padding-top:14px;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><button type="button" class="btn sec sm dc-toggle"${bal > 0 && room > 0 ? '' : ' disabled style="opacity:.5;cursor:not-allowed" title="' + (bal > 0 ? 'Na tuto službu nelze DC uplatnit' : 'Nemáš žádné DC') + '"'}>Uplatnit DC</button><button type="button" class="btn sm dc-buy" data-item="svc:${sv.key}" data-name="${esc(sv.name)}">Koupit</button></div>
      ${bal > 0 && room > 0 ? `<div class="dc-panel" style="margin-top:12px"><div style="display:none"><input type="number" class="dc-in" min="0" max="${Math.min(bal, Math.floor(room * R))}" step="1" value="0" inputmode="numeric"><button type="button" class="dc-max"></button></div>
      <div class="dc-after small" style="margin-top:8px;display:none">Po slevě: <b class="dc-new"></b> bez DPH <span class="muted">(<span class="dc-gross"></span> s DPH · ušetříš <span class="dc-saved"></span>)</span></div></div>` : ''}</div>`; }).join('')}${sec === 'services' ? `</div>
    <div class="card svc-free" id="svc-free" style="margin:0;display:flex;flex-direction:column"><div class="svc-h"><b>Ve správě Best Series — zdarma</b><span>Nic neplatíte.</span></div>
      <p class="small" style="margin:10px 0 0;line-height:1.5">Neplatíte Najít místo ani Přípojky. Místo i přípojky zajišťuje <b>Best Series</b> na vlastní smlouvu — místo <b>není Vaše</b>, nemáte k němu žádnou právní vazbu.</p>
      <div style="margin-top:14px;font-size:24px;font-weight:800;letter-spacing:-.02em;color:var(--ok)">0 Kč</div><div class="small muted">bez poplatků za místo a přípojky</div>
      <div style="margin-top:auto;padding-top:14px;display:flex;justify-content:flex-end"><button type="button" class="btn sm svc-quote" data-item="svc:place_free" data-name="Místo zdarma" data-ask="Mám zájem o místo zdarma — místo i přípojky zajistí Best Series na vlastní smlouvu (místo nebude Vaše).">Mám zájem o místo zdarma</button></div></div>
  </div>` : `</div>`}</div>` : ''; }).join('')}
  <script>
  (function(){
    var total=${bal}, sym=${JSON.stringify(sym)}, R=${JSON.stringify(R)}; // DC = Kč; sleva v měně = DC / R
    var cards=[].slice.call(document.querySelectorAll('.dc-card'));
    function fmt(n){return Math.round(n).toLocaleString('cs-CZ');}
    function used(except){var u=0;cards.forEach(function(c){if(c===except)return;var i=c.querySelector('.dc-in');if(i)u+=Math.max(0,parseInt(i.value,10)||0);});return u;}
    function recalc(){
      var u=0;
      cards.forEach(function(c){
        var i=c.querySelector('.dc-in'); if(!i)return;
        var price=parseFloat(c.getAttribute('data-price'))||0, room=parseFloat(c.getAttribute('data-room'));if(isNaN(room))room=price;room=Math.floor(room*R);
        var other=used(c), cap=Math.max(0,Math.min(room,total-other));
        var val=Math.max(0,parseInt(i.value,10)||0); if(val>cap){val=cap;i.value=cap;}
        i.max=cap; u+=val;
        var box=c.querySelector('.dc-after');
        if(val>0){box.style.display='block';c.querySelector('.dc-new').textContent=fmt(price-val/R)+' '+sym;c.querySelector('.dc-gross').textContent=fmt((price-val/R)*1.21)+' '+sym;c.querySelector('.dc-saved').textContent=fmt(val/R)+' '+sym+(R!==1?' ('+fmt(val)+' DC)':'');}else box.style.display='none';
      });
      document.getElementById('dc-left').textContent=fmt(total-u);
    }
    [].forEach.call(document.querySelectorAll('.dc-card[data-per]'),function(c){
      var r=c.querySelector('.wy-r'), n=c.querySelector('.wy-n'), per=parseFloat(c.getAttribute('data-per'))||0, pct=parseFloat(c.getAttribute('data-pct'))||100, free=parseInt(c.getAttribute('data-free'),10)||0, pd=c.querySelector('.wy-paid');
      function lab(y){return y+' '+(y<5?'roky':'let');}
      function upd(){ var y=parseInt(r.value,10)||2, paid=Math.max(0,y-free), price=per*paid, room=Math.floor(price*pct/100); c.setAttribute('data-price',price); c.setAttribute('data-room',room); n.textContent=lab(y); if(pd)pd.textContent='záruka celkem '+lab(y)+' · placeno '+paid+' × '+fmt(per)+' '+sym;
        var p=c.querySelector('.dc-price'); if(p)p.textContent=fmt(price)+' '+sym; var v=c.querySelector('.dc-vat'); if(v)v.textContent=fmt(price*1.21)+' '+sym;
        var roomDc=Math.floor(room*R);var mx=c.querySelector('.dc-in'); if(mx){ mx.max=Math.min(total,roomDc); if(parseInt(mx.value,10)>roomDc) mx.value=roomDc; }
        var rm=c.querySelector('.dc-room'); if(rm)rm.textContent=fmt(roomDc)+' DC'; recalc(); }
      r.addEventListener('input',upd); upd();
    });
    (function(){ var g=document.getElementById('svc-mgmt'), own=document.getElementById('svc-own'), fr=document.getElementById('svc-free'); if(!g)return;
      function up(){ var v=(g.querySelector('input:checked')||{}).value; [].forEach.call(g.querySelectorAll('.pfo'),function(l){ l.classList.toggle('on', l.querySelector('input').checked); }); if(own) own.classList.toggle('dim', v!=='own'); if(fr) fr.classList.toggle('dim', v!=='bs'); }
      g.addEventListener('change',up); up(); })();
    [].forEach.call(document.querySelectorAll('.svc-quote'),function(b){b.addEventListener('click',function(){
      var ask = b.getAttribute('data-ask') || ('Poptat nacenění: '+b.getAttribute('data-name')+'?');
      if(!confirm(ask+'\\n\\nOzveme se s individuální nabídkou.'))return;
      var f=document.getElementById('orderf');f.item.value=b.getAttribute('data-item');f.dc.value=0;f.submit();});});
    var M=document.getElementById('dcm'),mr=document.getElementById('dcm-r'),mn=document.getElementById('dcm-n'),cur=null,curBtn=null,curCap=0;
    function $(id){return document.getElementById(id);}
    function mupd(){
      var v=Math.max(0,Math.min(curCap,parseInt(mn.value,10)||0)),price=parseFloat(cur.getAttribute('data-price'))||0;
      $('dcm-p0').textContent=fmt(price)+' '+sym;$('dcm-sv').textContent='− '+fmt(v/R)+' '+sym;$('dcm-p1').textContent=fmt(price-v/R)+' '+sym;$('dcm-p2').textContent=fmt((price-v/R)*1.21)+' '+sym;$('dcm-left').textContent=fmt(total-used(cur)-v)+' DC';
    }
    function mset(v){v=Math.max(0,Math.min(curCap,Math.round(v)||0));mr.value=v;mn.value=v;mupd();}
    function openDc(c,btn){
      cur=c;curBtn=btn;var price=parseFloat(c.getAttribute('data-price'))||0,room=parseFloat(c.getAttribute('data-room'));if(isNaN(room))room=price;room=Math.floor(room*R);
      curCap=Math.max(0,Math.min(room,total-used(c)));mr.max=curCap;mn.max=curCap;
      $('dcm-name').textContent=c.querySelector('b').textContent;$('dcm-cap').textContent=fmt(curCap);
      var mnote=$('dcm-min'); if(mnote) mnote.textContent='';
      mset(parseInt(c.querySelector('.dc-in').value,10)||0);M.style.display='flex';mn.focus();mn.select();
    }
    function closeDc(){M.style.display='none';cur=null;}
    mr.addEventListener('input',function(){mset(parseInt(mr.value,10));});
    mn.addEventListener('input',function(){var v=parseInt(mn.value,10)||0;if(v>curCap){v=curCap;mn.value=v;}mr.value=v;mupd();});
    [].forEach.call(M.querySelectorAll('[data-pct]'),function(b){b.addEventListener('click',function(){mset(curCap*parseInt(b.getAttribute('data-pct'),10)/100);});});
    $('dcm-x').addEventListener('click',closeDc);$('dcm-cancel').addEventListener('click',closeDc);
    M.addEventListener('click',function(e){if(e.target===M)closeDc();});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&cur)closeDc();if(e.key==='Enter'&&cur&&e.target===mn)$('dcm-ok').click();});
    $('dcm-ok').addEventListener('click',function(){var v=parseInt(mn.value,10)||0;cur.querySelector('.dc-in').value=v;recalc();curBtn.textContent=v>0?'Změnit DC':'Uplatnit DC';closeDc();});
    cards.forEach(function(c){
      var tg=c.querySelector('.dc-toggle'), pn=c.querySelector('.dc-panel');
      if(tg&&pn&&!tg.disabled)tg.addEventListener('click',function(){openDc(c,tg);});
      var buy=c.querySelector('.dc-buy');
      if(buy)buy.addEventListener('click',function(){
        var inp=c.querySelector('.dc-in'), val=(inp&&c.querySelector('.dc-panel').style.display!=='none')?Math.max(0,parseInt(inp.value,10)||0):0;
        var price=parseFloat(c.getAttribute('data-price'))||0;
        var yr=c.querySelector('.wy-r'), ys=yr?parseInt(yr.value,10):0;
        var txt='Objednat '+buy.getAttribute('data-name')+(ys?' — '+ys+' '+(ys<5?'roky':'let'):'')+'?\\n\\nCena bez DPH: '+fmt(price-val/R)+' '+sym+(R!==1&&val>0?' (sleva '+fmt(val/R)+' '+sym+')':'')+(val>0?'\\nUplatněno DC: '+fmt(val):'')+'\\n\\nObjednávku potvrdíme.';
        if(!confirm(txt))return;
        var f=document.getElementById('orderf');f.item.value=buy.getAttribute('data-item');f.dc.value=val;f.years.value=ys||'';f.submit();
      });
    });
    cards.forEach(function(c){var i=c.querySelector('.dc-in'); if(!i)return;
      i.addEventListener('input',recalc);
      c.querySelector('.dc-max').addEventListener('click',function(){var room=parseFloat(c.getAttribute('data-room'));if(isNaN(room))room=parseFloat(c.getAttribute('data-price'))||0;room=Math.floor(room*R);i.value=Math.max(0,Math.min(room,total-used(c)));recalc();});
    });
  })();
  </script>` });
}
const PURCHASE_STATUS = { ordered: 'Objednáno', production: 'Ve výrobě', delivered: 'Dodáno', running: 'V provozu' };
const MODEL_L = { L1: 'L1 — nejkratší', L2: 'L2', L3: 'L3', L4: 'L4 — nejdelší' };

// Pohyby žádosti o převod podpory (evidence): ev = [{event, actor, detail, created_at}]
const TF_EV = { created: 'Žádost podána', amount_changed: 'Upravena částka DC', approved: 'Převedeno na Discount Credit', rejected: 'Zamítnuto' };
function tfEvents(ev, showActor) {
  if (!ev || !ev.length) return '';
  return `<details style="margin-top:6px"><summary class="small muted" style="cursor:pointer">Pohyby (${ev.length})</summary><div class="small" style="margin-top:4px;display:grid;gap:3px">${ev.map(e => `<div><span class="muted">${fmtDT(e.created_at)}</span> · ${esc(TF_EV[e.event] || e.event)}${showActor && e.actor ? ' <span class="muted">(' + esc(e.actor) + ')</span>' : ''}${e.detail ? ' — <span class="muted">' + esc(e.detail) + '</span>' : ''}</div>`).join('')}</div></details>`;
}
function supporterCredit(s, { rows = [], sellable = [], rate = 25, transfers = [], msg = '', tfEv = {} } = {}) {
  const cur = curOf(s), sym = cur === 'EUR' ? '€' : 'Kč', k = 1; // DC jsou vždy stejné (1 DC = 1 Kč), měna se mění jen u cen
  const conv = (x) => Math.round(Number(x) * k * 100) / 100;
  const bal = rows.reduce((a, r) => a + Number(r.amount_czk), 0) * k;
  // Nápověda s přepočtem na eura podle aktuálního kurzu (1 DC = 1 Kč)
  const rt = Number(rate) || 25, eurOne = Math.round(1 / rt * 10000) / 10000;
  const eurTxt = eurOne.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const rtTxt = rt.toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const isSeller = ['seller', 'standard'].includes(s.user_type); // Stávající vidí totéž co Může prodávat
  const creditHelp = { title: HELP.credit.title, html: HELP.credit.html.replace(/<p>DC se Vám připíše[\s\S]*?<\/p>/, isSeller ? '$&' : '<p>DC Vám připíše administrátor — například po převodu podpory ze starého systému (tlačítko <b>Přenést podporu ze starého systému</b>) nebo jako bonus.</p>').replace('1 DC = 1 Kč slevy na nákup prádlomatu.', '1 DC = 1 Kč slevy na nákup prádlomatu (v eurech ≈ ' + eurTxt + ' €, tedy ' + rtTxt + ' DC ≈ 1 €; kurz ' + rtTxt + ' Kč / 1 €).') };
  // Převod podpory ze starého systému (jen uživatelé typu Stávající): žádost → admin zpracuje ručně
  const canTransfer = s.user_type === 'standard';
  const TF_ST = { pending: ['invited', 'zpracovává se'], approved: ['active', 'převedeno'], rejected: ['blocked', 'zamítnuto'] };
  const tfSt = (t) => (TF_ST[t.status] || TF_ST.pending);
  const tfSrc = (t) => (t.kind === 'withdrawal' ? 'Z výběru' : 'Z podpory');
  const transferList = (transfers && transfers.length) ? `<h3 style="margin:20px 0 8px">Moje žádosti o převod podpory</h3><div class="card tbl-wrap"><table class="cards"><thead><tr><th>Datum</th><th>Zdroj</th><th>Částka</th><th>Kurz</th><th>DC</th><th>Stav</th><th>Poznámka</th></tr></thead><tbody>
    ${transfers.map(t => { const st = tfSt(t); return `<tr><td data-l="Datum" class="small muted">${fmtDT(t.created_at)}</td><td data-l="Zdroj">${tfSrc(t)}</td><td data-l="Částka">${money(t.amount, t.currency === 'EUR' ? '€' : 'Kč')}</td><td data-l="Kurz" class="small muted">${t.currency === 'EUR' ? '1 € = ' + esc(Number(t.rate).toLocaleString('cs-CZ', { maximumFractionDigits: 4 })) + ' Kč' : '—'}</td><td data-l="DC"><b>${money(t.dc_amount, 'DC')}</b></td><td data-l="Stav"><span class="badge ${st[0]}">${st[1]}</span>${tfEvents(tfEv[t.id], false)}</td><td data-l="Poznámka" class="small muted">${esc(t.admin_note || '')}</td></tr>`; }).join('')}</tbody></table></div>` : '';
  const transferModal = `<div id="tfm" style="display:none;position:fixed;inset:0;z-index:90;background:rgba(2,6,16,.72);backdrop-filter:blur(3px);align-items:center;justify-content:center;padding:16px"><div class="card" style="width:min(460px,100%);margin:0;box-shadow:0 30px 80px rgba(0,0,0,.6)">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><b style="font-size:18px">Přenést podporu ze starého systému</b><button type="button" id="tfm-x" class="btn sec sm" aria-label="Zavřít">✕</button></div>
    <p class="muted small" style="margin:6px 0 12px">Vyber, odkud ve starém systému částku přenášíš. V obou případech se po ověření připíše jako Discount Credit. Žádost zpracujeme ručně.</p>
    <form method="post" action="/discount-credit/transfer" id="tfm-f" style="margin:0">
      <div style="display:grid;gap:8px;margin-bottom:14px">
        <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;padding:10px 12px;border:1px solid var(--border);border-radius:12px"><input type="radio" name="kind" value="support" checked style="margin-top:3px;width:auto"><span><b>Z podpořené částky</b><br><span class="small muted">Přenesu část podpory, kterou mám nasbíranou ve starém systému.</span></span></label>
        <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;padding:10px 12px;border:1px solid var(--border);border-radius:12px"><input type="radio" name="kind" value="withdrawal" style="margin-top:3px;width:auto"><span><b>Z výběru</b><br><span class="small muted">Přenesu částku, kterou bych si jinak nechal vybrat ve starém systému.</span></span></label>
      </div>
      <label class="small muted" id="tfm-al">Částka z podpory</label>
      <div style="display:flex;gap:8px;margin:4px 0 12px"><input type="number" name="amount" id="tfm-a" min="1" step="0.01" inputmode="decimal" required placeholder="např. 5000" style="flex:1;text-align:right"><select name="cur" id="tfm-c" style="width:auto"><option value="CZK"${cur === 'EUR' ? '' : ' selected'}>Kč</option><option value="EUR"${cur === 'EUR' ? ' selected' : ''}>€</option></select></div>
      <div style="border-top:1px solid var(--border);padding-top:12px;display:grid;gap:6px;font-size:14px">
        <div id="tfm-rrow" style="display:flex;justify-content:space-between"><span class="muted">Kurz</span><span id="tfm-rate"></span></div>
        <div style="display:flex;justify-content:space-between;font-size:17px"><b id="tfm-lbl">Bude připsáno</b><b id="tfm-dc" style="color:var(--ok)">0 DC</b></div>
        <div class="muted small" id="tfm-hint">1 DC = 1 Kč slevy na nákup prádlomatu.</div>
      </div>
      <label class="small muted" id="tfm-nl" style="display:block;margin-top:14px">Poznámka (nepovinné — např. přihlašovací jméno / ID ve starém systému)</label>
      <input type="text" name="note" maxlength="300" style="width:100%;margin-top:4px">
      <div style="margin-top:16px;padding:12px 14px;border-radius:12px;background:rgba(255,184,77,.1);border:1px solid rgba(255,184,77,.45);font-size:13px;line-height:1.5"><b>⚠ Důležité</b><br>Žádost je <b>závazná a nelze ji zrušit ani vzít zpět</b>. Bude splněna <b>maximálně do výše podpory, resp. výběru</b>, kterou ve starém systému skutečně umožňuje – pokud zadáte víc, převede se jen povolená částka.
        <label style="display:flex;gap:10px;align-items:center;margin:12px 0 0;cursor:pointer;font-weight:600"><input type="checkbox" name="confirm" value="1" required style="width:18px;height:18px;min-width:18px;flex:0 0 18px;margin:0;padding:0"><span style="flex:1;min-width:0">Rozumím a souhlasím, že žádost je závazná a nelze ji zrušit.</span></label></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button type="button" id="tfm-cancel" class="btn sec">Zrušit</button><button type="submit" class="btn">Odeslat žádost</button></div>
    </form></div></div>
  <script>(function(){var RT=${JSON.stringify(rt)};var m=document.getElementById('tfm'),o=document.getElementById('tfm-open');if(!m||!o)return;
    var a=document.getElementById('tfm-a'),c=document.getElementById('tfm-c'),dc=document.getElementById('tfm-dc'),rate=document.getElementById('tfm-rate');
    function fm(n,d){return Number(n).toLocaleString('cs-CZ',{maximumFractionDigits:d==null?2:d});}
    function kind(){var r=document.querySelector('#tfm-f input[name=kind]:checked');return r?r.value:'support';}
    function calc(){var eur=c.value==='EUR',v=parseFloat(String(a.value).replace(',','.'))||0;
      document.getElementById('tfm-al').textContent=kind()==='withdrawal'?'Částka z výběru':'Částka z podpory';
      rate.textContent=eur?('1 € = '+fm(RT,4)+' Kč'):'1 Kč = 1 DC';dc.textContent=fm(Math.round((eur?v*RT:v)*100)/100)+' DC';}
    function open(){m.style.display='flex';calc();setTimeout(function(){a.focus();},50);}function close(){m.style.display='none';}
    o.addEventListener('click',open);document.getElementById('tfm-x').addEventListener('click',close);document.getElementById('tfm-cancel').addEventListener('click',close);
    m.addEventListener('click',function(e){if(e.target===m)close();});document.addEventListener('keydown',function(e){if(e.key==='Escape')close();});
    a.addEventListener('input',calc);c.addEventListener('change',calc);[].forEach.call(document.querySelectorAll('#tfm-f input[name=kind]'),function(r){r.addEventListener('change',calc);});})();</script>`;
  return layout({ title: 'Discount Credit', user: s.nick, nav: userNav(s), active: 'credit', fx: true, help: creditHelp, body: `
  <div class="row" style="justify-content:space-between;align-items:center;margin:22px 0 10px"><h2 style="margin:0;display:flex;align-items:center;gap:8px">${ico('bolt', 18)} Discount Credit</h2>${curSw(s, '/discount-credit')}</div>
  ${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}
  <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:stretch">
  <div class="card" style="max-width:420px;margin:0;flex:1 1 300px"><div class="small muted">Dostupný kredit</div><div style="font-size:34px;font-weight:800;letter-spacing:-.02em">${money(bal, 'DC')}</div></div>
  ${canTransfer ? `<div class="card" style="margin:0;flex:1 1 300px;max-width:420px;display:flex;flex-direction:column;justify-content:space-between;gap:10px"><div><div class="small muted">Podpora ze starého systému</div><div class="small" style="margin-top:4px">Máš nasbíranou podporu ve starém systému? Požádej o její převod na Discount Credit.</div></div><div><button type="button" class="btn" id="tfm-open">Přenést podporu ze starého systému</button></div></div>` : ''}
  </div>
  ${canTransfer ? transferModal : ''}
  ${transferList}
  ${isSeller ? `  <h3 style="margin:20px 0 8px">Prádlomaty, které mohu prodávat</h3>
  <div class="card tbl-wrap">${sellable.length ? `<table class="cards"><thead><tr><th>Prádlomat</th><th>Cena bez DPH</th><th>Discount Credit</th></tr></thead><tbody>
    ${sellable.map(p => { const vat = vatPrice(p, cur); const net = cur === 'EUR' ? p.price_eur : p.price_czk; const pct = Number(p.credit_pct || 0); return `<tr><td data-l="Prádlomat"><b>${esc(p.name_cs)}</b></td><td data-l="Cena bez DPH">${money(net, sym)}</td><td data-l="Discount Credit">${pct > 0 && p.price_czk != null ? `<b style="color:var(--ok)">+${money(Math.round(Number(p.price_czk) * pct) / 100, 'DC')}</b>` : '<span class="muted">—</span>'}</td></tr>`; }).join('')}</tbody></table>
    <p class="small muted" style="margin:10px 0 0">Credit se připíše, když člověk z tvého doporučení zakoupí prádlomat.</p>`
    : '<p class="muted" style="margin:0">Momentálně není nastavena žádná nabídka.</p>'}</div>
` : ''}
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
  ${orders.length ? `<h3 style="margin:0 0 8px">Moje objednávky</h3><div class="card tbl-wrap" style="margin-bottom:14px"><table class="cards"><thead><tr><th>Datum</th><th>Prádlomat</th><th>Cena bez DPH</th><th>Uplatněno DC</th><th>Doklady</th><th>Stav</th></tr></thead><tbody>${orders.map(o => `<tr><td data-l="Datum" class="small muted">${fmtDT(o.created_at)}</td><td data-l="Prádlomat"><b>${esc(o.product_name)}</b></td><td data-l="Cena bez DPH">${money(o.final_net, o.currency === 'EUR' ? '€' : 'Kč')}</td><td data-l="Uplatněno DC">${Number(o.dc_used) > 0 ? esc(Number(o.dc_used).toLocaleString('cs-CZ')) + ' DC' : '<span class="muted">—</span>'}</td><td data-l="Doklady">${['proforma', 'final'].map(w => { const d = o.docs && o.docs[w]; return d ? `<div style="margin:2px 0"><a href="/moje-pradlomaty/doklad/${d.id}/pdf" title="Stáhnout ${w === 'proforma' ? 'zálohovou fakturu' : 'fakturu'} ${esc(d.number)}" style="text-decoration:none">📄 ${w === 'proforma' ? 'Záloha' : 'Faktura'} ${esc(d.number)} ⬇</a>${d.seen ? '' : ' <span class="badge active" style="font-size:10px">nové</span>'}${d.unpaid ? ` <span class="paynow" title="Zálohu je potřeba zaplatit — platební údaje jsou na faktuře">ZAPLATIT ${Number(d.total).toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} ${d.currency === 'EUR' ? '€' : 'Kč'}${d.due ? ' do ' + new Date(d.due).toLocaleDateString('cs-CZ') : ''}</span>` : ''}</div>` : ''; }).join('') || '<span class="muted">—</span>'}</td><td data-l="Stav"><span class="badge ${o.status === 'confirmed' ? 'active' : o.status === 'cancelled' ? 'blocked' : 'invited'}">${o.status === 'confirmed' ? 'potvrzeno' : o.status === 'cancelled' ? 'zrušeno' : 'čeká na potvrzení'}</span></td></tr>`).join('')}</tbody></table></div>` : ''}
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
  <div class="card tbl-wrap">${(team || []).length ? `<table class="cards"><thead><tr><th>Nick</th><th>Registrace</th><th>Stav účtu</th><th>Objednávky</th></tr></thead><tbody>
    ${team.map(r => `<tr><td data-l="Nick" class="nm"><b>${esc(r.nick || '—')}</b></td>
      <td data-l="Registrace" class="small muted">${fmtDT(r.activated_at || r.created_at)}</td>
      <td data-l="Stav"><span class="badge ${esc(r.status)}">${r.status === 'active' ? 'aktivní' : r.status === 'blocked' ? 'blokován' : 'čeká na aktivaci'}</span>${r.user_type === 'owner' ? ' <span class="badge type-owner">koupil prádlomat</span>' : ''}</td>
      <td data-l="Objednávky" class="small muted">${r.user_type === 'owner' ? 'prádlomat pořízen' : 'zatím bez objednávky'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted" style="margin:0">Zatím nikdo. Pošli svůj odkaz — první registrace se tu objeví hned.</p>'}</div>` });
}
// Historie nákupů (aplikace Prověření lokality): balíčky, dokupy, přechody – jen u účtů s balíčkem
const LOC_PURCHASE_STATUS = { pending: ['čeká na platbu', 'invited'], request: ['žádost', 'invited'], paid: ['zaplaceno', 'active'], granted: ['aktivováno', 'active'], canceled: ['zrušeno', 'blocked'], refunded: ['vráceno', 'blocked'] };
function purchaseHistory(purchases) {
  if (!purchases || !purchases.length) return '';
  const kc = (n) => Number(n || 0).toLocaleString('cs-CZ') + ' Kč';
  const total = purchases.filter((p) => p.status === 'paid' || p.status === 'granted').reduce((a, p) => a + Number(p.amount_czk || 0), 0);
  return `<div class="card" style="grid-column:1/-1"><div class="row" style="justify-content:space-between;align-items:baseline;flex-wrap:wrap"><h2 style="margin:0">Historie nákupů</h2><span class="small muted">celkem zaplaceno <b>${kc(total)}</b> s DPH</span></div>
    <div class="tbl-wrap" style="margin-top:10px"><table class="cards"><thead><tr><th>Datum</th><th>Položka</th><th>Částka</th><th>Stav</th><th>Doklad</th></tr></thead><tbody>${purchases.map((p) => { const st = LOC_PURCHASE_STATUS[p.status] || [p.status, 'invited']; return `<tr><td data-l="Datum" class="small muted">${fmtDT(p.paid_at || p.created_at)}</td><td data-l="Položka"><b>${esc(p.item)}</b>${p.detail ? `<div class="small muted">${esc(p.detail)}</div>` : ''}</td><td data-l="Částka">${kc(p.amount_czk)} <span class="small muted">s DPH</span></td><td data-l="Stav"><span class="badge ${st[1]}">${esc(st[0])}</span></td><td data-l="Doklad" class="small">${p.receipt_url ? `<a href="${esc(p.receipt_url)}" target="_blank" rel="noopener">doklad ↗</a>` : '<span class="muted">e-mailem ze Stripe</span>'}</td></tr>`; }).join('')}</tbody></table></div>
    <p class="small muted" style="margin:10px 0 0">Doklad o platbě posílá Stripe automaticky na váš e-mail při každé platbě.</p></div>`;
}
function passwordPage({ s, nick, error = '', ok = '', purchases = null }) {
  const u = s || { nick };
  const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ');
  return layout({ title: 'Můj účet', user: u.nick, nav: userNav(u), active: 'acc', fx: true, body: `
  <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px"><h1 style="margin:0">Můj účet</h1><a class="btn sec sm" href="/logout" title="Odhlásit se">${ico('logout', 14)} Odhlásit se</a></div>
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
    ${u.location_package ? (() => { const pk = u.location_package, col = pk === 'premium' ? '#ffd866' : pk === 'plus' ? '#a78bfa' : '#4fd1ff', lbl = { basic: 'Základ', plus: 'Plus', premium: 'Premium' }[pk] || pk; const exp = u.location_expires_at ? new Date(u.location_expires_at) : null; const expired = exp && exp < new Date();
      return `<div class="card" style="grid-column:1/-1;border-color:${col}55"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px"><div><h2 style="margin:0 0 4px">Můj balíček</h2><div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><span style="display:inline-flex;align-items:center;gap:7px;padding:4px 11px;border-radius:999px;border:1px solid ${col}66;background:${col}14;color:${col};font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase"><span style="width:7px;height:7px;border-radius:50%;background:${col};box-shadow:0 0 8px ${col}"></span>Balíček ${lbl}</span><span class="small ${expired ? '' : 'muted'}" style="${expired ? 'color:var(--err)' : ''}">${exp ? (expired ? 'přístup vypršel ' + exp.toLocaleDateString('cs-CZ') : 'přístup do ' + exp.toLocaleDateString('cs-CZ')) : ''}</span></div></div><div class="row" style="gap:8px"><a class="btn sm" href="/lokalita/balicek">Detail balíčku a přechod na vyšší</a><a class="btn sec sm" href="/lokalita">Moje lokality</a></div></div></div>`; })() : ''}
    ${purchaseHistory(purchases)}
  </div>` });
}

// ── Admin (Tomáš, Jan přes SSO) ─────────────────────────────────────────────
const ADMIN_NAV = [
  { id: 'dash', href: '/admin', label: 'Přehled', icon: 'chart' },
  { id: 'sup', href: '/admin/supporters', label: 'Uživatelé', icon: 'users' },
  { id: 'prod', href: '/admin/products', label: 'Produkty', icon: 'box' },
  { id: 'ord', href: '/admin/orders', label: 'Objednávky', icon: 'check' },
  { id: 'loc', href: '/admin/online', label: 'Online produkty', icon: 'box' },
  { id: 'meet', href: '/admin/meetings', label: 'Schůzky', icon: 'calendar' },
  { id: 'leads', href: '/admin/leads', label: 'Leady', icon: 'users' },
  { id: 'trf', href: '/admin/transfers', label: 'Převody podpory', icon: 'bolt' },
  { id: 'stat', href: '/admin/stats', label: 'Statistiky', icon: 'chart' },
  { id: 'sug', href: '/admin/suggestions', label: 'Podněty', icon: 'bolt' },
  { id: 'ai', href: '/admin/ai-chat', label: 'AI chat', icon: 'bolt' },
  { id: 'sup2', href: '/admin/podpora', label: 'Podpora', icon: 'chat' },
  { id: 'imp', href: '/admin/import', label: 'Import', icon: 'upload', right: true },
];
function adminLayout(title, active, admin, body, holyosUrl) {
  return layout({ title, active, nav: ADMIN_NAV, user: admin.name || admin.username, holyosUrl, body,
    banner: { icon: 'users', title: 'Uživatelé', subtitle: 'Správa uživatelů Best Series 2.0, jejich přístupů a dalších agend na jednom místě' } });
}
function adminDash({ admin, stats, recent, history = [], holyosUrl }) {
  return adminLayout('Přehled', 'dash', admin, `
  <p class="muted" style="margin-top:0">Přihlášen přes HolyOS jako <b>${esc(admin.name)}</b>.</p>
  <div class="grid">
    <div class="stat"><div class="v">${stats.total}</div><div class="l">Celkem</div></div>
    <div class="stat"><div class="v" style="color:var(--ok)">${stats.active}</div><div class="l">Aktivní (mají nick + heslo)</div></div>
    <div class="stat"><div class="v" style="color:var(--blue)">${stats.invited}</div><div class="l">Čeká na první přihlášení</div></div>
    <div class="stat"><div class="v" style="color:var(--err)">${stats.blocked}</div><div class="l">Blokovaní</div></div>
    <div class="stat" title="Uživatelé, kteří se do Best Series 2.0 alespoň jednou sami přihlásili"><div class="v" style="color:#ffd866">${stats.logged != null ? stats.logged : '—'}</div><div class="l">Aktivní – celkem se aspoň 1× přihlásili (od spuštění)</div>${stats.logged30 != null ? `<div class="small muted" style="margin-top:4px">z toho za posledních 30 dní: <b style="color:var(--ok)">${stats.logged30}</b></div>` : ''}</div>
  </div>

  ${history && history.length ? (() => { const H = history, mx = Math.max(1, ...H.map((x) => x.logins)), mc = Math.max(1, ...H.map((x) => x.cumulative)); const W = 900, Hh = 170, L = 36, B = 26, T = 10, pw = W - L - 40, ph = Hh - T - B, bw = pw / H.length;
    const y = (v, m) => T + ph - v / m * ph; const d = (s) => { const [yy, m, dd] = s.split('-'); return +dd + '.' + +m + '.'; };
    const bars = H.map((x, i) => `<rect x="${(L + i * bw + bw * 0.15).toFixed(1)}" y="${y(x.logins, mx).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${(ph - (y(x.logins, mx) - T)).toFixed(1)}" rx="2" fill="#4fd1ff" opacity=".8"><title>${d(x.d)}: ${x.logins} přihlášených · ${x.new_users} nových · celkem ${x.cumulative}</title></rect>${x.new_users ? `<rect x="${(L + i * bw + bw * 0.15).toFixed(1)}" y="${y(x.new_users, mx).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${(ph - (y(x.new_users, mx) - T)).toFixed(1)}" rx="2" fill="#ffd866" opacity=".9"><title>${d(x.d)}: ${x.new_users} nových (první přihlášení)</title></rect>` : ''}`).join('');
    const line = H.map((x, i) => `${(L + i * bw + bw / 2).toFixed(1)},${y(x.cumulative, mc).toFixed(1)}`).join(' ');
    const labels = H.map((x, i) => (i % 7 === H.length % 7 ? `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${Hh - 8}" text-anchor="middle" font-size="10" fill="#8ea2c2">${d(x.d)}</text>` : '')).join('');
    const last = H[H.length - 1];
    return `<div class="card"><div class="row" style="justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px"><h2 style="margin:0">Aktivní uživatelé – historie (60 dní)</h2><span class="small muted"><span style="color:#4fd1ff">■</span> přihlášení za den · <span style="color:#ffd866">■</span> noví (první přihlášení) · <span style="color:var(--ok)">—</span> celkem aspoň 1× přihlášeni: <b style="color:var(--ok)">${last.cumulative}</b></span></div>
    <svg viewBox="0 0 ${W} ${Hh}" style="width:100%;height:auto;display:block;margin-top:8px" xmlns="http://www.w3.org/2000/svg"><text x="${L - 6}" y="${T + 10}" text-anchor="end" font-size="10" fill="#8ea2c2">${mx}</text><text x="${L - 6}" y="${T + ph}" text-anchor="end" font-size="10" fill="#8ea2c2">0</text><text x="${W - 4}" y="${T + 10}" text-anchor="end" font-size="10" fill="#2fe3a0">${mc}</text>${bars}<polyline points="${line}" fill="none" stroke="#2fe3a0" stroke-width="2" stroke-linejoin="round"/>${labels}</svg>
    <div class="small muted" style="margin-top:6px">Počítá se z událostí přihlášení (od spuštění Best Series 2.0 24. 9. 2026). Najetím na sloupec zobrazíte čísla dne.</div></div>`; })() : ''}
  <div class="card"><h2 style="margin-top:0">Poslední přihlášení</h2>
  ${recent.length ? recent.map(r => `<div class="list-item"><span><b>${esc(r.nick || '—')}</b> <span class="muted">${esc(r.email)}</span></span><span class="muted small">${fmtDT(r.last_login_at)}</span></div>`).join('') : '<p class="muted">Zatím se nikdo nepřihlásil.</p>'}</div>
  <p class="muted small">Přihlašovací stránka pro uživatele: <code>${esc(process.env.BS2_PUBLIC_URL || 'https://www.bestseries2.cz')}/login</code> — první přihlášení přes <code>/activate</code> (e-mail musí být v seznamu).</p>`, holyosUrl);
}
// Sloupce seznamu: základní (pevně Jméno) + volitelné základní + libovolné údaje z importu. Výběr je v cookie bs2_cols.
const BASE_COLS = [
  { key: 'email', label: 'E-mail', render: (r) => `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` },
  { key: 'nick', label: 'Nick', render: (r) => r.nick ? esc(r.nick) : '<span class="muted">—</span>' },
  { key: 'support_czk', label: 'Celkem podpořil (Kč)', render: (r) => r.support_czk != null && r.support_czk !== '' ? `<span style="white-space:nowrap" title="${r.support_currency === 'EUR' ? 'Eurový účet — přepočteno kurzem ČNB' : 'Celkem od počátku ze starého portálu'}"><b>${Number(r.support_czk).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })}</b>${r.support_currency === 'EUR' ? ' <span class="muted small">€→Kč</span>' : ''}</span>` : '<span class="muted small">—</span>' },
  { key: 'status', label: 'Stav', render: (r) => `<span class="badge ${esc(r.status)}">${r.status === 'active' ? 'aktivní' : r.status === 'blocked' ? 'blokován' : 'čeká na aktivaci'}</span>` },
  { key: 'user_type', label: 'Typ uživatele', render: (r) => typeBadge(r.user_type) },
  { key: 'last_login_at', label: 'Poslední přihlášení', render: (r) => `<span class="muted small">${fmtDT(r.last_login_at)}</span>` },
  { key: 'activated_at', label: 'Aktivován', render: (r) => `<span class="muted small">${fmtDT(r.activated_at)}</span>` },
  { key: 'created_at', label: 'Vytvořen v BS2', render: (r) => `<span class="muted small">${fmtDT(r.created_at)}</span>` },
  { key: 'source', label: 'Zdroj importu', render: (r) => `<span class="muted small">${esc(r.source || '—')}</span>` },
  { key: 'support_snapshot', label: 'Screenshot podpory', render: (r) => r.support_snapshot_at ? `<a href="/admin/supporters/${r.id}/support-snapshot.png" target="_blank" rel="noopener" class="small" data-lightbox="1">${fmtDT(r.support_snapshot_at)}</a>` : '<span class="muted small">—</span>' },
];
const DEFAULT_COLS = ['email', 'nick', 'support_czk', 'user_type', 'status', 'last_login_at', 'x:obrat', 'support_snapshot'];
// Přihlášení za uživatele ve starém systému (partner.bestseries.cz).
// Bez `to`: přímý odkaz na fake-login.php (přistane na výchozím dashboardu) — funguje spolehlivě,
// protože je to normální top-level navigace a cookie session se nastaví jako first-party.
// S `to`: fake-login.php samo žádný parametr pro cílovou stránku nepřijímá, a mezistránka přes
// fetch(no-cors) cookii nenastavila spolehlivě (SameSite u cross-site požadavku) — proto se
// „Stránka podpory" řeší na klientovi (viz .legacy-btn skript níže): otevře se nové okno rovnou
// na fake-login.php (top-level = cookie se nastaví správně) a po krátké pauze se TOTÉŽ okno
// přesměruje na cílovou stránku.
function fakeLogin(email) {
  return `https://partner.bestseries.cz/php-action/fake-login.php?email=${encodeURIComponent(email)}`;
}
// Typ uživatele: standard = stávající, owner = koupil prádlomat, seller = může prodávat
const USER_TYPE_LABEL = { new: 'Nový', standard: 'Stávající', owner: 'Koupil prádlomat', seller: 'Může prodávat', location: 'Prověření lokality' };
const typeBadge = (t) => { const k = USER_TYPE_LABEL[t] ? t : 'standard'; return `<span class="badge type-${k}">${USER_TYPE_LABEL[k]}</span>`; };
const typeSelect = (cur, name = 'user_type') => `<select name="${name}" style="width:auto">${Object.keys(USER_TYPE_LABEL).map(k => `<option value="${k}"${(cur || 'standard') === k ? ' selected' : ''}>${USER_TYPE_LABEL[k]}</option>`).join('')}</select>`;
const EXTRA_PRIO = ['active', 'pozice', 'level', 'obrat', 'profit', 'podil', 'visit', 'date', 'country', 'currency', 'lang', 'vip', 'founder_terms_accepted_at', 'id'];
// Náhled uloženého screenshotu podpory u tlačítka — klik otevře zvětšení v okně (lightbox)
const snapThumb = (r) => r.support_snapshot_at ? `<button type="button" class="snap-view" data-src="/admin/supporters/${r.id}/support-snapshot.png?t=${new Date(r.support_snapshot_at).getTime()}" title="Screenshot z ${fmtDT(r.support_snapshot_at)} — klikni pro zvětšení"><img src="/admin/supporters/${r.id}/support-snapshot.png?t=${new Date(r.support_snapshot_at).getTime()}" alt="screenshot" loading="lazy"></button>` : '';
function adminSupporters({ admin, rows, qstr = '', status = '', utype = '', total, msg = '', holyosUrl, cols = DEFAULT_COLS, extraKeys = [], supportStats = null }) {
  const baseSel = BASE_COLS.filter(c => cols.includes(c.key));
  const extraSel = cols.filter(k => k.startsWith('x:')).map(k => k.slice(2)).filter(k => extraKeys.includes(k));
  const sortedExtra = extraKeys.slice().sort((a, b) => { const ia = EXTRA_PRIO.indexOf(a), ib = EXTRA_PRIO.indexOf(b); return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b); });
  const head = '<th>Jméno</th>' + baseSel.map(c => `<th>${esc(c.label)}</th>`).join('') + extraSel.map(k => `<th title="údaj z importu">${esc(k)}</th>`).join('') + '<th></th>';
  const rowsHtml = rows.map(r => `<tr>
    <td data-l="Jméno" class="nm"><b title="${esc([r.last_name, r.first_name].filter(Boolean).join(' '))}">${esc([r.last_name, r.first_name].filter(Boolean).join(' ') || '—')}</b></td>
    ${baseSel.map(c => `<td data-l="${esc(c.label)}">${c.render(r)}</td>`).join('')}
    ${extraSel.map(k => { const v = r.extra ? r.extra[k] : null; return `<td data-l="${esc(k)}" class="small" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(v == null ? '' : v)}">${v == null || v === '' ? '<span class="muted">—</span>' : esc(v)}</td>`; }).join('')}
    <td class="actions"><div class="row"><a class="btn sec sm" href="/admin/supporters/${r.id}">Detail</a><a class="btn sec sm" href="${fakeLogin(r.email)}" target="_blank" rel="noopener" title="Přihlásit se jako tento uživatel ve starém systému (partner.bestseries.cz)">Starý účet</a><button type="button" class="btn sec sm legacy-btn" data-email="${esc(r.email)}" data-to="/cs/bo/my-invests/" title="Přihlásit se jako tento uživatel a otevřít rovnou Přehled podpory">Stránka podpory</button><button type="button" class="btn sec sm snap-btn" data-id="${r.id}" title="Přihlásit se jako tento uživatel, počkat na načtení Přehledu podpory a uložit screenshot k uživateli">📸 Screenshot</button>${snapThumb(r)}</div></td></tr>`).join('');
  const colCount = 2 + baseSel.length + extraSel.length;
  const picker = `
  <details class="colpick" id="colpick"><summary class="btn sec" title="Vybrat sloupce tabulky" style="padding:10px 12px">${ico('settings', 18)}</summary>
    <form method="post" action="/admin/supporters/columns" class="colpick-pop">
      <input type="hidden" name="cols" value="_seen_czk">
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
    .snap-view{padding:0;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:zoom-in;width:44px;height:32px;overflow:hidden;flex:none;align-self:center}
    .snap-view img{width:100%;height:100%;object-fit:cover;object-position:top left;display:block}
    #snap-lb{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.8);display:none;align-items:center;justify-content:center;padding:20px}
    .snap-lb-box{max-width:min(1300px,96vw);max-height:94vh;display:flex;flex-direction:column;gap:8px}
    .snap-lb-bar{display:flex;justify-content:flex-end;gap:8px} #snap-lb-img{max-width:100%;max-height:calc(94vh - 50px);object-fit:contain;border-radius:8px;background:#fff;overflow:auto}
    .colpick{position:relative} .colpick summary{list-style:none;cursor:pointer;display:inline-flex} .colpick summary::-webkit-details-marker{display:none}
    .colpick-pop{position:absolute;right:0;top:calc(100% + 6px);z-index:20;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;width:min(560px,calc(100vw - 32px));box-shadow:0 12px 40px rgba(0,0,0,.5)}
    .colpick-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px} @media (max-width:600px){.colpick-grid{grid-template-columns:1fr}}
    .colpick-h{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--text2);margin-bottom:6px}
    .colpick-i{display:flex;align-items:center;gap:8px;font-size:14px;margin:0;padding:5px 0;color:var(--text);cursor:pointer} .colpick-i input{width:auto;margin:0}
    .colpick-scroll{max-height:40vh;overflow:auto;padding-right:4px}
    #sup-top{position:sticky;top:var(--hh,52px);z-index:6;background:var(--bg);padding-top:14px;margin-top:-14px}
  </style>
  <div id="sup-top">
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
      <h1 style="margin:0">Uživatelé <span class="muted" style="font-size:14px;font-weight:500">${total}</span></h1>
      <button type="button" class="btn sec sm" id="ps-sync-all" title="U všech uživatelů s nenulovým obratem načte podporu ze starého portálu (palety, expanze, NeuraWash, opakovačky, celkem) do detailu">🔄 Načíst podporu (obrat ≠ 0)</button><a class="btn sec sm" href="/admin/partner-support" title="Načtená podpora všech uživatelů — ruční kontrola, průběh načítání, eurové účty">📋 Kontrola podpory</a><a class="btn sec sm" href="/admin/partner-support/export.xlsx" title="Všichni uživatelé s nenulovou podporou do Excelu">⬇ Excel</a><button type="button" class="btn sec sm" id="snap-all" title="U všech s nenulovým obratem pořídí screenshot Přehledu podpory ze starého portálu (na pozadí; přeskočí screenshoty mladší 24 h)">📸 Screenshot všech</button><button type="button" class="btn sec sm" id="snap-verify" title="U všech s nenulovým obratem (zatím nezkontrolovaných) projde Přehled podpory, přečte z něj „Celkem jste podpořili", pořídí screenshot a podle něj opraví hodnotu v poli">📊 Data ze screenu (obrat ≠ 0)</button><span id="snap-all-st" class="small muted"></span>
      <script>
        (function(){ var b=document.getElementById('snap-all'), st=document.getElementById('snap-all-st'); if(!b) return;
          function dur(s){ s=Math.max(0,Math.round(s)); var h=Math.floor(s/3600), m=Math.floor(s%3600/60); return h? h+' h '+m+' min' : m+' min'; }
          function show(j){ if(!j.total){ st.textContent = j.started_at ? ' 📸 nic k pořízení' : ''; return; }
            var el=((j.finished_at?new Date(j.finished_at):new Date())-new Date(j.started_at))/1000, per=j.done?el/j.done:0;
            st.textContent=' 📸 '+(j.running?'běží ':'hotovo ')+j.done+'/'+j.total+' ('+Math.round(100*j.done/j.total)+' %) · OK '+j.ok+(j.failed?' · chyby '+j.failed:'')+(j.matched?' · sedí '+j.matched:'')+(j.corrected?' · opraveno '+j.corrected:'')+(j.placeholder?' · jen rok (neopraveno) '+j.placeholder:'')+(j.running&&per?' · zbývá cca '+dur(per*(j.total-j.done)):'');
            st.title=(j.errors||[]).join(' | '); b.disabled=!!j.running; }
          function poll(){ fetch('/admin/support-snapshots/sync-all').then(function(r){return r.json()}).then(function(j){ show(j); if(j.running) setTimeout(poll,4000); }).catch(function(){}); }
          b.onclick=function(){ if(!confirm('Pořídit screenshot Přehledu podpory u všech uživatelů s nenulovým obratem? Běží na pozadí (cca 1 h), přeskočí screenshoty mladší 24 h.')) return;
            fetch('/admin/support-snapshots/sync-all',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(function(r){return r.json()}).then(function(j){ show(j); poll(); }); };
          var bv=document.getElementById('snap-verify'); if(bv) bv.onclick=function(){ if(!confirm('Projít Přehled podpory u všech uživatelů s nenulovým obratem, přečíst „Celkem jste podpořili" ze stránky a podle toho opravit hodnotu v poli? Běží na pozadí, může to trvat i hodinu.')) return;
            fetch('/admin/support-snapshots/sync-all',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'verify'})}).then(function(r){return r.json()}).then(function(j){ show(j); poll(); }); };
          poll(); })();
      </script><span id="ps-sync-st" class="small muted"></span>
      <script>
        (function(){ var b=document.getElementById('ps-sync-all'), st=document.getElementById('ps-sync-st'); if(!b) return;
          function show(j){ st.textContent = j.total ? (j.running ? ' běží ' : ' hotovo ') + j.done + '/' + j.total + ' (' + Math.round(100*j.done/j.total) + ' %) · OK ' + j.ok + (j.failed ? ' · chyby ' + j.failed : '') : ''; if (j.errors && j.errors.length) st.title = j.errors.join(' | '); }
          function poll(){ fetch('/admin/partner-support/sync-all').then(function(r){return r.json()}).then(function(j){ show(j); if (j.running) setTimeout(poll, 2000); }); }
          b.onclick=function(){ if(!confirm('Načíst podporu ze starého portálu u všech uživatelů s nenulovým obratem? Běží na pozadí, může to trvat několik minut.')) return; fetch('/admin/partner-support/sync-all',{method:'POST'}).then(function(r){return r.json()}).then(function(j){ show(j); poll(); }); };
          poll(); })();
      </script>
      <div class="row"><a class="btn" href="/admin/import">${ico('upload', 17)} Import CSV / Excel</a><a class="btn sec" href="/admin/supporters/new">+ Přidat ručně</a>${picker}</div>
    </div>
    ${supportStats ? (() => { const st = supportStats, n0 = (v) => Math.round(Number(v) || 0).toLocaleString('cs-CZ'); const box = (lbl, val, sub, hl) => `<div class="card" style="flex:1;min-width:170px;padding:10px 14px;margin:0${hl ? ';border-color:var(--primary,#3b82f6)' : ''}"><div class="small muted">${lbl}</div><div style="font-size:20px;font-weight:800;white-space:nowrap">${val}</div><div class="small muted">${sub}</div></div>`;
      return `<div class="row" style="gap:10px;margin:10px 0 4px;flex-wrap:wrap">
        ${box('Podpořili v Kč', n0(st.czk_sum) + ' Kč', n0(st.czk_n) + ' korunových účtů')}
        ${box('Podpořili v eurech', n0(st.eur_sum) + ' €', n0(st.eur_n) + ' eurových účtů · ≈ ' + n0(st.eur_czk) + ' Kč')}
        ${box('Celkem v Kč', n0(st.total_czk) + ' Kč', 'eura přepočtena kurzem ČNB' + (st.rate_date ? ' (' + esc(st.rate_date) + ')' : '') + (st.partial ? ' · část eur bez kurzu' : ''), true)}
      </div>`; })() : ''}
    ${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}
    <form method="get" class="row" style="margin:10px 0 14px">
      <input name="q" value="${esc(qstr)}" placeholder="Hledat jméno / e-mail / nick…" style="flex:1;min-width:200px">
      <select name="status" style="width:auto"><option value="">Všechny stavy</option><option value="invited"${status === 'invited' ? ' selected' : ''}>Čeká na aktivaci</option><option value="active"${status === 'active' ? ' selected' : ''}>Aktivní</option><option value="blocked"${status === 'blocked' ? ' selected' : ''}>Blokovaní</option></select>
      <select name="type" style="width:auto"><option value="">Všechny typy</option>${Object.keys(USER_TYPE_LABEL).map(k => `<option value="${k}"${utype === k ? ' selected' : ''}>${USER_TYPE_LABEL[k]}</option>`).join('')}</select>
      <button class="btn sec" type="submit">Vyhledat</button>
    </form>
  </div>
  <div class="card tbl-wrap"><table class="cards"><thead><tr>${head}</tr></thead><tbody>${rowsHtml || `<tr><td colspan="${colCount}" class="muted">Nic nenalezeno.</td></tr>`}</tbody></table></div>
  <script>document.addEventListener('click',function(e){var d=document.getElementById('colpick');if(d&&d.open&&!d.contains(e.target))d.removeAttribute('open');});</script>
  <script>
  // „Stránka podpory": otevři nové okno rovnou na fake-login.php (top-level navigace = cookie session
  // se nastaví správně, žádné SameSite/third-party omezení), pak po krátké pauze přesměruj to samé okno
  // na cílovou stránku ve starém systému.
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.legacy-btn');
    if (!b) return;
    var email = b.dataset.email, to = b.dataset.to || '/cs/bo/dashboard/';
    var loginUrl = 'https://partner.bestseries.cz/php-action/fake-login.php?email=' + encodeURIComponent(email);
    var targetUrl = 'https://partner.bestseries.cz' + to;
    var w = window.open(loginUrl, '_blank');
    if (!w) return; // blokovač vyskakovacích oken — uživatel dostane aspoň info v title tlačítka
    setTimeout(function () { try { w.location = targetUrl; } catch (err) { /* okno mezitím zavřené */ } }, 1800);
  });
  // 📸 Screenshot: server se přihlásí jako uživatel headless Chromiem, počká na načtení stránky
  // a vyfotí ji — pak se v řádku objeví odkaz s časem pořízení.
  // Lightbox pro screenshot podpory (klik mimo / Esc / ✕ zavře)
  window.openSnap = function (src) {
    var o = document.getElementById('snap-lb');
    if (!o) {
      o = document.createElement('div'); o.id = 'snap-lb';
      o.innerHTML = '<div class="snap-lb-box"><div class="snap-lb-bar"><a class="btn sec sm" target="_blank" rel="noopener" id="snap-lb-open">Otevřít v nové záložce</a><button type="button" class="btn sec sm" id="snap-lb-x">✕</button></div><img id="snap-lb-img" alt="screenshot podpory"></div>';
      document.body.appendChild(o);
      o.addEventListener('click', function (ev) { if (ev.target === o || ev.target.id === 'snap-lb-x') o.style.display = 'none'; });
      document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') o.style.display = 'none'; });
    }
    document.getElementById('snap-lb-img').src = src; document.getElementById('snap-lb-open').href = src; o.style.display = 'flex';
  };
  document.addEventListener('click', function (e) {
    var v = e.target.closest('.snap-view'); if (v) { e.preventDefault(); openSnap(v.dataset.src); return; }
    var l = e.target.closest('a[data-lightbox]'); if (l) { e.preventDefault(); openSnap(l.getAttribute('href') + '?t=' + Date.now()); }
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.snap-btn');
    if (!b) return;
    var id = b.dataset.id, orig = b.textContent;
    b.disabled = true; b.textContent = 'Pořizuji…';
    fetch('/admin/supporters/' + id + '/support-snapshot', { method: 'POST' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok) { alert(x.j.error || 'Nepodařilo se pořídit screenshot.'); return; }
        var cell = b.closest('tr').querySelector('[data-l="Screenshot podpory"]');
        if (cell) cell.innerHTML = '<a href="/admin/supporters/' + id + '/support-snapshot.png" target="_blank" rel="noopener" class="small">' + new Date(x.j.at).toLocaleString('cs-CZ') + '</a>';
        var src = '/admin/supporters/' + id + '/support-snapshot.png?t=' + Date.now();
        var th = b.parentNode.querySelector('.snap-view');
        if (!th) { th = document.createElement('button'); th.type = 'button'; th.className = 'snap-view'; th.innerHTML = '<img alt="screenshot">'; b.parentNode.appendChild(th); }
        th.dataset.src = src; th.querySelector('img').src = src; th.title = 'Screenshot z ' + new Date(x.j.at).toLocaleString('cs-CZ') + ' — klikni pro zvětšení';
        if (cell) { var a = cell.querySelector('a'); if (a) a.dataset.lightbox = '1'; }
        openSnap(src);
        var rs = x.j.result || {};
        if (rs.status === 'corrected') setTimeout(function () { alert('Hodnota „Celkem podpořil" opravena podle screenshotu: ' + (rs.before == null ? '—' : Number(rs.before).toLocaleString('cs-CZ')) + ' → ' + Number(rs.after).toLocaleString('cs-CZ') + ' ' + (rs.currency || 'CZK')); }, 300);
        else if (rs.status === 'matched') setTimeout(function () { alert('Hodnota ve screenshotu sedí s uloženou (' + Number(rs.after).toLocaleString('cs-CZ') + ').'); }, 300);
        else if (rs.status === 'unread') setTimeout(function () { alert('Ze stránky se nepodařilo přečíst „Celkem jste podpořili" — hodnotu zkontroluj ručně podle screenshotu.'); }, 300);
      })
      .catch(function (err) { alert('Chyba spojení: ' + err.message); })
      .finally(function () { b.disabled = false; b.textContent = orig; });
  });
  </script>`, holyosUrl);
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
function adminAiChat({ admin, cfg, models, tones, limits, msg = '', errors = [], holyosUrl, keyOk = false, preview = '' }) {
  const o = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
  const saveBtn = '<div style="text-align:right;margin-top:10px"><button class="btn" type="submit" form="aif">Uložit</button></div>';
  const lbl = (t, hint) => `<label class="small" style="display:block;margin:12px 0 5px;font-weight:600">${t}${hint ? ` <span class="muted" style="font-weight:400">— ${hint}</span>` : ''}</label>`;
  // pole s kontrolou limitu: data-max → živé počítadlo (červené při překročení), kontrola i při uložení
  const ta = (name, val, max, rows) => `<textarea name="${name}" form="aif" rows="${rows}" data-max="${max}" data-label="${esc(name)}">${esc(val)}</textarea>`;
  const data = JSON.stringify({ items: cfg.knowledge_items || [], examples: cfg.examples || [], limits }).replace(/</g, '\\u003c');
  const L = limits; const fmtN = (n) => Number(n).toLocaleString('cs-CZ');
  return adminLayout('AI chat', 'ai', admin, `
  <h1 style="margin:0 0 6px">AI chat</h1>
  <p class="muted" style="margin-top:0">Kompletní nastavení AI asistenta, který bude na stránkách odpovídat uživatelům. Čím přesnější instrukce, znalosti a příklady, tím přesnější odpovědi. Změny se projeví hned po uložení.</p>
  ${msg ? `<div class="card" style="border-color:rgba(60,220,160,.4)">${esc(msg)}</div>` : ''}
  <div id="errbox" class="card" style="border-color:rgba(255,110,110,.55);${errors.length ? '' : 'display:none'}"><b style="color:var(--err)">Nelze uložit — oprav prosím:</b><ul id="errlist" style="margin:8px 0 0 18px;padding:0">${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>
  <form id="aif" method="post" action="/admin/ai-chat"></form>
  <input type="hidden" name="knowledge_json" form="aif" id="kj"><input type="hidden" name="examples_json" form="aif" id="ej">
  <script type="application/json" id="ai-data">${data}</script>

  <div class="card"><h2 style="margin-top:0">Základ</h2>
    <label style="display:flex;gap:10px;align-items:center;cursor:pointer"><input type="checkbox" name="enabled" value="1" form="aif" style="width:auto"${cfg.enabled ? ' checked' : ''}> <b>Chat je zapnutý na stránkách</b> <span class="muted small">(vypnutý se uživatelům nezobrazí)</span></label>
    ${lbl('Jméno asistenta')}<input name="name" form="aif" value="${esc(cfg.name)}" data-max="${L.name}" data-label="name">
    ${lbl('Úvodní zpráva', 'první věta, kterou uživatel uvidí')}${ta('greeting', cfg.greeting, L.greeting, 2)}
    <div class="grid" style="margin-top:4px"><div>${lbl('Styl odpovědí')}<select name="tone" form="aif">${Object.keys(tones).map(k => o(k, cfg.tone, { friendly: 'Přátelský a věcný', expert: 'Odborný a přesný', concise: 'Maximálně stručný', formal: 'Formální (vykání)' }[k])).join('')}</select></div>
    <div>${lbl('Jazyk')}<label style="display:flex;gap:8px;align-items:center;margin-top:10px;cursor:pointer"><input type="checkbox" name="reply_in_user_language" value="1" form="aif" style="width:auto"${cfg.reply_in_user_language ? ' checked' : ''}> Odpovídat v jazyce dotazu</label></div></div>
    ${saveBtn}</div>

  <div class="card"><h2 style="margin-top:0">Instrukce</h2>
    ${lbl('Role a úkol asistenta', 'kdo je, komu pomáhá, co má dělat')}${ta('instructions', cfg.instructions, L.instructions, 6)}
    ${lbl('Pravidla a zákazy', 'co nesmí říkat nebo slibovat — závazné')}${ta('rules', cfg.rules, L.rules, 5)}
    ${saveBtn}</div>

  <div class="card"><h2 style="margin-top:0">Znalosti <span class="muted small" style="font-weight:400">— po tématech, počet témat není omezen</span></h2>
    <p class="muted small" style="margin-top:0">Jediný zdroj faktů pro asistenta. Rozděl je na krátká témata (Discount Credit, provize, Moje svoboda, nákup prádlomatu…). Vypnuté téma se do AI neposílá, ale zůstane uložené. Co tu není, to asistent neřekne.</p>
    <details class="small" style="margin:0 0 12px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:rgba(79,209,255,.05)"><summary style="cursor:pointer;font-weight:700">Jak znalosti napsat a jak velké smí být</summary>
      <div style="margin-top:8px;line-height:1.55">
        <b>Formát:</b> čistý text (soubory PDF / Word / Excel se nenahrávají — zkopíruj z nich text).<br>
        <b>Jak psát:</b> jedno téma = jedna věc, s výstižným názvem · krátké věty s konkrétními čísly a podmínkami („1 DC = 1 Kč slevy") · výčty po řádcích s pomlčkou nebo dvojice „Otázka: … / Odpověď: …" · tabulky z Excelu přepiš na řádky („Prádlomat V3: 52 000 €, kamion 47 000 €") · žádné obrázky ani dlouhé souvislé odstavce.<br>
        <b>Velikost:</b> jedno téma max. ${fmtN(L.item_text)} znaků, témat max. ${fmtN(L.items_max)}. Rozhoduje <b>celkový objem</b> (ukazatel dole; 3 znaky ≈ 1 token): doporučeno do ${fmtN(L.tokens_warn)} tokenů (≈ ${fmtN(L.tokens_warn * 3)} znaků, asi 60 normostran) — chat je rychlý a levný; nad tím zpomaluje, zdražuje a klesá přesnost; maximum ${fmtN(L.tokens_hard)} tokenů, výš se nedá uložit.<br>
        <b>Tip:</b> raději více krátkých a přesných témat než jeden dlouhý text. Co aktuálně nepotřebuješ, vypni zaškrtávátkem „zapnuto".
      </div></details>
    <div id="kn-list"></div>
    <button class="btn sec" type="button" id="kn-add">＋ Přidat téma</button>
    <label style="display:flex;gap:10px;align-items:center;margin-top:14px;cursor:pointer"><input type="checkbox" name="include_products" value="1" form="aif" style="width:auto"${cfg.include_products ? ' checked' : ''}> Automaticky vložit aktuální nabídku prádlomatů a ceny (z Produktů)</label>
    ${saveBtn}</div>

  <div class="card"><h2 style="margin-top:0">Příklady správných odpovědí</h2>
    <p class="muted small" style="margin-top:0">Nejúčinnější způsob, jak asistenta „naučit" přesnou formulaci: zadej otázku a odpověď, jakou si přeješ. U podobných dotazů se jí bude držet.</p>
    <details class="small" style="margin:0 0 12px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:rgba(79,209,255,.05)"><summary style="cursor:pointer;font-weight:700">Jak příklady psát a jak velké smí být</summary>
      <div style="margin-top:8px;line-height:1.55">Otázka max. ${fmtN(L.example_q)} znaků, odpověď max. ${fmtN(L.example_a)} znaků, příkladů max. ${fmtN(L.examples_max)}. Odpověď piš tak, jak ji chceš slyšet — stručně, ideálně do 500 znaků, s konkrétními čísly. Přidej příklady pro nejčastější dotazy a pro situace, kdy má asistent něco odmítnout nebo odkázat na kontakt.</div></details>
    <div id="ex-list"></div>
    <button class="btn sec" type="button" id="ex-add">＋ Přidat příklad</button>
    ${saveBtn}</div>

  <div class="card"><h2 style="margin-top:0">Když asistent neví</h2>
    ${lbl('Co řekne', 'použije se při nezodpovězené otázce místo odhadu')}${ta('unknown_reply', cfg.unknown_reply, L.unknown_reply, 2)}
    ${lbl('Kontakt', 'e-mail / telefon, na který uživatele odkáže')}${ta('contact', cfg.contact, L.contact, 2)}
    ${saveBtn}</div>

  <div class="card"><h2 style="margin-top:0">Model a přesnost</h2>
    <div class="grid"><div>${lbl('Model')}<select name="model" form="aif">${models.map(m => o(m[0], cfg.model, m[1])).join('')}</select></div>
    <div>${lbl('Teplota', '0 = nejpřesnější, 1 = nejkreativnější')}<input name="temperature" form="aif" type="number" step="0.1" min="${L.temperature[0]}" max="${L.temperature[1]}" value="${esc(cfg.temperature)}"></div>
    <div>${lbl('Max. délka odpovědi', 'tokeny, ' + L.max_tokens[0] + '–' + L.max_tokens[1])}<input name="max_tokens" form="aif" type="number" step="50" min="${L.max_tokens[0]}" max="${L.max_tokens[1]}" value="${esc(cfg.max_tokens)}"></div></div>
    <p class="muted small">Pro co nejpřesnější odpovědi doporučuji teplotu 0–0,3 a model Sonnet. Haiku je rychlejší a levnější.</p>
    <details class="small" style="margin:0 0 8px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:rgba(79,209,255,.05)"><summary style="cursor:pointer;font-weight:700">Jak dlouhé budou odpovědi asistenta</summary>
      <div style="margin-top:8px;line-height:1.55">Délku určuje <b>Max. délka odpovědi</b> (${L.max_tokens[0]}–${L.max_tokens[1]} tokenů; výchozí 600 ≈ 1 800 znaků). Odpovědi jsou navíc vždy krátké, bez markdownu a emoji. Kratší a rychlejší: kolem 300 a styl „Maximálně stručný". Delší (např. podrobný postup): 1 000–1 500 a styl „Odborný a přesný".</div></details>
    ${saveBtn}</div>

  <div id="budget" class="card" style="position:sticky;bottom:10px;z-index:4;padding:12px 16px">
    <div class="row" style="justify-content:space-between;gap:10px"><b>Celkový objem instrukcí</b><span id="b-txt" class="small"></span></div>
    <div style="height:8px;border-radius:6px;background:rgba(255,255,255,.08);margin-top:8px;overflow:hidden"><div id="b-bar" style="height:100%;width:0;background:var(--ok);transition:width .2s"></div></div>
    <div id="b-hint" class="muted small" style="margin-top:6px"></div>
  </div>

  <div class="card"><h2 style="margin-top:0">Vyzkoušet chat <span class="badge ${keyOk ? 'active' : 'blocked'}" style="margin-left:6px;font-size:11px">${keyOk ? 'ANTHROPIC_API_KEY nastaven' : 'chybí ANTHROPIC_API_KEY'}</span></h2>
    <p class="muted small" style="margin-top:0">Test používá <b>uložené</b> nastavení — nejdřív ulož, pak zkoušej.</p>
    <div id="aichat-log" style="min-height:120px;max-height:380px;overflow:auto;border:1px solid var(--border);border-radius:12px;padding:12px;background:rgba(4,8,16,.5)"><div class="muted small">Napiš dotaz a pošli…</div></div>
    <div class="row" style="gap:8px;margin-top:10px"><input id="aichat-in" placeholder="Zeptej se asistenta…" style="flex:1"><button class="btn" type="button" id="aichat-send">Poslat</button><button class="btn sec" type="button" id="aichat-reset">Nový rozhovor</button></div>
  </div>

  <details class="card"><summary style="cursor:pointer;font-weight:700">Zobrazit celé systémové instrukce (co AI skutečně dostane)</summary>
    <pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;margin:12px 0 0;max-height:420px;overflow:auto">${esc(preview)}</pre></details>

  <script>
  (function(){
    var D=JSON.parse(document.getElementById('ai-data').textContent), LM=D.limits, form=document.getElementById('aif');
    var items=D.items.slice(), exs=D.examples.slice();
    var fmt=function(n){ return Number(n).toLocaleString('cs-CZ'); };
    function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
    function counter(el,max){ var c=el.nextElementSibling; if(!c||!c.classList.contains('cc')){ c=document.createElement('div'); c.className='cc muted small'; c.style.cssText='text-align:right;margin-top:3px'; el.parentNode.insertBefore(c,el.nextSibling); }
      var n=el.value.length, over=n>max; c.textContent=fmt(n)+' / '+fmt(max)+' znaků'+(over?' — přebývá '+fmt(n-max):''); c.style.color=over?'var(--err)':''; el.style.borderColor=over?'var(--err)':''; return over; }
    function totalChars(){
      var v=function(n){ var e=document.querySelector('[name="'+n+'"]'); return e?e.value.length:0; };
      var n=v('instructions')+v('rules')+v('unknown_reply')+v('contact');
      items.forEach(function(x){ if(x.enabled!==false) n+=(x.title||'').length+(x.text||'').length+6; });
      exs.forEach(function(x){ n+=(x.q||'').length+(x.a||'').length+20; });
      return n; }
    function budget(){
      var tok=Math.ceil(totalChars()/3), pct=Math.min(100,tok/LM.tokens_hard*100), bar=document.getElementById('b-bar');
      bar.style.width=pct+'%'; bar.style.background=tok>LM.tokens_hard?'var(--err)':tok>LM.tokens_warn?'#f5a524':'var(--ok)';
      document.getElementById('b-txt').textContent='≈ '+fmt(tok)+' tokenů z '+fmt(LM.tokens_hard)+' (max)';
      document.getElementById('b-hint').textContent=tok>LM.tokens_hard?'Přes maximum — nelze uložit. Zkrať znalosti nebo vypni některá témata.':tok>LM.tokens_warn?'Nad doporučenou hranicí '+fmt(LM.tokens_warn)+' tokenů: chat bude pomalejší a dražší. Zvaž zkrácení.':'V pořádku. Doporučená hranice pro rychlý chat je '+fmt(LM.tokens_warn)+' tokenů.'; }
    function bindFields(root){ root.querySelectorAll('[data-max]').forEach(function(el){ var mx=+el.dataset.max; counter(el,mx); if(!el.__b){ el.__b=1; el.addEventListener('input',function(){ counter(el,mx); budget(); }); } }); }
    function renderItems(){
      var box=document.getElementById('kn-list');
      box.innerHTML=items.map(function(x,i){ return '<div class="card" style="padding:12px;margin-bottom:10px;background:rgba(255,255,255,.03)">'+
        '<div class="row" style="gap:8px;align-items:center"><label style="display:flex;gap:6px;align-items:center;cursor:pointer;white-space:nowrap" title="Vypnuté téma se do AI neposílá"><input type="checkbox" data-k="en" data-i="'+i+'" style="width:auto"'+(x.enabled!==false?' checked':'')+'> zapnuto</label>'+
        '<input data-k="title" data-i="'+i+'" data-max="'+LM.item_title+'" placeholder="Název tématu (např. Discount Credit)" value="'+esc(x.title)+'" style="flex:1"><button class="btn sec" type="button" data-rm="'+i+'" title="Odebrat téma">✕</button></div>'+
        '<textarea data-k="text" data-i="'+i+'" data-max="'+LM.item_text+'" rows="6" placeholder="Text tématu — fakta, pravidla, postupy…" style="margin-top:8px">'+esc(x.text)+'</textarea></div>'; }).join('')||'<p class="muted small">Zatím žádné téma. Přidej první.</p>';
      box.querySelectorAll('[data-k]').forEach(function(el){ el.addEventListener('input',function(){ var it=items[+el.dataset.i]; if(el.dataset.k==='title') it.title=el.value; else if(el.dataset.k==='text') it.text=el.value; budget(); }); if(el.dataset.k==='en') el.addEventListener('change',function(){ items[+el.dataset.i].enabled=el.checked; budget(); }); });
      box.querySelectorAll('[data-rm]').forEach(function(b){ b.addEventListener('click',function(){ var it=items[+b.dataset.rm]; if((it.title||it.text)&&!confirm('Odebrat téma „'+(it.title||'bez názvu')+'"?')) return; items.splice(+b.dataset.rm,1); renderItems(); }); });
      bindFields(box); budget(); }
    function renderEx(){
      var box=document.getElementById('ex-list');
      box.innerHTML=exs.map(function(x,i){ return '<div class="card" style="padding:12px;margin-bottom:10px;background:rgba(255,255,255,.03)">'+
        '<div class="row" style="gap:8px;align-items:center"><input data-e="q" data-i="'+i+'" data-max="'+LM.example_q+'" placeholder="Otázka uživatele" value="'+esc(x.q)+'" style="flex:1"><button class="btn sec" type="button" data-exrm="'+i+'" title="Odebrat příklad">✕</button></div>'+
        '<textarea data-e="a" data-i="'+i+'" data-max="'+LM.example_a+'" rows="3" placeholder="Přesná odpověď, jakou si přeješ" style="margin-top:8px">'+esc(x.a)+'</textarea></div>'; }).join('')||'<p class="muted small">Zatím žádný příklad.</p>';
      box.querySelectorAll('[data-e]').forEach(function(el){ el.addEventListener('input',function(){ exs[+el.dataset.i][el.dataset.e]=el.value; budget(); }); });
      box.querySelectorAll('[data-exrm]').forEach(function(b){ b.addEventListener('click',function(){ exs.splice(+b.dataset.exrm,1); renderEx(); }); });
      bindFields(box); budget(); }
    document.getElementById('kn-add').addEventListener('click',function(){ items.push({title:'',text:'',enabled:true}); renderItems(); var t=document.querySelectorAll('#kn-list [data-k="title"]'); if(t.length) t[t.length-1].focus(); });
    document.getElementById('ex-add').addEventListener('click',function(){ exs.push({q:'',a:''}); renderEx(); var t=document.querySelectorAll('#ex-list [data-e="q"]'); if(t.length) t[t.length-1].focus(); });
    // kontrola limitů při uložení (server kontroluje znovu)
    form.addEventListener('submit',function(e){
      var errs=[];
      document.querySelectorAll('[data-max]').forEach(function(el){ var mx=+el.dataset.max; if(el.value.length>mx) errs.push((el.placeholder||el.dataset.label||el.name||'Pole')+': '+fmt(el.value.length)+' znaků, limit je '+fmt(mx)+' (přebývá '+fmt(el.value.length-mx)+').'); });
      items.forEach(function(x,i){ if((x.text||'')!==''&&!(x.title||'').trim()) errs.push('Téma '+(i+1)+': chybí název.'); });
      exs.forEach(function(x,i){ if((x.q||x.a)&&(!(x.q||'').trim()||!(x.a||'').trim())) errs.push('Příklad '+(i+1)+': vyplň otázku i odpověď.'); });
      var tok=Math.ceil(totalChars()/3); if(tok>LM.tokens_hard) errs.push('Celkový objem je ≈ '+fmt(tok)+' tokenů, maximum je '+fmt(LM.tokens_hard)+'.');
      var t=document.querySelector('input[name=temperature]'), m=document.querySelector('input[name=max_tokens]');
      if(t&&(+t.value<LM.temperature[0]||+t.value>LM.temperature[1]||t.value==='')) errs.push('Teplota musí být '+LM.temperature[0]+'–'+LM.temperature[1]+'.');
      if(m&&(+m.value<LM.max_tokens[0]||+m.value>LM.max_tokens[1]||m.value==='')) errs.push('Max. délka odpovědi musí být '+LM.max_tokens[0]+'–'+LM.max_tokens[1]+'.');
      if(errs.length){ e.preventDefault(); var box=document.getElementById('errbox'); document.getElementById('errlist').innerHTML=errs.map(function(x){ return '<li>'+esc(x)+'</li>'; }).join(''); box.style.display=''; box.scrollIntoView({behavior:'smooth',block:'center'}); return; }
      document.getElementById('kj').value=JSON.stringify(items); document.getElementById('ej').value=JSON.stringify(exs);
    });
    bindFields(document); renderItems(); renderEx();
    // zkušební chat
    var log=document.getElementById('aichat-log'), inp=document.getElementById('aichat-in'), btn=document.getElementById('aichat-send'), hist=[];
    function add(role,text){ if(!hist.length&&log.firstChild&&log.firstChild.className==='muted small') log.innerHTML='';
      var d=document.createElement('div'); d.style.cssText='margin:6px 0;padding:8px 11px;border-radius:10px;max-width:88%;white-space:pre-wrap;'+(role==='user'?'margin-left:auto;background:rgba(79,209,255,.15)':'background:rgba(255,255,255,.06)');
      d.textContent=text; log.appendChild(d); log.scrollTop=log.scrollHeight; return d; }
    async function send(){
      var t=inp.value.trim(); if(!t||btn.disabled) return; inp.value=''; add('user',t); hist.push({role:'user',content:t}); btn.disabled=true;
      var wait=add('assistant','…');
      try{
        var r=await fetch('/admin/ai-chat/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:hist})});
        var j=await r.json();
        if(j.error){ wait.textContent=j.error; wait.style.color='#ff8a8a'; hist.pop(); }
        else { wait.textContent=j.reply||'(prázdná odpověď)'; hist.push({role:'assistant',content:j.reply||''}); }
      }catch(e){ wait.textContent='Chyba spojení: '+e.message; wait.style.color='#ff8a8a'; hist.pop(); }
      btn.disabled=false; inp.focus();
    }
    btn.addEventListener('click',send); inp.addEventListener('keydown',function(e){ if(e.key==='Enter') send(); });
    document.getElementById('aichat-reset').addEventListener('click',function(){ hist=[]; log.innerHTML='<div class="muted small">Napiš dotaz a pošli…</div>'; });
  })();
  </script>`, holyosUrl);
}

// Admin: Převody podpory ze starého systému — žádosti uživatelů, zpracovává se ručně
function adminTransfers({ admin, rows = [], msg = '', holyosUrl, status = '', counts = {}, rate = 25, tfEv = {} }) {
  const ST = { pending: ['invited', 'zpracovává se'], approved: ['active', 'převedeno'], rejected: ['blocked', 'zamítnuto'] };
  const sy = (t) => (t.currency === 'EUR' ? '€' : 'Kč');
  const all = (counts.pending || 0) + (counts.approved || 0) + (counts.rejected || 0);
  return adminLayout('Převody podpory', 'trf', admin, `
  <h1 style="margin:0 0 6px">Převody podpory <span class="muted" style="font-size:14px;font-weight:500">${rows.length}</span></h1>
  <p class="muted" style="margin-top:0">Žádosti uživatelů typu Stávající o přenesení částky ze starého systému — buď <b>z podpořené částky</b>, nebo <b>z výběru</b>. Vždy se převádí na Discount Credit. Dokud žádost ručně nezpracuješ, zůstává ve stavu <b>zpracovává se</b>; všechny pohyby se evidují (rozbal „Pohyby"). Ověř nárok ve starém systému, případně uprav počet DC a žádost <b>schval</b> (uživateli se připíše kredit) nebo <b>zamítni</b>. Aktuální kurz: 1 € = ${esc(Number(rate).toLocaleString('cs-CZ', { maximumFractionDigits: 4 }))} Kč.</p>
  ${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}
  <div class="row" style="gap:8px;margin:10px 0 12px">${[['', 'Všechny', all], ['pending', 'Zpracovávají se', counts.pending || 0], ['approved', 'Převedené', counts.approved || 0], ['rejected', 'Zamítnuté', counts.rejected || 0]].map(([k, l, n]) => `<a class="btn sm ${status === k ? '' : 'sec'}" href="/admin/transfers${k ? '?status=' + k : ''}">${l} (${n})</a>`).join('')}</div>
  <div class="card tbl-wrap">${rows.length ? `<table class="cards"><thead><tr><th>Datum</th><th>Uživatel</th><th>Zdroj</th><th>Částka</th><th>Kurz</th><th>DC</th><th>Poznámka uživatele</th><th>Stav</th><th></th></tr></thead><tbody>
    ${rows.map(t => { const st = ST[t.status] || ST.pending; return `<tr><td data-l="Datum" class="small muted">${fmtDT(t.created_at)}</td>
      <td data-l="Uživatel"><a href="/admin/supporters/${t.supporter_id}"><b>${esc([t.last_name, t.first_name].filter(Boolean).join(' ') || t.email)}</b></a><div class="small muted">${esc(t.nick || t.email || '')}</div></td>
      <td data-l="Zdroj">${t.kind === 'withdrawal' ? 'Z výběru' : 'Z podpory'}</td>
      <td data-l="Částka">${money(t.amount, sy(t))}</td>
      <td data-l="Kurz" class="small muted">${t.currency === 'EUR' ? '1 € = ' + esc(Number(t.rate).toLocaleString('cs-CZ', { maximumFractionDigits: 4 })) + ' Kč' : '—'}</td>
      <td data-l="DC"><b>${money(t.dc_amount, 'DC')}</b></td>
      <td data-l="Poznámka" class="small">${esc(t.note || '') || '<span class="muted">—</span>'}</td>
      <td data-l="Stav"><span class="badge ${st[0]}">${st[1]}</span>${t.processed_at ? `<div class="small muted">${fmtDT(t.processed_at)}${t.processed_by ? ' · ' + esc(t.processed_by) : ''}</div>` : ''}${t.admin_note ? `<div class="small muted">${esc(t.admin_note)}</div>` : ''}${tfEvents(tfEv[t.id], true)}</td>
      <td class="actions">${t.status === 'pending' ? `<div class="row" style="flex-direction:column;gap:8px;align-items:stretch;min-width:240px">
        <form method="post" action="/admin/transfers/${t.id}/approve" style="margin:0;display:flex;gap:6px;align-items:center;flex-wrap:wrap"><input name="dc" inputmode="decimal" value="${esc(String(Number(t.dc_amount)))}" required title="Počet DC k připsání" style="width:110px;padding:6px 8px;text-align:right"><input name="admin_note" placeholder="Poznámka (nepovinné)" style="width:150px;padding:6px 8px"><button class="btn sm" type="submit" onclick="return confirm('Připsat uživateli DC a žádost schválit?')">Schválit</button></form>
        <form method="post" action="/admin/transfers/${t.id}/reject" style="margin:0;display:flex;gap:6px;align-items:center;flex-wrap:wrap"><input name="admin_note" placeholder="Důvod zamítnutí" style="width:150px;padding:6px 8px"><button class="btn sec sm" type="submit" onclick="return confirm('Žádost zamítnout?')">Zamítnout</button></form></div>` : ''}</td></tr>`; }).join('')}</tbody></table>`
    : '<p class="muted" style="margin:0">Zatím žádné žádosti o převod podpory.</p>'}</div>`, holyosUrl);
}
function adminSuggestions({ admin, rows = [], status = '', counts = {}, msg = '', holyosUrl }) {
  const all = (counts.new || 0) + (counts.done || 0) + (counts.dismissed || 0);
  const ST = { new: ['invited', 'nový'], done: ['active', 'vyřešeno'], dismissed: ['blocked', 'zamítnuto'] };
  const tab = (k, l, n) => `<a class="btn sec sm" href="/admin/suggestions${k ? '?status=' + k : ''}"${status === k ? ' style="border-color:var(--accent);color:var(--accent2)"' : ''}>${l} <b>${n}</b></a>`;
  return adminLayout('Podněty', 'sug', admin, `
  <h1 style="margin:0 0 6px">Podněty na vylepšení <span class="muted" style="font-size:14px;font-weight:500">${rows.length}</span></h1>
  <p class="muted" style="margin-top:0">Nápady, které uživatelé poslali tlačítkem „Nápad na vylepšení" v aplikaci.</p>
  ${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}
  <div class="row" style="gap:8px;margin:10px 0 12px;flex-wrap:wrap">${tab('', 'Všechny', all)}${tab('new', 'Nové', counts.new || 0)}${tab('done', 'Vyřešené', counts.done || 0)}${tab('dismissed', 'Zamítnuté', counts.dismissed || 0)}</div>
  ${rows.length ? rows.map(g => { const st = ST[g.status] || ST.new; const nm = [g.last_name, g.first_name].filter(Boolean).join(' ') || g.email || 'smazaný uživatel'; return `<div class="card" style="margin:0 0 10px">
    <div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap"><div>${g.supporter_id ? `<a href="/admin/supporters/${g.supporter_id}"><b>${esc(nm)}</b></a>` : `<b>${esc(nm)}</b>`}${g.nick ? ` <span class="muted small">${esc(g.nick)}</span>` : ''} <span class="muted small">· ${fmtDT(g.created_at)}${g.page ? ' · ze stránky ' + esc(g.page) : ''}${g.device ? ' · ' + esc(g.device) : ''}</span></div><span class="badge ${st[0]}">${st[1]}</span></div>
    <p style="white-space:pre-wrap;margin:10px 0 12px;font-size:15px">${esc(g.body)}</p>
    ${g.handled_at ? `<div class="small muted" style="margin-bottom:8px">Zpracoval ${esc(g.handled_by || '')} · ${fmtDT(g.handled_at)}</div>` : ''}
    <form method="post" action="/admin/suggestions/${g.id}/status" class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin:0"><input type="hidden" name="back" value="${esc(status)}"><input name="admin_note" value="${esc(g.admin_note || '')}" placeholder="Poznámka (nepovinné)" style="flex:1;min-width:200px">
      ${g.status !== 'done' ? '<button class="btn sm" name="status" value="done" type="submit">Vyřešeno</button>' : ''}${g.status !== 'dismissed' ? '<button class="btn sec sm" name="status" value="dismissed" type="submit">Zamítnout</button>' : ''}${g.status !== 'new' ? '<button class="btn sec sm" name="status" value="new" type="submit">Znovu otevřít</button>' : ''}
    </form>
    <form method="post" action="/admin/suggestions/${g.id}/delete" style="margin:8px 0 0" onsubmit="return confirm('Opravdu smazat podnět?')"><button class="btn danger sm" type="submit">Smazat</button></form>
  </div>`; }).join('') : '<div class="card"><p class="muted" style="margin:0">Zatím žádné podněty.</p></div>'}`, holyosUrl);
}
// Buňka faktury v Objednávkách: ikona (klik = PDF), stav odeslání e-mailem a ruční odeslání
// Stav dokladu: zaplaceno / po splatnosti / čeká na platbu / odesláno / vystaveno (neodesláno) / zrušeno
function invState(i) {
  const paid = i.status === 'paid' || (Number(i.paid_amount) > 0 && Number(i.paid_amount) >= Number(i.total) - 0.01);
  if (i.status === 'cancelled') return { k: 'blocked', t: 'zrušeno' };
  if (paid) return { k: 'active', t: 'zaplaceno' };
  const due = i.date_due ? new Date(i.date_due) : null; const over = due && due < new Date(new Date().toDateString());
  const sent = i.delivery_status === 'sent';
  if (over) return { k: 'blocked', t: 'po splatnosti' + (due ? ' (' + due.toLocaleDateString('cs-CZ') + ')' : '') };
  if (sent) return { k: 'invited', t: 'čeká na platbu' + (due ? ' · do ' + due.toLocaleDateString('cs-CZ') : '') };
  return { k: 'invited', t: 'vystaveno · neodesláno' };
}
const fmtShort = (d) => d ? new Date(d).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
// Jeden řádek dokladu v buňce „Doklady": typ · číslo · stav · odesláno · akce
function invRow(o, which) {
  const i = o.inv && o.inv[which]; const label = which === 'proforma' ? 'Záloha' : 'Faktura';
  if (!i) {
    if (which === 'final') return `<div class="inv-row"><span class="inv-k">${label}</span><span class="muted small" title="Vystaví se automaticky po zaplacení zálohy">— po zaplacení zálohy</span></div>`;
    if (o.kind === 'service' && !(Number(o.price_net) > 0)) return '';
    return `<div class="inv-row"><span class="inv-k">${label}</span><form method="post" action="/admin/orders/${o.id}/invoice" style="margin:0" onsubmit="return confirm('Vystavit zálohovou fakturu? Zatím se NEODEŠLE — nejdřív si ji zkontroluješ.')"><button class="btn sec sm inv-btn" type="submit">Vystavit</button></form></div>`;
  }
  const st = invState(i); const sent = i.delivery_status === 'sent';
  return `<div class="inv-row"><span class="inv-k">${label}</span><a href="/admin/orders/invoice/${i.id}/pdf" target="_blank" class="inv-no" title="Otevřít PDF">📄 ${esc(i.invoice_number)}</a><span class="badge ${st.k} inv-badge">${esc(st.t)}</span>${sent ? `<span class="small muted" title="${esc(i.sent_to || '')}">✉ ${esc(fmtShort(i.sent_at))}</span>` : (i.send_error ? `<span class="small" style="color:var(--err)" title="${esc(i.send_error)}">✉ chyba</span>` : '')}<form method="post" action="/admin/orders/invoice/${i.id}/send" style="margin:0"><button class="btn sec sm inv-btn" type="submit" title="${sent ? 'Poslat e-mailem znovu' : 'Odeslat e-mailem zákazníkovi'}">${sent ? '↻' : 'Odeslat'}</button></form></div>`;
}
function invCell(o) { const a = invRow(o, 'proforma'), b = invRow(o, 'final'); return (a || b) ? `<div class="inv-cell">${a}${b}</div>` : '<span class="muted small">—</span>'; }
function adminOrders({ admin, rows = [], msg = '', holyosUrl, status = '', counts = {} }) {
  const sy = (o) => (o.currency === 'EUR' ? '€' : 'Kč');
  const st = (o) => `<span class="badge ${o.status === 'confirmed' ? 'active' : o.status === 'cancelled' ? 'blocked' : 'invited'}">${o.status === 'confirmed' ? 'potvrzeno' : o.status === 'cancelled' ? 'zrušeno' : 'čeká na potvrzení'}</span>`;
  return adminLayout('Objednávky', 'ord', admin, `
  <h1 style="margin:0 0 6px">Objednávky <span class="muted" style="font-size:14px;font-weight:500">${rows.length}</span></h1>
  <p class="muted" style="margin-top:0">Objednávky odeslané uživateli tlačítkem <b>Koupit</b>. Potvrzením vznikne nákup a prodejci se připíše provize v DC. Zrušením se uživateli vrátí uplatněné DC.</p>
  ${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}
  <div class="row" style="gap:8px;margin:10px 0 12px">${[['', 'Všechny', (counts.new || 0) + (counts.confirmed || 0) + (counts.cancelled || 0)], ['new', 'Čekají na potvrzení', counts.new || 0], ['confirmed', 'Potvrzené', counts.confirmed || 0], ['cancelled', 'Zrušené', counts.cancelled || 0]].map(([k, l, n]) => `<a class="btn sm ${status === k ? '' : 'sec'}" href="/admin/orders${k ? '?status=' + k : ''}">${l} <span style="opacity:.7">${n}</span></a>`).join('')}</div>
  <style>.ord-tbl td{vertical-align:top;padding:10px 10px}.ord-tbl .btn.sm{padding:5px 10px;font-size:12px}.inv-cell{display:flex;flex-direction:column;gap:6px;min-width:300px}.inv-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px}.inv-k{color:var(--text2);min-width:52px;font-size:11px;text-transform:uppercase;letter-spacing:.05em}.inv-no{font-weight:600;white-space:nowrap;text-decoration:none}.inv-badge{font-size:11px;padding:2px 8px}.inv-btn{padding:3px 8px!important;font-size:11.5px!important}.ord-act{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.ord-act .btn.sm{padding:5px 10px}</style>
  <div class="card tbl-wrap">${rows.length ? `<table class="cards ord-tbl"><thead><tr><th>Datum</th><th>Uživatel</th><th>Prádlomat</th><th>Cena bez DPH</th><th>Doklady</th><th>DC</th><th>Stav</th><th></th></tr></thead><tbody>
    ${rows.map(o => `<tr><td data-l="Datum" class="small muted" style="white-space:nowrap">${fmtDT(o.created_at)}</td>
      <td data-l="Uživatel"><a href="/admin/supporters/${o.supporter_id}"><b>${esc([o.last_name, o.first_name].filter(Boolean).join(' ') || o.email)}</b></a><div class="small muted">${esc(o.nick || '')} · <a href="/admin/podpora?u=${o.supporter_id}&order=${o.id}" title="Napsat uživateli zprávu k objednávce č. ${o.id}">💬 napsat</a></div></td>
      <td data-l="Prádlomat"><b>${esc(o.product_name)}</b>${o.kind === 'service' ? ' <span class="small muted">služba</span>' : ''}<div class="small muted">obj. č. ${o.id}</div></td>
      <td data-l="Cena bez DPH" style="white-space:nowrap">${o.kind === 'service' && !(Number(o.price_net) > 0) ? `<span class="muted">${o.no_price ? '% z obratu' : 'čeká na nacenění'}</span>` : `<b>${money(o.final_net, sy(o))}</b>${Number(o.final_net) !== Number(o.price_net) ? `<div class="small muted">ceník ${money(o.price_net, sy(o))}</div>` : ''}`}</td>
      <td data-l="Doklady">${invCell(o)}</td>
      <td data-l="DC" style="white-space:nowrap">${Number(o.dc_used) > 0 ? esc(Number(o.dc_used).toLocaleString('cs-CZ')) + ' DC' : '<span class="muted">—</span>'}</td>
      <td data-l="Stav">${st(o)}</td>
      <td class="actions">${o.status === 'new' ? `<div class="row"><form method="post" action="/admin/orders/${o.id}/confirm" style="margin:0;display:flex;gap:6px;align-items:center;flex-wrap:wrap">${o.kind === 'service' && !(Number(o.price_net) > 0) ? `${o.no_price ? '' : '<input name="price" inputmode="decimal" placeholder="Cena bez DPH" required style="width:120px;padding:6px 8px;text-align:right">'}<input name="dc" inputmode="decimal" placeholder="DC" title="Kolik DC uplatnit (nepovinné)" style="width:80px;padding:6px 8px;text-align:right">` : ''}<button class="btn sm" type="submit">Potvrdit</button></form><form method="post" action="/admin/orders/${o.id}/cancel" onsubmit="return confirm('Zrušit objednávku a vrátit DC?')" style="margin:0"><button class="btn danger sm" type="submit">Zrušit</button></form></div>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted" style="margin:0">Zatím žádné objednávky.</p>'}</div>`, holyosUrl);
}
// URL obrázku produktu (BS2 proxy); null = bez obrázku
const productImg = (p) => p && p.image_ext ? '/img/product/' + p.id + '?v=' + encodeURIComponent(p.image_updated_at ? new Date(p.image_updated_at).getTime() : '') : null;
function adminProducts({ admin, rows = [], error = '', msg = '', holyosUrl, rate = 25, services = [] }) {
  const groups = {};
  for (const p of rows) { const k = [p.model_version, p.model_variant].filter(Boolean).join(' · ') || 'Ostatní'; (groups[k] = groups[k] || []).push(p); }
  const body = Object.keys(groups).map((k, gi) => `<h2 style="margin:18px 0 8px;font-size:15px;color:var(--text2)">${esc(k)}</h2><form id="gf${gi}" method="post" action="/admin/products/save-group" style="display:none"></form>
    <div class="card tbl-wrap"><table class="cards"><thead><tr><th>Název</th><th>Cena CZK</th><th>Cena EUR</th><th>Discount Credit</th><th>Minimální cena bez DPH</th><th title="Prodejní cena − sleva (využití DC) − provize (Discount Credit) − minimální cena (bráno jako výrobní náklad)">Zbývá mi</th><th>Může být využito DC</th><th style="text-align:right">Nabízet uživatelům</th></tr></thead><tbody>
    ${groups[k].map(p => `<tr><td data-l="Název"><div style="display:flex;align-items:center;gap:10px">${productImg(p) ? `<img src="${productImg(p)}" alt="" style="width:64px;height:48px;object-fit:contain;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid var(--border);flex:none">` : `<span class="muted" title="Bez obrázku — nahraj ho v HolyOS v ceníku" style="width:64px;height:48px;border-radius:8px;border:1px dashed var(--border2);display:inline-flex;align-items:center;justify-content:center;flex:none;font-size:11px">foto</span>`}<b>${esc(p.name_cs)}</b></div></td>
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
  ${body || (error ? '' : '<p class="muted">V ceníku nejsou žádné aktivní stroje.</p>')}
  <h2 style="margin:26px 0 8px;font-size:15px;color:var(--text2)">Služby</h2>
  <p class="muted small" style="margin-top:0">Položky, které se uživatelům zobrazí na stránce Prádlomaty v sekci Služby. Prázdná cena = individuální nacenění (uživatel pošle poptávku a ty v Objednávkách zadáš cenu). <b>Může být využito DC</b> = kolik % ceny lze uhradit z DC.</p>
  <form method="post" action="/admin/services/save"><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))">${services.map(sv => `<div class="card" style="margin:0">
    <label style="margin-top:0">Název</label><input name="name_${sv.key}" value="${esc(sv.name)}">
    <label>Popis (zobrazí se uživateli)</label><textarea name="desc_${sv.key}" rows="3" style="width:100%">${esc(sv.desc || '')}</textarea>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px">${sv.mode === 'percent' ? `<div><label>Cena: % z obratu (s DPH)</label><input name="percent_${sv.key}" inputmode="decimal" value="${sv.percent != null ? Number(sv.percent) : 13}" style="width:140px;text-align:right"></div>` : `<div><label>Cena bez DPH (Kč)</label><input name="price_${sv.key}" inputmode="decimal" value="${sv.price_czk != null ? Number(sv.price_czk) : ''}" placeholder="individuálně" style="width:140px;text-align:right"></div>
    <div><label>Může být využito DC (%)</label><input name="dc_${sv.key}" inputmode="decimal" value="${sv.dc_use_pct != null ? Number(sv.dc_use_pct) : 100}" style="width:110px;text-align:right"></div>`}</div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:12px;cursor:pointer"><input type="checkbox" name="offered_${sv.key}" value="1" ${sv.offered ? 'checked' : ''} style="width:auto"> Nabízet uživatelům</label></div>`).join('')}</div>
  <div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="btn sm" type="submit">Uložit služby</button></div></form>`, holyosUrl);
}
// Karta „Podpora (partnerský portál)" v detailu uživatele — souhrny ze starého portálu partner.bestseries.cz
function partnerSupportCard(s) {
  const p = (s && s.partner_support) || {};
  const val = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('cs-CZ'));
  const cur = p.currency === 'EUR' ? '€' : 'Kč';
  const inp = (name, label, v) => `<div style="flex:1;min-width:140px"><label>${label}${name.startsWith('network') ? '' : ' (' + cur + ')'}</label><input name="${name}" inputmode="decimal" value="${esc(val(v))}" placeholder="${name.startsWith('network') ? 'Kč' : cur}"></div>`;
  const sumYear = ['palety', 'expanze', 'neurawash', 'opakovacky'].reduce((a, k) => a + (Number(p[k]) || 0), 0);
  return `<details class="card sec" data-sec="partner" open><summary><span>Podpora (partnerský portál)${p.total_all != null ? ` <span class="muted small">celkem ${Number(p.total_all).toLocaleString('cs-CZ')} ${cur}${p.currency === 'EUR' && p.total_all_czk != null ? ' ≈ ' + Number(p.total_all_czk).toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč' : ''}</span>` : ''}</span><span class="chev">▶</span></summary><div class="sec-body">
    <form method="post" action="/admin/supporters/${s.id}/partner-support">
      <div class="row" style="gap:10px;align-items:flex-end">
        ${inp('total_all', 'Celkem podpořil (od počátku)', p.total_all)}
        <div style="width:90px"><label>Rok</label><input name="year" inputmode="numeric" value="${esc(p.year || new Date().getFullYear())}"></div>
        ${inp('total_year', 'Podpořil v roce', p.total_year)}
      </div>
      <div class="row" style="gap:10px;align-items:flex-end;margin-top:6px">
        ${inp('palety', 'Palety', p.palety)}${inp('expanze', 'Expanze', p.expanze)}${inp('neurawash', 'NeuraWash', p.neurawash)}${inp('opakovacky', 'Opakovačky', p.opakovacky)}
      </div>
      <div class="row" style="gap:10px;align-items:flex-end;margin-top:6px">
        ${inp('network_all', 'Obrat sítě od počátku', p.network_all)}${inp('network_year', 'Obrat sítě v roce', p.network_year)}
      </div>
      <label style="margin-top:6px">Poznámka</label><input name="note" value="${esc(p.note || '')}" placeholder="např. Expanze obsahuje i palety a opakovačky">
      ${sumYear ? `<div class="small muted" style="margin-top:6px">Součet palety + expanze + NeuraWash + opakovačky = <b>${sumYear.toLocaleString('cs-CZ')} ${cur}</b>${p.total_year != null && Math.abs(sumYear - Number(p.total_year)) > 0.5 ? ' (≠ „Podpořil v roce")' : ''}</div>` : ''}
      ${p.currency === 'EUR' ? `<div class="card" style="margin-top:8px;padding:10px 12px;background:var(--bg2,#f6f7f9)"><div class="small"><b>Přepočet na Kč</b> <span class="muted">${p.eur_rate ? 'kurz ČNB ' + Number(p.eur_rate).toLocaleString('cs-CZ', { maximumFractionDigits: 3 }) + ' Kč/€' + (p.eur_rate_date ? ' ze dne ' + esc(p.eur_rate_date) : '') : esc(p.eur_rate_error || 'kurz zatím nenačten')}</span></div>
        <div class="small" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:4px 12px;margin-top:6px">${[['total_all', 'Celkem'], ['total_year', 'V roce'], ['palety', 'Palety'], ['expanze', 'Expanze'], ['neurawash', 'NeuraWash'], ['opakovacky', 'Opakovačky']].map(([k, l]) => `<div><span class="muted">${l}:</span> <b>${p[k + '_czk'] != null ? Number(p[k + '_czk']).toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč' : '—'}</b></div>`).join('')}</div></div>` : ''}
      ${p.updated_at ? `<div class="small muted" style="margin-top:4px">Naposledy uloženo ${new Date(p.updated_at).toLocaleString('cs-CZ')} · ${esc(p.updated_by || '')}</div>` : ''}
      <div style="height:10px"></div><div class="row" style="gap:8px"><button class="btn sm" type="submit">Uložit podporu</button>
        <button class="btn sec sm" type="submit" formaction="/admin/supporters/${s.id}/partner-support/sync" formnovalidate title="Přihlásí se jako uživatel do partner.bestseries.cz a načte Přehled podpory + obrat sítě">🔄 Načíst ze starého portálu</button></div>
      ${p.synced_at ? `<div class="small muted" style="margin-top:4px">Načteno ze starého portálu ${new Date(p.synced_at).toLocaleString('cs-CZ')}${p.legacy_name ? ' · účet ' + esc(p.legacy_name) : ''}</div>` : ''}
    </form>
  </div></details>`;
}
// Kontrola načtené podpory ze starého portálu — seznam hotových uživatelů (ruční kontrola)
function adminPartnerSupport({ admin, rows, job, overall = {}, q: qs = '', onlyDiff = false }) {
  const fmt = (v) => (v == null || v === '' ? '<span class="muted">—</span>' : Number(v).toLocaleString('cs-CZ'));
  const sumY = (p) => ['palety', 'expanze', 'neurawash', 'opakovacky'].reduce((a, k) => a + (Number(p[k]) || 0), 0);
  const body = rows.map(r => { const p = r.partner_support || {}; const diff = p.total_year != null && Math.abs(sumY(p) - Number(p.total_year)) > 0.5;
    return `<tr>
      <td data-l="Jméno" class="nm"><b>${esc([r.last_name, r.first_name].filter(Boolean).join(' ') || '—')}</b><div class="small muted">${esc(r.nick || '')} · ${esc(r.email)}</div></td>
      <td data-l="Obrat (import)" class="small">${esc((r.extra && r.extra.obrat) || '—')}</td>
      <td data-l="Celkem" style="text-align:right"><b>${fmt(p.total_all)}</b>${p.currency === 'EUR' ? ' <span class="badge" title="Účet vede podporu v eurech">€</span>' : ''}</td>
      <td data-l="Celkem v Kč" style="text-align:right" title="${p.currency === 'EUR' && p.eur_rate ? 'Přepočet kurzem ČNB ' + p.eur_rate + (p.eur_rate_date ? ' (' + p.eur_rate_date + ')' : '') : 'Korunový účet'}">${p.currency === 'EUR' ? (p.total_all_czk != null ? fmt(Math.round(p.total_all_czk)) : '<span class="muted">—</span>') : fmt(p.total_all)}</td>
      <td data-l="Rok" class="small">${esc(p.year || '')}</td>
      <td data-l="V roce" style="text-align:right">${fmt(p.total_year)}</td>
      <td data-l="Palety" style="text-align:right">${fmt(p.palety)}</td>
      <td data-l="Expanze" style="text-align:right">${fmt(p.expanze)}</td>
      <td data-l="NeuraWash" style="text-align:right">${fmt(p.neurawash)}</td>
      <td data-l="Opakovačky" style="text-align:right">${fmt(p.opakovacky)}</td>
      <td data-l="Obrat sítě" style="text-align:right">${fmt(p.network_all)}</td>
      <td data-l="Kontrola" class="small">${diff ? '<span class="badge blocked" title="Součet sekcí ≠ podpořil v roce">≠ součet</span>' : ''}${p.total_all_error ? '<span class="badge blocked" title="' + esc(p.total_all_error) + '">celkem ?</span>' : ''}</td>
      <td data-l="Načteno" class="small">${p.synced_at ? new Date(p.synced_at).toLocaleString('cs-CZ') : '—'}</td>
      <td class="actions"><div class="row"><a class="btn sec sm" href="/admin/supporters/${r.id}">Detail</a><button type="button" class="btn sec sm legacy-btn" data-email="${esc(r.email)}" data-to="/cs/bo/my-invests/" title="Otevřít jeho Přehled podpory ve starém portálu a porovnat">Starý portál</button></div></td></tr>`; }).join('');
  const st = job && job.total ? `${job.running ? 'Běží' : 'Hotovo'} ${job.done}/${job.total} · OK ${job.ok}${job.failed ? ' · chyby ' + job.failed : ''}` : 'Hromadné načítání neběží';
  return adminLayout('Kontrola podpory', 'sup', admin, `
  <p><a href="/admin/supporters">${ico('back', 15)} Uživatelé</a></p>
  <h1 style="margin-bottom:4px">Kontrola načtené podpory <span class="muted" style="font-size:14px;font-weight:500">${rows.length}</span></h1>
  <div class="card" id="ps-prog" style="padding:14px 16px;margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <b id="ps-p-title">Průběh načítání</b>
      <div class="row" style="gap:6px"><a class="btn sec sm" href="/admin/partner-support/export.xlsx" title="Všichni uživatelé s nenulovou podporou do Excelu (Kč i €, přepočet ČNB, sekce)">⬇ Export do Excelu</a><button type="button" class="btn sec sm" id="ps-p-missing" title="Znovu načte jen uživatele, u kterých chybí rok a sekce (typicky eurové účty)">↻ Znovu bez roku (${rows.filter(r => r.partner_support && r.partner_support.year == null).length})</button><button type="button" class="btn sec sm" id="ps-p-start">🔄 Spustit / pokračovat</button></div>
    </div>
    <div class="small muted" style="margin:8px 0 4px">Celkem načteno (obrat ≠ 0): <b id="ps-p-ovt">${overall.synced != null ? overall.synced + ' / ' + overall.eligible : '—'}</b></div>
    <div style="height:10px;background:var(--bg2,#eee);border-radius:6px;overflow:hidden"><div id="ps-p-ovbar" style="height:100%;width:${overall.eligible ? Math.round(100 * overall.synced / overall.eligible) : 0}%;background:var(--ok,#2e9d5b);transition:width .5s"></div></div>
    <div class="small muted" style="margin:10px 0 4px">Aktuální běh: <b id="ps-p-run">${esc(st)}</b></div>
    <div style="height:10px;background:var(--bg2,#eee);border-radius:6px;overflow:hidden"><div id="ps-p-bar" style="height:100%;width:${job && job.total ? Math.round(100 * job.done / job.total) : 0}%;background:var(--primary,#3b6fd8);transition:width .5s"></div></div>
    <div class="small muted" id="ps-p-info" style="margin-top:6px"></div>
  </div>
  <script>
    (function(){ var $=function(i){return document.getElementById(i)}; var wasRunning=false;
      function f(n){ return Number(n||0).toLocaleString('cs-CZ'); }
      function dur(sec){ sec=Math.max(0,Math.round(sec)); var h=Math.floor(sec/3600), m=Math.floor(sec%3600/60); return h ? h+' h '+m+' min' : m ? m+' min' : sec+' s'; }
      function show(j){
        var o=j.overall||{}; if(o.eligible){ $('ps-p-ovt').textContent=f(o.synced)+' / '+f(o.eligible)+' ('+Math.round(100*o.synced/o.eligible)+' %)'; $('ps-p-ovbar').style.width=(100*o.synced/o.eligible)+'%'; }
        if(!j.total){ $('ps-p-run').textContent=j.started_at ? 'Hotovo — nic dalšího k načtení' : 'Neběží'; $('ps-p-bar').style.width='0'; $('ps-p-info').textContent=''; return; }
        var pct=Math.round(100*j.done/j.total); $('ps-p-bar').style.width=pct+'%';
        $('ps-p-run').textContent=(j.running?'Běží ':'Dokončeno ')+f(j.done)+' / '+f(j.total)+' ('+pct+' %) · OK '+f(j.ok)+(j.failed?' · chyby '+f(j.failed):'');
        $('ps-p-title').textContent=j.running?'⏳ Načítání běží…':'✅ Průběh načítání';
        var el=((j.finished_at?new Date(j.finished_at):new Date())-new Date(j.started_at))/1000, info=[];
        if(j.done){ var per=el/j.done; info.push('rychlost '+(60/per).toFixed(1).replace('.',',')+' uživ./min'); if(j.running) info.push('zbývá cca '+dur(per*(j.total-j.done))+' (hotovo kolem '+new Date(Date.now()+per*(j.total-j.done)*1000).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'})+')'); }
        info.push((j.running?'běží ':'trvalo ')+dur(el)); if(j.running&&j.last) info.push('naposledy: '+j.last);
        $('ps-p-info').textContent=info.join(' · ');
        $('ps-p-start').disabled=!!j.running; $('ps-p-missing').disabled=!!j.running;
      }
      function poll(){ fetch('/admin/partner-support/sync-all').then(function(r){return r.json()}).then(function(j){ show(j); if(j.running){ wasRunning=true; setTimeout(poll,3000); } else if(wasRunning){ wasRunning=false; } }).catch(function(){ setTimeout(poll,10000); }); }
      $('ps-p-missing').onclick=function(){ if(!confirm('Znovu načíst uživatele bez roku (eurové účty)?')) return; fetch('/admin/partner-support/sync-all',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'missing_year'})}).then(function(r){return r.json()}).then(function(j){ show(j); poll(); }); };
      $('ps-p-start').onclick=function(){ if(!confirm('Spustit načítání podpory? Přeskočí uživatele načtené za posledních 24 h.')) return; 
        fetch('/admin/partner-support/sync-all',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(function(r){return r.json()}).then(function(j){ show(j); poll(); }); };
      poll(); })();
  </script>
  <p class="small muted" style="margin-top:0">Seřazeno od posledně načtených (obnov stránku pro nové řádky). „Starý portál" otevře jeho Přehled podpory pro ruční porovnání.</p>
  ${job && job.errors && job.errors.length ? `<details class="card" style="padding:10px 14px;margin-bottom:12px"><summary class="small"><b>Chyby (${job.errors.length})</b></summary><div class="small" style="margin-top:6px">${job.errors.map(e => '<div>' + esc(e) + '</div>').join('')}</div></details>` : ''}
  <form method="get" class="row" style="gap:8px;margin-bottom:12px"><input name="q" value="${esc(qs)}" placeholder="Hledat jméno / e-mail / nick…" style="flex:1"><label class="small" style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="diff" value="1"${onlyDiff ? ' checked' : ''}> jen s nesrovnalostí</label><button class="btn sm" type="submit">Filtrovat</button></form>
  <div class="tbl-wrap"><table class="cards"><thead><tr><th>Uživatel</th><th>Obrat (import)</th><th>Celkem</th><th>Celkem v Kč</th><th>Rok</th><th>V roce</th><th>Palety</th><th>Expanze</th><th>NeuraWash</th><th>Opakovačky</th><th>Obrat sítě</th><th>Kontrola</th><th>Načteno</th><th></th></tr></thead><tbody>${body || '<tr><td colspan="14" class="muted">Zatím nikdo.</td></tr>'}</tbody></table></div>
  <script>
    document.addEventListener('click', function (e) { var b = e.target.closest('.legacy-btn'); if (!b) return;
      var w = window.open('https://partner.bestseries.cz/php-action/fake-login.php?email=' + encodeURIComponent(b.dataset.email), '_blank');
      if (w) setTimeout(function () { try { w.location.href = 'https://partner.bestseries.cz' + b.dataset.to; } catch (x) {} }, 2500); });
  </script>`);
}
function adminSupporterDetail({ admin, s, msg = '', error = '', holyosUrl, isNew = false, firstLine = [], purchases = [], machines = [], credits = [], timeline = [] }) {
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
        ${isNew ? '' : `<label>Typ uživatele</label>${typeSelect(s.user_type)}<div class="small muted" style="margin-top:4px">Nový · Stávající · Koupil prádlomat · Může prodávat · Prověření lokality (vidí jen aplikaci /lokalita)</div>
        <label style="margin-top:12px">Balíček Prověření lokality</label><select name="location_package" style="width:auto"><option value="">— žádný —</option>${['basic', 'plus', 'premium'].map(k => `<option value="${k}"${s.location_package === k ? ' selected' : ''}>${({ basic: 'Základ (3 lokality)', plus: 'Plus (10)', premium: 'Premium (10 + šetření)' })[k]}</option>`).join('')}</select>
        <div class="small muted" style="margin-top:4px">Platnost: <b>${s.location_expires_at ? new Date(s.location_expires_at).toLocaleDateString('cs-CZ') : '—'}</b> · při zvolení balíčku bez platnosti se nastaví 12 měsíců od teď. Po zaplacení na /location se vyplňuje samo.</div>
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
        <a class="btn sec sm" href="/admin/stats/user/${s.id}">Chování a statistiky</a>
        <form method="post" action="/admin/supporters/${s.id}/${s.status === 'blocked' ? 'unblock' : 'block'}"><button class="btn ${s.status === 'blocked' ? 'sec' : 'danger'} sm" type="submit">${s.status === 'blocked' ? ico('check', 16) + ' Odblokovat' : ico('block', 16) + ' Blokovat'}</button></form>
        <form method="post" action="/admin/supporters/${s.id}/delete" onsubmit="return confirm('Opravdu smazat uživatele ' + ${JSON.stringify(s.email)} + '?')"><button class="btn danger sm" type="submit">${ico('trash', 16)} Smazat</button></form>
      </div>
    </div></details>
    ${partnerSupportCard(s)}
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
  </div></details>
  <details class="card sec" data-sec="activity" open style="margin-top:12px"><summary><span>Kompletní aktivita <span class="muted small">(${timeline.length} záznamů)</span></span><span class="chev">▶</span></summary><div class="sec-body">
    <div class="row" id="tl-f" style="gap:6px;flex-wrap:wrap;margin-bottom:10px">${[['', 'Vše'], ['login', 'Přihlášení'], ['web', 'Chování na webu'], ['chat', 'Chat'], ['mail', 'E-maily'], ['order', 'Objednávky'], ['transfer', 'Převody'], ['dc', 'DC'], ['suggestion', 'Podněty'], ['admin', 'Správa']].map(([k, l]) => `<button type="button" class="btn sm ${k ? 'sec' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
    ${timeline.length ? `<div id="tl-list" style="max-height:560px;overflow:auto">${timeline.map(t => `<div class="list-item tl-i" data-k="${esc(t.kind)}" style="gap:12px;align-items:flex-start"><span class="small muted" style="min-width:128px;flex:none">${fmtDT(t.at)}</span><span style="flex:1">${esc(t.text)}${t.meta ? `<div class="small muted">${esc(t.meta)}</div>` : ''}</span><span class="badge ${t.kind === 'mail' ? 'invited' : t.kind === 'login' ? 'active' : ''}" style="flex:none">${({ login: 'přihlášení', web: 'web', chat: 'chat', mail: 'e-mail', order: 'objednávka', transfer: 'převod', dc: 'DC', suggestion: 'podnět', admin: 'správa' })[t.kind] || esc(t.kind)}</span></div>`).join('')}</div>` : '<p class="muted">Zatím žádná aktivita.</p>'}
    <p class="small muted" style="margin:10px 0 0">Zahrnuje přihlášení, chování na webu, chat, e-maily odeslané systémem (od nasazení této funkce), objednávky, převody, DC, podněty a zásahy administrátora. SMS BS2 zatím neodesílá.</p>
    <script>(function(){var f=document.getElementById('tl-f');if(!f)return;f.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;var k=b.getAttribute('data-k');f.querySelectorAll('button').forEach(function(x){x.classList.toggle('sec',x!==b);});document.querySelectorAll('.tl-i').forEach(function(r){r.style.display=(!k||r.getAttribute('data-k')===k)?'':'none';});});})();</script>
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
// 2FA správce (volitelné, BS2_ADMIN_2FA=1)
function admin2faPage({ setup = false, secret = '', uri = '', error = '' }) {
  const qr = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(uri);
  return authShell({ title: 'Ověření správce', esc, card: `
    <h2>${setup ? 'Nastavení dvoufázového ověření' : 'Ověření správce'}</h2>
    <p class="sub">${setup ? 'Naskenujte QR kód v aplikaci Google Authenticator / Microsoft Authenticator a zadejte vygenerovaný kód.' : 'Zadejte 6místný kód z aplikace Authenticator.'}</p>
    ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
    ${setup ? `<div style="text-align:center;margin:10px 0"><img src="${qr}" alt="QR" width="200" height="200" style="border-radius:12px;background:#fff;padding:8px"><div class="small muted" style="margin-top:6px">Ruční zadání: <code>${esc(secret)}</code></div></div>` : ''}
    <form method="post" action="/admin/2fa"><label>Kód</label>${field({ name: 'code', value: '', icon: 'lock', placeholder: '123 456', auto: 'one-time-code', extra: 'inputmode="numeric" required autofocus' })}
    <button class="btn" type="submit">Ověřit ${ICON.arrow}</button></form>
    <p class="foot"><a href="/logout">Odhlásit</a></p>` });
}
const SV = require('./stats-views')({ esc, fmtDT, adminLayout });
function errorPage(title, text, back = '/') {
  return layout({ title, body: `<div class="auth"><div class="card"><h2 style="margin-top:0">${esc(title)}</h2><p class="muted">${esc(text)}</p><a class="btn full" href="${back}">Pokračovat</a></div></div>` });
}

module.exports = { adminPartnerSupport, presenceWidget, PRESENCE_HTML, PRESENCE_CSS, PRESENCE_JS, locVopPage, locGdprPage, adminLayout, ADMIN_NAV, adminSuggestions, adminLive: (...a) => SV.adminLive(...a), adminStats: (...a) => SV.adminStats(...a), adminStatsUser: (...a) => SV.adminStatsUser(...a), consentPage, resetPage, admin2faPage, vopPage, gdprPage, supportPage, adminSupport, adminTransfers, DEFAULT_COLS, esc, layout, loginPage, activatePage, forgotPage, joinPage, supporterHome, supporterCompounder, supporterTeam, supporterNetwork, supporterMine, supporterCredit, supporterProducts, passwordPage, aiChatPage, adminDash, adminSupporters, adminProducts, adminOrders, adminAiChat, setBuild, adminSupporterDetail, adminImport, errorPage };
