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
// E-mail podepsaný S/MIME (UniCredit BusinessNet): Graph vrátí místo příloh jediný soubor smime.p7m,
// ve kterém je celá původní zpráva (MIME). Přílohy výpisu z něj vytáhneme přes mailparser.
const SMIME = (a) => /smime\.p7m$/i.test(a.name || '') || /multipart\/signed|pkcs7-mime/i.test(a.contentType || '');
async function filesFromSmime(buffer) {
  const { simpleParser } = require('mailparser');
  let raw = buffer;
  // Neprůhledný podpis (application/pkcs7-mime, DER): původní zpráva je uvnitř jako text — najdi začátek MIME hlaviček
  if (raw[0] === 0x30) {
    const txt = raw.toString('latin1'), i = txt.search(/(Content-Type|MIME-Version):/i);
    if (i < 0) return [];
    raw = Buffer.from(txt.slice(i), 'latin1');
  }
  const mail = await simpleParser(raw);
  const out = [];
  for (const a of mail.attachments || []) {
    if (a.filename && STATEMENT_FILE.test(a.filename)) out.push({ name: a.filename, buffer: a.content });
    // Vnořená podepsaná zpráva (podpis v podpisu)
    else if (/rfc822|pkcs7-mime|multipart\/signed/i.test(a.contentType || '') && a.content) { try { out.push(...(await filesFromSmime(a.content))); } catch (e) { /* ignoruj */ } }
  }
  return out;
}

let running = false;
let lastRun = null;
const handled = new Set(); // id zpráv, které už jsou úspěšně zpracované (nebo byly duplicitní) — jen do restartu
let folderId = null;
// Průběh právě běžícího (nebo posledního) importu — čte ho UI přes GET /statements/fetch-email/status
let progress = { running: false, phase: 'idle', total: 0, done: 0, current: '', imported: 0, duplicates: 0, errors: 0, started_at: null, finished_at: null, report: null };

