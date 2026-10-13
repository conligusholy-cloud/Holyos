// BS2 — Aplikace „Prověření lokality" pro platící zákazníky (user_type = 'location').
// Zákazník vidí jen tuto sekci: seznam lokalit (limit dle balíčku), formulář lokality,
// kalkulačku ekonomiky (scénáře, bod zvratu, financování), orientační vyhodnocení
// se čtyřmi výsledky, report k tisku/PDF, checklist a (u Premium) stav místního šetření.
// Výpočty jsou záměrně průhledné: všechny sazby zadává zákazník, žádné skryté konstanty.
const { esc, layout } = require('./views');

const LIMITS = { basic: 3, plus: 10, premium: 10 };
const PKG_LABEL = { basic: 'Základ', plus: 'Plus', premium: 'Premium' };

const NAV = (s) => [
  { id: 'loc', href: '/lokalita', label: 'Moje lokality', icon: 'box' },
  { id: 'check', href: '/lokalita/checklist', label: 'Checklist', icon: 'check' },
  { id: 'studie', href: '/lokalita/studie', label: 'Případové studie', icon: 'chart' },
  { id: 'acc', href: '/password', label: 'Můj účet', icon: 'user', right: true },
];
function page(s, title, active, body) {
  return layout({ title, user: s.nick, nav: NAV(s), active, fx: true, help: null, body: `<style>${CSS}</style>${body}` });
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
@media print{body{background:#fff!important;color:#000!important}header,.tabs,.banner,.glow,.gridfx,#net,.helpbtn,.no-print{display:none!important}main{max-width:none;padding:0}.card{background:#fff!important;border:1px solid #ccc!important;box-shadow:none!important;color:#000}.rep ul,.sc .k,.cas div span,.muted{color:#333!important}.sc .c,.cas div{background:#fff!important;border-color:#ccc!important}.res{color:#000!important}}
`;

// ── Výpočet ekonomiky ────────────────────────────────────────────────────────
const num = (v, d = 0) => { const t = String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'); const n = Number(t); return t !== '' && isFinite(n) ? n : d; };
function annuity(principal, ratePa, months) { if (!(principal > 0) || !(months > 0)) return 0; const r = ratePa / 100 / 12; if (r <= 0) return principal / months; return principal * r / (1 - Math.pow(1 + r, -months)); }
/** d = uložená data lokality (viz FIELDS). Vrací scénáře + bod zvratu. */
function calc(d) {
  const vat = d.vat_payer === 'no' ? 0 : 0.21;
  const pw = num(d.price_wash, 300), pd = num(d.price_dry, 50), dryShare = num(d.dry_share, 60) / 100, dryCycles = num(d.dry_cycles, 2);
  const perWash = pw + dryShare * dryCycles * pd;                // tržba s DPH na jedno praní (vč. sušení)
  const days = 30.4;
  const fixed = num(d.rent) + num(d.software) + num(d.insurance) + num(d.marketing) + num(d.other);
  const invest = num(d.machine_price) + num(d.delivery) + num(d.site_prep);
  const loanPrincipal = Math.max(0, invest - num(d.down_payment));
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
  return { S, perWash, fixed, invest, payment, loanPrincipal, be_operating: breakEven('operating'), be_cash: breakEven('cash'), vat };
}

// ── Vyhodnocení (4 výsledky) ───────────────────────────────────────────────────
function evaluate(d, c) {
  const missing = [], risks = [], steps = [], verified = [], given = [], assumed = [];
  const yes = (v) => v === 'yes', unk = (v) => !v || v === 'unknown';
  if (!num(d.rent)) missing.push('Výše nájmu');
  if (unk(d.conn_water)) missing.push('Přípojka vody'); if (unk(d.conn_sewer)) missing.push('Odpad'); if (unk(d.conn_power)) missing.push('Elektrická přípojka');
  if (!num(d.households)) missing.push('Počet domácností v docházkové vzdálenosti (doplňte ručně – ČSÚ, mapy)');
  if (d.competition === '' || d.competition == null) missing.push('Konkurence do 2 km');
  if (!num(d.foot_traffic)) missing.push('Vlastní měření pěší frekvence (2× 30 min)');
  if (!num(d.machine_price)) missing.push('Cena zařízení (investice)');
  // ověřené skutečnosti = zadané s uvedeným zdrojem
  const v = (label, val, src) => { if (val === '' || val == null) return; if (src) verified.push(`${label}: ${val} – ${src}`); else given.push(`${label}: ${val}`); };
  v('Nájem', num(d.rent) ? num(d.rent).toLocaleString('cs-CZ') + ' Kč/měs' : '', d.rent_src);
  v('Přípojky', [d.conn_water === 'yes' ? 'voda' : null, d.conn_sewer === 'yes' ? 'odpad' : null, d.conn_power === 'yes' ? 'elektřina ' + (d.power_amp || '') : null].filter(Boolean).join(', ') || (unk(d.conn_water) ? '' : 'chybí'), d.conn_src);
  v('Pěší frekvence', num(d.foot_traffic) ? num(d.foot_traffic) + ' osob / 30 min' : '', d.foot_src);
  v('Plocha', num(d.area) ? num(d.area) + ' m²' : '', '');
  v('Domácnosti do 500 m', num(d.households) ? num(d.households).toLocaleString('cs-CZ') : '', d.households_src);
  v('Konkurence do 2 km', d.competition === '' || d.competition == null ? '' : String(num(d.competition)), '');
  v('Výpovědní lhůta', num(d.notice) ? num(d.notice) + ' měs.' : '', '');
  assumed.push(`Ceny: praní ${num(d.price_wash, 300)} Kč, sušení ${num(d.price_dry, 50)} Kč/cyklus, ${num(d.dry_share, 60)} % zákazníků suší (${num(d.dry_cycles, 2)} cykly)`);
  assumed.push(`Návštěvnost (váš předpoklad): slabý ${c.S.weak.washes} / střední ${c.S.mid.washes} / silný ${c.S.strong.washes} praní za den`);
  assumed.push(d.energy_mode === 'consumption' ? `Energie podle spotřeby: ${num(d.kwh_wash)} kWh/praní, ${num(d.kwh_dry)} kWh/sušení, ${num(d.water_wash)} l/praní, ${num(d.kwh_price)} Kč/kWh, ${num(d.water_price)} Kč/m³` : `Energie a voda zjednodušeně ${num(d.energy_pct, 9.5)} % z tržby bez DPH`);
  assumed.push(`Servis ${num(d.service_pct, 13)} % z tržby bez DPH, platební poplatky ${num(d.fee_pct, 1.5)} % z tržby, rezerva na opravy a obnovu ${num(d.reserve_pct, 5)} % (plánované odložení prostředků)`);
  assumed.push(d.vat_payer === 'no' ? 'Režim: neplátce DPH (tržby bez odvodu DPH, náklady vč. DPH)' : 'Režim: plátce DPH (21 % z tržeb odvedeno)');
  if (d.financing === 'yes') assumed.push(`Financování: ${c.loanPrincipal.toLocaleString('cs-CZ')} Kč, ${num(d.interest)} % p.a., ${num(d.months, 60)} měs. → splátka ${Math.round(c.payment).toLocaleString('cs-CZ')} Kč/měs`);
  // rizika
  if (c.S.weak.cash < 0) risks.push('Ve slabém scénáři je peněžní tok po splátce záporný – místo stojí a padá s návštěvností');
  if (c.S.mid.cash < 0) risks.push('Ve středním scénáři je peněžní tok po splátce záporný');
  if (c.S.weak.operating < 0) risks.push('Ve slabém scénáři nepokryje provoz ani fixní náklady');
  if (num(d.notice) && num(d.notice) < 12) risks.push(`Výpovědní lhůta ${num(d.notice)} měs. je krátká – riziko ztráty místa před návratností`);
  if (d.conn_water === 'no' || d.conn_sewer === 'no') risks.push('Chybí voda nebo odpad – náklady na přípojku nejsou v kalkulaci');
  if (d.conn_power === 'no') risks.push('Chybí dostatečná elektrická přípojka');
  if (num(d.competition) >= 2) risks.push(`Konkurence v okolí: ${num(d.competition)} provozoven do 2 km`);
  if (d.visibility === 'no') risks.push('Místo není vidět z ulice');
  if (d.parking === 'no' && d.transit === 'no') risks.push('Bez parkování i MHD – špatná dostupnost');
  if (num(d.households) && num(d.households) < 800) risks.push('Málo domácností v docházkové vzdálenosti');
  if (!num(d.foot_traffic)) risks.push('Návštěvnost není podložena vlastním měřením');
  if (c.S.mid.payback && c.S.mid.payback > 84) risks.push(`Návratnost ve středním scénáři ${Math.round(c.S.mid.payback / 12)} let`);
  // kroky
  missing.forEach((m) => steps.push('Doplnit: ' + m));
  if (num(d.notice) && num(d.notice) < 12) steps.push('Vyjednat výpovědní lhůtu min. 12 měsíců (ideálně 24)');
  if (!num(d.foot_traffic)) steps.push('Změřit pěší frekvenci 2× 30 min (všední den 17–18 h, sobota 10–11 h) a vyhodnotit znovu');
  if (c.S.weak.cash < 0 && c.S.mid.cash >= 0) steps.push('Zvážit vyšší akontaci nebo delší splácení, aby slabý scénář nebyl záporný');
  if (c.S.mid.cash < 0) steps.push('Vyjednat nižší nájem nebo hledat místo s vyšší návštěvností');
  steps.push('Po 1., 3. a 6. měsíci provozu porovnat skutečné cykly se scénáři');
  // výsledek
  let result, cls;
  const critical = missing.filter((m) => /nájmu|Přípojka|Odpad|Elektrick|Cena zařízení/.test(m)).length;
  if (critical >= 2) { result = 'Nedostatek údajů pro posouzení'; cls = 'na'; }
  else if (c.S.strong.operating <= 0 || c.S.mid.cash < 0) { result = 'Nevhodné podle dostupných podkladů'; cls = 'bad'; }
  else if (c.S.weak.cash < 0 || critical >= 1 || (num(d.notice) && num(d.notice) < 12) || num(d.competition) >= 2 || !num(d.foot_traffic) || d.conn_water === 'no' || d.conn_sewer === 'no') { result = 'Vhodné při splnění podmínek'; cls = 'cond'; }
  else { result = 'Vhodné podle dostupných podkladů'; cls = 'ok'; }
  return { result, cls, missing, risks, steps, verified, given, assumed };
}

// ── Formulář ─────────────────────────────────────────────────────────────────
const FIELDS = ['name', 'address', 'city', 'building', 'area', 'rent', 'rent_src', 'deposit', 'notice', 'exclusive', 'conn_water', 'conn_sewer', 'conn_power', 'power_amp', 'conn_src', 'visibility', 'parking', 'transit', 'households', 'households_src', 'competition', 'foot_traffic', 'foot_src',
  'price_wash', 'price_dry', 'dry_share', 'dry_cycles', 'washes_weak', 'washes_mid', 'washes_strong', 'vat_payer', 'energy_mode', 'energy_pct', 'kwh_wash', 'kwh_dry', 'kwh_price', 'water_wash', 'water_price', 'service_pct', 'software', 'fee_pct', 'insurance', 'marketing', 'reserve_pct', 'other',
  'machine_price', 'delivery', 'site_prep', 'financing', 'down_payment', 'interest', 'months', 'notes'];
const DEFAULTS = { price_wash: 300, price_dry: 50, dry_share: 60, dry_cycles: 2, washes_weak: 5, washes_mid: 8, washes_strong: 12, vat_payer: 'yes', energy_mode: 'percent', energy_pct: 9.5, kwh_wash: 1.5, kwh_dry: 2.5, kwh_price: 6, water_wash: 90, water_price: 110, service_pct: 13, fee_pct: 1.5, reserve_pct: 5, financing: 'no', interest: 8, months: 60, conn_water: 'unknown', conn_sewer: 'unknown', conn_power: 'unknown', visibility: 'unknown', parking: 'unknown', transit: 'unknown', exclusive: 'unknown' };
function clean(body) { const d = {}; for (const k of FIELDS) { let v = body[k]; if (v == null) continue; v = String(v).trim().slice(0, k === 'notes' ? 4000 : 300); d[k] = v; } return d; }

function siteForm(s, site, d, error) {
  const V = (k) => esc(d[k] != null && d[k] !== '' ? d[k] : (DEFAULTS[k] != null ? DEFAULTS[k] : ''));
  const sel = (k, opts) => `<select name="${k}">${opts.map(([v, l]) => `<option value="${v}"${(d[k] || DEFAULTS[k] || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const YNU = [['unknown', 'nevím / neověřeno'], ['yes', 'ano'], ['no', 'ne']];
  const inp = (k, label, extra = '', hint = '') => `<label>${label}<input name="${k}" value="${V(k)}" ${extra}>${hint ? `<small>${hint}</small>` : ''}</label>`;
  return page(s, site ? 'Lokalita' : 'Nová lokalita', 'loc', `
  <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px"><div><h1 style="margin:0 0 4px">${site ? esc(site.name || 'Lokalita') : 'Nová lokalita'}</h1><p class="muted" style="margin:0">Vyplňte, co víte. Co neznáte, nechte prázdné – report to označí jako chybějící údaj.</p></div><a class="btn sec sm" href="/lokalita">← Moje lokality</a></div>
  ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
  <form method="post" action="${site ? '/lokalita/' + site.id : '/lokalita/new'}" class="card lk-f" style="margin-top:14px">
    <h3>Místo</h3>
    ${inp('name', 'Název lokality *', 'required maxlength="120" placeholder="např. Tábor – Tesco"')}
    ${inp('address', 'Adresa *', 'required maxlength="300"')}
    ${inp('city', 'Město', 'maxlength="120"')}
    <label>Typ zástavby${sel('building', [['', '—'], ['sidliste', 'sídliště'], ['centrum', 'centrum města'], ['obchod', 'u obchodu / OC'], ['vesnice', 'obec / vesnice'], ['prumysl', 'průmyslová zóna'], ['kemp', 'kemp / rekreace']])}</label>
    ${inp('area', 'Plocha prostoru (m²)', 'inputmode="decimal"')}
    <h3>Nájem a smlouva</h3>
    ${inp('rent', 'Nájem (Kč / měsíc, bez energií)', 'inputmode="decimal"')}
    ${inp('rent_src', 'Zdroj nájmu (ověření)', 'maxlength="200" placeholder="např. nabídka pronajímatele 1. 10. 2026"', 'Uvedený zdroj zařadí údaj mezi ověřené skutečnosti.')}
    ${inp('deposit', 'Kauce (Kč)', 'inputmode="decimal"')}
    ${inp('notice', 'Výpovědní lhůta (měsíce)', 'inputmode="numeric"')}
    <label>Exkluzivita (bez konkurence v objektu)${sel('exclusive', YNU)}</label>
    <h3>Přípojky</h3>
    <label>Voda${sel('conn_water', YNU)}</label><label>Odpad${sel('conn_sewer', YNU)}</label><label>Elektřina${sel('conn_power', YNU)}</label>
    ${inp('power_amp', 'Jištění / příkon', 'maxlength="60" placeholder="např. 3× 25 A"')}
    ${inp('conn_src', 'Zdroj (ověření přípojek)', 'maxlength="200" placeholder="např. fotodokumentace, sdělení pronajímatele"')}
    <h3>Okolí a dostupnost</h3>
    <label>Viditelnost z ulice${sel('visibility', YNU)}</label><label>Parkování${sel('parking', YNU)}</label><label>MHD do 300 m${sel('transit', YNU)}</label>
    ${inp('households', 'Domácnosti do 500 m', 'inputmode="numeric"', 'Doplňte ručně (ČSÚ, mapy). Aplikace tento údaj automaticky nezjišťuje.')}
    ${inp('households_src', 'Zdroj počtu domácností', 'maxlength="200"')}
    ${inp('competition', 'Konkurence do 2 km (počet)', 'inputmode="numeric"', 'samoobslužné prádelny, čistírny')}
    ${inp('foot_traffic', 'Pěší frekvence (osob / 30 min)', 'inputmode="numeric"', 'Vlastní měření podle checklistu.')}
    ${inp('foot_src', 'Kdy a kde měřeno', 'maxlength="200" placeholder="např. út 17:00–17:30 před vchodem"')}
    <h3>Ceny a návštěvnost (váš předpoklad)</h3>
    ${inp('price_wash', 'Cena praní (Kč s DPH)', 'inputmode="decimal"')}
    ${inp('price_dry', 'Cena sušení za cyklus (Kč s DPH)', 'inputmode="decimal"')}
    ${inp('dry_share', 'Podíl zákazníků, kteří suší (%)', 'inputmode="decimal"')}
    ${inp('dry_cycles', 'Cyklů sušení na jedno praní', 'inputmode="decimal"')}
    ${inp('washes_weak', 'Slabý scénář – praní / den', 'inputmode="decimal"')}
    ${inp('washes_mid', 'Střední scénář – praní / den', 'inputmode="decimal"')}
    ${inp('washes_strong', 'Silný scénář – praní / den', 'inputmode="decimal"')}
    <h3>Náklady provozu</h3>
    <label>DPH${sel('vat_payer', [['yes', 'plátce DPH (21 % z tržeb)'], ['no', 'neplátce DPH']])}</label>
    <label>Energie a voda${sel('energy_mode', [['percent', 'zjednodušeně – % z tržby bez DPH'], ['consumption', 'podle spotřeby na cyklus']])}</label>
    ${inp('energy_pct', 'Energie zjednodušeně (% z tržby bez DPH)', 'inputmode="decimal"')}
    ${inp('kwh_wash', 'kWh na praní', 'inputmode="decimal"')}${inp('kwh_dry', 'kWh na cyklus sušení', 'inputmode="decimal"')}${inp('kwh_price', 'Cena elektřiny (Kč / kWh)', 'inputmode="decimal"')}
    ${inp('water_wash', 'Voda na praní (litry)', 'inputmode="decimal"')}${inp('water_price', 'Vodné + stočné (Kč / m³)', 'inputmode="decimal"')}
    ${inp('service_pct', 'Servisní smlouva (% z tržby bez DPH)', 'inputmode="decimal"', 'Pokud servis zahrnuje i prací prostředky, nezapočítávejte je znovu jinde.')}
    ${inp('software', 'Software (Kč / měsíc)', 'inputmode="decimal"')}
    ${inp('fee_pct', 'Platební poplatky (% z tržby)', 'inputmode="decimal"')}
    ${inp('insurance', 'Pojištění (Kč / měsíc)', 'inputmode="decimal"')}
    ${inp('marketing', 'Marketing (Kč / měsíc)', 'inputmode="decimal"')}
    ${inp('reserve_pct', 'Rezerva na opravy a obnovu (% z tržby bez DPH)', 'inputmode="decimal"', 'Plánované odložení prostředků, ne účetní náklad.')}
    ${inp('other', 'Další náklady (Kč / měsíc)', 'inputmode="decimal"')}
    <h3>Investice a financování</h3>
    ${inp('machine_price', 'Cena zařízení (Kč)', 'inputmode="decimal"')}
    ${inp('delivery', 'Doprava a instalace (Kč)', 'inputmode="decimal"')}
    ${inp('site_prep', 'Příprava místa / přípojky (Kč)', 'inputmode="decimal"')}
    <label>Financování${sel('financing', [['no', 'vlastní kapitál'], ['yes', 'úvěr / leasing']])}</label>
    ${inp('down_payment', 'Akontace (Kč)', 'inputmode="decimal"')}
    ${inp('interest', 'Úrok (% p.a.)', 'inputmode="decimal"')}
    ${inp('months', 'Délka splácení (měsíce)', 'inputmode="numeric"')}
    <label class="full">Poznámky<textarea name="notes" rows="3" maxlength="4000">${V('notes')}</textarea></label>
    <div class="full row" style="margin-top:8px"><button class="btn" type="submit">Uložit a vyhodnotit</button>${site ? `<a class="btn sec" href="/lokalita/${site.id}/report">Zobrazit report</a>` : ''}</div>
  </form>`);
}

// ── Seznam lokalit ───────────────────────────────────────────────────────────
function listPage(s, sites, info) {
  const limit = LIMITS[info.package] || 3, used = sites.length;
  const exp = info.expires_at ? new Date(info.expires_at) : null;
  return page(s, 'Moje lokality', 'loc', `
  <div class="hero"><span class="eyebrow"><i></i>Prověření lokality · balíček ${esc(PKG_LABEL[info.package] || info.package)}</span>
    <h1><span class="g">Moje lokality</span></h1>
    <p>Využito <b>${used} / ${limit}</b> adres${exp ? ` · přístup do ${exp.toLocaleDateString('cs-CZ')}` : ''}. Úpravy stejné adresy jsou neomezené; nová adresa se započítá až po uložení.</p></div>
  ${info.msg ? `<div class="msg ok">${esc(info.msg)}</div>` : ''}
  <div class="row" style="margin:6px 0 14px">${used < limit ? '<a class="btn" href="/lokalita/new">+ Nová lokalita</a>' : '<span class="muted">Limit adres balíčku je vyčerpán. Pro další adresy nás kontaktujte přes Podporu.</span>'}<a class="btn sec" href="/lokalita/checklist">Checklist před podpisem nájmu</a></div>
  ${sites.length ? `<div class="lk-grid">${sites.map((x) => { const ev = x.result || {}; return `<div class="card" style="margin:0"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><b style="font-size:16px">${esc(x.name)}</b><div class="small muted">${esc(x.address || '')}${x.city ? ', ' + esc(x.city) : ''}</div></div>${ev.result ? `<span class="res ${ev.cls}" style="font-size:12px;padding:4px 10px">${esc(ev.result)}</span>` : ''}</div>
    ${x.calc ? `<div class="small muted" style="margin-top:10px">Střední scénář: provozní výsledek <b style="color:${x.calc.mid_operating >= 0 ? 'var(--ok)' : 'var(--err)'}">${Math.round(x.calc.mid_operating).toLocaleString('cs-CZ')} Kč/měs</b>, po splátce <b style="color:${x.calc.mid_cash >= 0 ? 'var(--ok)' : 'var(--err)'}">${Math.round(x.calc.mid_cash).toLocaleString('cs-CZ')} Kč/měs</b></div>` : ''}
    <div class="row" style="margin-top:12px"><a class="btn sm" href="/lokalita/${x.id}/report">Report</a><a class="btn sec sm" href="/lokalita/${x.id}">Upravit</a><form method="post" action="/lokalita/${x.id}/delete" style="margin:0" onsubmit="return confirm('Smazat lokalitu? Adresa se vrátí do limitu.')"><button class="btn danger sm" type="submit">Smazat</button></form></div></div>`; }).join('')}</div>` : '<div class="card"><p class="muted" style="margin:0">Zatím nemáte žádnou lokalitu. Začněte tlačítkem <b>Nová lokalita</b>.</p></div>'}
  ${info.package === 'premium' ? `<div class="card" style="margin-top:14px"><h2 style="margin:0 0 6px">Místní šetření technikem</h2>${info.survey_date ? `<p class="muted" style="margin:0">Termín: <b>${esc(info.survey_date)}</b>${info.survey_tech ? ' · technik ' + esc(info.survey_tech) : ''}</p>${info.survey_report ? `<div class="rep" style="margin-top:8px"><h4>Zpráva z šetření</h4><p style="white-space:pre-wrap;color:var(--text2)">${esc(info.survey_report)}</p></div>` : '<p class="small muted">Zpráva bude doplněna po návštěvě.</p>'}` : '<p class="muted" style="margin:0">Součást balíčku Premium. Napište nám přes Podporu, kterou lokalitu má technik navštívit – termín pak uvidíte zde.</p>'}</div>` : ''}`);
}

// ── Report ───────────────────────────────────────────────────────────────────
const kc = (n) => Math.round(n).toLocaleString('cs-CZ') + ' Kč';
function reportPage(s, site, d, c, ev) {
  const sc = (x, hi) => `<div class="c${hi ? ' hi' : ''}"><div class="k">${x.name} · ${x.washes} praní / den</div><div class="v">${kc(x.gross)}<span class="small muted" style="font-weight:500"> tržba s DPH</span></div>
    <div class="cas"><div><span>Tržba bez DPH</span><b>${kc(x.net)}</b></div><div><span>Energie a voda</span><b>− ${kc(x.energy)}</b></div><div><span>Servis</span><b>− ${kc(x.service)}</b></div><div><span>Platební poplatky</span><b>− ${kc(x.fees)}</b></div><div><span>Fixní (nájem, software, pojištění, marketing, ostatní)</span><b>− ${kc(x.fixed)}</b></div><div><span>Rezerva na obnovu</span><b>− ${kc(x.reserve)}</b></div>
    <div class="t"><span>Provozní výsledek (před financováním a daní)</span><b class="${x.operating >= 0 ? 'pos' : 'neg'}">${kc(x.operating)}</b></div>${x.payment ? `<div><span>Splátka financování</span><b>− ${kc(x.payment)}</b></div><div class="t"><span>Peněžní tok po splátce</span><b class="${x.cash >= 0 ? 'pos' : 'neg'}">${kc(x.cash)}</b></div>` : ''}<div><span>Návratnost investice</span><b>${x.payback ? (x.payback / 12).toFixed(1) + ' roku' : '—'}</b></div></div></div>`;
  const li = (arr) => arr.length ? '<ul>' + arr.map((t) => `<li>${esc(t)}</li>`).join('') + '</ul>' : '<p class="small muted" style="margin:0">—</p>';
  return page(s, 'Report – ' + (site.name || ''), 'loc', `
  <div class="row no-print" style="justify-content:space-between;flex-wrap:wrap;gap:10px"><a class="btn sec sm" href="/lokalita">← Moje lokality</a><div class="row"><a class="btn sec sm" href="/lokalita/${site.id}">Upravit údaje</a><button class="btn sm" type="button" onclick="window.print()">Uložit jako PDF / tisk</button></div></div>
  <div class="card" style="margin-top:12px">
    <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px"><div><div class="small muted">Orientační vyhodnocení lokality · ${new Date().toLocaleDateString('cs-CZ')}</div><h1 style="margin:2px 0 4px">${esc(site.name)}</h1><div class="muted">${esc(d.address || '')}${d.city ? ', ' + esc(d.city) : ''}${d.area ? ' · ' + esc(d.area) + ' m²' : ''}${d.rent ? ' · nájem ' + kc(num(d.rent)) + '/měs' : ''}</div></div><span class="res ${ev.cls}">${esc(ev.result)}</span></div>
    <p class="small muted" style="margin:10px 0 0">Automatický orientační výstup z dostupných podkladů a vašich předpokladů – nikoli odborné schválení investice ani předpověď výdělku. Bez skóre a pravděpodobností.</p>
  </div>
  <div class="card rep"><h2 style="margin:0 0 10px">Ekonomické scénáře <span class="small muted" style="font-weight:500">měsíčně · liší se jen návštěvností</span></h2>
    <div class="sc">${sc(c.S.weak)}${sc(c.S.mid, true)}${sc(c.S.strong)}</div>
    <div class="row" style="margin-top:12px;gap:18px;flex-wrap:wrap"><span class="small">Bod zvratu provozu: <b>${c.be_operating != null ? c.be_operating + ' praní / den' : 'nedosažen do 60/den'}</b></span>${c.payment ? `<span class="small">Bod zvratu po splátce: <b>${c.be_cash != null ? c.be_cash + ' praní / den' : 'nedosažen'}</b></span>` : ''}<span class="small">Investice celkem: <b>${kc(c.invest)}</b></span>${c.payment ? `<span class="small">Splátka: <b>${kc(c.payment)}/měs</b></span>` : ''}</div>
  </div>
  <div class="lk-grid rep">
    <div class="card" style="margin:0"><h4 style="margin-top:0">Ověřené skutečnosti <span class="small muted">(se zdrojem)</span></h4>${li(ev.verified)}</div>
    <div class="card" style="margin:0"><h4 style="margin-top:0">Zadal zákazník</h4>${li(ev.given)}</div>
    <div class="card" style="margin:0"><h4 style="margin-top:0">Modelové předpoklady</h4>${li(ev.assumed)}</div>
    <div class="card miss" style="margin:0"><h4 style="margin-top:0">Chybějící údaje</h4>${li(ev.missing)}</div>
    <div class="card warn" style="margin:0"><h4 style="margin-top:0">Hlavní rizika</h4>${li(ev.risks)}</div>
    <div class="card" style="margin:0"><h4 style="margin-top:0">Doporučené další kroky</h4>${li(ev.steps)}</div>
  </div>
  ${d.notes ? `<div class="card rep"><h4 style="margin-top:0">Poznámky</h4><p style="white-space:pre-wrap;color:var(--text2);margin:0">${esc(d.notes)}</p></div>` : ''}
  <p class="small muted">Vyhodnocení: „Nedostatek údajů" = chybí 2+ klíčové údaje (nájem, přípojky, cena zařízení). „Nevhodné" = ani silný scénář nepokryje provoz, nebo je střední scénář po splátce záporný. „Vhodné při splnění podmínek" = slabý scénář záporný, chybí 1 klíčový údaj, krátká výpověď, konkurence 2+, neměřená frekvence nebo chybějící voda/odpad. Jinak „Vhodné podle dostupných podkladů".</p>`);
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
function studiesPage(s, studies) {
  return page(s, 'Případové studie', 'studie', `<h1 style="margin:0 0 6px">Případové studie</h1>${studies && studies.length ? studies.map((x) => `<div class="card"><h2 style="margin:0 0 6px">${esc(x.title)}</h2><div style="white-space:pre-wrap;color:var(--text2)">${esc(x.body)}</div></div>`).join('') : '<div class="card"><p class="muted" style="margin:0">Tři anonymizované lokality z naší sítě (dobrá, průměrná, slabá) připravujeme – jakmile budou hotové, objeví se zde a dostanete e-mail.</p></div>'}`);
}
function expiredPage(s) {
  return page(s, 'Přístup vypršel', 'loc', `<div class="card"><h1 style="margin:0 0 6px">Platnost přístupu skončila</h1><p class="muted">Váš přístup k aplikaci Prověření lokality vypršel. Pro prodloužení nás kontaktujte přes Podporu.</p></div>`);
}

module.exports = { LIMITS, PKG_LABEL, FIELDS, clean, calc, evaluate, siteForm, listPage, reportPage, checklistPage, studiesPage, expiredPage, num };
