// HolyOS — Hlídání zpracování bankovních výpisů + upozornění do Velína
// Po každém běhu importu z e-mailu (a jednou za den) zkontroluje:
//   1) chyby stažení / odemčení / načtení výpisu, výpis pro neznámý účet
//   2) kontrolní součet výpisu: počáteční zůstatek + příjmy − výdaje = konečný zůstatek
//   3) návaznost: počáteční zůstatek = konečný zůstatek předchozího výpisu (chybějící výpis)
//   4) nevypořádané platby z nových výpisů (k posouzení / bez dokladu)
//   5) „ticho": žádný nový výpis déle než 3 pracovní dny
//   6) pád workeru
// Problém → push do Velína + zvonek v HolyOS. Stejné upozornění max. 1× za 12 h.
// Příjemci: AppSetting `banking.velin_notify_person_ids` (JSON pole Person.id), výchozí [1] (Tomáš).
'use strict';

const { prisma } = require('../../config/database');
const SETTING_KEY = 'banking.velin_notify_person_ids';
const DEDUP_MS = 12 * 3600 * 1000;
const sent = new Map(); // klíč → čas odeslání (in-memory dedup)

async function recipients() {
  try {
    const { getSetting } = require('../settings');
    const ids = await getSetting(SETTING_KEY, { type: 'json', defaultValue: null });
    if (Array.isArray(ids) && ids.length) return ids.map(Number).filter(Boolean);
  } catch (e) { /* výchozí */ }
  return [1];
}

let _collect = null; // nálezy aktuálního běhu (pro log)
async function alert(key, title, body, link = '/modules/ucetni-doklady/index.html') {
  const now = Date.now();
  if (_collect) _collect.push({ title, body, notified: !(sent.has(key) && now - sent.get(key) < DEDUP_MS) });
  if (sent.has(key) && now - sent.get(key) < DEDUP_MS) return false;
  sent.set(key, now);
  console.warn('[bank-monitor] ⚠', title, '—', body);
  const ids = await recipients();
  let notifyPerson = null, createNotification = null;
  try { ({ notifyPerson } = require('../push/expo-push')); } catch (e) { /* bez pushe */ }
  try { ({ createNotification } = require('../../routes/notifications.routes')); } catch (e) { /* bez zvonku */ }
  const persons = await prisma.person.findMany({ where: { id: { in: ids } }, select: { id: true, user_id: true } }).catch(() => []);
  for (const p of persons) {
    if (notifyPerson) notifyPerson(prisma, p.id, { title, body, data: { type: 'bank_statement_alert', link }, sound: 'default' }).catch((e) => console.warn('[bank-monitor] push', p.id, e.message));
    if (createNotification && p.user_id) createNotification({ userId: p.user_id, type: 'system', title, body, link }).catch(() => {});
  }
  return true;
}

const fmt = (n) => Number(n || 0).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Kontrola jednoho naimportovaného výpisu (součet + návaznost + vypořádání). Vrací pole problémů. */
async function checkStatement(statementId) {
  const problems = [];
  const st = await prisma.bankStatement.findUnique({
    where: { id: statementId },
    include: { bank_account: { select: { id: true, name: true } }, transactions: { select: { amount: true, direction: true, match_status: true } } },
  });
  if (!st) return problems;
  const tx = st.transactions;
  const inSum = tx.filter((t) => t.direction === 'in').reduce((s, t) => s + Number(t.amount), 0);
  const outSum = tx.filter((t) => t.direction === 'out').reduce((s, t) => s + Number(t.amount), 0);
  const expected = Math.round((Number(st.opening_balance) + inSum - outSum) * 100) / 100;
  const closing = Math.round(Number(st.closing_balance) * 100) / 100;
  if (Math.abs(expected - closing) > 0.01) {
    problems.push({ key: 'sum:' + st.id, title: '⚠️ Výpis ' + st.statement_number + ' nesedí',
      body: 'Počáteční ' + fmt(st.opening_balance) + ' + příjmy ' + fmt(inSum) + ' − výdaje ' + fmt(outSum) + ' = ' + fmt(expected) + ', ale výpis končí na ' + fmt(closing) + ' Kč. Některé platby se nejspíš nenačetly.' });
  }
  // návaznost na předchozí výpis téhož účtu
  const prev = await prisma.bankStatement.findFirst({
    where: { bank_account_id: st.bank_account_id, period_to: { lt: st.period_from }, id: { not: st.id } },
    orderBy: [{ period_to: 'desc' }, { id: 'desc' }], select: { statement_number: true, closing_balance: true },
  });
  if (prev && Math.abs(Number(prev.closing_balance) - Number(st.opening_balance)) > 0.01) {
    problems.push({ key: 'gap:' + st.id, title: '⚠️ Chybí výpis před ' + st.statement_number,
      body: 'Předchozí výpis ' + prev.statement_number + ' končí na ' + fmt(prev.closing_balance) + ' Kč, ale ' + st.statement_number + ' začíná na ' + fmt(st.opening_balance) + ' Kč. Nejspíš chybí výpis mezi nimi — zkus „Načíst i staré".' });
  }
  // nevypořádané platby
  const review = tx.filter((t) => t.match_status === 'needs_review').length;
  const unmatched = tx.filter((t) => t.match_status === 'unmatched').length;
  if (review || unmatched) {
    problems.push({ key: 'open:' + st.id, title: '🔎 Výpis ' + st.statement_number + ': ' + (review + unmatched) + ' plateb nevypořádáno',
      body: (review ? review + '× k posouzení' : '') + (review && unmatched ? ', ' : '') + (unmatched ? unmatched + '× bez dokladu' : '') + ' z ' + tx.length + ' plateb. Projdi Banka → Platby.' });
  }
  return problems;
}