// all = true → projde VŠECHNY zprávy ve složce (i přečtené) od nejstarší; duplicity import přeskočí, zprávy neoznačuje.
// passwords = hesla k PDF navíc k BANK_STATEMENT_PASSWORD (zkusí se postupně, nikam se neukládají).
async function runOnce({ markRead = true, all = false, passwords = null, trigger = 'auto', user = null } = {}) {
  if (running) return { skipped: 'already_running' };
  running = true;
  const report = { at: new Date().toISOString(), messages: 0, imported: [], duplicates: [], errors: [], no_account: [] };
  progress = { running: true, phase: 'listing', total: 0, done: 0, current: 'Načítám seznam e-mailů…', imported: 0, duplicates: 0, errors: 0, started_at: report.at, finished_at: null, report: null };
  try {
    const mb = MAILBOX();
    if (!mb || !graph.isConfigured || !require('../ms-oauth2').isConfigured()) { report.errors.push('Schránka nebo Azure není nastavené'); return report; }
    if (!folderId) folderId = await graph.findMailFolderId(mb, FOLDER());
    if (!folderId) { report.errors.push(`Složka „${FOLDER()}" ve schránce ${mb} nenalezena`); return report; }
    let msgs;
    if (all) msgs = await graph.listAllInFolder(mb, folderId);
    else {
      // Nepřečtené + všechno za posledních 14 dní (i přečtené — Outlook označí zprávu jako přečtenou už při zobrazení v náhledu,
      // takže by se jinak výpis nikdy nenačetl). Už zpracované zprávy si pamatujeme, ať se PDF neparsují znovu při každém běhu.
      const unread = await graph.listUnreadInFolder(mb, folderId, { top: 25 });
      const recent = await graph.listRecentInFolder(mb, folderId, { days: 14, top: 50 });
      const seen = new Set(); msgs = [];
      for (const m of [...recent, ...unread]) { if (m && !seen.has(m.id) && !handled.has(m.id)) { seen.add(m.id); msgs.push(m); } }
    }
    if (all) markRead = false;
    report.messages = msgs.length;
    progress.phase = 'importing'; progress.total = msgs.length;
    for (const m of msgs) {
      progress.current = (m.receivedDateTime ? String(m.receivedDateTime).slice(0, 10) + ' — ' : '') + (m.subject || 'e-mail');
      const atts = (m.attachments || []).filter((a) => !a.isInline && (STATEMENT_FILE.test(a.name || '') || SMIME(a)));
      if (!atts.length) { progress.done++; continue; }
      let allOk = true;
      // Rozbal S/MIME obálky na skutečné přílohy výpisu
      const soubory = [];
      for (const a of atts) {
        if (!SMIME(a)) { soubory.push({ a }); continue; }
        try {
          const f = await graph.downloadAttachment(mb, m.id, a.id);
          const inner = f && f.buffer ? await filesFromSmime(f.buffer) : [];
          if (!inner.length) { allOk = false; report.errors.push((m.subject || 'e-mail') + ': podepsaná zpráva (S/MIME) bez přílohy výpisu'); }
          inner.forEach((x) => soubory.push({ a: { name: x.name }, file: { buffer: x.buffer } }));
        } catch (e) { allOk = false; report.errors.push((m.subject || 'e-mail') + ': S/MIME se nepodařilo rozbalit — ' + e.message); }
      }
      for (const { a, file: predem } of soubory) {
        try {
          const file = predem || await graph.downloadAttachment(mb, m.id, a.id);
          if (!file || !file.buffer) { allOk = false; report.errors.push(a.name + ': nelze stáhnout'); continue; }
          const r = await importStatementBuffer({ buffer: file.buffer, filename: a.name, source: 'email', passwords });
          if (r.status === 'imported') report.imported.push({ file: a.name, statement_id: r.statement_id, statement: r.statement_number, transactions: r.inserted, matched: r.matched ? r.matched.matched : null, warnings: r.warnings });
          else if (r.status === 'duplicate') report.duplicates.push({ file: a.name, statement: r.statement_number });
          else if (r.status === 'unreconciled') { allOk = false; report.errors.push(`${a.name}: výpis ${r.statement_number} NEIMPORTOVÁN — nesedí na zůstatky (načteno ${r.read} z ${r.expected != null ? r.expected : '?'} transakcí, rozdíl ${r.diff}). Zkontroluj PDF / dej vědět vývojáři.`); }
          else { allOk = false; report.no_account.push({ file: a.name, account: (r.account_number || '?') + '/' + (r.bank_code || '?') }); }
        } catch (e) { allOk = false; report.errors.push((a.name || '?') + ': ' + e.message); }
      }
      progress.done++; progress.imported = report.imported.length; progress.duplicates = report.duplicates.length; progress.errors = report.errors.length + report.no_account.length;
      if (allOk) handled.add(m.id);
      if (allOk && markRead && m.isRead !== true) { try { await graph.markAsRead(mb, m.id); } catch (e) { /* další běh to zkusí znovu */ } }
    }
    // Po importu znovu projít všechny nevyřešené platby (faktura mohla dorazit později než platba)
    if (report.imported.length) {
      try {
        const { prisma } = require('../../config/database');
        const s = await require('./auto-matcher').autoMatchAll(prisma, { id: null, displayName: 'Import výpisů' });
        report.auto_match = { matched: s.matched, partial: s.partial, needs_review: s.needs_review };
      } catch (e) { report.errors.push('auto-match: ' + e.message); }
    }
    if (report.imported.length || report.errors.length) console.log('[bank-statement-email]', JSON.stringify(report));
    // Kontrola výsledku + upozornění do Velína (při hromadném „Načíst i staré" jen chyby)
    try { await require('./statement-monitor').afterRun(all ? { ...report, imported: [], _imported_count: report.imported.length } : report, { trigger: all ? 'manual_all' : trigger, user }); } catch (e) { console.warn('[bank-statement-email] monitor:', e.message); }
    return report;
  } catch (e) {
    folderId = null;
    report.errors.push(e.message);
    console.warn('[bank-statement-email] chyba:', e.message);
    try { await require('./statement-monitor').workerCrashed(e, { trigger: all ? 'manual_all' : trigger, user }); } catch (e2) { /* ignore */ }
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
