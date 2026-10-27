// HolyOS — Automatický import bankovních výpisů z e-mailu
// Čte složku (výchozí „VYPISY") ve schránce faktur (BANK_STATEMENT_MAILBOX, výchozí invoice@bestseries.cz)
// přes Microsoft Graph, stáhne přílohy STM_*.PDF (MONETA, zaheslované — BANK_STATEMENT_PASSWORD, lze víc hesel
// oddělených čárkou) nebo GPC/CSV/MT940, naimportuje je do Účetní doklady → Banka a spustí párování s fakturami.
// Zprávu označí jako přečtenou až po úspěšném importu (nebo když je výpis už v systému).
'use strict';

const graph = require('../ms-graph-client');
const { importStatementBuffer } = require('./statement-import');

const MAILBOX = () => process.env.BANK_STATEMENT_MAILBOX || 'invoice@bestseries.cz';
const FOLDER = () => process.env.BANK_STATEMENT_MAIL_FOLDER || 'VYPISY';
const INTERVAL_MIN = Math.max(5, parseInt(process.env.BANK_STATEMENT_POLL_MINUTES || '30', 10) || 30);
const STATEMENT_FILE = /\.(pdf|gpc|abo|csv|sta|mt940|txt)$/i;

let running = false;
let lastRun = null;
let folderId = null;
// Průběh právě běžícího (nebo posledního) importu — čte ho UI přes GET /statements/fetch-email/status
let progress = { running: false, phase: 'idle', total: 0, done: 0, current: '', imported: 0, duplicates: 0, errors: 0, started_at: null, finished_at: null, report: null };

// all = true → projde VŠECHNY zprávy ve složce (i přečtené) od nejstarší; duplicity import přeskočí, zprávy neoznačuje.
// passwords = hesla k PDF navíc k BANK_STATEMENT_PASSWORD (zkusí se postupně, nikam se neukládají).
async function runOnce({ markRead = true, all = false, passwords = null } = {}) {
  if (running) return { skipped: 'already_running' };
  running = true;
  const report = { at: new Date().toISOString(), messages: 0, imported: [], duplicates: [], errors: [], no_account: [] };
  progress = { running: true, phase: 'listing', total: 0, done: 0, current: 'Načítám seznam e-mailů…', imported: 0, duplicates: 0, errors: 0, started_at: report.at, finished_at: null, report: null };
  try {
    const mb = MAILBOX();
    if (!mb || !graph.isConfigured || !require('../ms-oauth2').isConfigured()) { report.errors.push('Schránka nebo Azure není nastavené'); return report; }
    if (!folderId) folderId = await graph.findMailFolderId(mb, FOLDER());
    if (!folderId) { report.errors.push(`Složka „${FOLDER()}" ve schránce ${mb} nenalezena`); return report; }
    const msgs = all ? await graph.listAllInFolder(mb, folderId) : await graph.listUnreadInFolder(mb, folderId, { top: 25 });
    if (all) markRead = false;
    report.messages = msgs.length;
    progress.phase = 'importing'; progress.total = msgs.length;
    for (const m of msgs) {
      progress.current = (m.receivedDateTime ? String(m.receivedDateTime).slice(0, 10) + ' — ' : '') + (m.subject || 'e-mail');
      const atts = (m.attachments || []).filter((a) => !a.isInline && STATEMENT_FILE.test(a.name || ''));
      if (!atts.length) { progress.done++; continue; }
      let allOk = true;
      for (const a of atts) {
        try {
          const file = await graph.downloadAttachment(mb, m.id, a.id);
          if (!file || !file.buffer) { allOk = false; report.errors.push(a.name + ': nelze stáhnout'); continue; }
          const r = await importStatementBuffer({ buffer: file.buffer, filename: a.name, source: 'email', passwords });
          if (r.status === 'imported') report.imported.push({ file: a.name, statement: r.statement_number, transactions: r.inserted, matched: r.matched ? r.matched.matched : null, warnings: r.warnings });
          else if (r.status === 'duplicate') report.duplicates.push({ file: a.name, statement: r.statement_number });
          else { allOk = false; report.no_account.push({ file: a.name, account: (r.account_number || '?') + '/' + (r.bank_code || '?') }); }
        } catch (e) { allOk = false; report.errors.push((a.name || '?') + ': ' + e.message); }
      }
      progress.done++; progress.imported = report.imported.length; progress.duplicates = report.duplicates.length; progress.errors = report.errors.length + report.no_account.length;
      if (allOk && markRead) { try { await graph.markAsRead(mb, m.id); } catch (e) { /* další běh to zkusí znovu */ } }
    }
    if (report.imported.length || report.errors.length) console.log('[bank-statement-email]', JSON.stringify(report));
    return report;
  } catch (e) {
    folderId = null;
    report.errors.push(e.message);
    console.warn('[bank-statement-email] chyba:', e.message);
    return report;
  } finally {
    running = false;
    lastRun = report;
    progress = { ...progress, running: false, phase: 'done', current: '', imported: report.imported.length, duplicates: report.duplicates.length, errors: report.errors.length + report.no_account.length, finished_at: new Date().toISOString(), report };
  }
}

function start() {
  if (process.env.BANK_STATEMENT_EMAIL_DISABLED === '1') { console.log('[bank-statement-email] vypnuto (BANK_STATEMENT_EMAIL_DISABLED=1)'); return; }
  if (!MAILBOX()) { console.log('[bank-statement-email] není nastavená schránka — worker nespuštěn'); return; }
  setTimeout(() => { runOnce().catch(() => {}); }, 90 * 1000);
  setInterval(() => { runOnce().catch(() => {}); }, INTERVAL_MIN * 60 * 1000);
  console.log(`[bank-statement-email] běží — složka „${FOLDER()}" ve ${MAILBOX()}, každých ${INTERVAL_MIN} min`);
}

module.exports = { start, runOnce, getLastRun: () => lastRun, getProgress: () => progress };
