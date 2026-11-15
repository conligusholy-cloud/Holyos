// HolyOS — Laundromat Tycoon: sdílená pozvánka do hry (náhled odkazu na Facebooku, WhatsAppu, Messengeru…)
// =============================================================================
// Když hráč sdílí svůj odkaz pradlomaty.info/game?ref=<kód>, sociální sítě si stáhnou
// og:title / og:description / og:image. Tady:
//   • metaZnacky(ref, host) → personalizované OG značky do <head> stránky hry
//   • obrazek(ref)          → PNG 1200×630 „pozvánka" (jméno zvoucího, jeho firma, co dostaneš)
// Obrázek se kreslí v headless Chromiu (puppeteer, stejně jako PDF faktur) a drží se v paměti.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { prisma } = require('../../config/database');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GAME_DIR = path.join(__dirname, '..', '..', 'public', 'compounder', 'game');

// Kdo zve (podle ref_id ze sdíleného odkazu). Bez kódu / neznámý kód = obecná pozvánka.
async function zvouci(ref) {
  const r = String(ref || '').trim();
  if (!/^[a-z0-9]{6,24}$/i.test(r)) return null;
  try {
    const p = await prisma.gamePlayer.findUnique({ where: { ref_id: r }, select: { id: true, nick: true, company: true, state: true, disabled: true } });
    if (!p || p.disabled) return null;
    const units = p.state && Array.isArray(p.state.units) ? p.state.units.length : 0;
    return { nick: p.nick || 'Hráč', firma: p.company || '', units };
  } catch (e) { return null; }
}
const prad = (n) => (n === 1 ? 'prádlomat' : n >= 2 && n <= 4 ? 'prádlomaty' : 'prádlomatů');

// OG / Twitter značky pro stránku hry
async function metaZnacky(ref, origin) {
  const z = await zvouci(ref);
  const title = z ? `${z.nick} tě zve do hry Laundromat Tycoon 🎮` : 'Laundromat Tycoon — postav největší síť prádlomatů';
  const desc = z
    ? `${z.firma ? z.firma + ' už staví' : z.nick + ' staví'} síť prádlomatů${z.units ? ' (' + z.units + ' ' + prad(z.units) + ')' : ''} na skutečné mapě. Přidej se — dostaneš 1 550 000 L$ do začátku a hraješ hned, bez e-mailu a hesla.`
    : 'Skutečná mapa, skutečná ekonomika. Postav první prádlomat za 60 sekund a vybuduj síť po celé zemi. Hraješ hned, bez e-mailu a hesla.';
  const img = origin + '/game/pozvanka.png' + (z ? '?ref=' + encodeURIComponent(ref) : '');
  const url = origin + '/game' + (z ? '?ref=' + encodeURIComponent(ref) : '');
  return [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Laundromat Tycoon">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(z ? 'Pozvánka do hry od ' + z.nick : 'Laundromat Tycoon')}">`,
    `<meta property="og:locale" content="cs_CZ">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${esc(img)}">`,
  ].join('\n');
}

// ── Obrázek pozvánky ─────────────────────────────────────────────────────────
let _browser = null;
async function prohlizec() {
  if (_browser && _browser.isConnected()) return _browser;
  const puppeteer = require('puppeteer');
  _browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'] });
  return _browser;
}
let _flex = null;
function flexDataUrl() {
  if (_flex !== null) return _flex;
  try { _flex = 'data:image/webp;base64,' + fs.readFileSync(path.join(GAME_DIR, 'flex.webp')).toString('base64'); } catch (e) { _flex = ''; }
  return _flex;
}
const cache = new Map(); // klíč → { at, png }

