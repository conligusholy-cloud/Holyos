// Laundromats — jednotná horní lišta pro všechny stránky (vzhled jako /cesta/ekonomika).
// Logo + Laundromats.eu, navigace, počítadlo „právě si prohlíží" (doplní server do mezery), přepínač jazyka (jen /cesta), Probrat můj záměr.
'use strict';
const LOGO = '<span style="margin-right:10px;display:inline-flex"><svg width="34" height="34" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="lmg" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse"><stop stop-color="#4fd1ff"/><stop offset=".55" stop-color="#3a6cf5"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs><rect x="2" y="2" width="60" height="60" rx="17" fill="#0b1220"/><rect x="2.75" y="2.75" width="58.5" height="58.5" rx="16.5" stroke="url(#lmg)" stroke-width="1.5"/><circle cx="32" cy="34" r="15" stroke="url(#lmg)" stroke-width="3.5"/><circle cx="32" cy="34" r="8" stroke="url(#lmg)" stroke-width="2.5" stroke-opacity=".6"/><circle cx="20" cy="16" r="2" fill="#4fd1ff"/><circle cx="27" cy="16" r="2" fill="#7c5cff"/></svg></span>';
const MAIN_URL = () => String(process.env.PUBLIC_URL || 'https://laundromats.eu').replace(/\/$/, '');
const APPS_URL = () => String(process.env.LM_APPS_URL || 'https://lokality.laundromats.eu').replace(/\/$/, '');
const homeHref = () => (process.env.LM_HOME_LIVE === '1' ? '/' : '/uvod');
const T = {
  cs: { why: 'Proč prádlomat', comp: 'Compounder', prad: 'Prádlomaty', eco: 'Ekonomika', find: 'Najít místo', eval: 'Zhodnotit místo', cta: 'Probrat můj záměr' },
  pl: { why: 'Dlaczego pralnia', comp: 'Compounder', prad: 'Pralnie', eco: 'Ekonomika', find: 'Znajdź miejsce', eval: 'Oceń miejsce', cta: 'Omów mój plan' },
};
// opts: { absolute: odkazy na hlavní web absolutně (subdoména aplikací), lang: 'cs'|'pl' }
function header(opts) {
  const o = opts || {}; const t = T[o.lang] || T.cs;
  // Cesta (funel /cesta…): bez menu a bez tlačítka — jen logo, štítek, počítadlo a přepínač jazyka
  if (o.minimal) return '<header class="lhdr" id="lhdr"><div class="in"><a class="brand" href="' + (o.lang === 'pl' ? '/cesta/pl' : '/cesta') + '">' + LOGO + '<span class="name">Laundromats<span>.eu</span></span></a><span class="htag">Jak to u nás probíhá</span><span class="lsp"></span><span style="margin-left:auto"></span></div></header>';
  const m = o.absolute ? MAIN_URL() : '';
  const home = m + homeHref();
  const items = [
    [home + '#proc', t.why, 'home'],
    [m + '/cesta/compounder', t.comp, 'compounder'],
    [m + '/cesta/pradlomaty', t.prad, 'pradlomaty'],
    [m + (o.lang === 'pl' ? '/cesta/pl/ekonomika' : '/cesta/ekonomika'), t.eco, 'ekonomika'],
    [m + '/cesta/hledat', t.find, 'hledat'],
    [m + '/cesta/zhodnotit', t.eval, 'zhodnotit'],
  ];
  return '<header class="lhdr" id="lhdr"><div class="in"><a class="brand" href="' + home + '" aria-label="Laundromats">' + LOGO + '<span class="name">Laundromats<span>.eu</span></span></a>'
    + '<nav class="lnav" aria-label="Navigace">' + items.map(([h, l, k]) => '<a href="' + h + '" data-k="' + k + '">' + l + '</a>').join('') + '</nav>'
    + '<span class="lsp"></span>'
    // Pravá část lišty jako jeden blok — počítadlo, přepínač jazyka a CTA se tak
    // nikdy nepotkají s navigací. Kotva '<span style="margin-left:auto"></span>'
    // MUSÍ zůstat doslova: server do ní vkládá počítadlo (před ni) a jazyk (za ni).
    + '<div class="lright"><span style="margin-left:auto"></span>'
    + '<a class="lcta" href="' + home + '#kontakt">' + t.cta + '</a></div></div></header>'
    + '<script>(function(){var p=location.pathname,k=/\\/compounder/.test(p)?"compounder":/\\/pradlomaty/.test(p)?"pradlomaty":/ekonomika/.test(p)?"ekonomika":/\\/hledat/.test(p)?"hledat":/\\/zhodnotit/.test(p)?"zhodnotit":"";if(k){var e=document.querySelector(\'.lnav a[data-k="\'+k+\'"]\');if(e)e.classList.add("on");}})();</script>';
}
const FONT = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">';
const CSS = '.lhdr{position:sticky;top:0;z-index:60;background:rgba(4,6,12,.72);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid rgba(120,160,255,.14);padding:10px 18px;padding-top:calc(10px + env(safe-area-inset-top));font-family:\'Inter\',system-ui,Arial,sans-serif;color:#eaf1ff}'
  + '.lhdr .in{max-width:1320px;margin:0 auto;display:flex;align-items:center;gap:12px;flex-wrap:nowrap}'
  + '.lhdr .brand{display:inline-flex;align-items:center;gap:0;text-decoration:none;color:#eaf1ff;flex:none}'
  + '.lhdr .brand .name{font-size:15px;letter-spacing:.02em;font-weight:700}'
  + '.lhdr .brand .name span{background:linear-gradient(90deg,#4fd1ff,#7c5cff);-webkit-background-clip:text;background-clip:text;color:transparent}'
  + '.lhdr .lnav{display:flex;gap:2px;margin-left:10px;min-width:0;flex:0 1 auto;overflow-x:auto;scrollbar-width:none}'
  + '.lhdr .lnav::-webkit-scrollbar{display:none}'
  + '.lhdr .lnav a{white-space:nowrap;padding:6px 10px;border-radius:999px;font-size:13px;font-weight:500;color:#a9b8d6;text-decoration:none;border:1px solid transparent;transition:color .15s,background .15s}'
  + '.lhdr .lnav a:hover{color:#fff;background:rgba(255,255,255,.04)}'
  + '.lhdr .lnav a.on{color:#fff;border-color:rgba(120,160,255,.28);background:rgba(79,209,255,.08)}'
  + '.lhdr .lsp{flex:1 1 0;min-width:8px}'
  + '.lhdr .lright{display:flex;align-items:center;gap:10px;flex:none}'
  + '.lhdr .lcta{flex:none;white-space:nowrap;padding:7px 14px;border-radius:999px;font-size:12.5px;font-weight:700;color:#fff;text-decoration:none;background:linear-gradient(90deg,#1e86e0,#7c5cff);box-shadow:0 6px 20px -8px rgba(79,120,255,.7)}'
  + '.lhdr .htag{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#a9b8d6;border:1px solid rgba(120,160,255,.14);border-radius:999px;padding:3px 9px;background:rgba(255,255,255,.02);white-space:nowrap;margin-left:12px}@media(max-width:520px){.lhdr .htag{display:none}}'
  + '@media(max-width:980px){.lhdr .in{flex-wrap:wrap;row-gap:8px}.lhdr .lnav{order:9;flex-basis:100%;margin:0 -18px;padding:0 18px;overflow-x:auto;scrollbar-width:none}.lhdr .lnav::-webkit-scrollbar{display:none}}'
  + '@media(max-width:520px){.lhdr .lcta{display:none}.lhdr .presence .pt{display:none}}';