/** Zavolá worker / upload po každém běhu s jeho reportem. opts.trigger: auto | manual | manual_all | upload */
async function afterRun(report, opts = {}) {
  _collect = [];
  try {
    if (report.errors && report.errors.length) {
      await alert('err:' + report.errors.join('|').slice(0, 200), '❌ Výpisy z e-mailu: chyba zpracování', report.errors.slice(0, 3).join(' · ').slice(0, 300));
    }
    for (const n of report.no_account || []) {
      await alert('noacc:' + n.account, '❌ Výpis pro neznámý účet', 'Soubor ' + n.file + ' patří k účtu ' + n.account + ', který v HolyOS není (Banky). Výpis se nenaimportoval.', '/modules/banky/index.html');
    }
    for (const im of report.imported || []) {
      if (!im.statement_id) continue;
      for (const p of await checkStatement(im.statement_id)) await alert(p.key, p.title, p.body);
      if (im.warnings && im.warnings.length) await alert('warn:' + im.statement_id, '⚠️ Výpis ' + (im.statement || '') + ': upozornění při načtení', im.warnings.slice(0, 3).join(' · ').slice(0, 300));
    }
    await checkStale();
  } catch (e) { console.warn('[bank-monitor] afterRun:', e.message); }
  const issues = _collect || []; _collect = null;
  await logRun(report, opts, issues);
  return issues;
}

const TRIGGER_LABEL = { auto: 'automaticky', manual: 'ručně (Načíst z e-mailu)', manual_all: 'ručně (Načíst i staré)', upload: 'ruční nahrání souboru' };
/** Záznam o běhu do audit logu (entity bank_statement_run) — zobrazuje se v Banka → Výpisy → 📜 Logy. */
async function logRun(report, opts, issues) {
  try {
    const imported = report.imported || [];
    const importedCount = imported.length || report._imported_count || 0;
    const errors = (report.errors || []).length + (report.no_account || []).length;
    const level = errors ? 'error' : issues.length ? 'warning' : 'ok';
    // prázdné automatické běhy (nic nového) logovat jen jednou za hodinu, ať log nezahltí
    if (opts.trigger === 'auto' && !importedCount && !errors && !issues.length) {
      const last = await prisma.auditLog.findFirst({ where: { entity: 'bank_statement_run' }, orderBy: { timestamp: 'desc' }, select: { timestamp: true, changes: true } });
      if (last && last.changes && last.changes.level === 'ok' && !last.changes.imported && Date.now() - new Date(last.timestamp).getTime() < 3600e3) return;
    }
    const am = report.auto_match || {};
    await prisma.auditLog.create({ data: {
      action: 'run', entity: 'bank_statement_run', entity_id: null,
      user_name: opts.user ? (opts.user.username || null) : 'system',
      user_display: opts.user ? (opts.user.displayName || null) : 'Import výpisů',
      description: (TRIGGER_LABEL[opts.trigger] || opts.trigger || 'běh') + ': ' + (importedCount ? importedCount + ' nových výpisů' : 'žádný nový výpis') +
        (am.matched ? ', spárováno ' + am.matched : '') + (errors ? ', chyby ' + errors : '') + (issues.length ? ', upozornění ' + issues.length : ''),
      changes: {
        level, trigger: opts.trigger || null, messages: report.messages || 0, imported: importedCount,
        duplicates: (report.duplicates || []).length, matched: am.matched || 0, partial: am.partial || 0, needs_review: am.needs_review || 0,
        statements: imported.map(i => ({ id: i.statement_id, number: i.statement, transactions: i.transactions, file: i.file })),
        errors: (report.errors || []).slice(0, 20), no_account: report.no_account || [],
        issues: issues.slice(0, 30),
      },
    } });
  } catch (e) { console.warn('[bank-monitor] log:', e.message); }
}

/** Žádný nový výpis déle než 3 pracovní dny (po víkendu se nepočítá). */
async function checkStale() {
  const accounts = await prisma.bankAccount.findMany({ where: { active: true }, select: { id: true, name: true } });
  for (const a of accounts) {
    const last = await prisma.bankStatement.findFirst({ where: { bank_account_id: a.id }, orderBy: { period_to: 'desc' }, select: { period_to: true, statement_number: true } });
    if (!last) continue;
    let d = new Date(last.period_to); d.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let workdays = 0;
    while (d < today) { d = new Date(+d + 864e5); const wd = d.getDay(); if (wd !== 0 && wd !== 6) workdays++; }
    if (workdays > 3) {
      await alert('stale:' + a.id + ':' + today.toISOString().slice(0, 10), '⏰ Žádný nový výpis — ' + a.name,
        'Poslední výpis ' + last.statement_number + ' je do ' + new Date(last.period_to).toLocaleDateString('cs-CZ') + ' (' + workdays + ' pracovní dny). Zkontroluj, jestli banka posílá výpisy do invoice@bestseries.cz → VYPISY.');
    }
  }
}

async function workerCrashed(err, opts = {}) {
  _collect = [];
  await alert('crash:' + String(err && err.message).slice(0, 80), '❌ Import výpisů spadl', String(err && err.message || err).slice(0, 300));
  const issues = _collect; _collect = null;
  await logRun({ errors: [String(err && err.message || err)] }, opts, issues);
}

module.exports = { afterRun, checkStatement, checkStale, workerCrashed, alert, SETTING_KEY };