function html(z) {
  const hl = z ? `<div class="kdo"><span class="ava">${esc((z.nick || '?').slice(0, 1).toUpperCase())}</span><div><b>${esc(z.nick)}</b>${z.firma ? `<i>${esc(z.firma)}</i>` : ''}</div></div>
      <h1>tě zve do hry</h1>` : `<h1 class="obec">Postav největší<br>síť prádlomatů</h1>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1200px;height:630px;overflow:hidden;font-family:'Liberation Sans',Arial,sans-serif;color:#eef4ff;
    background:radial-gradient(900px 500px at 85% 30%,rgba(124,92,255,.35),transparent 60%),radial-gradient(700px 500px at 10% 90%,rgba(79,209,255,.22),transparent 60%),linear-gradient(135deg,#050914,#0b1430 60%,#120c2e)}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(120,160,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(120,160,255,.07) 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(180deg,transparent,#000 40%,#000)}
  .l{position:absolute;left:64px;top:56px;width:640px}
  .brand{display:flex;align-items:center;gap:14px;font-weight:800;font-size:26px;letter-spacing:-.01em;margin-bottom:34px}
  .brand .m{width:52px;height:52px;border-radius:15px;background:#0b1220;border:2px solid #4fd1ff;display:grid;place-items:center;font-size:28px}
  .brand .g{background:linear-gradient(90deg,#ffe9a8,#f0a92b);-webkit-background-clip:text;color:transparent}
  .kdo{display:flex;align-items:center;gap:16px;margin-bottom:6px}
  .ava{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:30px;background:linear-gradient(135deg,#4fd1ff,#7c5cff);color:#06101f}
  .kdo b{display:block;font-size:40px;line-height:1.05;letter-spacing:-.02em}.kdo i{display:block;font-style:normal;color:#a9b8d3;font-size:22px;margin-top:4px}
  h1{font-size:64px;line-height:1.02;letter-spacing:-.035em;font-weight:800;background:linear-gradient(90deg,#4fd1ff,#9db8ff 50%,#a78bfa);-webkit-background-clip:text;color:transparent;margin:6px 0 22px}
  h1.obec{font-size:70px}
  .pts{display:flex;flex-direction:column;gap:12px}
  .pt{display:flex;align-items:center;gap:12px;font-size:24px;color:#dbe6ff}.pt .ic{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font-size:22px;background:rgba(79,209,255,.12);border:1px solid rgba(79,209,255,.35)}
  .pt b{color:#ffd866}
  .cta{position:absolute;left:64px;bottom:50px;display:inline-flex;align-items:center;gap:12px;padding:16px 28px;border-radius:16px;font-size:26px;font-weight:800;color:#06101f;background:linear-gradient(90deg,#4fd1ff,#7c5cff);box-shadow:0 12px 40px rgba(79,209,255,.35)}
  .r{position:absolute;right:30px;top:70px;width:470px;height:500px;display:grid;place-items:center}
  .glow{position:absolute;width:420px;height:420px;border-radius:50%;background:radial-gradient(circle,rgba(79,209,255,.35),transparent 65%)}
  .r img{position:relative;width:470px;filter:drop-shadow(0 30px 40px rgba(0,0,0,.6))}
  .badge{position:absolute;right:60px;top:52px;padding:10px 18px;border-radius:999px;background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.5);color:#86efac;font-weight:800;font-size:20px}
  .url{position:absolute;right:64px;bottom:58px;color:#6b7d9e;font-size:20px;font-weight:700}
  </style></head><body><div class="grid"></div>
  <div class="l"><div class="brand"><div class="m">🧺</div><span>Laundromat <span class="g">Tycoon</span></span></div>
    ${hl}
    <div class="pts">
      <div class="pt"><span class="ic">🗺️</span>Skutečná mapa, skutečná ekonomika</div>
      <div class="pt"><span class="ic">💰</span><span><b>1 550 000 L$</b> do začátku + bonus za rychlý start</span></div>
      <div class="pt"><span class="ic">⚡</span>Hraješ hned — bez e-mailu a hesla</div>
    </div></div>
  <div class="cta">▶ Přijmout pozvánku</div>
  <div class="badge">🎁 Hra zdarma</div>
  <div class="r"><div class="glow"></div>${flexDataUrl() ? `<img src="${flexDataUrl()}" alt="">` : ''}</div>
  <div class="url">pradlomaty.info/game</div>
  </body></html>`;
}

async function obrazek(ref) {
  const z = await zvouci(ref);
  const key = z ? 'r:' + String(ref) + ':' + z.nick + ':' + z.firma : 'obecna';
  const c = cache.get(key);
  if (c && Date.now() - c.at < 6 * 3600e3) return c.png;
  const b = await prohlizec();
  const page = await b.newPage();
  try {
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    await page.setContent(html(z), { waitUntil: 'load', timeout: 20000 });
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
    cache.set(key, { at: Date.now(), png });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return png;
  } finally { await page.close().catch(() => {}); }
}

module.exports = { metaZnacky, obrazek, _html: html };
