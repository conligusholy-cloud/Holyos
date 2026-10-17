// BS2 — Vyhledávač míst (/findlocation): veřejná prodejní stránka aplikace „Najděte nejlepší místo pro prádlomat".
// Vzhled, hlavička, objednávkový formulář a platba (Stripe) se přebírají ze stránky /location (location.js);
// mění se hlavička/hero, obsah a ceník. Aplikace samotná běží po zaplacení na /lokalita/analyza.
const LOC = require('./location');

const fmt = (a) => Math.round(a / 100).toLocaleString('cs-CZ').replace(/ /g, ' ');

// Nahradí úsek [start, end) novým obsahem; chybí-li značka, vrátí text beze změny.
function swap(h, startRe, endRe, repl) {
  const a = h.search(startRe); if (a < 0) return h;
  const rest = h.slice(a);
  const m = rest.search(endRe); if (m < 0) return h;
  return h.slice(0, a) + repl + rest.slice(m);
}

const CSS = `
  .radar{flex:none;width:min(46%,480px);position:relative;aspect-ratio:1/1}
  .radar svg{width:100%;height:100%;display:block;filter:drop-shadow(0 24px 48px rgba(30,134,224,.35))}
  .radar .ring{fill:none;stroke:rgba(79,209,255,.22);stroke-width:1}
  .radar .sweep{transform-origin:200px 200px;animation:fl-spin 5s linear infinite}
  .radar .dot{fill:#4fd1ff;opacity:.15;animation:fl-dot 5s linear infinite}
  .radar .dot.ok{fill:#2fe3a0}
  .radar .me{fill:#fff}
  .radar .pulse{fill:none;stroke:#fff;stroke-width:1.5;transform-origin:200px 200px;animation:fl-pulse 2.4s ease-out infinite}
  @keyframes fl-spin{to{transform:rotate(360deg)}}
  @keyframes fl-pulse{from{transform:scale(.4);opacity:.9}to{transform:scale(2.4);opacity:0}}
  @keyframes fl-dot{0%,100%{opacity:.15;transform:scale(1)}8%{opacity:1;transform:scale(1.8)}35%{opacity:.85;transform:scale(1.2)}}
  .radar .cap{position:absolute;left:50%;bottom:0;transform:translateX(-50%);font-size:12px;color:#fff;background:rgba(5,10,25,.72);border:1px solid var(--border);border-radius:999px;padding:4px 12px;white-space:nowrap}
  .fl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
  .fl-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px 18px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
  .fl-card b{display:block;font-size:26px;font-weight:800;letter-spacing:-.02em;background:linear-gradient(90deg,#fff,var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
  .fl-card span{display:block;font-size:13.5px;color:var(--text2);margin-top:2px}
  @media(max-width:720px){.radar{width:100%;max-width:360px;margin:0 auto}}
  @media(prefers-reduced-motion:reduce){.radar .sweep,.radar .dot,.radar .pulse{animation:none}.radar .dot{opacity:.8}}
`;

// Radar: střed = město, kruh = spádová oblast 15 km, body = kandidátní místa (zeleně ta nejlepší)
function radarSvg() {
  const pts = [[260, 120, 0], [120, 150, 1], [290, 230, 0], [150, 280, 0], [230, 300, 1], [100, 220, 0], [220, 90, 0], [310, 170, 0], [180, 330, 0]];
  const dots = pts.map((p, i) => `<circle class="dot${p[2] ? ' ok' : ''}" cx="${p[0]}" cy="${p[1]}" r="5" style="animation-delay:${(i * 0.55).toFixed(2)}s;transform-origin:${p[0]}px ${p[1]}px"/>`).join('');
  return `<div class="radar" aria-hidden="true"><svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="flbg" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#0d1c3a"/><stop offset="1" stop-color="#050912"/></radialGradient><linearGradient id="flsw" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4fd1ff" stop-opacity="0"/><stop offset="1" stop-color="#4fd1ff" stop-opacity=".55"/></linearGradient></defs><circle cx="200" cy="200" r="190" fill="url(#flbg)" stroke="rgba(120,160,255,.35)"/><circle class="ring" cx="200" cy="200" r="140"/><circle class="ring" cx="200" cy="200" r="90"/><circle class="ring" cx="200" cy="200" r="40"/><path d="M10 200h380M200 10v380" stroke="rgba(120,160,255,.12)"/><g class="sweep"><path d="M200 200 L390 200 A190 190 0 0 0 330 66 Z" fill="url(#flsw)"/></g>${dots}<circle class="pulse" cx="200" cy="200" r="14"/><circle class="me" cx="200" cy="200" r="6"/></svg><span class="cap">Spádová oblast 15 km · kandidátní místa</span></div>`;
}

