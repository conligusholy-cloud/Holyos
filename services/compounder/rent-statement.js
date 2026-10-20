// HolyOS — Podklad pro fakturaci nájmu kiosku (čl. VI nájemní smlouvy)
// Měsíční nájemné = B − C − D − E − F
//   A tržby s DPH (SIS, po odečtu vratek) · B = A / (1 + DPH) · C = % z A (bez DPH)
//   D náklad na lokalitu · E energie a média · F pozáruční servis a náhradní díly (D–F bez DPH po odečtu nároku na odpočet)
// Záporný výsledek = vyúčtování nákladů nekrytých obratem (čl. VI odst. 4).
'use strict';

const { prisma } = require('../../config/database');
const { computePrevMonthRevenue } = require('./kiosk-revenue');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const CATS = { D: 'Náklad na užívání lokality', E: 'Energie a provozní média', F: 'Pozáruční servis a náhradní díly' };

// Čisté přepočtení řádků a výsledku (bez DB)
function calc(st) {
  const vat = Number(st.vat_rate) || 0; const fee = Number(st.fee_pct) || 0;
  const lines = (Array.isArray(st.lines) ? st.lines : []).filter((l) => l && CATS[l.cat]).map((l) => {
    const amount = Number(l.amount) || 0; const lv = l.vat_rate === '' || l.vat_rate == null ? 0 : Number(l.vat_rate) || 0;
    const deductible = l.deductible !== false && lv > 0; // nárok na odpočet → do nákladu jen základ bez DPH
    return { cat: l.cat, label: String(l.label || '').slice(0, 200), amount: r2(amount), vat_rate: lv, deductible: l.deductible !== false, net: r2(deductible ? amount / (1 + lv / 100) : amount) };
  });
  const sum = (c) => r2(lines.filter((l) => l.cat === c).reduce((s, l) => s + l.net, 0));
  const A = r2((Number(st.revenue_sis) || 0) + (Number(st.revenue_adjust) || 0));
  const B = r2(A / (1 + vat / 100)); const C = r2(A * fee / 100);
  const D = sum('D'), E = sum('E'), F = sum('F');
  return { lines, revenue_gross: A, revenue_net: B, fee_net: C, cost_d: D, cost_e: E, cost_f: F, rent: r2(B - C - D - E - F) };
}

async function nextDocNumber() {
  const series = 'NP-' + new Date().getFullYear();
  const row = await prisma.documentCounter.upsert({ where: { series }, create: { series, last_seq: 1 }, update: { last_seq: { increment: 1 } } });
  return series + '-' + String(row.last_seq).padStart(4, '0');
}

// Vytvoří / obnoví podklad za měsíc ym (YYYY-MM; výchozí předchozí měsíc). Tržby A se načtou ze SIS jen za dny, kdy smlouva běžela.
async function generate(subscriptionId, ym) {
  const sub = await prisma.serviceSubscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) { const e = new Error('Smlouva nenalezena'); e.status = 404; throw e; }
  const toYmd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  const rev = await computePrevMonthRevenue(sub.kiosk_code, { from: toYmd(sub.contract_start), to: toYmd(sub.contract_end), ym: ym || undefined });
  if (rev.empty) { const e = new Error('V tomto měsíci smlouva neběžela — není co vyúčtovat.'); e.status = 400; throw e; }
  const period = rev.prevMonthYm;
  const existing = await prisma.kioskRentStatement.findUnique({ where: { subscription_id_period_ym: { subscription_id: sub.id, period_ym: period } } });
  if (existing && existing.status === 'issued') { const e = new Error('Podklad už je vydaný — nelze přepsat.'); e.status = 409; throw e; }
  const base = {
    kiosk_code: sub.kiosk_code, customer_name: sub.customer_name || null, buyer_ico: sub.buyer_ico || null,
    period_from: new Date(rev.period_from + 'T00:00:00Z'), period_to: new Date(rev.period_to + 'T00:00:00Z'),
    currency: sub.currency || rev.currency || 'CZK', vat_rate: Number(sub.vat_rate) || 21, fee_pct: Number(sub.fee_pct) || 13,
    revenue_sis: rev.prevMonth,
  };
  const merged = Object.assign({}, existing || {}, base);
  const c = calc(merged);
  const data = Object.assign({}, base, { lines: c.lines, revenue_gross: c.revenue_gross, revenue_net: c.revenue_net, fee_net: c.fee_net, cost_d: c.cost_d, cost_e: c.cost_e, cost_f: c.cost_f, rent: c.rent });
  if (existing) return prisma.kioskRentStatement.update({ where: { id: existing.id }, data });
  return prisma.kioskRentStatement.create({ data: Object.assign({ subscription_id: sub.id, period_ym: period }, data) });
}

// Úprava: řádky D/E/F, ruční úprava A, poznámka; status 'issued' přidělí číslo dokladu
async function update(id, body) {
  const st = await prisma.kioskRentStatement.findUnique({ where: { id } });
  if (!st) { const e = new Error('Podklad nenalezen'); e.status = 404; throw e; }
  if (st.status === 'issued' && body.status !== 'draft') { const e = new Error('Vydaný podklad nelze upravit (nejdřív ho vrať do konceptu).'); e.status = 409; throw e; }
  const merged = Object.assign({}, st);
  if (body.lines !== undefined) merged.lines = body.lines;
  if (body.revenue_adjust !== undefined) merged.revenue_adjust = Number(body.revenue_adjust) || 0;
  const c = calc(merged);
  const data = { lines: c.lines, revenue_adjust: merged.revenue_adjust, revenue_gross: c.revenue_gross, revenue_net: c.revenue_net, fee_net: c.fee_net, cost_d: c.cost_d, cost_e: c.cost_e, cost_f: c.cost_f, rent: c.rent };
  if (body.note !== undefined) data.note = body.note ? String(body.note).slice(0, 4000) : null;
  if (body.status === 'issued' && st.status !== 'issued') { data.status = 'issued'; if (!st.doc_number) data.doc_number = await nextDocNumber(); }
  if (body.status === 'draft' && st.status === 'issued') data.status = 'draft';
  return prisma.kioskRentStatement.update({ where: { id }, data });
}

