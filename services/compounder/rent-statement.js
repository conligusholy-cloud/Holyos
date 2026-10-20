// HolyOS — Podklad pro fakturaci nájmu kiosku (čl. VI nájemní smlouvy)
// Měsíční nájemné = B − C − D − E − F
//   A tržby s DPH (SIS, po odečtu vratek) · B = A / (1 + DPH) · C = % z A (bez DPH)
//   D náklad na lokalitu · E energie a média · F pozáruční servis a náhradní díly (D–F bez DPH po odečtu nároku na odpočet)
// Záporný výsledek = vyúčtování nákladů nekrytých obratem (čl. VI odst. 4).
// Subjekt a pravidla: KioskRentContract. D a E se automaticky doplní z PŘIJATÝCH faktur (dodavatel + klíčové slovo).
'use strict';

const { prisma } = require('../../config/database');
const { computePrevMonthRevenue } = require('./kiosk-revenue');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const CATS = { D: 'Náklad na užívání lokality', E: 'Energie a provozní média', F: 'Pozáruční servis a náhradní díly' };
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Klíčové slovo pravidla: „+" = musí platit všechno (AND), „|" = stačí jedno z nich (OR). Bez diakritiky a velikosti písmen.
// Např. „HM Breclav + Nájemné" nebo „HM Breclav + elektr|energi|voda". Prázdné = bere celou fakturu.
function kwMatch(desc, kw) {
  const k = norm(kw).trim(); if (!k) return true;
  const d = norm(desc);
  return k.split('+').every((grp) => { const alts = grp.split('|').map((x) => x.trim()).filter(Boolean); return !alts.length || alts.some((a) => d.includes(a)); });
}
const toYmd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

