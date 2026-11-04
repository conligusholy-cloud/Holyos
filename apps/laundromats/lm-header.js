// Laundromats — jednotná horní lišta pro všechny stránky (vzhled jako /cesta/ekonomika).
// Logo + Laundromats.eu, navigace, počítadlo „právě si prohlíží" (doplní server do mezery), přepínač jazyka (jen /cesta), Probrat můj záměr.
'use strict';
const LOGO = '<span style="margin-right:10px;display:inline-flex"><svg width="34" height="34" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="lmg" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse"><stop stop-color="#4fd1ff"/><stop offset=".55" stop-color="#3a6cf5"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs><rect x="2" y="2" width="60" height="60" rx="17" fill="#0b1220"/><rect x="2.75" y="2.75" width="58.5" height="58.5" rx="16.5" stroke="url(#lmg)" stroke-width="1.5"/><circle cx="32" cy="34" r="15" stroke="url(#lmg)" stroke-width="3.5"/><circle cx="32" cy="34" r="8" stroke="url(#lmg)" stroke-width="2.5" stroke-opacity=".6"/><circle cx="20" cy="16" r="2" fill="#4fd1ff"/><circle cx="27" cy="16" r="2" fill="#7c5cff"/></svg></span>';
const MAIN_URL = () => String(process.env.PUBLIC_URL || 'https://laundromats.eu').replace(/\/$/, '');
const APPS_URL = () => String(process.env.LM_APPS_URL || 'https://lokality.laundromats.eu').replace(/\/$/, '');
const homeHref = () => (process.env.LM_HOME_LIVE === '1' ? '/' : '/uvod');
// Verze aplikace do lišty: číslo z package.json + commit právě nasazeného buildu.
// Číslo se mění, až ho zvýšíš v package.json; commit se mění každým nasazením,
// takže podle něj poznáš, jestli na serveru běží to, co sis pushnul.
function verText() {
  let v = '';
  try { v = require('./package.json').version || ''; } catch (e) { /* bez package.json */ }
  const sha = String(process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7);
  return (v ? 'v' + v : '') + (v && sha ? ' · ' : '') + sha;
}
function verTitle() {
  const msg = String(process.env.RAILWAY_GIT_COMMIT_MESSAGE || '').split('\n')[0].slice(0, 120);
  return 'Verze aplikace' + (msg ? ' — poslední nasazení: ' + msg : '');
}
const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const T = {
  cs: { apps: 'Moje nástroje', why: 'Proč prádlomat', comp: 'Compounder', prad: 'Prádlomaty', eco: 'Ekonomika', find: 'Najít místo', eval: 'Zhodnotit místo', cta: 'Probrat můj záměr' },
  pl: { apps: 'Moje narzędzia', why: 'Dlaczego pralnia', comp: 'Compounder', prad: 'Pralnie', eco: 'Ekonomika', find: 'Znajdź miejsce', eval: 'Oceń miejsce', cta: 'Omów mój plan' },
};
// opts: { absolute: odkazy na hlavní web absolutně (subdoména aplikací), lang: 'cs'|'pl' }
function header(opts) {
  const o = opts || {}; const t = T[o.lang] || T.cs;
  // Cesta (funel /cesta…): bez menu a bez tlačítka — jen logo, štítek, počítadlo a přepínač jazyka
  if (o.minimal) return '<header class="lhdr" id="lhdr"><div class="in"><a class="brand" href="' + (o.lang === 'pl' ? '/cesta/pl' : '/cesta') + '">' + LOGO + '<span class="name">Laundromats<span>.eu</span></span></a><span class="htag">Jak to u nás probíhá</span><span class="lsp"></span><span style="margin-left:auto"></span></div></header>';
  const m = o.absolute ? MAIN_URL() : '';
  const home = m + homeHref();
  const items = [
    [m + '/cesta/compounder', t.comp, 'compounder'],
    [m + '/cesta/pradlomaty', t.prad, 'pradlomaty'],
    [m + '/cesta/ucet/ekonomika', t.eco, 'ekonomika'],
    [m + '/cesta/hledat', t.find, 'hledat'],
    [m + '/cesta/zhodnotit', t.eval, 'zhodnotit'],
  ];
  return '<header class="lhdr" id="lhdr"><div class="in"><a class="brand" href="' + home + '" aria-label="Laundromats">' + LOGO + '<span class="name">Laundromats<span>.eu</span></span></a>'
    // Rozcestník „Moje nástroje" je první — odsud se uživatel dostane ke všemu.
    // <!--PRIV--> bez klíče = vidí ho každý přihlášený (nepřihlášenému se celá položka vyřízne).
    + '<nav class="lnav" aria-label="Navigace">'
      + '<!--PRIV--><a href="' + m + '/cesta/ucet" data-k="ucet">' + t.apps + '</a><!--/PRIV-->'
      + items.map(([h, l, k]) => '<!--PRIV:' + k + '--><a href="' + h + '" data-k="' + k + '">' + l + '</a><!--/PRIV-->').join('') + '</nav>'
    + '<span class="lsp"><!--PRIV--><span class="lver" title="' + esc(verTitle()) + '">' + esc(verText()) + '</span><!--/PRIV--></span><span style="margin-left:auto"></span>'
    + '<!--LACC--></div></header>'
    + '<script>(function(){var p=location.pathname,k=/\\/cesta\\/ucet\\/?$/.test(p)?"ucet":/\\/compounder/.test(p)?"compounder":/\\/pradlomaty/.test(p)?"pradlomaty":/ekonomika/.test(p)?"ekonomika":/\\/hledat/.test(p)?"hledat":/\\/zhodnotit/.test(p)?"zhodnotit":"";if(k){var e=document.querySelector(\'.lnav a[data-k="\'+k+\'"]\');if(e)e.classList.add("on");}})();</script>';
}
const FONT = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">';
const CSS = '.lhdr{position:sticky;top:0;z-index:60;background:rgba(4,6,12,.72);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid rgba(120,160,255,.14);padding:10px 18px;padding-top:calc(10px + env(safe-area-inset-top));font-family:\'Inter\',system-ui,Arial,sans-serif;color:#eaf1ff}'
  + '.lhdr .in{max-width:1280px;margin:0 auto;display:flex;align-items:center;gap:12px}'
  + '.lhdr .brand{display:inline-flex;align-items:center;gap:0;text-decoration:none;color:#eaf1ff;flex:none}'
  + '.lhdr .brand .name{font-size:15px;letter-spacing:.02em;font-weight:700}'
  + '.lhdr .brand .name span{background:linear-gradient(90deg,#4fd1ff,#7c5cff);-webkit-background-clip:text;background-clip:text;color:transparent}'
  + '.lhdr .lnav{display:flex;gap:2px;margin-left:10px;flex:none}'
  + '.lhdr .lnav a{white-space:nowrap;padding:6px 10px;border-radius:999px;font-size:13px;font-weight:500;color:#a9b8d6;text-decoration:none;border:1px solid transparent;transition:color .15s,background .15s}'
  + '.lhdr .lnav a:hover{color:#fff;background:rgba(255,255,255,.04)}'
  + '.lhdr .lnav a.on{color:#fff;border-color:rgba(120,160,255,.28);background:rgba(79,209,255,.08)}'
  + '.lhdr .lmenu{position:relative;flex:none}.lhdr .lmenu>summary{list-style:none;cursor:pointer;display:inline-block}.lhdr .lmenu>summary::-webkit-details-marker{display:none}'
  + '.lhdr .lmenu-b{position:absolute;right:0;top:calc(100% + 8px);min-width:230px;background:#0b1220;border:1px solid rgba(120,160,255,.28);border-radius:14px;padding:6px;box-shadow:0 18px 40px -12px rgba(0,0,0,.8);z-index:70}'
  + '.lhdr .lmenu-h{padding:8px 10px 10px;border-bottom:1px solid rgba(120,160,255,.14);margin-bottom:4px}.lhdr .lmenu-h b{display:block;font-size:13.5px}.lhdr .lmenu-h span{display:block;font-size:12px;color:#8ea2c4;overflow:hidden;text-overflow:ellipsis}'
  + '.lhdr .lmenu-b a,.lhdr .lmenu-b button{display:block;width:100%;text-align:left;padding:9px 10px;border-radius:9px;font:inherit;font-size:13.5px;color:#eaf1ff;text-decoration:none;background:none;border:0;cursor:pointer}.lhdr .lmenu-b a:hover,.lhdr .lmenu-b button:hover{background:rgba(79,209,255,.08)}.lhdr .lmenu-b form{margin:0}'
  + '.lhdr .lacc svg{width:15px;height:15px;vertical-align:-3px;margin-right:2px}.lhdr .lmenu-b svg{width:16px;height:16px;vertical-align:-3px;margin-right:9px;color:#7fd6ff}'
  + '.lhdr .lsp{flex:1;display:flex;align-items:center;justify-content:center;min-width:0}'
  + '.lhdr .lver{font-size:11.5px;color:#8ea2c4;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.01em;font-variant-numeric:tabular-nums}'
  + '@media(max-width:860px){.lhdr .lver{display:none}}'
  + '.lhdr .lacc{flex:none;white-space:nowrap;padding:6px 11px;border-radius:999px;font-size:12.5px;font-weight:600;color:#eaf1ff;text-decoration:none;border:1px solid rgba(120,160,255,.28);background:rgba(255,255,255,.03)}.lhdr .lacc:hover{border-color:rgba(79,209,255,.55)}'
  + '.lhdr .lcta{flex:none;white-space:nowrap;padding:7px 14px;border-radius:999px;font-size:12.5px;font-weight:700;color:#fff;text-decoration:none;background:linear-gradient(90deg,#1e86e0,#7c5cff);box-shadow:0 6px 20px -8px rgba(79,120,255,.7)}'
  + '.lhdr .htag{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#a9b8d6;border:1px solid rgba(120,160,255,.14);border-radius:999px;padding:3px 9px;background:rgba(255,255,255,.02);white-space:nowrap;margin-left:12px}@media(max-width:520px){.lhdr .htag{display:none}}'
  + '@media(max-width:1320px){.lhdr .in{flex-wrap:wrap;row-gap:8px}.lhdr .lnav{order:9;flex-basis:100%;margin:0 -18px;padding:0 18px;overflow-x:auto;scrollbar-width:none}.lhdr .lnav::-webkit-scrollbar{display:none}}'
  + '@media(max-width:520px){.lhdr .lcta{padding:6px 12px;font-size:12px}.lhdr .presence .pt{display:none}.lhdr .in{gap:8px}.lhdr .lmenu-b{right:-8px;min-width:210px}}';
module.exports = { header, CSS, FONT, LOGO };