// ─── HTML / PDF ─────────────────────────────────────────────────────────────
function html(st, ourCompany) {
  const bs2 = require('../pdf/bs2-doc-style'); const esc = bs2.esc;
  const cur = st.currency || 'CZK';
  const m = (n) => Number(n).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + cur;
  const d = (v) => new Date(v).toLocaleDateString('cs-CZ', { timeZone: 'UTC' });
  const lines = Array.isArray(st.lines) ? st.lines : [];
  const catRows = ['D', 'E', 'F'].map((c) => {
    const ls = lines.filter((l) => l.cat === c);
    const total = ls.reduce((s, l) => s + Number(l.net || 0), 0);
    const detail = ls.map((l) => `<tr><td style="padding-left:22px;color:#5b6b86">${esc(l.label || '—')}</td><td class="r" style="color:#5b6b86">${m(l.amount)}${l.vat_rate ? ' (DPH ' + l.vat_rate + ' %' + (l.deductible === false ? ', bez odpočtu' : '') + ')' : ''}</td><td class="r" style="color:#5b6b86">${m(l.net)}</td></tr>`).join('');
    return `<tr><td><b>${c}. ${CATS[c]}</b></td><td class="r"></td><td class="r"><b>− ${m(total)}</b></td></tr>${detail}`;
  }).join('');
  const rent = Number(st.rent) || 0;
  return bs2.page({ title: 'Podklad pro fakturaci nájemného', number: st.doc_number || 'KONCEPT', pill: 'Nájem kiosku · ' + st.kiosk_code, ext: st.status === 'issued' ? '' : 'Koncept — nevydáno' }, `
  <div class="parties"><div class="party"><span class="h">Nájemce (provozovatel)</span><div class="name">${esc(st.customer_name || '—')}</div>${st.buyer_ico ? `<div class="row">IČO ${esc(st.buyer_ico)}</div>` : ''}<div class="row">Kiosk: ${esc(st.kiosk_code)}</div></div>
    <div class="party"><span class="h">Pronajímatel</span><div class="name">${esc((ourCompany && ourCompany.name) || 'Best Series s.r.o.')}</div>${ourCompany && ourCompany.ico ? `<div class="row">IČO ${esc(ourCompany.ico)}</div>` : ''}</div></div>
  <div class="meta"><div><div class="l">Období</div><div class="v">${d(st.period_from)} – ${d(st.period_to)}</div></div><div><div class="l">Měsíc</div><div class="v">${esc(st.period_ym)}</div></div><div><div class="l">DPH</div><div class="v">${Number(st.vat_rate)} %</div></div><div><div class="l">Poplatek Nájemce</div><div class="v">${Number(st.fee_pct)} % z tržeb</div></div></div>
  <table class="items"><thead><tr><th>Položka výpočtu (čl. VI)</th><th class="r">Částka vč. DPH</th><th class="r">Bez DPH</th></tr></thead><tbody>
    <tr><td><b>A. Tržby s DPH</b> <span style="color:#5b6b86">(SIS${Number(st.revenue_adjust) ? ', vč. úpravy ' + m(st.revenue_adjust) : ''})</span></td><td class="r"><b>${m(st.revenue_gross)}</b></td><td class="r"></td></tr>
    <tr><td><b>B. Obrat bez DPH</b> <span style="color:#5b6b86">(A snížené o DPH)</span></td><td class="r"></td><td class="r"><b>${m(st.revenue_net)}</b></td></tr>
    <tr><td><b>C. Servisní a provozní poplatek Nájemce</b> <span style="color:#5b6b86">(${Number(st.fee_pct)} % z A, bez DPH)</span></td><td class="r"></td><td class="r"><b>− ${m(st.fee_net)}</b></td></tr>
    ${catRows}
  </tbody></table>
  <div class="sum"><div class="row total"><span>${rent >= 0 ? 'Měsíční nájemné (B − C − D − E − F)' : 'Záporný výsledek — vyúčtování nekrytých nákladů'}</span><span>${m(rent)}</span></div></div>
  <div class="box"><h3>Jak číst výsledek</h3>${rent >= 0 ? 'Kladný výsledek je měsíční nájemné bez DPH za uvedené období. K částce se připočte DPH v zákonné výši, je-li podle právních předpisů účtována.' : 'Výsledek vzorce B − C − D − E − F je záporný. Absolutní hodnota představuje část nákladů na lokalitu, energie, provozní média a případný pozáruční servis, které nebyly kryty obratem po odečtení servisního a provozního poplatku. Nájemce tuto částku vyúčtuje Pronajímateli (čl. VI odst. 4).'} Položky D, E a F se uvádějí po odečtení DPH, na kterou má Nájemce nárok na odpočet; podklady (daňové doklady) jsou součástí vyúčtování.</div>
  ${st.note ? `<div class="box"><h3>Poznámka</h3>${esc(st.note)}</div>` : ''}
  <div class="sig"><div>Za Nájemce (zpracoval)</div><div>Za Pronajímatele (odsouhlasil)</div></div>`);
}

async function pdf(st) {
  let our = null; try { our = await require('../settings').getOurCompany(); } catch (e) { our = null; }
  return require('../pdf/contracts').htmlToPdfBuffer(html(st, our));
}

module.exports = { calc, generate, update, html, pdf, CATS };
