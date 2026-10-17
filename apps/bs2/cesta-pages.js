// BS2 — navazující stránky „cesty k rozhodnutí" (/cesta → /cesta/info → vlastní kapitál | financování → schůzka).
// Obsah 1:1 podle původních stránek pradlomaty.info (public/compounder/*.html), vzhled Best Series 2.0:
// stejná hlavička s počítadlem, interaktivní pozadí a patička jako /cesta (z cesta.html se přebírá <head>, styly a skripty).
const fs = require('fs');
const path = require('path');

const CK = '<svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>';

// Doplňkové styly pro karty podstránek (v barvách BS2: azurová → fialová, tmavé skleněné karty)
const EXTRA_CSS = `
  .bx-back{display:table;font-size:13px;color:var(--blue-soft);margin:4px 0 14px}
  .bx-eyebrow{display:flex;align-items:center;gap:9px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--blue-soft);font-weight:600;margin:6px 0 10px}
  .bx-lead{font-size:15.5px;line-height:1.65;color:var(--muted);max-width:560px;margin:14px 0 24px}
  .bx-card{position:relative;border-radius:18px;padding:1px;margin-bottom:26px;
    background:linear-gradient(135deg,rgba(79,209,255,.7),rgba(120,160,255,.12) 45%,rgba(124,92,255,.7));box-shadow:0 34px 90px -34px rgba(30,134,224,.7)}
  .bx-card.green{background:linear-gradient(135deg,rgba(62,224,138,.7),rgba(120,160,255,.14) 45%,rgba(124,92,255,.7))}
  .bx-in{position:relative;background:linear-gradient(180deg,#0f1a33,#080d1c);border-radius:17px;padding:26px 22px;overflow:hidden}
  .bx-in:before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(85% 60% at 50% -12%,rgba(30,134,224,.28),transparent 60%)}
  .bx-card.green .bx-in:before{background:radial-gradient(70% 70% at 50% 0%,rgba(62,224,138,.16),transparent 65%)}
  .bx-center{text-align:center}
  .bx-q-eyebrow{position:relative;display:inline-flex;align-items:center;gap:9px;font-size:12px;letter-spacing:.13em;text-transform:uppercase;color:var(--blue-soft);font-weight:600;margin-bottom:12px}
  .bx-q-h{position:relative;font-size:clamp(22px,5.4vw,30px);font-weight:700;line-height:1.16;letter-spacing:-.01em}
  .bx-q-h .g,.bx-closing .g{background:linear-gradient(90deg,#4fd1ff,#7c5cff);-webkit-background-clip:text;background-clip:text;color:transparent}
  .bx-q-sub{position:relative;font-size:14.5px;line-height:1.6;color:#c3d6e8;margin:12px 0 18px}
  .bx-paths{position:relative;display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .bx-path{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center;border-radius:12px;padding:16px 10px;color:#fff;font-weight:700;font-size:16px;
    background:linear-gradient(90deg,#1e86e0,#3a6cf5 55%,#7c5cff);box-shadow:0 14px 32px -12px rgba(58,108,245,.85);transition:filter .2s,transform .15s}
  .bx-path:hover{filter:brightness(1.08);transform:translateY(-2px)}
  .bx-path small{font-size:12px;font-weight:500;color:rgba(255,255,255,.82)}
  .bx-hr{display:flex;align-items:center;gap:14px;margin:38px 0 26px;color:var(--muted2);font-size:12px;letter-spacing:.14em;text-transform:uppercase}
  .bx-hr:before,.bx-hr:after{content:"";height:1px;flex:1;background:linear-gradient(90deg,transparent,rgba(120,160,255,.35),transparent)}
  .bx-kpis,.bx-items{display:flex;flex-direction:column;gap:12px;margin-bottom:28px}
  .bx-kpi,.bx-item{position:relative;display:flex;gap:14px;align-items:flex-start;background:var(--card);border:1px solid rgba(120,160,255,.18);border-radius:15px;padding:18px 19px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
  .bx-kpi .n{flex:0 0 auto;width:34px;height:34px;border-radius:10px;background:rgba(79,209,255,.12);display:flex;align-items:center;justify-content:center}
  .bx-kpi .n svg{width:19px;height:19px;stroke:var(--blue-soft);fill:none;stroke-width:1.8}
  .bx-kpi h3,.bx-item h3{font-size:16px;font-weight:600;margin-bottom:3px}
  .bx-kpi p,.bx-item p{font-size:14px;color:var(--muted);line-height:1.55}
  .bx-ck{flex:0 0 auto;width:26px;height:26px;border-radius:50%;background:rgba(62,224,138,.16);display:flex;align-items:center;justify-content:center;margin-top:1px}
  .bx-ck svg{width:14px;height:14px;stroke:#3ee08a;fill:none;stroke-width:2.6}
  .bx-rev{display:block!important;text-align:center;padding:24px 18px 22px;overflow:hidden;background:linear-gradient(180deg,#0f1a33,#080d1c)!important;border-color:rgba(79,209,255,.45)!important}
  .bx-rev:before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(70% 80% at 50% 0%,rgba(62,224,138,.13),transparent 65%)}
  .bx-label{position:relative;display:inline-flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.13em;text-transform:uppercase;color:var(--blue-soft);font-weight:600;margin-bottom:12px}
  .bx-label svg{width:16px;height:16px;stroke:#3ee08a;fill:none;stroke-width:2}
  .bx-big{position:relative;white-space:nowrap;font-weight:800;letter-spacing:-.03em;line-height:1;
    background:linear-gradient(90deg,#4fd1ff,#8fd0ff 50%,#7c5cff);-webkit-background-clip:text;background-clip:text;color:transparent}
  .bx-big.rev{font-size:clamp(34px,11vw,60px)} .bx-big.date{font-size:clamp(40px,13vw,68px)} .bx-big.time{font-size:clamp(46px,15vw,76px)}
  .bx-big .dash{font-weight:700;margin:0 .08em;color:#7cc4f8;-webkit-text-fill-color:#7cc4f8}
  .bx-big .cur{font-size:.5em;font-weight:700;letter-spacing:0;margin-left:.14em;color:#a99bff;-webkit-text-fill-color:#a99bff}
  .bx-big .u{font-size:.42em;font-weight:700;letter-spacing:0;margin-left:.12em;color:#a99bff;-webkit-text-fill-color:#a99bff}
  .bx-per{position:relative;font-size:15px;color:#dceaf6;font-weight:500;margin-top:10px}
  .bx-note{position:relative;font-size:12px;color:var(--muted2);margin-top:6px}
  .bx-ms-label{position:relative;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#3ee08a;font-weight:700;margin-bottom:10px}
  .bx-ms-title{position:relative;font-size:clamp(18px,4.6vw,22px);font-weight:700;margin-top:14px;line-height:1.3}
  .bx-ms-sub{position:relative;font-size:14.5px;color:#c3d6e8;margin-top:6px}
  .bx-sec-h{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--blue-soft);font-weight:600;margin:0 0 10px}
  .bx-closing{text-align:center;margin:6px 0 22px}
  .bx-closing h2{font-size:clamp(22px,5.6vw,30px);font-weight:800;line-height:1.18;letter-spacing:-.01em}
  .bx-closing p{font-size:15px;color:#c3d6e8;margin-top:8px}
  .bx-alt{display:block;text-align:center;margin-top:14px;font-size:14px;color:var(--blue-soft)}
  .bx-disc{margin-top:22px;text-align:center;font-size:11.5px;color:var(--muted2);opacity:.8}
`;