function hero() {
  return `<section class="hero">
   <div class="txt">
    <span class="eyebrow"><i></i>Webová aplikace Vyhledávač míst</span>
    <h1>Najděte nejlepší místo pro prádlomat <span class="g">za pár minut.</span></h1>
    <p class="lead">Zadejte město. Aplikace spočítá obyvatele v okruhu 15 km, odhadne, kolik prádlomatů oblast uživí, ukáže ty, které už v okolí fungují, a najde konkrétní místa, kde by váš prádlomat mohl stát.</p>
    <div class="cta-row" style="display:flex;gap:10px;flex-wrap:wrap">
      <a class="btn" href="#objednat" data-cta="hero">Chci najít své místo</a>    </div>
    <p class="small" style="margin-top:14px;color:var(--text3)">Aplikaci připravuje Best Series s.r.o., výrobce a provozovatel prádlomatů. Výsledky jsou orientační podklad pro vaše rozhodnutí, ne předpověď výdělku.</p>
   </div>
   ${radarSvg()}
  </section>`;
}

function how() {
  return `<section class="sec" id="jak">
    <h2>Jak to funguje</h2>
    <div class="list">
      <div class="item"><div class="n">1</div><div><b>Zadáte město</b><span>Stačí název obce nebo města. V aplikaci můžete klepnout i přímo do mapy, když je město velké a chcete hledat kolem konkrétního bodu.</span></div></div>
      <div class="item"><div class="n">2</div><div><b>Aplikace analyzuje spádovou oblast</b><span>Počet obyvatel v okruhu 15 km, odhad kapacity oblasti (kolik prádlomatů uživí) a prádlomaty, které už v okolí fungují.</span></div></div>
      <div class="item"><div class="n">3</div><div><b>Najde místa, kde by prádlomat mohl stát</b><span>Supermarkety, benzínky, myčky a další tahouny provozu v okolí. U každého hodnotí parkování, konkurenci a sousední provozy, abyste věděli, kam zavolat jako první.</span></div></div>
      <div class="item"><div class="n">4</div><div><b>Vybrané místo rovnou prověříte</b><span>Výsledek přenesete do nové lokality a spočítáte ekonomiku prádlomatu: scénáře, bod zvratu, návratnost a export do PDF.</span></div></div>
    </div>
  </section>

  <section class="sec">
    <h2>Co zjistíte o městě</h2>
    <div class="fl-grid">
      <div class="fl-card"><b>15 km</b><span>spádová oblast kolem města s počtem obyvatel</span></div>
      <div class="fl-card"><b>Kapacita</b><span>odhad, kolik prádlomatů oblast uživí</span></div>
      <div class="fl-card"><b>Konkurence</b><span>už fungující prádlomaty v okolí na mapě</span></div>
      <div class="fl-card"><b>Místa</b><span>konkrétní kandidáti s hodnocením parkování a okolí</span></div>
    </div>
    <p class="small" style="color:var(--text3);margin-top:10px">Údaje pocházejí z veřejných zdrojů a modelových předpokladů a jsou orientační. Každé město lze analyzovat jednou, výsledek se trvale uloží ve vašem účtu.</p>
  </section>`;
}

