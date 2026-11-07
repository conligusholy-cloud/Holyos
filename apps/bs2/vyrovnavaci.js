// Best Series 2.0 — Vyrovnávací účet (krizový režim výplat).
// Z částky „K výplatě" se vyplácí jen podíl (výchozí 30 %), zbytek (70 %) se připíše na vyrovnávací účet uživatele,
// který se zhodnocuje 5,68 % p.a. — průběžně od data každého pohybu (denně, act/365, bez skládání). Poměr jde u uživatele změnit v detailu
// (výplata % + vyrovnávací účet % = vždy 100 %). Pohyby: credit (připsání za měsíc), interest (zhodnocení za měsíc),
// deposit / withdraw (ruční). Připsání + zhodnocení za měsíc se zaúčtuje tlačítkem ve Výběry → Výplata (jen jednou).
'use strict';

const DEFAULT_PCT = 30;    // výchozí podíl k výplatě v %
const RATE_PA = 5.68;      // zhodnocení vyrovnávacího účtu p.a. v %
const KIND = { credit: 'Připsáno z výplaty', interest: 'Zhodnocení', deposit: 'Ruční vklad', withdraw: 'Výběr / vyplaceno' };
const r2 = (v) => Math.round(Number(v) * 100) / 100;
const pctOf = (s) => (s && s.payout_pct != null && isFinite(Number(s.payout_pct)) ? Number(s.payout_pct) : DEFAULT_PCT);
// Rozdělení částky k výplatě: { pay, bal, pct }
function split(total, pct) {
  if (total == null || !isFinite(Number(total))) return { pay: null, bal: null, pct };
  const pay = r2(Number(total) * pct / 100);
  return { pay, bal: r2(Number(total) - pay), pct };
}