let _parts = null;
function parts() {
  if (_parts) return _parts;
  const base = fs.readFileSync(path.join(__dirname, 'cesta.html'), 'utf8');
  const wrapAt = base.indexOf('<div class="wrap">');
  const footAt = base.indexOf('<div class="lfoot">');
  if (wrapAt < 0 || footAt < 0) throw new Error('cesta.html: chybí .wrap nebo .lfoot');
  const footEnd = base.indexOf('</div>', footAt) + 6;
  // skripty za patičkou: první (reveal + infoBtn) nahradíme vlastním, zbytek (síť bodů) ponecháme
  const tail = base.slice(footEnd).replace(/<script>\s*\(function\(\)\{\s*"use strict";[\s\S]*?<\/script>/, '');
  _parts = {
    head: base.slice(0, wrapAt).replace('</style>', EXTRA_CSS + '</style>'),
    foot: base.slice(footAt, footEnd),
    tail,
  };
  return _parts;
}

// Odkazy s data-keep si nesou parametry z SMS/reklamy (t, utm…), ať se rezervace spáruje s leadem.
const KEEP_JS = `<script>(function(){var q=location.search||'';document.querySelectorAll('a[data-keep]').forEach(function(a){a.href=a.getAttribute('href')+q;});
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{threshold:.12});document.querySelectorAll('.reveal').forEach(function(el){io.observe(el);});})();</script>`;

function page(title, desc, main, booking) {
  const p = parts();
  const head = p.head
    .replace(/<title>[\s\S]*?<\/title>/, '<title>' + title + ' · Best Series 2.0</title>')
    .replace(/<meta name="description"[^>]*>/, '<meta name="description" content="' + desc + '" />');
  return head + '<div class="wrap">\n' + main + '\n  </div>\n' + p.foot + '\n' + KEEP_JS + (booking ? '<script src="/cesta/booking.js"></script>' : '') + p.tail;
}

const item = (h, t) => `<div class="bx-item"><span class="bx-ck">${CK}</span><div><h3>${h}</h3><p>${t}</p></div></div>`;
const bookCard = (pathKey) => `<div class="bx-card" id="bookCard"><div class="bx-in">
        <p class="bx-q-eyebrow"><span class="pulse-dot"></span> Druhý nejdůležitější krok · 17,5 minuty</p>
        <div data-booking${pathKey ? ` data-path="${pathKey}"` : ''}></div>
      </div></div>`;

function infoPage() {
  return page('Prádlomat — klíčové informace', 'To nejdůležitější o podnikání se samoobslužným prádlomatem 24/7 — výnos, servis a připravená místa. A první klíčová otázka: jak prádlomat pořídíte.', `
    <a class="bx-back" data-keep href="/cesta">← zpět</a>
    <p class="bx-eyebrow">To nejdůležitější</p>
    <h1>Podnikání s <span class="g">prádlomatem 24/7</span></h1>
    <p class="bx-lead">Samoobslužná prádelna, která běží nonstop bez obsluhy. Vy vlastníte lokalitu a prádlomat — o zbytek se postaráme my.</p>

    <div class="bx-card reveal in"><div class="bx-in">
      <p class="bx-q-eyebrow"><span class="pulse-dot"></span> První klíčová otázka</p>
      <h2 class="bx-q-h">Jak prádlomat <span class="g">pořídíte?</span></h2>
      <p class="bx-q-sub">Z vlastních zdrojů, nebo přes financování? Vyberte cestu, která je vám bližší — ukážeme vám, jak funguje a co pro vás znamená.</p>
      <div class="bx-paths">
        <a class="bx-path" data-keep href="/cesta/vlastni-kapital">Vlastní kapitál<small>z vlastních zdrojů →</small></a>
        <a class="bx-path" data-keep href="/cesta/financovani">Financování<small>splátky z výnosu →</small></a>
      </div>
    </div></div>

    <div class="bx-hr">Proč prádlomat</div>

    <div class="bx-kpis reveal">
      <div class="bx-kpi bx-rev">
        <p class="bx-label"><svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>Výnos jednoho prádlomatu</p>
        <div class="bx-big rev">40<span class="dash">–</span>120<span class="cur">tis.&nbsp;Kč</span></div>
        <p class="bx-per">měsíčně v ČR</p>
        <p class="bx-note">Podle lokality, spádové oblasti a vytížení.</p>
      </div>
      <div class="bx-kpi"><span class="n"><svg viewBox="0 0 24 24"><path d="M14 7l3 3-9 9H5v-3z"/><path d="M13 4l3 3"/></svg></span><div><h3>Servis a provoz zajistíme kompletně</h3><p>Instalaci, zaškolení, dálkový dohled, údržbu i infolinku — všechno bereme na sebe. Vy se staráte jen o svůj příjem.</p></div></div>
      <div class="bx-kpi"><span class="n"><svg viewBox="0 0 24 24"><path d="M12 21s-7-6.1-7-12a7 7 0 1 1 14 0c0 5.9-7 12-7 12z"/><circle cx="12" cy="9" r="2.6"/></svg></span><div><h3>Místa máme pro vás připravená</h3><p>Předjednané lokality s dobrou spádovostí a parkováním. Vybereme spolu tu nejlepší právě pro vás.</p></div></div>
    </div>`, false);
}

function vlastniPage() {
  return page('Prádlomat — Vlastní kapitál', 'Prádlomat z vlastních zdrojů: celý výnos zůstává vám, bez splátek.', `
    <a class="bx-back" data-keep href="/cesta/info">← zpět</a>
    <p class="bx-eyebrow"><span class="pulse-dot"></span>Cesta 1 · Vlastní kapitál</p>
    <h1>Prádlomat z <span class="g">vlastních zdrojů</span></h1>
    <p class="bx-lead">Prádlomat pořídíte ze svého a celý výnos zůstává vám — bez splátek a bez závazků vůči třetí straně.</p>
    <div class="bx-items">
      ${item('Celý výnos je váš', 'Žádné splátky, které by ukrajovaly z měsíčního příjmu.')}
      ${item('Nejrychlejší rozjezd', 'Bez schvalování financování — od rozhodnutí rovnou k instalaci.')}
      ${item('Servis a místo zajistíme', 'Provoz, údržbu i připravenou lokalitu řešíme za vás, stejně jako u financování.')}
    </div>
    ${bookCard('vlastni')}
    <a class="bx-alt" data-keep href="/cesta/financovani">Zajímá vás spíš financování? →</a>`, true);
}

function financovaniPage() {
  return page('Prádlomat — Financování', 'Prádlomat přes financování: nemusíte mít celou částku hned.', `
    <a class="bx-back" data-keep href="/cesta/info">← zpět</a>
    <p class="bx-eyebrow"><span class="pulse-dot"></span>Cesta 2 · Financování</p>
    <h1>Prádlomat přes <span class="g">financování</span></h1>
    <p class="bx-lead">Nemusíte mít celou částku hned. A od teď to platí víc než kdy dřív.</p>
    <div class="bx-card green"><div class="bx-in bx-center">
      <p class="bx-ms-label">Den, který změnil historii prádlomatu</p>
      <div class="bx-big date">24. 9. 2026</div>
      <p class="bx-ms-title">Po 7 letech tvrdé práce</p>
      <p class="bx-ms-sub">bankovní domy zalistovaly prádlomat a jeho byznys model jako financovatelný.</p>
    </div></div>
    <p class="bx-sec-h">Co to pro vás znamená</p>
    <div class="bx-items">
      ${item('Prádlomat ručí sám za sebe', 'Podobně jako nemovitost — zárukou financování je samotný prádlomat a jeho výnos.')}
      ${item('Financování i pro nové firmy', 'Pořídit ho můžete i jako nově vzniklý subjekt — bez dlouhé historie hospodaření.')}
      ${item('Rámec podle vás', 'Schválit se dá v podstatě jakýkoli rámec. Je jen na vás, na kolik prádlomatů se cítíte.')}
    </div>
    <div class="bx-closing"><h2>Příležitost <span class="g">století</span></h2><p>A je na každém, kdo u toho bude.</p></div>
    ${bookCard('financovani')}
    <a class="bx-alt" data-keep href="/cesta/vlastni-kapital">Máte vlastní zdroje? Podívejte se na tuto cestu →</a>
    <p class="bx-disc">Konkrétní podmínky a schválení financování stanovuje financující partner.</p>`, true);
}

function schuzkaPage() {
  return page('Prádlomat — Schůzka 17,5 minuty', 'Druhý nejdůležitější krok: 17,5 minuty, po kterých budete vědět, jestli je prádlomat pro vás. Online nebo osobně.', `
    <a class="bx-back" data-keep href="/cesta/info">← zpět</a>
    <div id="intro">
      <p class="bx-eyebrow"><span class="pulse-dot"></span>Druhý nejdůležitější krok</p>
      <h1>Schůzka, po které <span class="g">budete vědět</span></h1>
      <p class="bx-lead">Nebudeme vám nic prodávat. Během krátkého rozhovoru společně zjistíme, jestli je prádlomat pro vás — a jestli má smysl jít dál.</p>
      <div class="bx-card green"><div class="bx-in bx-center">
        <p class="bx-ms-label">Přesně tolik vám zabere</p>
        <div class="bx-big time">17,5<span class="u">minuty</span></div>
        <p class="bx-ms-title">Míň než jedna epizoda seriálu</p>
        <p class="bx-ms-sub">Ani minutu navíc. Vážíme si vašeho času stejně jako svého.</p>
      </div></div>
      <p class="bx-sec-h">Co si z těch 17,5 minut odnesete</p>
      <div class="bx-items">
        ${item('Jasnou odpověď, jestli je to pro vás', 'Upřímně a bez tlaku. Rozhodujeme se oba — prádlomat svěřujeme jen partnerům, se kterými si sedneme.')}
        ${item('Čísla pro vaši lokalitu', 'Kolik může prádlomat vydělávat právě u vás a jak vypadá financování ve vašem případě.')}
        ${item('Další krok jasně na stole', 'Odejdete s konkrétním plánem: co, kdy a jak — ať se rozhodnete ano, nebo ne.')}
      </div>
    </div>
    <div class="bx-card"><div class="bx-in"><div data-booking></div></div></div>
    <p class="bx-disc">Termín potvrdíme zprávou. Kdyby vám nevyhovoval, jednoduše se ozvete a přesuneme ho.</p>`, true);
}

// Rezervační widget (kopie public/compounder/booking.js) – API jde přes proxy BS2 /api/cesta/* → HolyOS, barvy BS2.
let _booking = null;
function bookingJs() {
  if (_booking) return _booking;
  _booking = fs.readFileSync(path.join(__dirname, 'cesta-booking.js'), 'utf8')
    .split('/api/compounder/').join('/api/cesta/')
    .split('linear-gradient(135deg,#1e86e0,#3aa0f0)').join('linear-gradient(90deg,#1e86e0,#3a6cf5 55%,#7c5cff)')
    .split('#0e1e33').join('rgba(8,13,26,.85)')
    .split('#12294a').join('#121c38')
    .split('#4aa3ea').join('#4fd1ff');
  return _booking;
}

module.exports = { infoPage, vlastniPage, financovaniPage, schuzkaPage, bookingJs };