function what() {
  return `<section class="sec">
    <h2>Co dostanete</h2>
    <div class="list">
      <div class="item"><div class="n">1</div><div><b>Přístup do webové aplikace na 12 měsíců</b><span>Jednorázová platba, přístup se automaticky placeně neobnovuje. Funguje v mobilu i na počítači.</span></div></div>
      <div class="item"><div class="n">2</div><div><b>Vyhledávač míst</b><span>Analýza spádové oblasti města a seznam míst, kde by prádlomat mohl stát. Počet vyhledání se liší podle balíčku, další můžete kdykoli dokoupit.</span></div></div>
      <div class="item"><div class="n">3</div><div><b>Kalkulačka ekonomiky a vyhodnocení lokality</b><span>Vybrané místo prověříte: investice, nájem, energie, servis, scénáře slabý / střední / silný, bod zvratu a návratnost. Report si stáhnete do PDF pro banku, společníka nebo pronajímatele.</span></div></div>
    </div>
    <p class="small" style="color:var(--text3);margin-top:10px">Výstup je automatický orientační podklad, nikoli odborné schválení investice. Rozhodnutí Best Series o prodeji stroje na konkrétní místo je samostatný krok nezávislý na výsledku aplikace.</p>
  </section>`;
}

function prices(limits, searchLimits) {
  const P = { basic: { amount: LOC.FINDER_PRICES.basic }, plus: { amount: LOC.FINDER_PRICES.plus }, premium: { amount: LOC.FINDER_PRICES.premium } }, L = limits || {}, S = searchLimits || {};
  const s1 = fmt(LOC.EVAL_PACKS.search1.amount);
  const card = (key, title, hi, extra) => `<div class="price${hi ? ' hi' : ''}">
        <div class="tag">${title}</div>
        <div class="amt">${fmt(P[key].amount)} <small>Kč s DPH · jednorázově</small></div>
        <ul><li>Přístup do aplikace na 12 měsíců</li><li>Vyhledávač míst – ${S[key] != null ? S[key] : 1} ${(S[key] || 1) === 1 ? 'vyhledání města' : (S[key] || 1) < 5 ? 'vyhledání měst' : 'vyhledání měst'}</li><li>Vyhodnocení ${L[key] || (key === 'basic' ? 3 : 10)} různých adres</li>${extra}<li>Export výsledků do PDF</li></ul>
        <a class="btn${hi ? '' : ' sec'}" href="#objednat" data-cta="${key}" onclick="pickVariant('${key}')">Vybrat ${title}</a>
      </div>`;
  return `<section class="sec" id="cena">
    <h2>Cena</h2>
    <div class="prices">
      ${card('basic', 'Základ', true, '')}
      ${card('plus', 'Plus', false, '<li>Porovnání lokalit vedle sebe</li><li>Jeden 30minutový konzultační hovor</li>')}
      ${card('premium', 'Premium', false, '<li>Vše z Plus</li><li>Místní šetření naším technikem na jedné lokalitě</li>')}
    </div>
    <p class="small" style="color:var(--text3);margin-top:10px">Další vyhledání měst lze dokoupit v aplikaci, cena od ${s1} Kč s DPH za vyhledání.</p>
  </section>`;
}

function faq() {
  return `<section class="sec">
    <h2>Časté otázky</h2>
    <details><summary>Co přesně je „vyhledání"?</summary><p>Analýza jednoho města: spádová oblast 15 km, počet obyvatel, odhad kapacity, stávající prádlomaty a seznam kandidátních míst. Odečte se při spuštění analýzy a výsledek se trvale uloží, takže ho kdykoli znovu otevřete bez dalšího odečtu.</p></details>
    <details><summary>Jak dlouho mám přístup?</summary><p>12 měsíců od aktivace. Platba je jednorázová, přístup se automaticky neobnovuje a nic dalšího vám nestrháváme.</p></details>
    <details><summary>Jak přesné je hodnocení míst?</summary><p>Je to orientační podklad z veřejných zdrojů a modelových předpokladů. Pomůže vám vybrat, kam se jít podívat a koho oslovit. Není zárukou, že se místo vyplatí, ani odborným schválením investice. Údaje, které aplikace nemá, označí jako chybějící.</p></details>
    <details><summary>Mohu místo rovnou prověřit a spočítat ekonomiku?</summary><p>Ano. Vybrané místo přenesete jedním klikem do nové lokality a spočítáte ekonomiku prádlomatu včetně scénářů, bodu zvratu a exportu do PDF.</p></details>
    <details><summary>Jak probíhá objednávka a platba?</summary><p>Vyberete balíček, vyplníte kontakt a zaplatíte kartou přes Stripe (bezpečná platební brána, údaje o kartě k nám nikdy nejdou). Po zaplacení vám do jednoho pracovního dne aktivujeme přístup do aplikace a pošleme doklad e-mailem. Pokud online platba není zrovna dostupná, přijmeme žádost a pošleme platební údaje e-mailem.</p></details>
    <details><summary>Odečte se mi cena balíčku z ceny prádlomatu?</summary><p>Tuto výhodu připravujeme; její přesné podmínky zveřejníme v obchodních podmínkách. Do té doby ji neberte jako součást nabídky.</p></details>
  </section>`;
}

