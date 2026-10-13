// BS2 — Aplikace „Prověření lokality" pro platící zákazníky (user_type = 'location').
// Zákazník vidí jen tuto sekci: seznam lokalit (limit dle balíčku), formulář lokality,
// kalkulačku ekonomiky (scénáře, bod zvratu, financování), orientační vyhodnocení
// se čtyřmi výsledky, report k tisku/PDF, checklist a (u Premium) stav místního šetření.
// Výpočty jsou záměrně průhledné: všechny sazby zadává zákazník, žádné skryté konstanty.
const { esc, layout } = require('./views');

const LIMITS = { basic: 3, plus: 10, premium: 10 };
const SEARCH_LIMITS = { basic: 3, plus: 10, premium: 10 }; // vyhledání ve Vyhledávači míst
const PKG_LABEL = { basic: 'Základ', plus: 'Plus', premium: 'Premium' };

const NAV = (s) => [
  { id: 'loc', href: '/lokalita', label: 'Moje lokality', icon: 'box' },
  { id: 'anal', href: '/lokalita/analyza', label: 'Vyhledávač míst', icon: 'network' },
  { id: 'acc', href: '/password', label: 'Můj účet', icon: 'user', right: true },
];
function page(s, title, active, body, head) {
  let html = layout({ title, user: s.nick, nav: NAV(s), active, fx: true, help: null, body: `<style>${CSS}</style>${body}` });
  if (head) html = html.replace('</head>', head + '</head>');
  return html;
}
const CSS = `
.lk-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.lk-f{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px 14px} .lk-f label{margin:4px 0 0} .lk-f .full{grid-column:1/-1}
.lk-f h3{grid-column:1/-1;margin:16px 0 0;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent2)} .lk-f h3:first-child{margin-top:0}
.lk-f small{display:block;color:var(--text3);font-size:11.5px;margin-top:3px}
.res{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:6px 14px;font-weight:700;font-size:14px;border:1px solid}
.res.ok{color:var(--ok);border-color:rgba(47,227,160,.5);background:rgba(47,227,160,.1)} .res.cond{color:#ffd866;border-color:rgba(245,180,0,.5);background:rgba(245,180,0,.1)}
.res.bad{color:var(--err);border-color:rgba(255,93,108,.5);background:rgba(255,93,108,.1)} .res.na{color:var(--text2);border-color:var(--border2);background:rgba(120,160,255,.08)}
.sc{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px} .sc .c{background:var(--card2);border:1px solid var(--border);border-radius:12px;padding:12px 14px}
.sc .c.hi{border-color:rgba(79,209,255,.45)} .sc .k{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3)} .sc .v{font-size:20px;font-weight:800;letter-spacing:-.02em;margin:2px 0 6px;font-variant-numeric:tabular-nums}
.sc .pos{color:var(--ok)} .sc .neg{color:var(--err)}
.cas{display:flex;flex-direction:column;gap:5px} .cas div{display:flex;justify-content:space-between;gap:10px;font-size:13.5px;padding:6px 10px;border-radius:8px;background:rgba(4,8,16,.5);border:1px solid var(--border)} .cas div span{color:var(--text2)} .cas div.t{border-color:rgba(79,209,255,.4);font-weight:700}
.rep h4{margin:16px 0 6px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent2)} .rep ul{margin:0;padding-left:18px;color:var(--text2);font-size:14px} .rep li b{color:var(--text)}
.rep .warn li{color:#ffd9a0} .rep .miss li{color:#ffd866}
#site-map.poi-drop{outline:3px dashed var(--accent2);outline-offset:-3px} .warn-txt{color:#ffd866}
@media print{body{background:#fff!important;color:#000!important}header,.tabs,.banner,.glow,.gridfx,#net,.helpbtn,.no-print{display:none!important}main{max-width:none;padding:0}.card{background:#fff!important;border:1px solid #ccc!important;box-shadow:none!important;color:#000}.rep ul,.sc .k,.cas div span,.muted{color:#333!important}.sc .c,.cas div{background:#fff!important;border-color:#ccc!important}.res{color:#000!important}}
`;