// Čisté přepočtení řádků a výsledku (bez DB)
function calc(st) {
  const vat = Number(st.vat_rate) || 0; const fee = Number(st.fee_pct) || 0;
  const lines = (Array.isArray(st.lines) ? st.lines : []).filter((l) => l && CATS[l.cat]).map((l) => {
    const amount = Number(l.amount) || 0; const lv = l.vat_rate === '' || l.vat_rate == null ? 0 : Number(l.vat_rate) || 0;
    const deductible = lv > 0; // náklady D–F se vždy počítají bez DPH (nájem se účtuje z ceny bez DPH)
    const out = { cat: l.cat, label: String(l.label || '').slice(0, 300), amount: r2(amount), vat_rate: lv, deductible: true, net: r2(deductible ? amount / (1 + lv / 100) : amount) };
    if (l.source) out.source = l.source; if (l.invoice_id) out.invoice_id = l.invoice_id;
    return out;
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

// Z přijatých faktur vybere řádky pro D (nájem lokality) a E (energie) podle pravidel smlouvy.
// Období = kalendářní měsíc podle DUZP (jinak data vystavení). Při neúplném měsíci (začátek/konec smlouvy) se částky krátí poměrně dnům.
async function pullInvoiceLines(contract, rev) {
  const out = []; const missing = [];
  const ymFrom = new Date(rev.prevMonthYm + '-01T00:00:00Z');
  const ymTo = new Date(Date.UTC(ymFrom.getUTCFullYear(), ymFrom.getUTCMonth() + 1, 0));
  const factor = rev.partial && rev.month_days ? rev.days / rev.month_days : 1;
  const ded = contract.vat_deductible !== false;
  for (const [cat, key] of [['D', 'rent_rules'], ['E', 'energy_rules'], ['F', 'service_rules']]) {
    const rules = Array.isArray(contract[key]) ? contract[key].filter((x) => x && x.company_id) : [];
    if (!rules.length) continue;
    let found = 0;
    for (const rule of rules) {
      const invs = await prisma.invoice.findMany({
        where: { type: 'received', company_id: parseInt(rule.company_id, 10), status: { notIn: ['cancelled', 'draft', 'written_off'] },
          OR: [{ date_taxable: { gte: ymFrom, lte: ymTo } }, { date_taxable: null, date_issued: { gte: ymFrom, lte: ymTo } }] },
        include: { items: true, company: { select: { name: true } } },
      });
      const kw = norm(rule.keyword); const share = (Number(rule.share_pct) > 0 ? Number(rule.share_pct) : 100) / 100;
      for (const inv of invs) {
        const items = (inv.items || []).filter((it) => kwMatch(it.description, rule.keyword));
        const byRate = {};
        for (const it of items) { const k = Number(it.vat_rate) || 0; byRate[k] = (byRate[k] || 0) + Number(it.total || 0); }
        for (const [rate, total] of Object.entries(byRate)) {
          const amount = r2(total * share * factor); if (!(amount > 0)) continue;
          found++;
          out.push({ cat, label: 'Faktura ' + (inv.external_number || inv.invoice_number) + ' — ' + ((inv.company && inv.company.name) || '') + (kw ? ' (' + rule.keyword + ')' : '') + (share < 1 ? ', podíl ' + Math.round(share * 100) + ' %' : '') + (factor < 1 ? ', poměrně ' + rev.days + '/' + rev.month_days + ' dní' : ''), amount, vat_rate: Number(rate), deductible: ded, source: 'invoice', invoice_id: inv.id });
        }
      }
    }
    if (!found && cat !== 'F') missing.push(cat); // F (servis/díly) je příležitostné — nechybí
  }
  return { lines: out, missing };
}

// Vytvoří / obnoví podklad za měsíc ym (YYYY-MM; výchozí předchozí). Vrací { statement, missing[] }.
async function generate(contractId, ym) {
  const c = await prisma.kioskRentContract.findUnique({ where: { id: contractId } });
  if (!c) { const e = new Error('Nájemní smlouva nenalezena'); e.status = 404; throw e; }
  const rev = await computePrevMonthRevenue(c.kiosk_code, { from: toYmd(c.effective_from), to: toYmd(c.effective_to), ym: ym || undefined });
  if (rev.empty) { const e = new Error('V tomto měsíci smlouva neběžela — není co vyúčtovat.'); e.status = 400; throw e; }
  const period = rev.prevMonthYm;
  const existing = await prisma.kioskRentStatement.findUnique({ where: { contract_id_period_ym: { contract_id: c.id, period_ym: period } } });
  if (existing && existing.status === 'issued') { const e = new Error('Podklad už je vydaný — nelze přepsat.'); e.status = 409; throw e; }
  const inv = await pullInvoiceLines(c, rev);
  const manual = ((existing && Array.isArray(existing.lines)) ? existing.lines : []).filter((l) => l && l.source !== 'invoice' && l.source !== 'ai');
  // Chytré vyhledání: AI přečte ostatní přijaté doklady za měsíc a určí nájem / energie / díly pro tento kiosk
  let ai = { lines: [], suggestions: [] };
  try {
    const taken = inv.lines.concat(manual).map((l) => l.invoice_id).filter(Boolean);
    ai = await require('./rent-doc-matcher').match(c, rev, { skipInvoiceIds: taken });
  } catch (e) { console.warn('[rent-statement] AI vyhledání selhalo:', e.message); }
  const allLines = manual.concat(inv.lines, ai.lines);
  const haveIds = new Set(allLines.map((l) => l.invoice_id).filter(Boolean));
  const suggestions = (ai.suggestions || []).filter((s) => !haveIds.has(s.invoice_id));
  // „Chybí" = pravidla požadují doklad (nájem/energie), ale nenašel se ani podle pravidel, ani AI
  const missing = inv.missing.filter((cat) => !allLines.some((l) => l.cat === cat)).map((cat) => (cat === 'D' ? 'faktura za nájem lokality' : 'faktura za energie'));
  const base = {
    kiosk_code: c.kiosk_code, customer_name: c.customer_name || null, buyer_ico: c.buyer_ico || null,
    period_from: new Date(rev.period_from + 'T00:00:00Z'), period_to: new Date(rev.period_to + 'T00:00:00Z'),
    currency: c.currency || rev.currency || 'CZK', vat_rate: Number(c.vat_rate) || 21, fee_pct: Number(c.fee_pct) || 13,
    revenue_sis: rev.prevMonth,
  };
  const k = calc(Object.assign({}, existing || {}, base, { lines: allLines }));
  const data = Object.assign({}, base, { suggestions, lines: k.lines, revenue_gross: k.revenue_gross, revenue_net: k.revenue_net, fee_net: k.fee_net, cost_d: k.cost_d, cost_e: k.cost_e, cost_f: k.cost_f, rent: k.rent });
  const statement = existing
    ? await prisma.kioskRentStatement.update({ where: { id: existing.id }, data })
    : await prisma.kioskRentStatement.create({ data: Object.assign({ contract_id: c.id, period_ym: period }, data) });
  return { statement, missing, suggestions };
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
  if (Array.isArray(body.suggestions)) data.suggestions = body.suggestions.slice(0, 100);
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
  return bs2.page({ title: 'Podklad pro fakturaci nájemného', number: st.doc_number || 'KONCEPT', pill: 'Nájem kiosku · ' + st.kiosk_code, ext: st.status === 'issued' ? '' : (st.test ? 'TESTOVACÍ UKÁZKA' : 'Koncept — nevydáno') }, `
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

async function ourCompany() { try { return await require('../settings').getOurCompany(); } catch (e) { return null; } }
async function pdf(st) { return require('../pdf/contracts').htmlToPdfBuffer(html(st, await ourCompany())); }

// ─── E-mail ─────────────────────────────────────────────────────────────────
async function mailFrom() {
  const our = await ourCompany();
  return { from: process.env.SERVICE_BILLING_MAIL_FROM || (our && our.email) || process.env.COMPOUNDER_MAIL_FROM || undefined, fromName: process.env.SERVICE_BILLING_MAIL_FROM_NAME || '🧾 Fakturace Best Series - Prádlomat' };
}
function mailText(st, contract, test) {
  const cur = st.currency || 'CZK'; const f = (n) => Number(n).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + cur;
  const rent = Number(st.rent) || 0;
  const hi = contract && contract.contact_name ? 'Dobrý den, ' + String(contract.contact_name).split(' ')[0] + ',' : 'Dobrý den,';
  return (test ? 'TESTOVACÍ E-MAIL — takto bude vypadat zpráva pro kompetentní osobu. Podklad v příloze je ukázka.\n\n' : '')
    + hi + '\n\nv příloze zasíláme podklad pro fakturaci nájemného kiosku ' + st.kiosk_code + ' za období ' + st.period_ym + (st.doc_number ? ' (' + st.doc_number + ')' : '') + '.\n\n'
    + 'Tržby s DPH (A): ' + f(st.revenue_gross) + '\nServisní a provozní poplatek (C): ' + f(st.fee_net) + '\n'
    + (rent >= 0 ? 'Měsíční nájemné bez DPH (B − C − D − E − F): ' : 'Záporný výsledek — vyúčtování nekrytých nákladů: ') + f(rent) + '\n\n'
    + 'Podle tohoto podkladu prosím vystavte fakturu.\n\nS pozdravem\nBest Series';
}
async function sendStatementMail(st, contract, opts) {
  opts = opts || {};
  const { sendMail } = require('../email');
  const to = opts.to || contract.contact_email; if (!to) return { sent: false, error: 'Chybí e-mail kompetentní osoby' };
  const cc = !opts.to && contract.cc_emails ? contract.cc_emails : undefined;
  const buf = await pdf(st);
  const r = await sendMail(Object.assign({}, await mailFrom(), {
    to: cc ? to + ', ' + cc : to, brand: 'bs2',
    subject: (opts.test ? '[TEST] ' : '') + 'Podklad pro fakturaci nájmu kiosku ' + st.kiosk_code + ' — ' + st.period_ym,
    body: mailText(st, contract, !!opts.test),
    attachments: [{ filename: 'najem-' + st.kiosk_code + '-' + st.period_ym + '.pdf', content: buf, contentType: 'application/pdf' }],
  }));
  return Object.assign({}, r, { to });
}

// Testovací e-mail: ukázkový podklad (skutečné tržby a faktury, pokud jdou načíst; jinak vzorová data) — NIC se neukládá.
async function sendTest(contract, to) {
  let rev = null; try { rev = await computePrevMonthRevenue(contract.kiosk_code, { from: toYmd(contract.effective_from), to: toYmd(contract.effective_to) }); } catch (e) { rev = null; }
  if (rev && rev.empty) rev = null;
  const real = !!(rev && rev.prevMonth > 0);
  const base = rev || { prevMonthYm: new Date().toISOString().slice(0, 7), period_from: new Date().toISOString().slice(0, 8) + '01', period_to: new Date().toISOString().slice(0, 10), prevMonth: 0, partial: false, days: 30, month_days: 30 };
  let inv = { lines: [], missing: [] }; try { inv = await pullInvoiceLines(contract, base); } catch (e) { /* bez faktur */ }
  const lines = inv.lines.length ? inv.lines : [{ cat: 'D', label: 'Ukázka — faktura za nájem lokality', amount: 12100, vat_rate: 21, deductible: true }, { cat: 'E', label: 'Ukázka — faktura za energie', amount: 6050, vat_rate: 21, deductible: true }];
  const st = { test: true, kiosk_code: contract.kiosk_code, customer_name: contract.customer_name, buyer_ico: contract.buyer_ico, period_ym: base.prevMonthYm, period_from: new Date(base.period_from + 'T00:00:00Z'), period_to: new Date(base.period_to + 'T00:00:00Z'), currency: contract.currency || 'CZK', vat_rate: Number(contract.vat_rate) || 21, fee_pct: Number(contract.fee_pct) || 13, revenue_sis: real ? base.prevMonth : 121000, revenue_adjust: 0, lines, status: 'draft', note: real ? null : 'UKÁZKA — vzorová data, tržby za minulý měsíc se nepodařilo načíst.' };
  Object.assign(st, calc(st));
  const r = await sendStatementMail(st, contract, { to, test: true });
  return Object.assign({}, r, { sent_to: to, rent: st.rent, real_data: real });
}

// Zpracování jedné smlouvy za měsíc podle režimu (volá worker): draft = jen koncept, issue = vystavit, send = vystavit a odeslat.
// Chybí-li očekávaná faktura (nájem/energie), podklad se nevydává automaticky — zůstane koncept s upozorněním a zkusí se znovu.
async function processContract(contract, ym) {
  const { statement, missing, suggestions } = await generate(contract.id, ym);
  if (contract.auto_mode === 'draft') return { statement, action: 'draft' };
  // Neúplné doklady nebo nepotvrzené návrhy AI → automaticky nevydávat, ať se nepošle chybná částka
  const hold = missing.concat(suggestions && suggestions.length ? [suggestions.length + '× návrh AI čeká na potvrzení'] : []);
  if (hold.length) {
    await prisma.kioskRentStatement.update({ where: { id: statement.id }, data: { send_error: 'Čeká: ' + hold.join(', ') } });
    return { statement, action: 'held', missing: hold };
  }
  const issued = await update(statement.id, { status: 'issued', lines: statement.lines });
  if (contract.auto_mode !== 'send') { await prisma.kioskRentStatement.update({ where: { id: issued.id }, data: { send_error: null } }); return { statement: issued, action: 'issued' }; }
  return Object.assign({ action: 'issued' }, await deliver(issued.id, contract));
}
// Odeslání vydaného podkladu e-mailem (zapíše sent_at / send_error)
async function deliver(statementId, contract) {
  const st = await prisma.kioskRentStatement.findUnique({ where: { id: statementId } });
  let r; try { r = await sendStatementMail(st, contract); } catch (e) { r = { sent: false, error: e.message }; }
  const upd = await prisma.kioskRentStatement.update({ where: { id: st.id }, data: r.sent ? { sent_at: new Date(), sent_to: r.to, send_error: null } : { send_error: String(r.error || r.skipped || 'neodesláno').slice(0, 500) } });
  return { statement: upd, sent: !!r.sent, error: r.sent ? null : (r.error || r.skipped || 'neodesláno') };
}

module.exports = { calc, generate, update, html, pdf, sendTest, processContract, deliver, sendStatementMail, CATS };