function findLocationPage(limits, searchLimits) {
  let h = LOC.locationPage(limits, searchLimits);
  h = h.replace(/<title>[\s\S]*?<\/title>/, '<title>Najděte nejlepší místo pro prádlomat za pár minut – Vyhledávač míst</title>')
    .replace(/<meta name="description"[^>]*>/, '<meta name="description" content="Zadejte město a aplikace najde nejlepší místa pro prádlomat: spádová oblast 15 km, počet obyvatel, kapacita, konkurence a konkrétní kandidátní místa. Přístup na 12 měsíců, jednorázová platba." />')
    .replace('<a class="brand" href="/location">', '<a class="brand" href="/findlocation">')
    .replace('<span class="tag">Prověření lokality</span>', '<span class="tag">Vyhledávač míst</span>')
    .replace('</head>', '<style>' + CSS + '</style></head>');
  // hero (včetně koncové značky)
  h = swap(h, /<section class="hero">/, /<\/section>/, hero().replace(/<\/section>$/, ''));
  // ukázka + mapa + rovnice → „jak to funguje"
  h = swap(h, /<section class="sec sim" id="ukazka">/, /<section class="sec">\s*<h2>Co dostanete<\/h2>/, how() + '\n\n  ');
  // „Co dostanete"
  h = swap(h, /<section class="sec">\s*<h2>Co dostanete<\/h2>/, /<section class="sec" id="cena">/, what() + '\n\n  ');
  // ceník + FAQ
  h = swap(h, /<section class="sec" id="cena">/, /<section class="sec" id="objednat">/, prices(limits, searchLimits));
  // objednávka: návrat ze Stripe na /findlocation, upravený nadpis
  const FP = LOC.FINDER_PRICES, S = searchLimits || {};
  const opt = (k, t) => `<option value="${k}">${t} – ${fmt(FP[k])} Kč s DPH (${S[k] != null ? S[k] : 1} vyhledání)</option>`;
  h = h.replace('<h2>Získat aplikaci</h2>', '<h2>Získat Vyhledávač míst</h2>')
    .replace(/<select name="variant" id="variant">[\s\S]*?<\/select>/, `<select name="variant" id="variant">${opt('basic', 'Základ')}${opt('plus', 'Plus')}${opt('premium', 'Premium')}</select>`)
    .replace('<input type="hidden" name="consent" value="1">', '<input type="hidden" name="consent" value="1"><input type="hidden" name="ret" value="/findlocation"><input type="hidden" name="product" value="finder">');
  // FAQ až za objednávkový formulář (platba hned za balíčky)
  const o = h.indexOf('<section class="sec" id="objednat">'), oe = o < 0 ? -1 : h.indexOf('</section>', o);
  if (oe > 0) {
    // původní FAQ z /location (za objednávkou) nahradit FAQ aplikace
    const fa = h.indexOf('<section class="sec">', oe), fe = fa < 0 ? -1 : h.indexOf('</section>', fa) + 10;
    h = fa > 0 && h.slice(fa, fe).includes('Časté otázky') ? h.slice(0, fa) + faq() + h.slice(fe) : h.slice(0, oe + 10) + '\n\n  ' + faq() + h.slice(oe + 10);
  }
  return h;
}

module.exports = { findLocationPage };