// ── Výpočet ekonomiky ────────────────────────────────────────────────────────
const num = (v, d = 0) => { const t = String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'); const n = Number(t); return t !== '' && isFinite(n) ? n : d; };
function annuity(principal, ratePa, months) { if (!(principal > 0) || !(months > 0)) return 0; const r = ratePa / 100 / 12; if (r <= 0) return principal / months; return principal * r / (1 - Math.pow(1 + r, -months)); }
/** d = uložená data lokality (viz FIELDS). Vrací scénáře + bod zvratu. */
function calc(d) {
  const vat = d.vat_payer === 'no' ? 0 : 0.21;
  const pw = num(d.price_wash, 300), pws = num(d.price_wash_soft, 350), softShare = num(d.soft_share, 50) / 100, pd = num(d.price_dry, 50), dryShare = num(d.dry_share, 60) / 100, dryCycles = num(d.dry_cycles, 2);
  const perWash = pw * (1 - softShare) + pws * softShare + dryShare * dryCycles * pd;   // průměrná tržba na zákazníka s DPH                // tržba s DPH na jedno praní (vč. sušení)
  const days = 30.4;
  const payer = d.vat_payer !== 'no';
  const normCost = (v, mode) => { if (!v) return 0; if (payer) return mode === 'incl' ? v / 1.21 : v; return mode === 'incl' ? v : v * 1.21; };
  const rentN = normCost(num(d.rent), d.rent_vat || 'excl');
  const fixed = rentN + num(d.software) + num(d.insurance) + num(d.marketing) + num(d.other);
  const invest = normCost(num(d.machine_price) + num(d.delivery) + num(d.site_prep), d.invest_vat || 'excl');
  const down = d.down_mode === 'pct' ? invest * Math.min(100, num(d.down_payment)) / 100 : num(d.down_payment);
  const loanPrincipal = Math.max(0, invest - down);
  const payment = d.financing === 'yes' ? annuity(loanPrincipal, num(d.interest), num(d.months, 60)) : 0;
  function scen(name, washes) {
    const gross = washes * perWash * days;                       // s DPH
    const net = gross / (1 + vat);                               // bez DPH (neplátce: = gross)
    const vatAmt = gross - net;
    const cycles = washes * days * (1 + dryShare * dryCycles);
    let energy;
    if (d.energy_mode === 'consumption') energy = washes * days * (num(d.kwh_wash) * num(d.kwh_price) + num(d.water_wash) / 1000 * num(d.water_price)) + washes * dryShare * dryCycles * days * num(d.kwh_dry) * num(d.kwh_price);
    else energy = net * num(d.energy_pct, 9.5) / 100;
    const service = net * num(d.service_pct, 13) / 100;
    const fees = gross * num(d.fee_pct, 1.5) / 100;
    const reserve = net * num(d.reserve_pct, 5) / 100;
    const operating = net - energy - service - fees - fixed - reserve;   // provozní výsledek před financováním a daní
    const cash = operating - payment;                                   // peněžní tok po splátce (jistina + úrok)
    const payback = operating > 0 && invest > 0 ? invest / operating : null; // měsíců
    return { name, washes, gross, net, vatAmt, energy, service, fees, fixed, reserve, operating, payment, cash, payback, cycles };
  }
  const S = { weak: scen('Slabý', num(d.washes_weak, 5)), mid: scen('Střední', num(d.washes_mid, 8)), strong: scen('Silný', num(d.washes_strong, 12)) };
  // Bod zvratu (provozní / po splátce): hledání počtu praní/den, kde výsledek = 0
  function breakEven(key) { for (let w = 0.5; w <= 60; w += 0.5) { if (scen('x', w)[key] >= 0) return w; } return null; }
  return { S, perWash, fixed, invest, payment, loanPrincipal, rentN, be_operating: breakEven('operating'), be_cash: breakEven('cash'), vat, payer };
}

// ── Vyhodnocení (4 výsledky) ───────────────────────────────────────────────────
function evaluate(d, c) {
  const missing = [], risks = [], steps = [], verified = [], given = [], assumed = [];
  const yes = (v) => v === 'yes', unk = (v) => !v || v === 'unknown';
  const own = d.ownership === 'own';
  if (!d.ownership) missing.push('Vlastní místo, nebo nájem?');
  if (!d.vat_payer) missing.push('Plátce / neplátce DPH');
  else if (!own && d.rent_known === 'no') missing.push('Výše nájmu (zatím neznámá) – kalkulace počítá s 0 Kč');
  else if (!own && !num(d.rent)) missing.push('Výše nájmu');
  if (unk(d.conn_water)) missing.push('Přípojka vody'); if (unk(d.conn_sewer)) missing.push('Odpad'); if (unk(d.conn_power)) missing.push('Elektrická přípojka');
  if (!num(d.machine_price)) missing.push('Zvolený prádlomat (cena zařízení)');
  // ověřené skutečnosti = zadané s uvedeným zdrojem
  const v = (label, val, src) => { if (val === '' || val == null) return; if (src) verified.push(`${label}: ${val} – ${src}`); else given.push(`${label}: ${val}`); };
  if (own) given.push('Místo: vlastní (nájem 0 Kč)'); else if (d.ownership === 'rent') given.push('Místo: v nájmu' + (num(d.deposit) ? ', kauce ' + num(d.deposit).toLocaleString('cs-CZ') + ' Kč' : d.deposit === '0' ? ', bez kauce' : ''));
  if (!own) v('Nájem', num(d.rent) ? num(d.rent).toLocaleString('cs-CZ') + ' Kč/měs ' + (d.rent_vat === 'incl' ? 's DPH' : 'bez DPH') : '', '');
  v('Přípojky na místě', [d.conn_water === 'yes' ? 'voda' : null, d.conn_sewer === 'yes' ? 'odpad' : null, d.conn_power === 'yes' ? 'elektřina' : null].filter(Boolean).join(', '), '');
  if (d.lat && d.lng) given.push('Umístění na mapě: ' + d.lat + ', ' + d.lng + ' · prádlomat 3 × 2 m, otočení ' + (d.heading || 0) + '°');
  else missing.push('Přesné umístění prádlomatu na mapě');
  if (d.access === '247') given.push('Přístupnost: 24/7'); else if (d.access === 'limited') { given.push('Přístupnost: omezená – areál se zavírá' + (d.access_note ? ' (' + d.access_note + ')' : '')); risks.push('Prádlomat není přístupný 24/7 – omezený provoz snižuje tržby (scénáře počítají s nepřetržitým provozem)'); } else missing.push('Přístupnost prádlomatu pro zákazníky (24/7 / omezeně)');
  const pois = parsePois(d); const tl = Object.fromEntries(POI_TYPES.map((t) => [t.key, t]));
  pois.forEach((p) => { const t = tl[p.type] || tl.other; const vis = p.type === 'road' ? (p.visible === 'yes' ? ' · prádlomat ze silnice vidět' : p.visible === 'partial' ? ' · ze silnice vidět částečně' : p.visible === 'no' ? ' · ze silnice NENÍ vidět' : ' · viditelnost neuvedena') : ''; given.push(t.icon + ' ' + t.label + (p.label ? ': ' + p.label : '') + (p.note ? ' – ' + p.note : '') + vis); });
  const roads = pois.filter((p) => p.type === 'road');
  if (roads.length && roads.every((p) => p.visible === 'no')) risks.push('Prádlomat není vidět z hlavní silnice (' + roads.map((p) => p.label || 'silnice').join(', ') + ')');
  if (roads.some((p) => !p.visible)) missing.push('Viditelnost prádlomatu z hlavní silnice');
  if (!pois.some((p) => p.type === 'parking')) missing.push('Nejbližší parkoviště zakreslené v mapě (povinné)');
  if (d.product_name) given.push('Zvolený prádlomat: ' + d.product_name);
  if (d.delivery_known !== 'yes') { missing.push('Cena dopravy a instalace (počítáno 0 Kč)'); } else if (num(d.delivery)) given.push('Doprava a instalace: ' + num(d.delivery).toLocaleString('cs-CZ') + ' Kč bez DPH');
  const needPrep = ['conn_water', 'conn_sewer', 'conn_power', 'surface'].some((k) => d[k] === 'no');
  if (needPrep) { if (d.site_prep_known !== 'yes') missing.push('Cena vybudování přípojek / zpevněné plochy (počítáno 0 Kč)'); else if (num(d.site_prep)) given.push('Příprava místa / přípojky: ' + num(d.site_prep).toLocaleString('cs-CZ') + ' Kč bez DPH'); }
  if (!own) { v('Výpovědní lhůta', d.notice_known === 'no' ? 'zatím neznámá' : num(d.notice) ? num(d.notice) + ' měs.' : '', ''); v('Délka smlouvy', num(d.contract_years) ? num(d.contract_years) + ' let' : '', ''); }
  assumed.push(`Ceny s DPH: praní ${num(d.price_wash, 300)} Kč, praní s aviváží ${num(d.price_wash_soft, 350)} Kč (volí ${num(d.soft_share, 50)} % zákazníků), sušení ${num(d.price_dry, 50)} Kč/cyklus, ${num(d.dry_share, 60)} % zákazníků suší (${num(d.dry_cycles, 2)} cykly) → průměr ${Math.round(c.perWash)} Kč na zákazníka`);
  assumed.push(`Návštěvnost: slabý ${c.S.weak.washes} / střední ${c.S.mid.washes} / silný ${c.S.strong.washes} zákazníků za den (1 zákazník = 1 praní vč. sušení)`);
  assumed.push(d.energy_mode === 'consumption' ? `Energie podle spotřeby: ${num(d.kwh_wash)} kWh/praní, ${num(d.kwh_dry)} kWh/sušení, ${num(d.water_wash)} l/praní, ${num(d.kwh_price)} Kč/kWh, ${num(d.water_price)} Kč/m³` : `Energie a voda zjednodušeně ${num(d.energy_pct, 9.5)} % z tržby bez DPH`);
  assumed.push(`Servis ${num(d.service_pct, 13)} % z tržby bez DPH, platební poplatky ${num(d.fee_pct, 1.5)} % z tržby, rezerva na opravy a obnovu ${num(d.reserve_pct, 5)} % (plánované odložení prostředků)`);
  assumed.push(d.vat_payer === 'no' ? 'Režim: neplátce DPH (tržby bez odvodu DPH, náklady vč. DPH)' : (d.vat_payer === 'yes' ? 'Režim: plátce DPH (21 % z tržeb odvedeno, nájem a investice počítány bez DPH)' : 'Režim DPH neuveden – počítáno jako plátce DPH'));
  if (d.financing === 'yes') assumed.push(`Financování: akontace ${d.down_mode === 'pct' ? num(d.down_payment) + ' %' : num(d.down_payment).toLocaleString('cs-CZ') + ' Kč'}, úvěr ${Math.round(c.loanPrincipal).toLocaleString('cs-CZ')} Kč, ${num(d.interest)} % p.a., ${num(d.months, 60)} měs. → splátka ${Math.round(c.payment).toLocaleString('cs-CZ')} Kč/měs`);
  // rizika
  if (c.S.weak.cash < 0) risks.push('Ve slabém scénáři je peněžní tok po splátce záporný – místo stojí a padá s návštěvností');
  if (c.S.mid.cash < 0) risks.push('Ve středním scénáři je peněžní tok po splátce záporný');
  if (c.S.weak.operating < 0) risks.push('Ve slabém scénáři nepokryje provoz ani fixní náklady');
  if (!own && num(d.notice) && num(d.notice) < 12) risks.push(`Výpovědní lhůta ${num(d.notice)} měs. je krátká – riziko ztráty místa před návratností`);
  if (!own && d.rent_known === 'yes' && d.notice_known === 'no') missing.push('Výpovědní lhůta');
  if (!own && d.rent_known === 'yes' && !num(d.contract_years)) missing.push('Délka nájemní smlouvy');
  if (!own && num(d.contract_years) && c.S.mid.payback && num(d.contract_years) * 12 < c.S.mid.payback) risks.push(`Smlouva na ${num(d.contract_years)} let je kratší než návratnost investice (${(c.S.mid.payback / 12).toFixed(1)} roku)`);
  if (!own && d.rent_known === 'no') risks.push('Nájem zatím není známý – výsledek se změní podle skutečné výše');
  const cm = (k, l) => { if (d[k] !== 'no') return; const m = num(d[k + '_m']); if (!m) { missing.push('Délka trasy přípojky – ' + l); risks.push('Chybí ' + l + ' – délka trasy není uvedena'); } else { given.push('Přípojka ' + l + ': nutno vybudovat, trasa ' + m + ' m'); risks.push('Nutno vybudovat přípojku: ' + l + ' (' + m + ' m) – náklady zahrňte do „Příprava místa / přípojky"'); } };
  cm('conn_water', 'voda'); cm('conn_sewer', 'odpad'); cm('conn_power', 'elektřina');
  if (d.surface === 'yes') given.push('Zpevněná plocha: už vybudovaná'); else if (d.surface === 'no') { given.push('Zpevněná plocha: bude se budovat'); risks.push('Nutno vybudovat zpevněnou plochu pod prádlomat – náklady zahrňte do „Příprava místa / přípojky"'); } else missing.push('Zpevněná plocha pod prádlomat (vybudovaná / bude se budovat)');
  if (needPrep && d.site_prep_known !== 'yes') steps.push('Nacenit vybudování přípojek / zpevněné plochy a doplnit do investice');
  if (d.delivery_known !== 'yes') steps.push('Zjistit cenu dopravy a instalace a doplnit do investice');
  const compN = pois.filter((p) => p.type === 'competition').length;
  if (compN >= 2) risks.push(`Konkurence v okolí: ${compN} provozoven zakreslených v mapě`);
  if (!pois.some((p) => p.type === 'housing')) missing.push('Bytové domy v okolí zakreslené v mapě');
  if (!pois.some((p) => p.type === 'transit')) risks.push('V mapě není zakreslená zastávka MHD');
  if (c.S.mid.payback && c.S.mid.payback > 84) risks.push(`Návratnost ve středním scénáři ${Math.round(c.S.mid.payback / 12)} let`);
  // kroky
  missing.forEach((m) => steps.push('Doplnit: ' + m));
  if (num(d.notice) && num(d.notice) < 12) steps.push('Vyjednat výpovědní lhůtu min. 12 měsíců (ideálně 24)');
  steps.push('Změřit pěší frekvenci 2× 30 min (všední den 17–18 h, sobota 10–11 h) u hlavní silnice / vstupu');
  if (c.S.weak.cash < 0 && c.S.mid.cash >= 0) steps.push('Zvážit vyšší akontaci nebo delší splácení, aby slabý scénář nebyl záporný');
  if (c.S.mid.cash < 0) steps.push('Vyjednat nižší nájem nebo hledat místo s vyšší návštěvností');
  steps.push('Po 1., 3. a 6. měsíci provozu porovnat skutečné cykly se scénáři');
  // výsledek
  let result, cls;
  const critical = missing.filter((m) => /nájmu|Vlastní místo|Přípojka|Odpad|Elektrick|Zvolený prádlomat|Přístupnost|Plátce/.test(m)).length;
  if (critical >= 2) { result = 'Nedostatek údajů pro posouzení'; cls = 'na'; }
  else if (c.S.strong.operating <= 0 || c.S.mid.cash < 0) { result = 'Nevhodné podle dostupných podkladů'; cls = 'bad'; }
  else if (c.S.weak.cash < 0 || critical >= 1 || (num(d.notice) && num(d.notice) < 12) || compN >= 2 || d.conn_water === 'no' || d.conn_sewer === 'no') { result = 'Vhodné při splnění podmínek'; cls = 'cond'; }
  else { result = 'Vhodné podle dostupných podkladů'; cls = 'ok'; }
  return { result, cls, missing, risks, steps, verified, given, assumed };
}

const LEAFLET_HEAD = `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" crossorigin="anonymous" referrerpolicy="no-referrer"><script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`;
const TILES = "L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',{attribution:'Tiles &copy; Esri',maxZoom:19})";
// Důležité body v okolí lokality (zákazník zakreslí do mapy)
const POI_TYPES = [
  { key: 'parking', label: 'Nejbližší parkoviště', icon: '🅿️', color: '#4fd1ff', required: true },
  { key: 'road', label: 'Hlavní silnice', icon: '🛣️', color: '#2fe3a0' },
  { key: 'shop', label: 'Obchod / supermarket', icon: '🛒', color: '#f97316' },
  { key: 'transit', label: 'Zastávka MHD', icon: '🚌', color: '#a78bfa' },
  { key: 'housing', label: 'Bytové domy', icon: '🏢', color: '#e879f9' },
  { key: 'competition', label: 'Konkurence', icon: '⚠️', color: '#ff5d6c' },
  { key: 'other', label: 'Jiné', icon: '📌', color: '#9db6cd' },
];
// ── Formulář ─────────────────────────────────────────────────────────────────
const FIELDS = ['name', 'address', 'city', 'lat', 'lng', 'heading', 'pois', 'ownership', 'rent_known', 'rent_vat', 'invest_vat', 'notice_known', 'contract_years', 'building', 'area', 'rent', 'rent_src', 'deposit', 'notice', 'exclusive', 'conn_water', 'conn_sewer', 'conn_power', 'conn_water_m', 'conn_sewer_m', 'conn_power_m', 'surface', 'product_id', 'product_name', 'access', 'access_note', 'down_mode', 'delivery_known', 'site_prep_known', 'visibility', 'parking', 'transit', 'households', 'households_src', 'competition', 'foot_traffic', 'foot_src',
  'price_wash', 'price_dry', 'dry_share', 'dry_cycles', 'washes_weak', 'washes_mid', 'washes_strong', 'vat_payer', 'energy_mode', 'energy_pct', 'kwh_wash', 'kwh_dry', 'kwh_price', 'water_wash', 'water_price', 'service_pct', 'software', 'fee_pct', 'insurance', 'marketing', 'reserve_pct', 'other',
  'machine_price', 'delivery', 'site_prep', 'financing', 'down_payment', 'interest', 'months', 'notes'];
const DEFAULTS = { price_wash: 300, price_wash_soft: 350, soft_share: 50, price_dry: 50, dry_share: 60, dry_cycles: 2, washes_weak: 5, washes_mid: 8, washes_strong: 12, vat_payer: '', energy_mode: 'percent', energy_pct: 9.5, kwh_wash: 1.5, kwh_dry: 2.5, kwh_price: 6, water_wash: 90, water_price: 110, service_pct: 13, fee_pct: 1.5, reserve_pct: 5, financing: 'no', interest: 9, months: 60, rent_vat: 'excl', invest_vat: 'excl', conn_water: 'unknown', conn_sewer: 'unknown', conn_power: 'unknown', visibility: 'unknown', parking: 'unknown', transit: 'unknown', exclusive: 'unknown' };
function clean(body) { const d = {}; for (const k of FIELDS) { let v = body[k]; if (v == null) continue; v = String(v).trim().slice(0, k === 'notes' ? 4000 : (k === 'pois' ? 20000 : 300)); d[k] = v; } return d; }

function siteForm(s, site, d, error, saved, noeval, products) {
  products = products || [];
  const V = (k) => esc(d[k] != null && d[k] !== '' ? d[k] : (DEFAULTS[k] != null ? DEFAULTS[k] : ''));
  const sel = (k, opts) => `<select name="${k}">${opts.map(([v, l]) => `<option value="${v}"${(d[k] || DEFAULTS[k] || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const YNU = [['unknown', 'nevím / neověřeno'], ['yes', 'ano'], ['no', 'ne']];
  const inp = (k, label, extra = '', hint = '') => `<label>${label}<input name="${k}" value="${V(k)}" ${extra}>${hint ? `<small>${hint}</small>` : ''}</label>`;
  return page(s, site ? 'Lokalita' : 'Nová lokalita', 'loc', `
  <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px"><div><h1 style="margin:0 0 4px">${site ? esc(site.name || 'Lokalita') : 'Nová lokalita'}</h1><p class="muted" style="margin:0">Vyplňte, co víte. Co neznáte, nechte prázdné – report to označí jako chybějící údaj.</p></div><a class="btn sec sm" href="/lokalita">← Moje lokality</a></div>
  ${error ? `<div class="msg err">${esc(error)}</div>` : ''}${saved ? '<div class="msg ok">Uloženo.</div>' : ''}${d.washes_mid && d.washes_mid != DEFAULTS.washes_mid ? `<div class="msg ok">Scénáře návštěvnosti: slabý ${esc(d.washes_weak)} / střední ${esc(d.washes_mid)} / silný ${esc(d.washes_strong)} zákazníků za den (z AI studie). Uložte pro přepočet.</div><input type="hidden" name="washes_weak" form="lkf" value="${esc(d.washes_weak)}"><input type="hidden" name="washes_mid" form="lkf" value="${esc(d.washes_mid)}"><input type="hidden" name="washes_strong" form="lkf" value="${esc(d.washes_strong)}">` : ''}${noeval ? '<div class="msg err">Lokalita ještě není vyhodnocená – klikněte dole na „Vyhodnotit a vypracovat studii".</div>' : ''}
  <form id="lkf" method="post" action="${site ? '/lokalita/' + site.id : '/lokalita/new'}" class="card lk-f" style="margin-top:14px">
    <h3>Místo</h3>
    ${inp('name', 'Název lokality *', 'required maxlength="120" placeholder="např. Tábor – Tesco"')}
    ${inp('address', 'Adresa *', 'required maxlength="300"')}
    ${inp('city', 'Město', 'maxlength="120"')}
    <label>Typ zástavby${sel('building', [['', '—'], ['sidliste', 'sídliště'], ['centrum', 'centrum města'], ['obchod', 'u obchodu / OC'], ['vesnice', 'obec / vesnice'], ['prumysl', 'průmyslová zóna'], ['kemp', 'kemp / rekreace']])}</label>
    <div class="full"><label style="margin:0 0 6px">Umístění prádlomatu na mapě <small>Klikněte „Najít adresu", pak obdélník přetáhněte přesně na místo, kde bude prádlomat stát, a zeleným bodem ho otočte.</small></label>
      <div class="row" style="margin-bottom:8px"><button type="button" class="btn sec sm" id="geo-btn">📍 Najít adresu na mapě</button><select id="geo-pick" style="display:none;width:auto;max-width:420px;font-size:13px;padding:7px 10px"></select><span class="small muted" id="geo-msg">${d.lat ? 'Poloha uložena: ' + esc(d.lat) + ', ' + esc(d.lng) : 'Poloha zatím není určena.'}</span></div>
      <div id="site-map" style="height:440px;border-radius:14px;border:1px solid var(--border);background:#0e1e33;z-index:0;overflow:hidden"></div>
      <div class="row" style="margin-top:8px;gap:10px;flex-wrap:wrap;align-items:center"><span class="small muted">Prádlomat <b>3 × 2 m</b> – modrý obdélník = tažením přesunete, <span style="color:var(--ok)">zelený bod</span> na šipce (vstup) = tažením otočíte. Otočení: <b id="f-heading-v">${d.heading != null && d.heading !== '' ? esc(d.heading) : 0}°</b></span><span class="small muted" style="margin-left:6px">Podklad:</span><select id="base-sel" style="width:auto;font-size:13px;padding:7px 10px"><option value="street">🗺 Mapa</option><option value="cuzk" selected>🛰 Letecká</option></select></div>
      <input type="hidden" name="lat" id="f-lat" value="${V('lat')}"><input type="hidden" name="lng" id="f-lng" value="${V('lng')}"><input type="hidden" name="heading" id="f-heading" value="${d.heading != null && d.heading !== '' ? esc(d.heading) : 0}"><input type="hidden" name="pois" id="f-pois" value="${esc(d.pois || '[]')}"><input type="hidden" name="access" id="f-access" value="${V('access')}"><input type="hidden" name="access_note" id="f-access-note-h" value="${V('access_note')}">
      <div style="margin-top:10px;padding:12px 14px;border-radius:12px;border:1px solid var(--border);background:rgba(4,8,16,.45)">
        <div class="small" style="margin-bottom:8px"><b>Důležité body v okolí</b> <span class="muted">– ikonu <b>chytněte a přetáhněte do mapy</b> (nebo klikněte na ikonu a pak do mapy). <b style="color:#ffd866">Nejbližší parkoviště je povinné.</b> Umístěné body jdou dál posouvat, kliknutím na bod ho smažete.</span></div>
        <div class="row" style="gap:6px;flex-wrap:wrap" id="poi-tools">${POI_TYPES.map((t) => `<button type="button" class="btn sec sm poi-btn" draggable="true" data-type="${t.key}" style="border-color:${t.color}66;cursor:grab">${t.icon} ${t.label}${t.required ? ' *' : ''}</button>`).join('')}<button type="button" class="btn sec sm" id="poi-cancel" style="display:none">✕ Zrušit přidávání</button></div>
        <div id="poi-list" style="margin-top:10px;display:flex;flex-direction:column;gap:6px"></div>
        <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" type="submit" name="goto" value="form">💾 Uložit</button></div>
      </div></div>
    <h3 id="najem">Nájem a smlouva</h3>
    <label>Místo je *${sel('ownership', [['', '— vyberte —'], ['own', 'moje vlastní (nájem 0 Kč)'], ['rent', 'v nájmu / půjde do nájmu']])}</label>
    <div class="rent-only" style="display:contents">
      <label>Znáte výši nájmu?${sel('rent_known', [['', '— vyberte —'], ['yes', 'ano, znám'], ['no', 'ne, zatím nevím']])}</label>
      ${inp('rent', 'Nájem (Kč / měsíc, bez energií)', 'inputmode="decimal"')}
      <label>Nájem je uveden${sel('rent_vat', [['excl', 'bez DPH'], ['incl', 's DPH']])}</label>
      ${inp('deposit', 'Kauce (Kč, 0 = bez kauce)', 'inputmode="decimal"')}
      <label>Znáte výpovědní lhůtu?${sel('notice_known', [['', '— vyberte —'], ['yes', 'ano, znám'], ['no', 'ne, zatím nevím']])}</label>
      ${inp('notice', 'Výpovědní lhůta (měsíce)', 'inputmode="numeric" data-notice="1"')}
      ${inp('contract_years', 'Délka smlouvy (roky)', 'inputmode="decimal"')}
    </div>
    <script>(function(){ var own=document.querySelector('select[name=ownership]'), known=document.querySelector('select[name=rent_known]'), box=document.querySelector('.rent-only'); var rentIn=document.querySelector('input[name=rent]');
      function upd(){ var isOwn=own.value==='own', isRent=own.value==='rent'; box.querySelectorAll('label').forEach(function(l){ l.style.display=isRent?'':'none'; }); if(isOwn){ rentIn.value='0'; }
        var unknown=known.value==='no', showRent=isRent&&known.value==='yes'; rentIn.parentNode.style.display=showRent?'':'none'; if(unknown&&isRent) rentIn.value='';
        // kauce/výpověď/exkluzivita až po volbě, zda zná nájem
        ['deposit','contract_years'].forEach(function(n){ var el=document.querySelector('input[name='+n+']'); if(el) el.parentNode.style.display=showRent?'':'none'; }); var nk=document.querySelector('select[name=notice_known]'), nIn=document.querySelector('input[name=notice]'); nk.parentNode.style.display=showRent?'':'none'; nIn.parentNode.style.display=(showRent&&nk.value==='yes')?'':'none'; if(nk.value!=='yes') nIn.value=''; }
      own.addEventListener('change',upd); known.addEventListener('change',upd); document.querySelector('select[name=notice_known]').addEventListener('change',upd); upd(); })();</script>
    <h3>Přípojky</h3>
    <label>Voda${sel('conn_water', YNU)}</label>${inp('conn_water_m', 'Délka trasy přípojky vody (m)', 'inputmode="decimal" data-conn="conn_water"', 'Od nejbližšího místa napojení k prádlomatu.')}
    <label>Odpad${sel('conn_sewer', YNU)}</label>${inp('conn_sewer_m', 'Délka trasy odpadu (m)', 'inputmode="decimal" data-conn="conn_sewer"')}
    <label>Elektřina${sel('conn_power', YNU)}</label>${inp('conn_power_m', 'Délka trasy el. přípojky (m)', 'inputmode="decimal" data-conn="conn_power"')}
    <label>Zpevněná plocha pod prádlomat${sel('surface', [['unknown', 'nevím / neověřeno'], ['yes', 'už je vybudovaná'], ['no', 'bude se budovat']])}</label>
    <script>(function(){ document.querySelectorAll('input[data-conn]').forEach(function(inp){ var sel=document.querySelector('select[name='+inp.getAttribute('data-conn')+']'); function u(){ inp.parentNode.style.display=sel.value==='no'?'':'none'; if(sel.value!=='no') inp.value=''; } sel.addEventListener('change',u); u(); }); })();</script>
    <h3>Investice a financování</h3>
    <label class="full">Jste plátce DPH? *${sel('vat_payer', [['', '— vyberte —'], ['yes', 'ano, plátce DPH'], ['no', 'ne, neplátce']])}<small>Plátce: tržby bez 21 % DPH, nájem a investice počítány bez DPH. Neplátce: celé tržby, náklady včetně DPH.</small></label>
    <label class="full">Prádlomat, který si na lokalitu představujete<select name="product_id" id="f-product">${products.length ? '<option value="">— vyberte z nabídky —</option>' + products.map((p) => `<option value="${p.id}" data-name="${esc(p.name)}" data-price="${p.price_czk != null ? Number(p.price_czk) : ''}"${String(d.product_id || '') === String(p.id) ? ' selected' : ''}>${esc(p.name)}${p.price_czk != null ? ' – ' + Number(p.price_czk).toLocaleString('cs-CZ') + ' Kč bez DPH' : ''}</option>`).join('') : '<option value="">— nabídka momentálně není dostupná —</option>'}</select><small>Cena zařízení se bere z aktuální nabídky (bez DPH).</small></label>
    <input type="hidden" name="product_name" id="f-product-name" value="${V('product_name')}"><input type="hidden" name="machine_price" id="f-machine-price" value="${V('machine_price')}"><input type="hidden" name="invest_vat" value="excl">
    <script>(function(){ var sel=document.getElementById('f-product'), nm=document.getElementById('f-product-name'), price=document.getElementById('f-machine-price');
      function u(){ var o=sel.options[sel.selectedIndex]; if(!o) return; nm.value=o.getAttribute('data-name')||''; price.value=o.getAttribute('data-price')||''; } sel.addEventListener('change',u); if(sel.value) u(); })();</script>
    <label>Doprava a instalace${sel('delivery_known', [['no', 'neznám'], ['yes', 'znám cenu']])}</label>
    ${inp('delivery', 'Doprava a instalace (Kč bez DPH)', 'inputmode="decimal" data-known="delivery_known"')}
    <label class="prep-row">Přípojky / zpevněná plocha – cena${sel('site_prep_known', [['no', 'neznám'], ['yes', 'znám cenu']])}</label>
    ${inp('site_prep', 'Příprava místa / přípojky (Kč bez DPH)', 'inputmode="decimal" data-known="site_prep_known"')}
    <script>(function(){ function needPrep(){ return ['conn_water','conn_sewer','conn_power','surface'].some(function(n){ var e=document.querySelector('select[name='+n+']'); return e&&e.value==='no'; }); }
      function u(){ document.querySelectorAll('input[data-known]').forEach(function(i){ var k=document.querySelector('select[name='+i.getAttribute('data-known')+']'); var show=k.value==='yes'; if(i.name==='site_prep'){ var np=needPrep(); k.parentNode.style.display=np?'':'none'; show=show&&np; if(!np){ k.value='no'; } } i.parentNode.style.display=show?'':'none'; if(!show) i.value=''; }); }
      document.querySelectorAll('select[name=delivery_known],select[name=site_prep_known],select[name=conn_water],select[name=conn_sewer],select[name=conn_power],select[name=surface]').forEach(function(e){ e.addEventListener('change',u); }); u(); })();</script>
    <label>Financování${sel('financing', [['no', 'vlastní kapitál'], ['yes', 'úvěr / leasing']])}</label>
    <label>Akontace<div style="display:flex;gap:6px"><input name="down_payment" value="${V('down_payment')}" inputmode="decimal" style="flex:1"><select name="down_mode" style="width:auto">${[['czk', 'Kč'], ['pct', '%']].map(([v, l]) => `<option value="${v}"${(d.down_mode || 'czk') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div></label>
    ${inp('interest', 'Úrok (% p.a.)', 'inputmode="decimal"')}
    ${inp('months', 'Délka splácení (měsíce)', 'inputmode="numeric"')}
    <script>(function(){ var f=document.querySelector('select[name=financing]'); var ids=['down_payment','interest','months']; function u(){ var on=f.value==='yes'; ids.forEach(function(n){ var el=document.querySelector('input[name='+n+']'); if(el) el.closest('label').style.display=on?'':'none'; }); var ir=document.querySelector('input[name=interest]'); if(on&&ir&&(!ir.value||ir.value==='8')) ir.value='9'; } f.addEventListener('change',u); u(); })();</script>
    <label class="full">Poznámky<textarea name="notes" rows="3" maxlength="4000" lang="cs" spellcheck="true">${V('notes')}</textarea></label>
    <div class="full msg err" id="lk-val" style="display:none;margin:4px 0 0"></div>
    <div class="full row" style="margin-top:8px;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn sec" type="submit" name="goto" value="save">💾 Uložit</button>${site && site.evaluated_at ? `<a class="btn sm" href="/lokalita/${site.id}/studie">🧠 Otevřít studii</a><span class="small muted">Lokalita už byla vyhodnocena – každou lokalitu lze vyhodnotit jen jednou. Uložit = uloží upravené údaje.</span>` : `<button class="btn" type="submit" name="goto" value="eval" id="btn-eval">🧠 Vyhodnotit a vypracovat studii</button><span class="small muted">Uložit = jen uloží údaje. Vyhodnotit = zpracuje data a sestaví AI studii lokality (cca 15 min) a odečte 1 vyhodnocení z balíčku. Každou lokalitu lze vyhodnotit jen jednou.</span>`}</div>
  </form>
  <script>(function(){ var fmt=function(v){ var t=String(v).replace(/\s/g,'').replace(',','.'); var n=Number(t); if(t===''||!isFinite(n)) return v; return n.toLocaleString('cs-CZ',{maximumFractionDigits:2}).replace(/\u00a0/g,' '); };
    document.querySelectorAll('form.lk-f input[inputmode=decimal], form.lk-f input[inputmode=numeric]').forEach(function(i){ if(i.name==='interest'||i.name==='months'||i.name==='notice'||/_m$/.test(i.name)) return; i.addEventListener('blur',function(){ this.value=fmt(this.value); }); i.addEventListener('focus',function(){ this.value=this.value.replace(/\s/g,''); }); if(i.value) i.value=fmt(i.value); }); })();</script>
  <script>(function(){
    var lat=document.getElementById('f-lat'),lng=document.getElementById('f-lng'),hd=document.getElementById('f-heading'),hdv=document.getElementById('f-heading-v'),msg=document.getElementById('geo-msg');
    var has=lat.value&&lng.value; var map=L.map('site-map',{scrollWheelZoom:true,maxZoom:22}).setView(has?[+lat.value,+lng.value]:[49.8,15.5],has?20:7);
    var street=${TILES}; street.options.maxZoom=22; street.options.maxNativeZoom=19;
    // ČÚZK ortofoto ČR (WMS, 20 cm/px) – nejostřejší letecký podklad pro Česko
    var cuzk=L.tileLayer('https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}',{attribution:'Ortofoto &copy; ČÚZK',maxZoom:22,maxNativeZoom:20});
    var bases={street:street,cuzk:cuzk}, cur=null; function setBase(k){ if(cur) map.removeLayer(cur); cur=bases[k]||street; cur.addTo(map); try{ cur.bringToBack(); }catch(e){} }
    var sel=document.getElementById('base-sel'); setBase(sel.value); sel.addEventListener('change',function(){ setBase(this.value); });
    // Obdélník 3 × 2 m (délka × hloubka), otočený o heading (0° = čelo na sever), šipka = vstup
    var W=3, D=2, rect=null, arrow=null, knob=null, dragging=false, rotating=false;
    function corners(a,b,h){ var R=6378137, rad=h*Math.PI/180, cos=Math.cos(rad), sin=Math.sin(rad), lat0=a*Math.PI/180; function off(x,y){ var xr=x*cos-y*sin, yr=x*sin+y*cos; return [a+(yr/R)*180/Math.PI, b+(xr/(R*Math.cos(lat0)))*180/Math.PI]; }
      return { box:[off(-W/2,-D/2),off(W/2,-D/2),off(W/2,D/2),off(-W/2,D/2)], front:[off(0,D/2),off(0,D/2+1.2)], tipL:off(-0.5,D/2+0.7), tipR:off(0.5,D/2+0.7), knob:off(0,D/2+1.6) }; }
    function headingTo(latlng){ var c=map.latLngToContainerPoint([+lat.value,+lng.value]), p=map.latLngToContainerPoint(latlng); var az=Math.atan2(p.x-c.x, -(p.y-c.y))*180/Math.PI; return (360-az)%360; }
    function stopEv(e){ L.DomEvent.stop(e.originalEvent||e); }
    function draw(){ if(!lat.value) return; var c=corners(+lat.value,+lng.value,+hd.value||0);
      if(!rect){ rect=L.polygon(c.box,{color:'#4fd1ff',weight:2,fillColor:'#1e86e0',fillOpacity:.55}).addTo(map); arrow=L.polyline([c.tipL,c.front[1],c.tipR,c.front[1],c.front[0]],{color:'#2fe3a0',weight:3,interactive:false}).addTo(map);
        knob=L.circleMarker(c.knob,{radius:8,color:'#fff',weight:2,fillColor:'#2fe3a0',fillOpacity:1}).addTo(map); knob.bindTooltip('Tažením otočíte',{direction:'top'});
        rect.on('mousedown',function(e){ dragging=true; map.dragging.disable(); stopEv(e); }); knob.on('mousedown',function(e){ rotating=true; map.dragging.disable(); stopEv(e); });
        map.on('mousemove',function(e){ if(dragging) save(e.latlng.lat,e.latlng.lng); else if(rotating) setHeading(headingTo(e.latlng)); });
        map.on('mouseup',function(){ if(dragging||rotating){ dragging=false; rotating=false; map.dragging.enable(); } });
        var el=map.getContainer(); el.addEventListener('touchmove',function(ev){ if(!(dragging||rotating)) return; var t=ev.touches[0]; var p=map.containerPointToLatLng(L.point(t.clientX-el.getBoundingClientRect().left,t.clientY-el.getBoundingClientRect().top)); if(dragging) save(p.lat,p.lng); else setHeading(headingTo(p)); ev.preventDefault(); },{passive:false});
        el.addEventListener('touchend',function(){ dragging=false; rotating=false; map.dragging.enable(); }); rect.on('touchstart',function(e){ dragging=true; map.dragging.disable(); }); knob.on('touchstart',function(e){ rotating=true; map.dragging.disable(); });
        try{ rect.getElement().style.cursor='move'; knob.getElement().style.cursor='grab'; }catch(e){}
      } else { rect.setLatLngs(c.box); arrow.setLatLngs([c.tipL,c.front[1],c.tipR,c.front[1],c.front[0]]); knob.setLatLng(c.knob); } }
    var _firstPin=true; function save(a,b){ var was=!!lat.value; lat.value=a.toFixed(7); lng.value=b.toFixed(7); msg.textContent='Poloha: '+lat.value+', '+lng.value+' · otočení '+hd.value+'° (uloží se s lokalitou)'; draw(); if(!was&&typeof renderList==='function') renderList(); }
    function setPin(a,b,zoom){ save(a,b); if(zoom) map.setView([a,b],zoom); }
    function setHeading(v){ v=((Math.round(v)%360)+360)%360; hd.value=v; hdv.textContent=v+'°'; msg.textContent='Poloha: '+lat.value+', '+lng.value+' · otočení '+v+'°'; draw(); }
    // ── Důležité body (POI) ──
    var ACC=document.getElementById('f-access'), ACCN=document.getElementById('f-access-note-h');
    var POI=${JSON.stringify(POI_TYPES)}, poisEl=document.getElementById('f-pois'), pois=[]; try{ pois=JSON.parse(poisEl.value||'[]'); if(!Array.isArray(pois)) pois=[]; }catch(e){ pois=[]; }
    var poiMarkers=[], addType=null, cancelBtn=document.getElementById('poi-cancel'), listEl=document.getElementById('poi-list');
    function ptype(k){ for(var i=0;i<POI.length;i++) if(POI[i].key===k) return POI[i]; return POI[POI.length-1]; }
    function poiIcon(t){ return L.divIcon({className:'',html:'<div style="width:30px;height:30px;border-radius:50%;background:rgba(4,8,16,.85);border:2px solid '+t.color+';display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 0 12px '+t.color+'88">'+t.icon+'</div>',iconSize:[30,30],iconAnchor:[15,15]}); }
    function savePois(){ poisEl.value=JSON.stringify(pois); renderList(); }
    function renderList(){ if(!pois.length){ listEl.innerHTML='<span class="small" style="color:#ffd866">Zatím žádný bod – zakreslete alespoň nejbližší parkoviště.</span>'; return; }
      listEl.innerHTML='<div class="row" style="gap:8px;padding:0 8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-weight:700"><span style="width:26px"></span><span style="min-width:120px">Typ</span><span style="flex:1;min-width:160px">Název</span><span style="flex:2;min-width:200px">Poznámka</span><span style="width:20px"></span></div>'
        +'<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;padding:6px 8px;border-radius:10px;background:rgba(30,134,224,.12);border:1px solid rgba(79,209,255,.45)"><span style="width:26px;text-align:center;font-size:16px">🧺</span><span class="small" style="min-width:120px;color:var(--accent2);font-weight:700">Prádlomat</span><span class="small muted" style="flex:1;min-width:160px">'+(lat.value?'umístěn na mapě (modrý obdélník)':'<span class="warn-txt">zatím neumístěn – klikněte do mapy</span>')+'</span><select id="f-access-sel" style="width:auto;font-size:13px;padding:7px 9px"><option value="" disabled'+(!ACC.value?' selected':'')+'>Přístupnost pro zákazníky? *</option><option value="247"'+(ACC.value==='247'?' selected':'')+'>✓ přístupný 24/7</option><option value="limited"'+(ACC.value==='limited'?' selected':'')+'>⏰ omezeně – areál se zavírá</option></select><input id="f-access-note" value="'+(ACCN.value||'').replace(/"/g,'&quot;')+'" placeholder="Otevírací doba areálu (např. 6–22 h)" style="flex:2;min-width:200px;font-size:13px;padding:7px 9px;display:'+(ACC.value==='limited'?'':'none')+'"><span style="width:20px"></span></div>'
        +pois.map(function(p,i){ var t=ptype(p.type); return '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;padding:6px 8px;border-radius:10px;background:rgba(4,8,16,.5);border:1px solid var(--border)"><span style="width:26px;text-align:center;font-size:16px" title="'+t.label+'">'+t.icon+'</span><span class="small muted" style="min-width:120px">'+t.label+'</span><input data-f="label" data-i="'+i+'" value="'+(p.label||'').replace(/"/g,'&quot;')+'" placeholder="Název (např. Tesco, zastávka Náměstí)" lang="cs" style="flex:1;min-width:160px;font-size:13px;padding:7px 9px"><input data-f="note" data-i="'+i+'" value="'+(p.note||'').replace(/"/g,'&quot;')+'" placeholder="Poznámka" lang="cs" style="flex:2;min-width:200px;font-size:13px;padding:7px 9px">'+(p.type==='road'?'<select data-f="visible" data-i="'+i+'" required style="width:auto;font-size:13px;padding:7px 9px;border-color:'+(!p.visible?'rgba(245,180,0,.7)':'rgba(120,160,255,.18)')+'"><option value="" disabled'+(!p.visible?' selected':'')+'>Bude prádlomat vidět ze silnice? *</option><option value="yes"'+(p.visible==='yes'?' selected':'')+'>✓ prádlomat je ze silnice vidět</option><option value="partial"'+(p.visible==='partial'?' selected':'')+'>částečně</option><option value="no"'+(p.visible==='no'?' selected':'')+'>✕ není vidět</option></select>':'')+'<a href="#" data-del="'+i+'" style="color:var(--err);padding:0 6px" title="Smazat">✕</a></div>'; }).join('')
        +(pois.some(function(p){return p.type==='parking';})?'':'<div class="small" style="color:#ffd866">Chybí nejbližší parkoviště (povinné).</div>'); }
    listEl.addEventListener('change',function(e){ var el=e.target; if(el.id==='f-access-sel'){ ACC.value=el.value; var n=document.getElementById('f-access-note'); if(n) n.style.display=el.value==='limited'?'':'none'; if(el.value!=='limited'){ ACCN.value=''; if(n) n.value=''; } return; } if(el.dataset&&el.dataset.f==='visible'){ var i=+el.dataset.i; if(pois[i]){ pois[i].visible=el.value; poisEl.value=JSON.stringify(pois); el.style.borderColor=el.value?'rgba(120,160,255,.18)':'rgba(245,180,0,.7)'; } } });
    listEl.addEventListener('input',function(e){ var el=e.target; if(el.id==='f-access-note'){ ACCN.value=el.value.slice(0,200); return; } if(!el.dataset||!el.dataset.f) return; var i=+el.dataset.i; if(!pois[i]) return; pois[i][el.dataset.f]=el.value.slice(0,200); poisEl.value=JSON.stringify(pois); if(el.dataset.f==='label'&&poiMarkers[i]) poiMarkers[i].setTooltipContent((pois[i].label||ptype(pois[i].type).label)+' · kliknutím smažete'); });
    listEl.addEventListener('click',function(e){ var a=e.target.closest('[data-del]'); if(!a) return; e.preventDefault(); removePoi(+a.getAttribute('data-del')); });
    function removePoi(i){ pois.splice(i,1); redrawPois(); savePois(); }
    function redrawPois(){ poiMarkers.forEach(function(m){ map.removeLayer(m); }); poiMarkers=[]; pois.forEach(function(p,i){ var t=ptype(p.type); var m=L.marker([p.lat,p.lng],{icon:poiIcon(t),draggable:true}).addTo(map); m.bindTooltip((p.label||t.label)+' · kliknutím smažete',{direction:'top'}); m.on('dragend',function(){ var q=m.getLatLng(); pois[i].lat=+q.lat.toFixed(7); pois[i].lng=+q.lng.toFixed(7); savePois(); }); m.on('click',function(ev){ L.DomEvent.stop(ev); if(confirm('Smazat bod '+(p.label||t.label)+'?')) removePoi(i); }); poiMarkers.push(m); }); }
    document.querySelectorAll('.poi-btn').forEach(function(b){ b.addEventListener('click',function(){ addType=this.getAttribute('data-type'); document.querySelectorAll('.poi-btn').forEach(function(x){ x.classList.add('sec'); }); this.classList.remove('sec'); cancelBtn.style.display='inline-flex'; map.getContainer().style.cursor='crosshair'; msg.textContent='Klikněte do mapy, kam umístit: '+ptype(addType).label; }); });
    // Přetažení ikony z lišty do mapy (HTML5 drag & drop); na dotykových zařízeních klik + klik do mapy
    var mapEl=map.getContainer();
    function addPoiAt(type,latlng){ pois.push({type:type,label:'',note:'',lat:+latlng.lat.toFixed(7),lng:+latlng.lng.toFixed(7)}); redrawPois(); savePois(); setTimeout(function(){ var inp=listEl.querySelector('input[data-f="label"][data-i="'+(pois.length-1)+'"]'); if(inp) inp.focus(); },50); }
    document.querySelectorAll('.poi-btn').forEach(function(b){ b.addEventListener('dragstart',function(e){ e.dataTransfer.setData('text/plain',this.getAttribute('data-type')); e.dataTransfer.effectAllowed='copy'; mapEl.classList.add('poi-drop'); }); b.addEventListener('dragend',function(){ mapEl.classList.remove('poi-drop'); }); });
    mapEl.addEventListener('dragover',function(e){ e.preventDefault(); e.dataTransfer.dropEffect='copy'; });
    mapEl.addEventListener('drop',function(e){ e.preventDefault(); var type=e.dataTransfer.getData('text/plain'); if(!type) return; var r=mapEl.getBoundingClientRect(); var p=map.containerPointToLatLng(L.point(e.clientX-r.left,e.clientY-r.top)); addPoiAt(type,p); mapEl.classList.remove('poi-drop'); stopAdd(); });
    // Kontrola před odesláním: Uložit = jen název + adresa (koncept). Vyhodnotit = vše povinné; chybějící položky se vypíší přesně a tlačítka se nikdy nezablokují, dokud formulář neprojde.
    var lastGoto='save'; document.querySelectorAll('.lk-f button[type=submit]').forEach(function(b){ b.addEventListener('click',function(){ lastGoto=b.value||'save'; }); });
    function lkValidate(evalMode){ var form=document.querySelector('form.lk-f'), errs=[], first=null;
      function add(text, el){ errs.push(text); if(!first&&el) first=el; }
      if(!form.name.value.trim()) add('Vyplňte <b>Název lokality</b>.', form.name);
      if(!form.address.value.trim()) add('Vyplňte <b>Adresu</b>.', form.address);
      if(!evalMode) return {errs:errs, first:first};
      if(!lat.value||!lng.value) add('Umístěte <b>prádlomat do mapy</b> – vyhledejte adresu tlačítkem Najít a přetáhněte modrý obdélník na přesné místo.', document.getElementById('site-map'));
      if(!ACC.value) add('V tabulce bodů u řádku <b>Prádlomat</b> vyberte, zda bude <b>přístupný 24/7</b>, nebo omezeně.', document.getElementById('f-access-sel'));
      if(!pois.some(function(p){return p.type==='parking';})) add('Přetáhněte do mapy ikonu <b>Nejbližší parkoviště</b> (povinný bod).', document.getElementById('poi-tools'));
      var bad=pois.filter(function(p){ return p.type==='road'&&!p.visible; }); if(bad.length) add('U hlavní silnice „'+String(bad[0].label||'Hlavní silnice').replace(/[<>&]/g,'')+'“ vyberte ve sloupci vpravo, zda bude <b>prádlomat ze silnice vidět</b>.', listEl.querySelector('select[data-f="visible"]'));
      if(form.ownership&&!form.ownership.value) add('V sekci Nájem a smlouva vyberte, zda je <b>místo vaše vlastní, nebo v nájmu</b>.', form.ownership);
      if(form.vat_payer&&!form.vat_payer.value) add('V sekci Investice vyberte, zda <b>jste plátce DPH</b>.', form.vat_payer);
      return {errs:errs, first:first}; }
    document.querySelector('form.lk-f').addEventListener('submit',function(e){ var goto=(e.submitter&&e.submitter.value)||lastGoto; var evalMode=goto==='eval'; var v=lkValidate(evalMode); var box=document.getElementById('lk-val');
      if(v.errs.length){ e.preventDefault(); renderList(); box.style.display='block'; box.innerHTML='<b>'+(evalMode?'Před vyhodnocením ještě doplňte:':'Před uložením doplňte:')+'</b><ul style="margin:6px 0 0 18px;padding:0">'+v.errs.map(function(t){return '<li>'+t+'</li>';}).join('')+'</ul>';
        if(v.first){ if(v.first.style) v.first.style.outline='2px solid rgba(245,180,0,.8)'; try{ v.first.scrollIntoView({behavior:'smooth',block:'center'}); }catch(x){} if(v.first.focus) try{ v.first.focus({preventScroll:true}); }catch(x){} setTimeout(function(){ if(v.first.style) v.first.style.outline=''; },4000); }
        document.querySelectorAll('.lk-f button[type=submit]').forEach(function(b){ b.disabled=false; }); return; }
      box.style.display='none';
      if(evalMode){ setTimeout(function(){ document.querySelectorAll('.lk-f button[type=submit]').forEach(function(b){ b.disabled=true; }); var be=document.getElementById('btn-eval'); if(be) be.textContent='⏳ Vyhodnocuji a sestavuji studii (1–2 min)…'; },0); } });
    function stopAdd(){ addType=null; cancelBtn.style.display='none'; document.querySelectorAll('.poi-btn').forEach(function(x){ x.classList.add('sec'); }); map.getContainer().style.cursor=''; }
    cancelBtn.addEventListener('click',stopAdd);
    redrawPois(); renderList();
    if(has) draw();
    map.on('click',function(e){ if(addType){ addPoiAt(addType,e.latlng); stopAdd(); return; } if(!dragging&&!rotating) setPin(e.latlng.lat,e.latlng.lng, map.getZoom()<19?20:null); });
    document.getElementById('geo-btn').addEventListener('click',function(){ var f=document.querySelector('form.lk-f'); var ad=f.address.value.trim(), ci=f.city.value.trim(); if(ad.length<2&&ci.length<2){ msg.textContent='Nejdřív vyplňte adresu nebo město.'; return; } msg.textContent='Hledám…';
      fetch('/api/location/geocode?address='+encodeURIComponent(ad)+'&city='+encodeURIComponent(ci)).then(function(r){return r.json();}).then(function(j){ var pick=document.getElementById('geo-pick'); pick.style.display='none'; if(j&&j.lat!=null){ setPin(j.lat,j.lon,j.level==='town'?16:20); msg.textContent=(j.level==='town'?'Přesná adresa nenalezena, zobrazuji obec: ':'Nalezeno: ')+(j.display_name||ad)+' – prádlomat přetáhněte přesně na místo.';
        if(j.candidates&&j.candidates.length>1){ pick.innerHTML=j.candidates.map(function(c,i){ return '<option value="'+i+'">'+c.display_name.replace(/</g,'&lt;')+'</option>'; }).join(''); pick.style.display='inline-block'; pick.onchange=function(){ var c=j.candidates[+this.value]; setPin(c.lat,c.lon,20); msg.textContent='Nalezeno: '+c.display_name+' – prádlomat přetáhněte přesně na místo.'; }; }
      } else msg.textContent=(j&&j.error)||'Adresa nenalezena – klikněte do mapy ručně.'; }).catch(function(){ msg.textContent='Vyhledání selhalo – klikněte do mapy ručně.'; }); });
  })();</script>`, LEAFLET_HEAD);
}

// ── Dokoupení kreditů (vyhodnocení / vyhledání): kostky + modal se 3 balíčky → POST /lokalita/dokoupit → Stripe ──
const BUY_CSS = `<style>.lk-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:0 0 14px}.lk-stats .st{padding:16px 18px;border:1px solid var(--border);border-radius:14px;background:var(--card)}.lk-stats .st .n{font-size:30px;font-weight:800;line-height:1.1}.lk-stats .st .l{font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-top:4px}.lk-stats .st.buy{border-color:rgba(124,92,255,.5);background:rgba(124,92,255,.08);display:flex;flex-direction:column;justify-content:center;gap:8px}
  .lk-modal{position:fixed;inset:0;background:rgba(2,4,10,.78);display:none;align-items:center;justify-content:center;z-index:1000;padding:16px}.lk-modal.on{display:flex}.lk-modal .bx{background:#0b1222;border:1px solid var(--border2);border-radius:18px;padding:22px;max-width:760px;width:100%;box-shadow:0 30px 80px rgba(0,0,0,.6)}
  .pk-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}.pk{margin:0;padding:16px;border:1px solid var(--border);border-radius:14px;background:var(--card);text-align:center}.pk:nth-child(2){border-color:rgba(79,209,255,.5)}.pk-n{font-size:34px;font-weight:800;color:var(--accent2)}.pk-l{font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.06em}.pk-p{font-size:20px;font-weight:700;margin-top:8px}
  @media(max-width:700px){.lk-stats,.pk-grid{grid-template-columns:1fr}}</style>`;
function buyBlock({ used, limit, base, packs, unit, unitPl, title, hint, extraLabel }) {
  const left = Math.max(0, limit - used);
  const packCard = (k, p) => { const n = p.evals || p.searches || 0; return `<form method="post" action="/lokalita/dokoupit" class="pk"><input type="hidden" name="pack" value="${k}"><div class="pk-n">${n}</div><div class="pk-l">${unitPl}</div><div class="pk-p">${Math.round(p.amount / 100).toLocaleString('cs-CZ')} Kč</div><div class="small muted">${Math.round(p.amount / 100 / n).toLocaleString('cs-CZ')} Kč / ${unit} · s DPH</div><button class="btn sm" type="submit" style="margin-top:10px;width:100%">Vybrat a zaplatit</button></form>`; };
  return `${BUY_CSS}
  <div class="lk-stats">
    <div class="st"><div class="n" id="buy-used">${used}</div><div class="l">Využitá ${unitPl}</div></div>
    <div class="st"><div class="n" id="buy-left" style="color:${left > 0 ? 'var(--ok)' : 'var(--err)'}">${left}</div><div class="l">Zbývá ${unitPl}${limit > base ? ` · z toho dokoupeno ${limit - base}` : ''}</div></div>
    <div class="st buy"><div class="l" style="margin:0">${extraLabel}</div><button class="btn" type="button" id="buy-btn" style="width:100%">${title}</button></div>
  </div>
  <div class="lk-modal" id="buy-modal"><div class="bx"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><h2 style="margin:0">${title}</h2><p class="muted small" style="margin:4px 0 0">${hint} Platnost přístupu se nemění. Platba kartou přes Stripe.</p></div><button class="btn sec sm" type="button" id="buy-close">✕</button></div>
    <div class="pk-grid">${Object.entries(packs).map(([k, p]) => packCard(k, p)).join('')}</div></div></div>
  <script>(function(){var m=document.getElementById('buy-modal'),b=document.getElementById('buy-btn');if(!m||!b)return;function open(){m.classList.add('on');}window.lkBuyOpen=open;b.addEventListener('click',open);document.getElementById('buy-close').addEventListener('click',function(){m.classList.remove('on');});m.addEventListener('click',function(e){if(e.target===m)m.classList.remove('on');});document.addEventListener('keydown',function(e){if(e.key==='Escape')m.classList.remove('on');});})();</script>`;
}

// ── Seznam lokalit ───────────────────────────────────────────────────────────
function listPage(s, sites, info) {
  const limit = info.limit != null ? info.limit : (LIMITS[info.package] || 3), used = info.used != null ? info.used : sites.filter((x) => x.evaluated_at).length;
  const exp = info.expires_at ? new Date(info.expires_at) : null;
  const packs = Object.fromEntries(Object.entries(info.packs || {}).filter(([, p]) => p.evals));
  return page(s, 'Moje lokality', 'loc', `
  <div class="hero"><span class="eyebrow"><i></i>Prověření lokality · balíček ${esc(PKG_LABEL[info.package] || info.package)}</span>
    <h1><span class="g">Moje lokality</span></h1>
    <p>Lokalita se z balíčku odečte až prvním vyhodnocením; ukládání a úpravy jsou neomezené${exp ? ` · přístup do ${exp.toLocaleDateString('cs-CZ')}` : ''}.</p></div>
  ${info.msg ? `<div class="msg ok">${esc(info.msg)}</div>` : ''}
  <style>.lk-spin{width:22px;height:22px;border:3px solid rgba(79,209,255,.25);border-top-color:var(--accent2);border-radius:50%;animation:lkspin .9s linear infinite;flex:none}@keyframes lkspin{to{transform:rotate(360deg)}}
  .lk-proc{border:1px solid rgba(79,209,255,.45);background:linear-gradient(135deg,rgba(30,134,224,.18),rgba(124,92,255,.14));border-radius:18px;padding:22px 24px;margin:0 0 16px;display:flex;gap:18px;align-items:center}.lk-proc .big{width:54px;height:54px;border-width:5px}.lk-proc h2{margin:0 0 4px}.lk-proc p{margin:0;color:var(--text2)}</style>
  ${info.evaluating ? (() => { const x = sites.find((y) => y.id === info.evaluating); return x ? `<div class="lk-proc"><div class="lk-spin big"></div><div><h2>Vyhodnocení lokality „${esc(x.name)}" běží</h2><p>Zpracováváme a vyhodnocujeme data lokality – spádovost, okolí, provoz, poptávku a ekonomiku. <b>Trvá to přibližně 15 minut.</b> Stránku můžete zavřít, hotovou studii najdete zde v seznamu a pošleme vám e-mail.</p></div></div>` : ''; })() : ''}
  ${buyBlock({ used, limit, base: LIMITS[info.package] || 3, packs, unit: 'lokalita', unitPl: 'vyhodnocení', title: 'Dokoupit vyhodnocení', hint: 'Vyhodnocení se po zaplacení ihned připíší k vašemu účtu.', extraLabel: 'Potřebujete prověřit další místa?' })}
  <div class="row" style="margin:6px 0 14px"><a class="btn" href="/lokalita/new">+ Nová lokalita</a>${used >= limit ? '<span class="muted small">Vyhodnocení v balíčku jsou vyčerpána – další lokality lze uložit, ale ne vyhodnotit. Dokupte vyhodnocení výše.</span>' : ''}</div>
  ${sites.length ? `<div class="lk-grid">${sites.map((x) => { const ev = x.result || {}; const running = x.evaluated_at && x.study_status === 'running'; const failed = x.evaluated_at && x.study_status === 'error'; return `<div class="card" style="margin:0" data-site="${x.id}" data-status="${esc(x.evaluated_at ? (x.study_status || 'done') : '')}"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><b style="font-size:16px">${esc(x.name)}</b><div class="small muted">${esc(x.address || '')}${x.city ? ', ' + esc(x.city) : ''}</div></div>${running ? '<span class="row" style="gap:8px;align-items:center;color:var(--accent2);font-size:13px;font-weight:600"><span class="lk-spin"></span>Vyhodnocuje se… (cca 15 min)</span>' : failed ? `<form method="post" action="/lokalita/${x.id}/studie" style="margin:0"><button class="btn sec sm" type="submit" title="${esc(x.study_error || '')}">⚠️ Vyhodnocení se nezdařilo – zkusit znovu</button></form>` : x.evaluated_at ? `<a class="btn sm" href="/lokalita/${x.id}/studie">🧠 Studie</a>` : '<span class="badge invited">koncept – nevyhodnoceno</span>'}</div>
    ${ev.result && x.evaluated_at ? `<div style="margin-top:10px"><span class="res ${ev.cls}" style="font-size:12px;padding:4px 10px">${esc(ev.result)}</span></div>` : ''}
    ${x.calc && x.evaluated_at ? (() => { const col = (v) => ev.cls === 'bad' || v < 0 ? 'var(--err)' : ev.cls === 'cond' ? '#ffd866' : 'var(--ok)'; return `<div class="small muted" style="margin-top:8px">Střední scénář: provozní výsledek <b style="color:${col(x.calc.mid_operating)}">${Math.round(x.calc.mid_operating).toLocaleString('cs-CZ')} Kč/měs</b>, po splátce <b style="color:${col(x.calc.mid_cash)}">${Math.round(x.calc.mid_cash).toLocaleString('cs-CZ')} Kč/měs</b></div>`; })() : ''}
    <div class="row" style="margin-top:12px">${running ? '' : `<a class="btn sec sm" href="/lokalita/${x.id}">${x.evaluated_at ? 'Upravit' : 'Doplnit a vyhodnotit'}</a>`}<form method="post" action="/lokalita/${x.id}/delete" style="margin:0" onsubmit="return confirm('Smazat lokalitu? Adresa se vrátí do limitu.')"><button class="btn danger sm" type="submit">Smazat</button></form></div></div>`; }).join('')}</div>` : '<div class="card"><p class="muted" style="margin:0">Zatím nemáte žádnou lokalitu. Začněte tlačítkem <b>Nová lokalita</b>.</p></div>'}
  ${sites.some((x) => x.evaluated_at && x.study_status === 'running') ? `<script>(function(){ function tick(){ fetch('/api/location/sites-status',{cache:'no-store'}).then(function(r){return r.json();}).then(function(list){ var changed=false; (list||[]).forEach(function(s){ var el=document.querySelector('[data-site="'+s.id+'"]'); if(el&&el.getAttribute('data-status')==='running'&&s.status!=='running') changed=true; }); if(changed) location.href='/lokalita'; else setTimeout(tick,15000); }).catch(function(){ setTimeout(tick,30000); }); } setTimeout(tick,15000); })();</script>` : ''}
  ${info.package === 'premium' ? `<div class="card" style="margin-top:14px"><h2 style="margin:0 0 6px">Místní šetření technikem</h2>${info.survey_date ? `<p class="muted" style="margin:0">Termín: <b>${esc(info.survey_date)}</b>${info.survey_tech ? ' · technik ' + esc(info.survey_tech) : ''}</p>${info.survey_report ? `<div class="rep" style="margin-top:8px"><h4>Zpráva z šetření</h4><p style="white-space:pre-wrap;color:var(--text2)">${esc(info.survey_report)}</p></div>` : '<p class="small muted">Zpráva bude doplněna po návštěvě.</p>'}` : '<p class="muted" style="margin:0">Součást balíčku Premium. Napište nám přes Podporu, kterou lokalitu má technik navštívit – termín pak uvidíte zde.</p>'}</div>` : ''}`);
}

// ── Report ───────────────────────────────────────────────────────────────────
const kc = (n) => Math.round(n).toLocaleString('cs-CZ') + ' Kč';
function parsePois(d) { try { const p = JSON.parse(d.pois || '[]'); return Array.isArray(p) ? p.filter((x) => x && isFinite(+x.lat) && isFinite(+x.lng)).slice(0, 50) : []; } catch (e) { return []; } }
function reportSections(site, d, c, ev) {
  const sc = (x, hi) => `<div class="c${hi ? ' hi' : ''}"><div class="k">${x.name} · ${x.washes} zákazníků / den</div><div class="v">${kc(x.gross)}<span class="small muted" style="font-weight:500"> tržba s DPH</span></div>
    <div class="cas"><div><span>Tržba bez DPH</span><b>${kc(x.net)}</b></div><div><span>Energie a voda</span><b>− ${kc(x.energy)}</b></div><div><span>Servis</span><b>− ${kc(x.service)}</b></div><div><span>Platební poplatky</span><b>− ${kc(x.fees)}</b></div><div><span>Fixní (nájem, software, pojištění, marketing, ostatní)</span><b>− ${kc(x.fixed)}</b></div><div><span>Rezerva na obnovu</span><b>− ${kc(x.reserve)}</b></div>
    <div class="t"><span>Provozní výsledek (před financováním a daní)</span><b class="${x.operating >= 0 ? 'pos' : 'neg'}">${kc(x.operating)}</b></div>${x.payment ? `<div><span>Splátka financování</span><b>− ${kc(x.payment)}</b></div><div class="t"><span>Peněžní tok po splátce</span><b class="${x.cash >= 0 ? 'pos' : 'neg'}">${kc(x.cash)}</b></div>` : ''}<div><span>Návratnost investice</span><b>${x.payback ? (x.payback / 12).toFixed(1) + ' roku' : '—'}</b></div></div></div>`;
  const li = (arr) => arr.length ? '<ul>' + arr.map((t) => `<li>${esc(t)}</li>`).join('') + '</ul>' : '<p class="small muted" style="margin:0">—</p>';
  // Tisková varianta scénářů: jedna přehledná tabulka (3 sloupce)
  const S3 = [c.S.weak, c.S.mid, c.S.strong];
  const row = (label, f, cls) => `<tr${cls ? ' class="' + cls + '"' : ''}><td>${label}</td>${S3.map((x) => `<td style="text-align:right;font-variant-numeric:tabular-nums">${f(x)}</td>`).join('')}</tr>`;
  const scenTable = `<div class="card rep"><h2 style="margin:0 0 8px">Ekonomické scénáře <span class="small muted" style="font-weight:500">měsíčně · liší se jen návštěvností</span></h2>
    <table class="scen-tbl"><thead><tr><th></th>${S3.map((x) => `<th style="text-align:right">${x.name}<br><span style="font-weight:500;text-transform:none;letter-spacing:0">${x.washes} zákazníků / den</span></th>`).join('')}</tr></thead><tbody>
    ${row('Tržba s DPH', (x) => '<b>' + kc(x.gross) + '</b>')}${row('Tržba bez DPH', (x) => kc(x.net))}${row('Energie a voda', (x) => '− ' + kc(x.energy))}${row('Servis', (x) => '− ' + kc(x.service))}${row('Platební poplatky', (x) => '− ' + kc(x.fees))}${row('Fixní náklady (nájem, software, pojištění, marketing, ostatní)', (x) => '− ' + kc(x.fixed))}${row('Rezerva na obnovu', (x) => '− ' + kc(x.reserve))}
    ${row('<b>Provozní výsledek (před financováním a daní)</b>', (x) => `<b style="color:${x.operating >= 0 ? 'var(--ok)' : 'var(--err)'}">${kc(x.operating)}</b>`, 't')}${c.payment ? row('Splátka financování', (x) => '− ' + kc(x.payment)) + row('<b>Peněžní tok po splátce</b>', (x) => `<b style="color:${x.cash >= 0 ? 'var(--ok)' : 'var(--err)'}">${kc(x.cash)}</b>`, 't') : ''}${row('Návratnost investice', (x) => x.payback ? (x.payback / 12).toFixed(1) + ' roku' : '—')}
    </tbody></table>
    <div class="row small" style="margin-top:8px;gap:14px;flex-wrap:wrap"><span>Bod zvratu provozu: <b>${c.be_operating != null ? c.be_operating + ' zákazníků / den' : 'nedosažen'}</b></span>${c.payment ? `<span>Bod zvratu po splátce: <b>${c.be_cash != null ? c.be_cash + ' zákazníků / den' : 'nedosažen'}</b></span>` : ''}<span>Investice celkem: <b>${kc(c.invest)}</b> <span class="muted">${c.payer ? 'bez DPH' : 's DPH'}</span></span>${c.payment ? `<span>Splátka: <b>${kc(c.payment)}/měs</b></span>` : ''}</div></div>`;
  return { scenTable, map: `${d.lat && d.lng ? `<div class="card" style="padding:10px"><div id="rep-map" style="height:340px;border-radius:12px;overflow:hidden;z-index:0"></div><script>(function(){var a=${num(d.lat)},b=${num(d.lng)},h=${num(d.heading)};var m=L.map('rep-map',{scrollWheelZoom:false,maxZoom:22}).setView([a,b],19);L.tileLayer('https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}',{attribution:'Ortofoto &copy; ČÚZK',maxZoom:22,maxNativeZoom:20}).addTo(m);var R=6378137,rad=h*Math.PI/180,cs=Math.cos(rad),sn=Math.sin(rad),l0=a*Math.PI/180;function off(x,y){var xr=x*cs-y*sn,yr=x*sn+y*cs;return [a+(yr/R)*180/Math.PI,b+(xr/(R*Math.cos(l0)))*180/Math.PI];}L.polygon([off(-1.5,-1),off(1.5,-1),off(1.5,1),off(-1.5,1)],{color:'#4fd1ff',weight:2,fillColor:'#1e86e0',fillOpacity:.55}).addTo(m);L.polyline([off(-0.5,1.7),off(0,2.2),off(0.5,1.7),off(0,2.2),off(0,1)],{color:'#2fe3a0',weight:3}).addTo(m);var P=${JSON.stringify(parsePois(d))},T=${JSON.stringify(Object.fromEntries(POI_TYPES.map((t) => [t.key, t])))};var bnd=[[a,b]];P.forEach(function(p,i){var t=T[p.type]||T.other;L.marker([p.lat,p.lng],{icon:L.divIcon({className:'',html:'<div style="position:relative;width:28px;height:28px;border-radius:50%;background:rgba(4,8,16,.85);border:2px solid '+t.color+';display:flex;align-items:center;justify-content:center;font-size:14px">'+t.icon+'<span style="position:absolute;right:-7px;top:-7px;min-width:16px;height:16px;border-radius:999px;background:'+t.color+';color:#061018;font:800 10px/16px Inter,sans-serif;text-align:center;padding:0 3px">'+(i+1)+'</span></div>',iconSize:[28,28],iconAnchor:[14,14]})}).addTo(m).bindTooltip((i+1)+' · '+(p.label||t.label)+(p.note?' · '+p.note:'')+(p.type==='road'?(p.visible==='yes'?' · vidět ✓':p.visible==='no'?' · nevidět ✕':p.visible==='partial'?' · částečně':''):''),{direction:'top',offset:[0,-14]});bnd.push([p.lat,p.lng]);});if(bnd.length>1){try{m.fitBounds(bnd,{padding:[30,30],maxZoom:19});}catch(e){}}})();</script>
    <div class="row" style="gap:6px 12px;flex-wrap:wrap;margin:8px 4px 2px;font-size:12.5px;color:var(--text2)">${parsePois(d).map((p, i) => { const t = POI_TYPES.find((x) => x.key === p.type) || POI_TYPES[POI_TYPES.length - 1]; return `<span><b style="color:${t.color}">${i + 1}</b> ${t.icon} ${esc(p.label || t.label)}${p.note ? ' <span class="muted">· ' + esc(p.note) + '</span>' : ''}${p.type === 'road' ? ' <span class="muted">· ' + (p.visible === 'yes' ? 'vidět ✓' : p.visible === 'no' ? 'nevidět ✕' : p.visible === 'partial' ? 'částečně' : '') + '</span>' : ''}</span>`; }).join('')}</div></div>` : ''}`, scenarios: `<div class="card rep"><h2 style="margin:0 0 10px">Ekonomické scénáře <span class="small muted" style="font-weight:500">měsíčně · liší se jen návštěvností</span></h2>
    <div class="sc">${sc(c.S.weak)}${sc(c.S.mid, true)}${sc(c.S.strong)}</div>
    <div class="row" style="margin-top:12px;gap:18px;flex-wrap:wrap"><span class="small">Bod zvratu provozu: <b>${c.be_operating != null ? c.be_operating + ' zákazníků / den' : 'nedosažen do 60/den'}</b></span>${c.payment ? `<span class="small">Bod zvratu po splátce: <b>${c.be_cash != null ? c.be_cash + ' zákazníků / den' : 'nedosažen'}</b></span>` : ''}<span class="small">Investice celkem: <b>${kc(c.invest)}</b> <span class="muted">${c.payer ? 'bez DPH' : 's DPH'}</span></span>${c.payment ? `<span class="small">Splátka: <b>${kc(c.payment)}/měs</b></span>` : ''}</div>
  </div>`, facts: `<div class="lk-grid rep">
    <div class="card" style="margin:0"><h4 style="margin-top:0">Zadal zákazník</h4>${li(ev.given)}</div>
    <div class="card" style="margin:0"><h4 style="margin-top:0">Modelové předpoklady</h4>${li(ev.assumed)}</div>
    <div class="card miss" style="margin:0"><h4 style="margin-top:0">Chybějící údaje</h4>${li(ev.missing)}</div>
    <div class="card warn" style="margin:0"><h4 style="margin-top:0">Hlavní rizika</h4>${li(ev.risks)}</div>
    <div class="card" style="margin:0"><h4 style="margin-top:0">Doporučené další kroky</h4>${li(ev.steps)}</div>
  </div>
  ${d.notes ? `<div class="card rep" style="margin-top:12px"><h4 style="margin-top:0">Poznámky</h4><p style="white-space:pre-wrap;color:var(--text2);margin:0">${esc(d.notes)}</p></div>` : ''}
` };
}
function reportPage(s, site, d, c, ev, studyErr) {
  const R = reportSections(site, d, c, ev);
  return page(s, 'Vyhodnocení – ' + (site.name || ''), 'loc', `
  <div class="row no-print" style="justify-content:space-between;flex-wrap:wrap;gap:10px"><a class="btn sec sm" href="/lokalita">← Moje lokality</a><div class="row"><a class="btn sec sm" href="/lokalita/${site.id}">Upravit údaje</a><form method="post" action="/lokalita/${site.id}/studie" style="margin:0" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Zpracovávám studii… (1–2 min)'"><button class="btn sm" type="submit">🧠 Vypracovat studii znovu</button></form></div></div>
  ${studyErr ? `<div class="msg err" style="margin-top:10px">${esc(studyErr)}</div>` : ''}
  <div class="card" style="margin-top:12px"><div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px"><div><div class="small muted">Orientační vyhodnocení lokality · ${new Date().toLocaleDateString('cs-CZ')}</div><h1 style="margin:2px 0 4px">${esc(site.name)}</h1></div><span class="res ${ev.cls}">${esc(ev.result)}</span></div><p class="small muted" style="margin:10px 0 0">AI studii se nepodařilo vypracovat – níže je základní vyhodnocení. Zkuste studii spustit znovu.</p></div>
  ${R.map}${R.scenarios}${R.facts}`, (d.lat && d.lng) ? LEAFLET_HEAD : '');
}
// ── Vyhledávač míst: spádová oblast 15 km (populace, kapacita, provozované prádlomaty) ──
// Data: HolyOS veřejné API /api/pradlomat-spots/public/* přes BS2 proxy (/api/location/area, /api/location/existing).
function analyzerPage(s, q, credits, msg) {
  credits = credits || null;
  const head = `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" crossorigin="anonymous" referrerpolicy="no-referrer"><script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`;
  return page(s, 'Vyhledávač míst', 'anal', `
  <div class="hero"><span class="eyebrow"><i></i>Vyhledávač míst</span><h1><span class="g">Spádová oblast</span> vašeho města</h1><p>Zadejte město – ukážeme počet obyvatel v okruhu 15 km, odhad kapacity (kolik prádlomatů oblast uživí) a prádlomaty, které už v okolí fungují. Výsledek si přeneste do nové lokality.</p></div>
  ${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}
  ${credits ? buyBlock({ used: credits.used, limit: credits.limit, base: credits.base, packs: credits.packs || {}, unit: 'vyhledání', unitPl: 'vyhledání', title: 'Dokoupit vyhledání', hint: 'Vyhledání se po zaplacení ihned připíší k vašemu účtu.', extraLabel: 'Chcete prověřit další města?' }) : ''}
  <div class="card" style="padding:12px"><div class="row" style="gap:8px;flex-wrap:wrap"><input id="an-q" value="${esc(q || '')}" data-q="${esc(q || '')}" placeholder="Zadejte své město, např. Tábor" style="flex:1;min-width:220px" autocomplete="off"><button class="btn" type="button" id="an-btn">🔎 Analyzovat</button><button class="btn sec" type="button" id="an-pin" title="Ve velkých městech: analýza kolem přesného místa">📍 Špendlík do mapy</button></div><div class="small muted" style="margin-top:8px">Jedno město = jedno vyhledávání. Výsledek se trvale uloží – k uloženým vyhledáváním se vracíte zdarma a znovu se neanalyzují.</div>
    ${credits && credits.saved && credits.saved.length ? `<div style="margin-top:10px"><div class="small muted" style="margin-bottom:6px">Uložená vyhledávání</div><div class="row" style="gap:6px;flex-wrap:wrap">${credits.saved.map((x) => `<a class="btn sec sm" href="/lokalita/analyza?q=${encodeURIComponent(x.area)}" title="${esc(new Date(x.created_at).toLocaleDateString('cs-CZ'))}">📌 ${esc(x.label || x.area)}${Number(x.n_contacts) ? ` <span class="muted">· ${Number(x.n_contacts)} kont.</span>` : ''}</a>`).join('')}</div></div>` : ''}</div>
  <div id="an-map" style="height:380px;border-radius:16px;border:1px solid var(--border);background:#0e1e33;z-index:0;overflow:hidden"></div>
  <div class="lk-modal" id="cand-modal"><div class="bx" style="max-width:900px"><div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px"><div><h2 style="margin:0" id="cand-title"></h2><div class="small muted" id="cand-sub"></div></div><div class="row" style="gap:6px"><button class="btn sm" type="button" data-base="orto">Letecká</button><button class="btn sec sm" type="button" data-base="street">Ulice</button><button class="btn sec sm" type="button" id="cand-close">✕</button></div></div>
    <div id="cand-map" style="height:60vh;min-height:320px;margin-top:12px;border-radius:14px;border:1px solid var(--border);background:#0e1e33;overflow:hidden"></div>
    <div class="row" style="margin-top:10px;justify-content:space-between;flex-wrap:wrap;gap:8px"><span class="small muted">Kruh = 150 m kolem místa. Přesnou polohu prádlomatu vyberete při založení lokality.</span><a class="btn sec sm" id="cand-gmaps" href="#" target="_blank" rel="noopener">Otevřít v Google Maps ↗</a></div></div></div>
  <div id="an-out" style="margin-top:12px"></div>
  <style>.an-big{display:flex;flex-direction:column;align-items:flex-end}.an-big .n{font-size:34px;font-weight:800;letter-spacing:-.02em;background:linear-gradient(90deg,#fff,var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent;line-height:1}.an-big .l{font-size:12px;color:var(--text2)}
  .town{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text2);background:rgba(4,8,16,.55);border:1px solid var(--border);border-radius:999px;padding:4px 10px}.town .d{width:9px;height:9px;border-radius:50%;display:inline-block}.towns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .an-box{margin-top:10px;padding:12px 14px;border-radius:12px;border:1px solid var(--border2);background:rgba(30,134,224,.1)} .an-box.ok{border-color:rgba(47,227,160,.4);background:rgba(47,227,160,.08);color:#a9f5d9} .an-box b.t{color:var(--accent2)}
  .cand-tbl{table-layout:fixed;width:100%}.cand-tbl td{vertical-align:top;word-wrap:break-word;overflow-wrap:anywhere}.cand-tbl .ct-more{display:none;margin-top:6px;padding-top:6px;border-top:1px dashed var(--border)}.cand-tbl .ct-open .ct-more{display:block}.ct-tgl{background:none;border:0;color:var(--accent2);cursor:pointer;padding:0;font:inherit;font-size:12.5px}
  .leaflet-container{font-family:inherit}.lk-spin{width:18px;height:18px;border:3px solid rgba(79,209,255,.25);border-top-color:var(--accent2);border-radius:50%;animation:lkspin .9s linear infinite;flex:none}@keyframes lkspin{to{transform:rotate(360deg)}}</style>
  <script>(function(){
    var map=L.map('an-map',{scrollWheelZoom:false}).setView([49.8,15.5],7);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',{attribution:'Tiles &copy; Esri',maxZoom:19}).addTo(map);
    var layers=[], existing=[]; function esc(t){return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
    function popColor(p){return p>=50000?'#7f0000':p>=20000?'#b30000':p>=10000?'#d7301f':p>=5000?'#ef6548':p>=2000?'#fc8d59':p>=1000?'#fdbb84':p>=500?'#fdd49e':'#fee8c8';}
    function popRadius(p){return Math.max(4,Math.min(30,Math.sqrt(p)/3));}
    fetch('/api/location/existing').then(function(r){return r.ok?r.json():[]}).then(function(list){(list||[]).forEach(function(w){if(w.lat==null||w.lon==null)return;var m=L.circleMarker([w.lat,w.lon],{radius:5,color:'#fff',weight:1.4,fillColor:'#1e86e0',fillOpacity:.95}).addTo(map);m.bindTooltip('🧺 '+esc(w.name),{direction:'top'});existing.push(m);});}).catch(function(){});
    var out=document.getElementById('an-out'),inp=document.getElementById('an-q'),btn=document.getElementById('an-btn');
    var SAVED_LIST=${JSON.stringify(((credits && credits.saved) || []).map((x) => x.area)).replace(/</g, '\\u003c')}, LEFT=${credits ? Math.max(0, credits.limit - credits.used) : 0};
    function normQ(t){return String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}
    function run(){var q=inp.value.trim(); if(q.length<2)return;
      // Jedno město = jedno vyhledávání: už analyzované město se jen otevře z uložených, nová analýza se nespouští
      var sv=SAVED_LIST.find(function(a){return normQ(a)===normQ(q);}); if(sv){ if(SAVED&&SAVED.result&&normQ(inp.getAttribute('data-q')||'')===normQ(q)) return; location.href='/lokalita/analyza?q='+encodeURIComponent(sv); return; }
      if(LEFT<=0){ out.innerHTML='<div class="msg err">Vyhledání v balíčku jsou vyčerpána. <a href="#" id="an-buy">Dokoupit vyhledání</a></div>'; var ab=document.getElementById('an-buy'); if(ab) ab.addEventListener('click',function(e){e.preventDefault();if(window.lkBuyOpen)window.lkBuyOpen();}); return; }
      if(!window._anSkipConfirm&&!confirm('Analýza místa „'+q+'“ odečte 1 vyhledání (zbývá '+LEFT+'). Každé město lze analyzovat jen jednou – výsledek se trvale uloží. Pokračovat?')) return; window._anSkipConfirm=false;
      btn.disabled=true; var old=btn.textContent; btn.textContent='Hledám…'; out.innerHTML='<div class="card"><span class="muted">Analyzuji spádovou oblast '+esc(q)+' (15 km)…</span></div>';
      fetch('/api/location/area?area='+encodeURIComponent(q)).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});}).then(function(res){btn.disabled=false;btn.textContent=old; if(res.j&&res.j.credits){var u=document.getElementById('buy-used'),l=document.getElementById('buy-left');if(u)u.textContent=res.j.credits.used;if(l){var left=Math.max(0,res.j.credits.limit-res.j.credits.used);l.textContent=left;l.style.color=left>0?'var(--ok)':'var(--err)';}} var overl=res.j&&/Overpass|přetížen|nedostupn/i.test(String(res.j.error||'')); if(!res.ok&&overl&&(window._anRetry=(window._anRetry||0)+1)<=5){ out.innerHTML='<div class="card"><div class="row" style="gap:8px;align-items:center"><span class="lk-spin"></span><span class="muted">Mapová data jsou právě zaneprázdněná, zkouším znovu ('+window._anRetry+'/5)… vydržte prosím.</span></div></div>'; window._anSkipConfirm=true; setTimeout(run,15000); return; } window._anRetry=0; window._anSkipConfirm=false;
        if(!res.ok){out.innerHTML='<div class="msg err">'+esc((res.j&&res.j.error)||'Analýzu se nepodařilo spustit.')+(res.j&&res.j.buy?' <a href="#" id="an-buy">Dokoupit vyhledání</a>':'')+'</div>';var ab=document.getElementById('an-buy');if(ab)ab.addEventListener('click',function(e){e.preventDefault();if(window.lkBuyOpen)window.lkBuyOpen();});return;} render(res.j,q);}).catch(function(){btn.disabled=false;btn.textContent=old;out.innerHTML='<div class="msg err">Chyba spojení, zkuste to prosím znovu.</div>';});}
    function render(r,q){layers.forEach(function(l){try{map.removeLayer(l);}catch(e){}});layers=[];
      if(r.center){var rk=r.radius_km||15;var ring=L.circle([r.center.lat,r.center.lon],{radius:rk*1000,color:'#4fd1ff',weight:2,fill:true,fillColor:'#1e86e0',fillOpacity:.06,dashArray:'6 6'}).addTo(map);layers.push(ring);
        layers.push(L.circle([r.center.lat,r.center.lon],{radius:10000,color:'#a78bfa',weight:1.5,fill:false,dashArray:'4 6'}).addTo(map).bindTooltip('10 km',{permanent:false}));layers.push(L.circle([r.center.lat,r.center.lon],{radius:5000,color:'#2fe3a0',weight:1.5,fill:false,dashArray:'4 6'}).addTo(map).bindTooltip('5 km'));layers.push(L.circleMarker([r.center.lat,r.center.lon],{radius:5,color:'#fff',weight:2,fillColor:'#4fd1ff',fillOpacity:1}).addTo(map).bindTooltip('Střed',{direction:'top'}));
        (r.places||[]).forEach(function(p){var cm=L.circleMarker([p.lat,p.lon],{radius:popRadius(p.population),color:'rgba(0,0,0,.35)',weight:.5,fillColor:popColor(p.population),fillOpacity:.8}).addTo(map);cm.bindTooltip(esc(p.name)+': '+p.population.toLocaleString('cs-CZ'),{direction:'top'});layers.push(cm);});
        try{map.fitBounds(ring.getBounds(),{padding:[20,20]});}catch(e){}}
      var title=r.label||((r.center&&r.center.display_name&&!/^-?\d/.test(r.center.display_name))?r.center.display_name.split(',')[0]:q), rk2=r.radius_km||15;
      var tot=r.total_population!=null?r.total_population.toLocaleString('cs-CZ'):'—', dens=r.density_per_km2!=null?r.density_per_km2.toLocaleString('cs-CZ'):'—';
      function sumR(rad){var pl=(r.places||[]).filter(function(p){return p.dist_km!=null&&p.dist_km<=rad;});return {pop:pl.reduce(function(a,p){return a+(+p.population||0);},0),n:pl.length};}
      var r5=sumR(5),r10=sumR(10),r15={pop:r.total_population!=null?+r.total_population:sumR(15).pop,n:(r.places||[]).length};
      var radii='<div class="lk-stats" style="margin:12px 0 0"><div class="st" style="border-color:rgba(47,227,160,.45)"><div class="n" style="color:#2fe3a0">'+r5.pop.toLocaleString('cs-CZ')+'</div><div class="l">Spádovost 5 km · '+r5.n+' obcí</div></div><div class="st" style="border-color:rgba(167,139,250,.45)"><div class="n" style="color:#a78bfa">'+r10.pop.toLocaleString('cs-CZ')+'</div><div class="l">Spádovost 10 km · '+r10.n+' obcí</div></div><div class="st" style="border-color:rgba(79,209,255,.45)"><div class="n" style="color:var(--accent2)">'+r15.pop.toLocaleString('cs-CZ')+'</div><div class="l">Spádovost 15 km · '+r15.n+' obcí</div></div></div>';
      var towns=(r.places||[]).slice(0,12).map(function(p){return '<span class="town"><span class="d" style="background:'+popColor(p.population)+'"></span>'+esc(p.name)+' — '+p.population.toLocaleString('cs-CZ')+(p.dist_km!=null?' · '+p.dist_km+' km':'')+'</span>';}).join('');
      var cap=r.capacity,capHtml='';
      if(cap&&cap.recommended>0){capHtml='<div class="an-box"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><b class="t">📦 Kapacita oblasti: '+cap.recommended+'× prádlomat</b><span class="small muted">1 prádlomat / '+cap.per_pradlomat.toLocaleString('cs-CZ')+' obyvatel</span></div>'+((cap.allocation||[]).length?'<div class="towns">'+cap.allocation.map(function(a){return '<span class="town"><b style="color:var(--accent2)">'+a.units+'×</b>&nbsp;'+esc(a.name)+' <span class="muted">· '+a.population.toLocaleString('cs-CZ')+' obyv.</span></span>';}).join('')+'</div>':'')+'</div>';}
      var op=r.operating||[]; var plur=function(n){return n===1?'prádelna':(n>=2&&n<=4?'prádelny':'prádelen');};
      var oper=op.length?'<div class="an-box"><b class="t">🧺 V tomto okruhu už '+(op.length===1?'funguje':'fungují')+' '+op.length+' '+plur(op.length)+'</b><div class="towns">'+op.slice(0,12).map(function(w){return '<span class="town"><span class="d" style="background:#1e86e0"></span>'+esc(w.name)+' · '+w.dist_km+' km</span>';}).join('')+'</div></div>':'<div class="an-box ok">✓ V okruhu '+rk2+' km zatím žádný prádlomat v provozu není.</div>';
      out.innerHTML='<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px"><div><h2 style="margin:0 0 4px">🎯 Spádová oblast '+rk2+' km — '+esc(title)+'</h2><div class="small muted">Počet obyvatel v okruhu '+rk2+' km od středu · zdroj: '+esc(r.source||'')+(r.saved?' · 📌 uložené vyhledávání':'')+'</div></div><div class="an-big"><div class="n">'+tot+'</div><div class="l">obyvatel · '+dens+' /km²</div></div></div>'+radii+capHtml+oper+(towns?'<div class="towns">'+towns+'</div>':'')+'</div>'
        +'<div class="card" id="an-cands"><h2 style="margin:0 0 4px">📍 Místa, kde by prádlomat mohl stát</h2><div class="small muted">Hledáme supermarkety, benzínky, myčky a další tahouny provozu v okolí '+esc(title)+' a hodnotíme parkování, konkurenci a sousední provozy…</div><div class="row" style="gap:8px;margin-top:10px;align-items:center"><span class="lk-spin"></span><span class="small muted">Vyhledávám (až 1 min)…</span></div></div>';
      loadCands(q,title,r._cands||null);
    }
    var candLayers=[];
    // Mapová data (Overpass) bývají chvilkově přetížená → automaticky opakujeme (až 5×, po 15 s), bez chybové hlášky
    function candRetry(q,title,attempt){ var box=document.getElementById('an-cands'); if(!box) return; var MAX=5;
      if(attempt>MAX){ box.innerHTML='<h2 style="margin:0 0 4px">📍 Místa, kde by prádlomat mohl stát</h2><div class="small muted" style="margin:6px 0 10px">Mapová data jsou právě delší dobu nedostupná. Výsledek analýzy je uložený – seznam míst se doplní, až to zkusíte znovu.</div><button class="btn sec sm" type="button" id="cand-retry">🔄 Zkusit znovu</button>'; document.getElementById('cand-retry').addEventListener('click',function(){ loadCands(q,title,null,1); }); return; }
      box.innerHTML='<h2 style="margin:0 0 4px">📍 Místa, kde by prádlomat mohl stát</h2><div class="row" style="gap:8px;margin-top:10px;align-items:center"><span class="lk-spin"></span><span class="small muted">Mapová data jsou právě zaneprázdněná, zkouším znovu ('+attempt+'/'+MAX+')… vydržte prosím.</span></div>';
      setTimeout(function(){ loadCands(q,title,null,attempt+1); },15000); }
    function loadCands(q,title,pre,attempt){ attempt=attempt||1; var box=document.getElementById('an-cands'); candLayers.forEach(function(l){try{map.removeLayer(l);}catch(e){}}); candLayers=[];
      (pre?Promise.resolve({ok:true,j:pre}):fetch('/api/location/candidates?area='+encodeURIComponent(q)).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})).then(function(res){ if(!box) return; if(!res.ok){ if(res.j&&res.j.buy){ box.innerHTML='<h2 style="margin:0 0 4px">📍 Místa, kde by prádlomat mohl stát</h2><div class="msg err" style="margin:8px 0 0">'+esc(res.j.error)+'</div>'; return; } candRetry(q,title,attempt); return; }
        var cs=res.j.candidates||[]; if(!cs.length){ box.innerHTML='<h2 style="margin:0 0 4px">📍 Místa, kde by prádlomat mohl stát</h2><p class="muted" style="margin:6px 0 0">'+esc(res.j.note||'V okolí se nenašla žádná typická místa (supermarkety, benzínky apod.).')+'</p>'; return; }
        var savedCt=res.j.contacts||{}; window._cands=cs; window._candTitle=title;
        var vcol=function(c){return c.score>=70?'#2fe3a0':(c.score>=45?'#ffd866':'#ff5d6c');};
        cs.forEach(function(c,i){ var m=L.circleMarker([c.lat,c.lon],{radius:7,color:'#fff',weight:1.5,fillColor:vcol(c),fillOpacity:.95}).addTo(map); m.bindTooltip((i+1)+'. '+esc(c.name)+' · '+c.score+' b.',{direction:'top'}); candLayers.push(m); });
        var rows=cs.map(function(c,i){ var pk=c.parking&&c.parking.count?'✓ parkoviště'+(c.parking.nearest_m!=null?' '+c.parking.nearest_m+' m':''):'✗ bez parkoviště'; var cp=c.competition&&c.competition.count?'⚠ konkurence '+c.competition.count+'×'+(c.competition.nearest_m!=null?' ('+c.competition.nearest_m+' m)':''):'✓ bez konkurence';
          var sk=(+c.lat).toFixed(5)+','+(+c.lon).toFixed(5); if(savedCt[sk]) return '<tr><td style="color:var(--text2)">'+(i+1)+'</td><td><b>'+esc(c.name)+'</b><div class="small muted">'+esc(c.shop_label||'')+'</div></td><td><span style="display:inline-block;min-width:44px;text-align:center;padding:3px 8px;border-radius:999px;font-weight:700;background:'+vcol(c)+'22;color:'+vcol(c)+';border:1px solid '+vcol(c)+'66">'+c.score+'</span><div class="small muted">'+esc(c.verdict||'')+'</div></td><td class="small">'+((c.parking&&c.parking.count)?'✓ parkoviště':'✗ bez parkoviště')+'<br>'+((c.competition&&c.competition.count)?'⚠ konkurence':'✓ bez konkurence')+'</td><td class="small" id="ct-'+i+'">'+contactHtml(savedCt[sk])+'</td><td><button class="btn sec sm" type="button" data-cand="'+i+'">🗺️ Mapa</button></td></tr>';
          var ct=c.contact||{}; var ctHtml=[ct.operator?'🏢 '+esc(ct.operator):'', ct.phone?'📞 <a href="tel:'+esc(ct.phone.replace(/\s+/g,''))+'">'+esc(ct.phone)+'</a>':'', ct.email?'✉️ <a href="mailto:'+esc(ct.email)+'">'+esc(ct.email)+'</a>':'', ct.website?'🌐 <a href="'+esc(ct.website)+'" target="_blank" rel="noopener">web ↗</a>':'', ct.address?'<span class="muted">'+esc(ct.address)+'</span>':''].filter(Boolean).join('<br>');
          return '<tr><td style="color:var(--text2)">'+(i+1)+'</td><td><b>'+esc(c.name)+'</b><div class="small muted">'+esc(c.shop_label||'')+'</div></td><td><span style="display:inline-block;min-width:44px;text-align:center;padding:3px 8px;border-radius:999px;font-weight:700;background:'+vcol(c)+'22;color:'+vcol(c)+';border:1px solid '+vcol(c)+'66">'+c.score+'</span><div class="small muted">'+esc(c.verdict||'')+'</div></td><td class="small">'+pk+'<br>'+cp+(c.anchors?'<br>🏪 '+c.anchors+' provozů v okolí':'')+'</td><td class="small" id="ct-'+i+'">'+(ctHtml||'<span class="muted">v mapových datech bez kontaktu</span>')+'<div style="margin-top:6px"><button class="btn sec sm" type="button" data-contact="'+i+'">🔍 Najít kontakt</button></div></td><td><button class="btn sec sm" type="button" data-cand="'+i+'">🗺️ Mapa</button></td></tr>'; }).join('');
        box.innerHTML='<div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px"><div><h2 style="margin:0 0 4px">📍 Místa, kde by prádlomat mohl stát <span class="muted" style="font-size:14px;font-weight:500">'+cs.length+'</span></h2><div class="small muted">Typická místa z mapových dat v okolí '+esc(title)+' seřazená podle skóre (parkování, konkurence, sousední provozy, spádovost). Body jsou i v mapě. Skóre je orientační – rozhoduje místní prověření.</div></div></div><div class="tbl-wrap" style="margin-top:10px"><table class="cards cand-tbl"><colgroup><col style="width:34px"><col style="width:22%"><col style="width:84px"><col style="width:22%"><col><col style="width:96px"></colgroup><thead><tr><th>#</th><th>Místo</th><th>Skóre</th><th>Parkování / konkurence</th><th>Kontakt</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>';
        box.querySelectorAll('button[data-cand]').forEach(function(b){ b.addEventListener('click',function(){ openCand(cs[+b.getAttribute('data-cand')], +b.getAttribute('data-cand')+1); }); });
        box.querySelectorAll('button[data-contact]').forEach(function(b){ b.addEventListener('click',function(){ findContact(cs[+b.getAttribute('data-contact')], +b.getAttribute('data-contact'), title, b); }); });
      }).catch(function(){ candRetry(q,title,attempt); });
    }
    function contactHtml(j){ var head=[ j.company?'🏢 '+esc(j.company):'', j.person?'👤 <b>'+esc(j.person)+'</b>'+(j.role?' <span class="muted">· '+esc(j.role)+'</span>':''):'', j.phone?'📞 <a href="tel:'+esc(String(j.phone).replace(/\s+/g,''))+'">'+esc(j.phone)+'</a>':'', j.email?'✉️ <a href="mailto:'+esc(j.email)+'">'+esc(j.email)+'</a>':'' ].filter(Boolean);
      var more=[ j.ico?'IČO '+esc(j.ico):'', j.website?'🌐 <a href="'+esc(j.website)+'" target="_blank" rel="noopener">web ↗</a>':'', j.address?'<span class="muted">'+esc(j.address)+'</span>':'', j.note?'<span class="muted">'+esc(j.note)+'</span>':'', (j.sources||[]).length?'<span class="muted">Zdroje: '+j.sources.slice(0,3).map(function(u,k){return '<a href="'+esc(u)+'" target="_blank" rel="noopener">['+(k+1)+']</a>';}).join(' ')+'</span>':'', '<span class="muted">Dohledáno AI z veřejných zdrojů – před použitím ověřte.</span>' ].filter(Boolean);
      if(!head.length) head=['<span class="muted">Veřejný kontakt se nepodařilo dohledat – zkuste web provozovatele nebo osobní návštěvu.</span>'];
      return '<div class="ct-box">'+head.join('<br>')+'<div><button type="button" class="ct-tgl">▸ Více</button></div><div class="ct-more">'+more.join('<br>')+'</div></div>'; }
    document.addEventListener('click',function(e){ var t=e.target.closest&&e.target.closest('.ct-tgl'); if(!t) return; var b=t.closest('.ct-box'); b.classList.toggle('ct-open'); t.textContent=b.classList.contains('ct-open')?'▾ Méně':'▸ Více'; });
    function contactHtmlOld(j){ var rows=[ j.company?'🏢 '+esc(j.company)+(j.ico?' <span class="muted">IČO '+esc(j.ico)+'</span>':''):'', j.person?'👤 <b>'+esc(j.person)+'</b>'+(j.role?' <span class="muted">· '+esc(j.role)+'</span>':''):'', j.phone?'📞 <a href="tel:'+esc(String(j.phone).replace(/\s+/g,''))+'">'+esc(j.phone)+'</a>':'', j.email?'✉️ <a href="mailto:'+esc(j.email)+'">'+esc(j.email)+'</a>':'', j.website?'🌐 <a href="'+esc(j.website)+'" target="_blank" rel="noopener">web ↗</a>':'', j.address?'<span class="muted">'+esc(j.address)+'</span>':'', j.note?'<span class="muted">'+esc(j.note)+'</span>':'' ].filter(Boolean);
      return (rows.length?rows.join('<br>'):'<span class="muted">Veřejný kontakt se nepodařilo dohledat – zkuste web provozovatele nebo osobní návštěvu.</span>')+((j.sources||[]).length?'<div class="small muted" style="margin-top:4px">Zdroje: '+j.sources.slice(0,3).map(function(u,k){return '<a href="'+esc(u)+'" target="_blank" rel="noopener">['+(k+1)+']</a>';}).join(' ')+'</div>':'')+'<div class="small muted" style="margin-top:4px">Dohledáno AI z veřejných zdrojů – před použitím ověřte.</div>'; }
    // AI dohledání kontaktu (provozovatel, kontaktní osoba, telefon, e-mail) – veřejné zdroje přes web search; výsledek se uloží k vyhledávání
    function findContact(c,i,title,btn){ var cell=document.getElementById('ct-'+i); if(!cell) return; btn.disabled=true; btn.innerHTML='<span class="lk-spin" style="width:12px;height:12px;border-width:2px;display:inline-block;vertical-align:middle"></span> Hledám (až 1 min)…';
      var ct=c.contact||{}; var qs='name='+encodeURIComponent(c.name)+'&city='+encodeURIComponent(title)+'&lat='+c.lat+'&lon='+c.lon+'&kind='+encodeURIComponent(c.shop_label||'')+(ct.address?'&address='+encodeURIComponent(ct.address):'');
      fetch('/api/location/contact?'+qs).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});}).then(function(res){ if(!res.ok){ btn.disabled=false; btn.textContent='🔍 Najít kontakt'; cell.insertAdjacentHTML('beforeend','<div class="small" style="color:var(--err);margin-top:4px">'+esc((res.j&&res.j.error)||'Nepodařilo se dohledat.')+'</div>'); return; }
        cell.innerHTML=contactHtml(res.j);
      }).catch(function(){ btn.disabled=false; btn.textContent='🔍 Najít kontakt'; }); }
    // Detail místa v okně (letecká mapa ČÚZK + ulice), stránka zůstává otevřená
    var cm=null, cmLayers=[], cmBase=null;
    function openCand(c,n){ var md=document.getElementById('cand-modal'); if(!md||!c) return; md.classList.add('on');
      document.getElementById('cand-title').textContent=n+'. '+c.name; document.getElementById('cand-sub').textContent=(c.shop_label||'')+' · skóre '+c.score+' ('+(c.verdict||'')+') · '+c.lat.toFixed(5)+', '+c.lon.toFixed(5);
      document.getElementById('cand-gmaps').href='https://www.google.com/maps?q='+c.lat+','+c.lon;
      if(!cm){ cm=L.map('cand-map',{maxZoom:22}); setCandBase('orto'); }
      cmLayers.forEach(function(l){try{cm.removeLayer(l);}catch(e){}}); cmLayers=[];
      cmLayers.push(L.circleMarker([c.lat,c.lon],{radius:9,color:'#fff',weight:2,fillColor:'#4fd1ff',fillOpacity:1}).addTo(cm).bindTooltip(esc(c.name),{permanent:true,direction:'top',offset:[0,-8]}));
      cmLayers.push(L.circle([c.lat,c.lon],{radius:150,color:'#4fd1ff',weight:1.5,fill:false,dashArray:'4 6'}).addTo(cm));
      cm.setView([c.lat,c.lon],18); setTimeout(function(){ cm.invalidateSize(); cm.setView([c.lat,c.lon],18); },60); }
    function setCandBase(kind){ if(!cm) return; if(cmBase){ try{cm.removeLayer(cmBase);}catch(e){} }
      cmBase = kind==='orto' ? L.tileLayer('https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}',{maxZoom:22,maxNativeZoom:20,attribution:'Ortofoto © ČÚZK'}) : L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',{maxZoom:22,maxNativeZoom:19,attribution:'Tiles © Esri'});
      cmBase.addTo(cm); cmBase.bringToBack(); document.querySelectorAll('#cand-modal [data-base]').forEach(function(b){ b.classList.toggle('sec', b.getAttribute('data-base')!==kind); }); }
    (function(){ var md=document.getElementById('cand-modal'); if(!md) return; document.getElementById('cand-close').addEventListener('click',function(){ md.classList.remove('on'); }); md.addEventListener('click',function(e){ if(e.target===md) md.classList.remove('on'); }); document.addEventListener('keydown',function(e){ if(e.key==='Escape') md.classList.remove('on'); }); md.querySelectorAll('[data-base]').forEach(function(b){ b.addEventListener('click',function(){ setCandBase(b.getAttribute('data-base')); }); }); })();
    btn.addEventListener('click',run); inp.addEventListener('keydown',function(e){if(e.key==='Enter')run();});
    // Špendlík: klik do mapy = vyhledání kolem přesného bodu (hodí se ve velkých městech, kde je město příliš velké)
    var pinMode=false, pinBtn=document.getElementById('an-pin'), pinMarker=null;
    pinBtn.addEventListener('click',function(){ pinMode=!pinMode; pinBtn.classList.toggle('sec',!pinMode); pinBtn.textContent=pinMode?'📍 Klikněte do mapy…':'📍 Špendlík do mapy'; map.getContainer().style.cursor=pinMode?'crosshair':''; if(pinMode){ try{ map.getContainer().scrollIntoView({behavior:'smooth',block:'center'}); }catch(e){} } });
    map.on('click',function(e){ if(!pinMode) return; pinMode=false; pinBtn.classList.add('sec'); pinBtn.textContent='📍 Špendlík do mapy'; map.getContainer().style.cursor=''; if(pinMarker){ try{map.removeLayer(pinMarker);}catch(x){} } pinMarker=L.marker(e.latlng).addTo(map); inp.value=e.latlng.lat.toFixed(5)+', '+e.latlng.lng.toFixed(5); run(); });
    var SAVED=${JSON.stringify(credits && credits.current ? credits.current : null).replace(/</g, '\\u003c')};
    if(SAVED&&SAVED.result){ var rr=SAVED.result; rr.saved=true; rr._cands=SAVED.candidates?Object.assign({},SAVED.candidates,{contacts:SAVED.contacts||{},saved:true}):null; render(rr,inp.value.trim()); }
    else if(inp.value.trim().length>=2) run();
  })();</script>`, head);
}
function checklistPage(s) {
  const sec = (t, items) => `<div class="card" style="margin:0 0 12px"><h2 style="margin:0 0 8px">${t}</h2><ul style="margin:0;padding-left:18px;color:var(--text2);display:flex;flex-direction:column;gap:6px">${items.map((i) => `<li>${i}</li>`).join('')}</ul></div>`;
  return page(s, 'Checklist', 'check', `<h1 style="margin:0 0 6px">Checklist prověření místa</h1><p class="muted" style="margin:0 0 14px">Co si změřit, spočítat a vyjednat, než podepíšete nájem. Výsledky zapište do formuláře lokality.</p>
  ${sec('1 · Poloha', ['Počet domácností do 300 / 500 m (ČSÚ, mapy) – zapsat i zdroj', 'Typ zástavby: sídliště, centrum, obchod, obec', 'Pěší frekvence: spočítat 2× 30 min – všední den 17–18 h a sobota 10–11 h', 'Viditelnost z ulice, parkování, zastávka MHD do 300 m'])}
  ${sec('2 · Prostor', ['Plocha a výška, vstup 24/7 bez zamykání objektu', 'Přípojky: voda, odpad, elektřina (jištění) – vyfotit, ověřit u pronajímatele', 'Osvětlení, bezpečnost, kamera', 'Kdo platí přípojky a úpravy prostoru'])}
  ${sec('3 · Smlouva', ['Nájem / měsíc a co zahrnuje (energie, služby)', 'Kauce, valorizace, výpovědní lhůta min. 12 měsíců', 'Exkluzivita – zákaz konkurence v objektu', 'Možnost podnájmu / převodu smlouvy'])}
  ${sec('4 · Konkurence', ['Samoobslužné prádelny do 2 km', 'Čistírny a prádelny v bytových domech', 'Ceny konkurence'])}
  ${sec('5 · Ekonomika', ['Zadat vlastní předpoklad návštěvnosti pro slabý / střední / silný scénář', 'Doplnit energie podle spotřeby, pokud znáte cenu od dodavatele', 'Zkontrolovat, že servis a prací prostředky nejsou započítané dvakrát', 'Projít report a doplnit chybějící údaje, pak vyhodnotit znovu'])}`);
}
function studiesPage(s, data) {
  const st = (data && data.studies) || [];
  const kc0 = (n) => (n == null ? '—' : Math.round(n).toLocaleString('cs-CZ') + ' Kč');
  const MN = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];
  const COL = { A: '#4fd1ff', B: '#a78bfa', C: '#2fe3a0' };
  // Sloupcový graf: mřížka, osa y, průměr jako přerušovaná čára, nejlepší měsíc zvýrazněn
  const chart = (x) => { const months = x.months || []; const col = COL[x.key] || '#4fd1ff'; const vals = months.map((m) => m.revenue); const mx = Math.max(1, ...vals); const step = mx > 60000 ? 20000 : 10000; const top = Math.ceil(mx / step) * step;
    const W = 640, H = 200, L = 46, B = 26, T = 10, pw = W - L - 8, ph = H - T - B, bw = pw / months.length; const y = (v) => T + ph - v / top * ph; const avg = x.avg_month_gross || 0;
    const grid = []; for (let v = 0; v <= top; v += step) grid.push(`<line x1="${L}" x2="${W - 8}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="rgba(120,160,255,.14)"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#8ea2c2">${v / 1000}k</text>`);
    const bars = months.map((m, i) => { const h = ph * m.revenue / top; const [yy, mo] = m.ym.split('-'); const best = m.revenue === x.best_month_gross && m.revenue > 0; const bx = L + i * bw + bw * 0.18, bwid = bw * 0.64;
      return `<rect x="${bx.toFixed(1)}" y="${y(m.revenue).toFixed(1)}" width="${bwid.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${best ? '#ffd866' : col}" opacity="${m.revenue ? (best ? 1 : .85) : .12}"><title>${MN[+mo - 1]} ${yy}: ${kc0(m.revenue)}</title></rect><text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="#8ea2c2">${MN[+mo - 1]}${mo === '01' ? ' ' + yy.slice(2) : ''}</text>`; }).join('');
    const avgLine = avg ? `<line x1="${L}" x2="${W - 8}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}" stroke="#fff" stroke-opacity=".7" stroke-dasharray="4 4"/><text x="${W - 10}" y="${(y(avg) - 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#eaf2ff">průměr ${Math.round(avg / 1000)}k</text>` : '';
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" xmlns="http://www.w3.org/2000/svg">${grid.join('')}${bars}${avgLine}</svg>`; };
  const pct = (v) => v == null ? '—' : v.toLocaleString('cs-CZ') + ' %';
  const yrs = (v) => v == null ? '—' : v.toLocaleString('cs-CZ') + ' roku';
  const cmpRows = [
    ['Charakter místa', (x) => esc(x.desc || '')],
    ['Prádlomat', (x) => esc(x.machine_version) + (x.months_in_operation ? ` · v provozu ${x.months_in_operation} měs.` : '')],
    ['Zákazníků za den', (x) => x.customers_per_day != null ? `<b>${x.customers_per_day.toLocaleString('cs-CZ')}</b>` : '—'],
    ['Průměrná měsíční tržba s DPH', (x) => `<b>${kc0(x.avg_month_gross)}</b>`],
    ['Nejlepší měsíc', (x) => kc0(x.best_month_gross)],
    ['Provozní výsledek / měsíc', (x) => `<b style="color:${x.operating_month >= 0 ? 'var(--ok)' : 'var(--err)'}">${kc0(x.operating_month)}</b>`],
    ['Investice (prádlomat bez DPH)', (x) => x.product ? `${esc(x.product.name)}<div class="small muted">${kc0(x.product.price_czk)}</div>` : kc0(x.machine_price_czk)],
    ['Návratnost', (x) => `<b>${yrs(x.payback_years)}</b>`],
    ['Výnos p.a.', (x) => pct(x.roi_pct)],
  ];
  const compare = st.length ? `<div class="card cs-cmp"><h2 style="margin:0 0 4px">Srovnání lokalit</h2><p class="small muted" style="margin:0 0 10px">Stejná metodika pro všechny tři – liší se jen místo a návštěvnost.</p><div class="tbl-wrap" style="overflow-x:auto"><table class="cs-tbl"><thead><tr><th></th>${st.map((x) => `<th><span class="cs-dot" style="background:${COL[x.key]}"></span>${esc(x.label.split(' – ')[0])}</th>`).join('')}</tr></thead><tbody>${cmpRows.map(([l, f]) => `<tr><td class="muted">${l}</td>${st.map((x) => `<td>${f(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>` : '';
  const card = (x) => `<div class="card cs-card" id="studie-${x.key}"><div class="cs-head"><div><span class="eyebrow"><i style="background:${COL[x.key]}"></i>Případová studie ${esc(x.key)} · živá data</span><h2 style="margin:6px 0 4px">${esc(x.label)}</h2><p class="muted" style="margin:0">${esc(x.desc || '')}${x.months_in_operation ? ` V provozu ${x.months_in_operation} měsíců.` : ''}</p></div>${x.product ? `<div class="cs-prod">${x.product.img ? `<img src="${esc(x.product.img)}" alt="${esc(x.product.name)}">` : ''}<div><div class="small muted">Prádlomat na lokalitě</div><b>${esc(x.product.name)}</b><div class="small">${kc0(x.product.price_czk)} <span class="muted">bez DPH</span></div></div></div>` : ''}</div>
    <div class="cs-kpi"><div class="k"><div class="n" style="color:${COL[x.key]}">${kc0(x.avg_month_gross)}</div><div class="l">průměrná tržba / měsíc s DPH</div></div><div class="k"><div class="n">${x.customers_per_day != null ? x.customers_per_day.toLocaleString('cs-CZ') : '—'}</div><div class="l">zákazníků za den${x.avg_ticket ? ` · útrata ${kc0(x.avg_ticket)}` : ''}</div></div><div class="k"><div class="n" style="color:${x.operating_month >= 0 ? 'var(--ok)' : 'var(--err)'}">${kc0(x.operating_month)}</div><div class="l">provozní výsledek / měsíc</div></div><div class="k"><div class="n">${yrs(x.payback_years)}</div><div class="l">návratnost investice${x.roi_pct != null ? ` · ${pct(x.roi_pct)} p.a.` : ''}</div></div></div>
    <div class="cs-body"><div><div class="cs-sub">Měsíční tržby s DPH · posledních 12 měsíců <span class="muted">· žlutě nejlepší měsíc</span></div>${chart(x)}</div>
    <div><div class="cs-sub">Ekonomika měsíce (průměr)</div><table class="cs-eco"><tbody>
      <tr><td>Tržba s DPH</td><td>${kc0(x.avg_month_gross)}</td></tr>
      <tr><td>Tržba bez DPH</td><td>${kc0(x.net_month)}</td></tr>
      <tr><td>Servis a údržba <span class="muted">(${x.costs.service_pct} %)</span></td><td>− ${kc0(x.costs.service)}</td></tr>
      <tr><td>Energie a voda <span class="muted">(${x.costs.energy_pct} %)</span></td><td>− ${kc0(x.costs.energy)}</td></tr>
      <tr><td>Nájem místa</td><td>− ${kc0(x.costs.rent)}</td></tr>
      <tr class="t"><td>Provozní výsledek</td><td style="color:${x.operating_month >= 0 ? 'var(--ok)' : 'var(--err)'}">${kc0(x.operating_month)}</td></tr>
      ${x.machine_price_czk ? `<tr><td>${x.product ? esc(x.product.name) : 'Prádlomat ' + esc(x.machine_version)} <span class="muted">(bez DPH)</span></td><td>${kc0(x.machine_price_czk)}</td></tr><tr class="t"><td>Návratnost</td><td>${yrs(x.payback_years)}</td></tr>` : ''}
    </tbody></table></div></div></div>`;
  return page(s, 'Případové studie', 'studie', `<div class="hero"><span class="eyebrow"><i></i>Případové studie</span><h1><span class="g">Tři reálné lokality</span> z naší sítě</h1><p>Anonymizované lokality, skutečná čísla. Tržby se načítají přímo z platebního systému prádlomatů${data && data.generatedAt ? ` – stav k ${new Date(data.generatedAt).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}. Porovnejte, jak vychází vaše lokalita proti špičce sítě, okresnímu městu a menšímu městu.</p></div>
  <style>.cs-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;vertical-align:middle}.cs-tbl{width:100%;border-collapse:collapse;min-width:640px;font-size:13.5px}.cs-tbl th{text-align:left;vertical-align:top;padding:8px 10px;font-size:13px;border-bottom:2px solid var(--border2)}.cs-tbl td:not(:first-child),.cs-tbl th:not(:first-child){width:27%}.cs-tbl td{vertical-align:top;padding:9px 10px;border-bottom:1px solid var(--border)}.cs-tbl tr:last-child td{border-bottom:0}
  .cs-card{margin:0 0 16px;padding:22px}.cs-head{margin-bottom:14px;display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap}.cs-prod{display:flex;gap:12px;align-items:center;padding:10px 12px;border:1px solid var(--border);border-radius:14px;background:rgba(4,8,16,.5);min-width:260px}.cs-prod img{width:96px;height:72px;object-fit:contain;border-radius:10px;background:#0b1222}.cs-kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:0 0 16px}.cs-kpi .k{padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:rgba(4,8,16,.5)}.cs-kpi .n{font-size:22px;font-weight:800;letter-spacing:-.01em;line-height:1.15}.cs-kpi .l{font-size:11.5px;color:var(--text2);margin-top:3px}
  .cs-body{display:grid;grid-template-columns:1.35fr 1fr;gap:18px;align-items:start}.cs-sub{font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
  .cs-eco{width:100%;border-collapse:collapse;font-size:13.5px}.cs-eco td{padding:7px 0;border-bottom:1px solid var(--border)}.cs-eco td:last-child{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.cs-eco tr.t td{font-weight:700;border-bottom:2px solid var(--border2)}
  @media(max-width:860px){.cs-kpi{grid-template-columns:1fr 1fr}.cs-body{grid-template-columns:1fr}}</style>
  ${compare}
  ${st.length ? st.map(card).join('') : '<div class="card"><p class="muted" style="margin:0">Živá data se právě načítají – zkuste to prosím za chvíli.</p></div>'}
  ${st.length ? `<p class="small muted" style="margin-top:4px">${esc(data.note || '')} Zákazníci za den = průměrná měsíční tržba ÷ průměrná útrata na platbu ÷ 30,4 dne. Servis, energie a nájem jsou orientační dle interní metodiky Best Series; neobsahují financování a daň z příjmu. Historie a výsledky jiných lokalit nejsou zárukou výsledků vaší lokality.</p>` : ''}`);
}
function expiredPage(s) {
  return page(s, 'Přístup vypršel', 'loc', `<div class="card"><h1 style="margin:0 0 6px">Platnost přístupu skončila</h1><p class="muted">Váš přístup k aplikaci Prověření lokality vypršel. Pro prodloužení nás kontaktujte přes Podporu.</p></div>`);
}

module.exports = { NAV, reportSections, analyzerPage, LIMITS, SEARCH_LIMITS, PKG_LABEL, FIELDS, clean, calc, evaluate, siteForm, listPage, reportPage, checklistPage, studiesPage, expiredPage, num };