// ── Bankovní účet pro výplatu ──
// CZK: [předčíslí-]číslo/kód banky (kontrola modulo 11), EUR: IBAN (kontrola modulo 97)
function normCzAccount(v) {
  const s = String(v || '').replace(/\s/g, '');
  const m = s.match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/);
  if (!m) return null;
  const mod11 = (num, len) => { const w = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1].slice(10 - len); const d = num.padStart(len, '0').split('').map(Number); return d.reduce((a, x, i) => a + x * w[i], 0) % 11 === 0; };
  if (m[1] && !mod11(m[1], 6)) return null;
  if (!mod11(m[2], 10)) return null;
  return (m[1] ? m[1].replace(/^0+/, '') + '-' : '') + m[2].replace(/^0+/, '') + '/' + m[3];
}
function normIban(v) {
  const s = String(v || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return null;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let mod = 0; for (const ch of r) mod = (mod * 10 + Number(ch)) % 97;
  return mod === 1 ? s.replace(/(.{4})/g, '$1 ').trim() : null;
}
// Variabilní symbol výplaty z id žádosti: 7 + id na 9 míst (10 číslic, unikátní)
const vsFor = (id) => '7' + String(id).padStart(9, '0');

module.exports = function mountVyrovnavaci(app, ctx) {
  const { q, requireAdmin, wrap, V, log } = ctx;
  const esc = V.esc;
  const money = (v, cur) => Number(v || 0).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur === 'EUR' ? ' €' : ' Kč');

  // Zůstatek = jistina (součet pohybů) + zhodnocení: každý pohyb se úročí RATE_PA od okamžiku, kdy proběhl
  // (výběr = záporný pohyb, od svého data úročení té části zastaví). m.get(id)[cur] = celkem, m.get(id)['_' + cur] = rozpad.
  const ACCR_SQL = `amount * GREATEST(0, EXTRACT(EPOCH FROM (now() - created_at))) / 86400.0 / 365.0 * ${RATE_PA} / 100.0`;
  async function balances(ids) {
    const m = new Map(); if (!ids.length) return m;
    (await q(`SELECT supporter_id, currency, sum(amount) AS bal, sum(CASE WHEN kind <> 'interest' THEN ${ACCR_SQL} ELSE 0 END) AS accr FROM balance_entries WHERE supporter_id = ANY($1::int[]) GROUP BY supporter_id, currency`, [ids])).rows
      .forEach((x) => { const o = m.get(x.supporter_id) || {}; const pr = r2(x.bal), ac = r2(x.accr); o[x.currency] = r2(pr + ac); o['_' + x.currency] = { principal: pr, accrued: ac }; m.set(x.supporter_id, o); });
    return m;
  }
  const accrOf = (e) => (e.kind === 'interest' ? 0 : Number(e.amount) * Math.max(0, (Date.now() - new Date(e.created_at).getTime()) / 864e5) / 365 * RATE_PA / 100);

  // Sekce do detailu uživatele (HTML)
  async function detailHtml(s) {
    if (!s || !s.id) return '';
    const ps = s.partner_support || {};
    const cur = ps.std_currency === 'EUR' ? 'EUR' : 'CZK';
    const rows = (await q('SELECT * FROM balance_entries WHERE supporter_id=$1 ORDER BY created_at DESC, id DESC LIMIT 300', [s.id])).rows;
    const bal = {}, acc = {}; rows.forEach((e) => { bal[e.currency] = (bal[e.currency] || 0) + Number(e.amount); acc[e.currency] = (acc[e.currency] || 0) + accrOf(e); });
    const pct = pctOf(s);
    const balTxt = Object.keys(bal).length ? Object.keys(bal).map((c) => '<b>' + money(r2(bal[c] + acc[c]), c) + '</b><div class="small muted" style="font-size:12px">jistina ' + money(r2(bal[c]), c) + ' + zhodnocení k dnešku ' + money(r2(acc[c]), c) + '</div>').join('') : '<b>' + money(0, cur) + '</b>';
    return `<div class="card" id="vyrovnavaci" style="margin-top:14px;border-color:rgba(167,139,250,.45)">
      <h3 style="margin:0 0 8px">🏦 Vyrovnávací účet <span class="muted" style="font-size:13px;font-weight:500">zhodnocení ${String(RATE_PA).replace('.', ',')} % p.a.</span></h3>
      <div class="row" style="gap:18px;flex-wrap:wrap;align-items:flex-end">
        <div><div class="small muted">Zůstatek vč. zhodnocení</div><div style="font-size:20px">${balTxt}</div></div>
        <form method="post" action="/admin/supporters/${s.id}/payout-pct" class="row" style="gap:8px;align-items:flex-end;margin:0;flex-wrap:wrap">
          <div><label class="small">Výplata %</label><input name="pct" id="vy-pct" type="number" min="0" max="100" step="1" value="${esc(String(pct))}" style="width:90px" oninput="var v=Math.max(0,Math.min(100,Number(this.value)||0));document.getElementById('vy-bal').value=100-v"></div>
          <div><label class="small">Vyrovnávací účet %</label><input id="vy-bal" type="number" value="${esc(String(100 - pct))}" style="width:90px" disabled></div>
          <button class="btn sm" type="submit">Uložit poměr</button>
          ${s.payout_pct != null ? `<button class="btn sec sm" type="submit" name="reset" value="1" title="Vrátit na výchozí ${DEFAULT_PCT} / ${100 - DEFAULT_PCT}">Výchozí ${DEFAULT_PCT} / ${100 - DEFAULT_PCT}</button>` : `<span class="small muted">výchozí nastavení</span>`}
        </form>
      </div>
      <form method="post" action="/admin/supporters/${s.id}/vyrovnavaci" class="row" style="gap:8px;align-items:flex-end;margin:12px 0 0;flex-wrap:wrap">
        <div><label class="small">Ruční pohyb</label><select name="kind" style="width:170px"><option value="deposit">Ruční vklad (+)</option><option value="withdraw">Výběr / vyplaceno (−)</option></select></div>
        <div><label class="small">Částka (${cur === 'EUR' ? '€' : 'Kč'})</label><input name="amount" inputmode="decimal" placeholder="0,00" style="width:120px" required></div>
        <div><label class="small">Za měsíc (nepovinné)</label><input name="period" placeholder="RRRR-MM" style="width:110px"></div>
        <div style="flex:1;min-width:180px"><label class="small">Poznámka</label><input name="note" placeholder="např. výplata převodem"></div>
        <button class="btn sec sm" type="submit" onclick="return confirm('Zapsat pohyb na vyrovnávací účet?')">Zapsat</button>
      </form>
      <div style="overflow-x:auto;margin-top:12px"><table><thead><tr><th>Datum</th><th>Měsíc</th><th>Pohyb</th><th style="text-align:right">Částka</th><th style="text-align:right" title="Zhodnocení tohoto pohybu od jeho data do dneška">Zhodnocení k dnešku</th><th>Poznámka</th></tr></thead><tbody>
      ${rows.map((e) => `<tr><td class="small muted">${new Date(e.created_at).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })}</td><td class="small">${esc(e.period || '—')}</td><td>${esc(KIND[e.kind] || e.kind)}</td><td style="text-align:right;white-space:nowrap;color:${Number(e.amount) < 0 ? '#f87171' : '#22c55e'}"><b>${Number(e.amount) > 0 ? '+' : ''}${money(e.amount, e.currency)}</b></td><td style="text-align:right;white-space:nowrap" class="small">${e.kind === 'interest' ? '—' : (accrOf(e) >= 0 ? '+' : '') + money(r2(accrOf(e)), e.currency)}</td><td class="small">${esc(e.note || '')}${e.created_by ? `<div class="muted">${esc(e.created_by)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Zatím žádné pohyby.</td></tr>'}
      </tbody></table></div></div>`;
  }

  // Poměr výplata / vyrovnávací účet (vždy 100 %)
  app.post('/admin/supporters/:id/payout-pct', requireAdmin, wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (req.body.reset) { await q('UPDATE supporters SET payout_pct=NULL WHERE id=$1', [id]); await log(req.admin, 'payout_pct', { id, pct: null }); return res.redirect('/admin/supporters/' + id + '?msg=' + encodeURIComponent('Poměr vrácen na výchozí ' + DEFAULT_PCT + ' / ' + (100 - DEFAULT_PCT)) + '#vyrovnavaci'); }
    const pct = Number(String(req.body.pct || '').replace(',', '.'));
    if (!isFinite(pct) || pct < 0 || pct > 100) return res.redirect('/admin/supporters/' + id + '?msg=' + encodeURIComponent('Výplata musí být 0–100 %') + '#vyrovnavaci');
    const v = Math.round(pct * 100) / 100;
    await q('UPDATE supporters SET payout_pct=$2 WHERE id=$1', [id, v]);
    await log(req.admin, 'payout_pct', { id, pct: v });
    res.redirect('/admin/supporters/' + id + '?msg=' + encodeURIComponent('Poměr uložen: výplata ' + v + ' % / vyrovnávací účet ' + r2(100 - v) + ' %') + '#vyrovnavaci');
  }));

  // Ruční pohyb na vyrovnávacím účtu
  app.post('/admin/supporters/:id/vyrovnavaci', requireAdmin, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const s = (await q("SELECT id, partner_support->>'std_currency' AS cur FROM supporters WHERE id=$1", [id])).rows[0];
    if (!s) return res.status(404).send('Uživatel nenalezen');
    const kind = req.body.kind === 'withdraw' ? 'withdraw' : 'deposit';
    const amt = Number(String(req.body.amount || '').replace(/\s/g, '').replace(',', '.'));
    if (!isFinite(amt) || amt <= 0) return res.redirect('/admin/supporters/' + id + '?msg=' + encodeURIComponent('Zadejte kladnou částku') + '#vyrovnavaci');
    const period = /^\d{4}-\d{2}$/.test(String(req.body.period || '').trim()) ? String(req.body.period).trim() : null;
    await q('INSERT INTO balance_entries (supporter_id, period, kind, amount, currency, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, period, kind, kind === 'withdraw' ? -r2(amt) : r2(amt), s.cur === 'EUR' ? 'EUR' : 'CZK', String(req.body.note || '').trim().slice(0, 300) || null, (req.admin && req.admin.name) || 'správce']);
    await log(req.admin, 'balance_' + kind, { id, amount: r2(amt), period });
    res.redirect('/admin/supporters/' + id + '?msg=' + encodeURIComponent('Pohyb zapsán') + '#vyrovnavaci');
  }));

  // Zaúčtování jednoho uživatele za měsíc (idempotentní — každý měsíc jen jednou):
  // připsání podílu pro vyrovnávací účet z K výplatě (zhodnocení běží průběžně od data připsání).
  async function bookUser(u, period, avgVisits, who) {
    const cur = u.std_currency === 'EUR' ? 'EUR' : 'CZK';
    const out = { interest: false, credit: false }; // zhodnocení se počítá průběžně od data pohybu, neúčtuje se měsíčně
    const p = V.provizeVyplaty(u, { period, avgVisits });
    const sp = split(p.total, pctOf(u));
    if (sp.bal != null && sp.bal > 0) {
      const rc = await q(`INSERT INTO balance_entries (supporter_id, period, kind, amount, currency, note, created_by) VALUES ($1,$2,'credit',$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
        [u.id, period, sp.bal, cur, (100 - sp.pct) + ' % z K výplatě ' + money(p.total, cur) + ' (výplata ' + sp.pct + ' % = ' + money(sp.pay, cur) + ')', who]);
      out.credit = !!rc.rowCount;
    }
    return out;
  }
  // Zaúčtování po odeslání žádosti o výběr (volá /vybery/request) — za měsíc, za který se vyplácí
  async function bookOnRequest(id) {
    const per = (await q(`SELECT to_char((now() AT TIME ZONE 'Europe/Prague') - interval '1 month', 'YYYY-MM') AS p`)).rows[0].p;
    const pr = (await q('SELECT avg_visits FROM vybery_periods WHERE period=$1', [per])).rows[0];
    if (!pr || pr.avg_visits == null) return null;
    const u = (await q(`SELECT s.id, s.mig_position, s.payout_pct, partner_support->>'std_currency' AS std_currency, partner_support->>'std_total' AS std_total,
      partner_support->>'std_expanze_all' AS std_expanze_all, partner_support->>'exp_invested' AS exp_invested, partner_support->>'position' AS legacy_position
      FROM supporters s WHERE s.id=$1`, [id])).rows[0];
    return u ? bookUser(u, per, Number(pr.avg_visits), 'automaticky při žádosti o výběr') : null;
  }

  // Zaúčtování měsíce (pro ty, kdo nepožádali o výběr): připsání podílu pro vyrovnávací účet
  // (5,68 % p.a. ÷ 12), pak připsání podílu pro vyrovnávací účet z částky K výplatě. Každý měsíc jen jednou.
  app.post('/admin/vybery/vyrovnavaci/zauctovat', requireAdmin, wrap(async (req, res) => {
    const period = String(req.body.period || '');
    if (!/^\d{4}-\d{2}$/.test(period)) return res.redirect('/admin/vybery?tab=vyplata&msg=' + encodeURIComponent('Chybí měsíc'));
    const pr = (await q('SELECT avg_visits FROM vybery_periods WHERE period=$1', [period])).rows[0];
    if (!pr || pr.avg_visits == null) return res.redirect('/admin/vybery?tab=vyplata&msg=' + encodeURIComponent('Nejdřív zadejte průměrnou návštěvnost za ' + period));
    const users = (await q(`SELECT s.id, s.mig_position, s.payout_pct, partner_support->>'std_currency' AS std_currency, partner_support->>'std_total' AS std_total,
      partner_support->>'std_expanze_all' AS std_expanze_all, partner_support->>'exp_invested' AS exp_invested, partner_support->>'position' AS legacy_position
      FROM supporters s WHERE s.mig_status IN ('ok','reviewed')`)).rows;
    const who = (req.admin && req.admin.name) || 'správce';
    let nCredit = 0, nInt = 0, skipped = 0;
    for (const u of users) { const r = await bookUser(u, period, Number(pr.avg_visits), who); if (r.interest) nInt++; if (r.credit) nCredit++; else skipped++; }
    await log(req.admin, 'balance_book_period', { period, credited: nCredit, interest: nInt });
    res.redirect('/admin/vybery?tab=vyplata&msg=' + encodeURIComponent(`Vyrovnávací účty za ${period}: připsáno ${nCredit}×` + (skipped ? `, přeskočeno ${skipped} (nic k připsání nebo už zaúčtováno)` : '')));
  }));

  // Částka k výplatě pro uživatele (stránka /vybery): za minulý měsíc (vyplácí se v aktuálním),
  // v měně účtu, už po rozdělení výplata / vyrovnávací účet; minus žádosti podané v aktuálním měsíci.
  async function payoutFor(id) {
    const per = (await q(`SELECT to_char((now() AT TIME ZONE 'Europe/Prague') - interval '1 month', 'YYYY-MM') AS p, to_char(now() AT TIME ZONE 'Europe/Prague','YYYY-MM') AS m`)).rows[0];
    const u = (await q(`SELECT s.id, s.mig_position, s.payout_pct, partner_support->>'std_currency' AS std_currency, partner_support->>'std_total' AS std_total,
      partner_support->>'std_expanze_all' AS std_expanze_all, partner_support->>'exp_invested' AS exp_invested, partner_support->>'position' AS legacy_position
      FROM supporters s WHERE s.id=$1`, [id])).rows[0];
    if (!u) return null;
    const cur = u.std_currency === 'EUR' ? 'EUR' : 'CZK';
    const pr = (await q('SELECT avg_visits FROM vybery_periods WHERE period=$1', [per.p])).rows[0];
    const bal = ((await balances([id])).get(id) || {})[cur] || 0;
    const out = { period: per.p, month: per.m, cur, pct: pctOf(u), total: null, pay: null, toBalance: null, balance: bal, requested: 0, available: null };
    if (!pr || pr.avg_visits == null) return out; // návštěvnost za měsíc ještě není zadaná
    const p = V.provizeVyplaty(u, { period: per.p, avgVisits: Number(pr.avg_visits) });
    const sp = split(p.total, out.pct);
    out.total = p.total; out.pay = sp.pay; out.toBalance = sp.bal;
    out.requested = r2((await q(`SELECT coalesce(sum(CASE WHEN status='paid' AND paid_amount IS NOT NULL THEN paid_amount ELSE amount END),0) AS s FROM withdrawal_requests
      WHERE supporter_id=$1 AND status IN ('requested','paid') AND currency=$2 AND to_char(requested_at AT TIME ZONE 'Europe/Prague','YYYY-MM')=$3`, [id, cur, per.m])).rows[0].s);
    out.available = sp.pay == null ? null : Math.max(0, r2(sp.pay - out.requested));
    return out;
  }

  return { DEFAULT_PCT, RATE_PA, pctOf, split, balances, detailHtml, payoutFor, bookOnRequest,
    async bookedPeriod(period) { return (await q("SELECT count(*)::int AS n FROM balance_entries WHERE period=$1 AND kind='credit'", [period])).rows[0].n; } };
};
module.exports.DEFAULT_PCT = DEFAULT_PCT;
module.exports.RATE_PA = RATE_PA;
module.exports.split = split;
module.exports.pctOf = pctOf;
module.exports.normCzAccount = normCzAccount;
module.exports.normIban = normIban;
module.exports.vsFor = vsFor;