// Počítadlo „právě si prohlíží" — patří k horní liště, proto bydlí tady.
// Potřebují ho obě vrstvy: stránky webu (server.js) i stránky aplikací (lm-layout.js),
// která si ho bere jako lm-header.PRES_* — bez tohoto exportu do nich teklo „undefined".
const PRES_HTML = '<span class="presence" id="presence" title="Právě online + aktivní lidé za posledních 60 minut (klouzavé okno)"><i></i><span class="pt">právě si prohlíží </span><b id="pr-hour">–</b></span>';
const PRES_CSS = '.presence{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;border:1px solid rgba(47,227,160,.35);background:rgba(47,227,160,.08);color:#a9f5d9;font-size:12px;font-weight:500;white-space:nowrap;transition:box-shadow .3s,background .3s;font-family:inherit;margin-left:12px}.presence i{width:7px;height:7px;border-radius:50%;background:#2fe3a0;box-shadow:0 0 8px #2fe3a0;animation:prpulse 2s infinite}.presence b{font-weight:800;color:#fff}.presence.flash{box-shadow:0 0 0 2px rgba(47,227,160,.5),0 0 22px rgba(47,227,160,.75);background:rgba(47,227,160,.22)}.presence.flash b{text-shadow:0 0 10px #2fe3a0}@keyframes prpulse{0%,100%{opacity:1}50%{opacity:.45}}@media(max-width:520px){.lhdr{padding-left:12px;padding-right:12px}.lhdr .in{gap:8px}.lhdr .brand{flex:none;min-width:0}.lhdr .brand>span:first-child{margin-right:7px!important}.lhdr .brand svg{width:30px;height:30px}.lhdr .brand .name{font-size:14px}.lsw{flex:none;margin-right:0!important}.presence{margin-left:2px;padding:3px 9px;font-size:11px}}@media(max-width:420px){.presence .pt{display:none}.lhdr .brand .name{font-size:13px}}';
const PRES_JS = '(function(){var el=document.getElementById("presence");if(!el)return;var h=document.getElementById("pr-hour"),last="";var sid;try{sid=localStorage.getItem("lm_sid");if(!sid){var cm=document.cookie.match(/(?:^|; )lm_sid=([^;]+)/);if(cm){sid=decodeURIComponent(cm[1]);localStorage.setItem("lm_sid",sid);}}if(!sid){sid="lm-"+Date.now().toString(36)+Math.random().toString(36).slice(2,10);localStorage.setItem("lm_sid",sid);}}catch(e){sid="lm-x"+Date.now().toString(36);}'
  + 'function ping(){try{fetch("/api/presence/ping",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sid:sid}),keepalive:true});}catch(e){}}'
  + 'function upd(){fetch("/api/presence",{cache:"no-store"}).then(function(r){return r.ok?r.json():null;}).then(function(j){if(!j)return;var v=j.total,k=String(v);h.textContent=v;if(last&&k!==last){el.classList.add("flash");setTimeout(function(){el.classList.remove("flash");},1400);}last=k;}).catch(function(){});}'
  + 'ping();setTimeout(upd,400);setInterval(function(){if(document.visibilityState==="visible"){ping();upd();}},15000);})();';

module.exports = { header, CSS, FONT, LOGO, PRES_HTML, PRES_CSS, PRES_JS };
