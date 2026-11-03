// =============================================================================
// HolyOS — Export dokladů pro účetní (Účetní doklady → 📦 Exporty)
// =============================================================================
// Za období (od kdy + interval, např. týden) vezme doklady ZALOŽENÉ v HolyOS v tom období,
// zabalí jejich přílohy do ZIPu (víc ZIPů, když by e-mail přesáhl max. velikost) a pošle je účetním.
// Každý ZIP obsahuje seznam-dokladu.csv. Vše se eviduje (AccountingExport + AccountingExportItem)
// a ZIPy zůstávají na disku (data/storage/accounting-exports/<id>/) ke stažení / opětovnému odeslání.
// Doklad, který už jednou úspěšně odešel, se znovu automaticky neposílá (ruční „Znovu odeslat" ano).
//
// Nastavení: AppSetting accounting.exports.config
//   { enabled, recipients, sender, start_from:'YYYY-MM-DD', interval:'day'|'week'|'2weeks'|'month', send_hour,
//     directions:['ap','ar'], include_proforma, max_mb, last_period_to }
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { prisma } = require('../../config/database');
const { getSetting, setSetting, getOurCompany } = require('../settings');

const CFG_KEY = 'accounting.exports.config';
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, '..', '..', 'data', 'storage');
const EXPORT_DIR = path.join(STORAGE_DIR, 'accounting-exports');
const SKIP_STATUSES = ['cancelled']; // i rozpracované (draft) — přijaté z e-mailu bývají draft, účetní je potřebuje
const GRAPH_INLINE_MAX = 2.8 * 1024 * 1024; // menší přílohy jdou běžným sendMail, větší přes upload session
const DEFAULTS = { enabled: false, recipients: '', confirm_recipients: '', sender: '', start_from: null, interval: 'week', send_hour: 7, directions: ['ap', 'ar'], include_proforma: false, max_mb: 20, last_period_to: null };
const INTERVAL_LABEL = { day: 'denně', '2days': 'každé 2 dny', '3days': 'každé 3 dny', week: 'týdně', '2weeks': 'každých 14 dní', month: 'měsíčně' };

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const csDate = (d) => (d ? new Date(d).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' }) : '');
const dayStart = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0); };
const csv = (v) => { const s = v == null ? '' : String(v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').slice(0, 80);
// Z textu udělá očištěný seznam e-mailů oddělený čárkou (co není e-mail, vypadne).
const emailList = (v) => String(v || '').split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).join(', ');

async function getConfig() {
  const v = (await getSetting(CFG_KEY, { type: 'json', defaultValue: {} }).catch(() => ({}))) || {};
  const c = Object.assign({}, DEFAULTS, v);
  if (!c.sender) c.sender = process.env.ACCOUNTING_EXPORT_FROM || process.env.INVOICE_IMAP_USER || '';
  return c;
}
async function saveConfig(patch, userId) {
  const cur = Object.assign({}, DEFAULTS, (await getSetting(CFG_KEY, { type: 'json', defaultValue: {} }).catch(() => ({}))) || {});
  const p = patch || {};
  const next = Object.assign({}, cur, {
    enabled: p.enabled != null ? !!p.enabled : cur.enabled,
    recipients: p.recipients != null ? emailList(p.recipients) : cur.recipients,
    // Komu přijde krátké potvrzení, že export odešel (bez příloh).
    confirm_recipients: p.confirm_recipients != null ? emailList(p.confirm_recipients) : cur.confirm_recipients,
    sender: p.sender != null ? String(p.sender).trim().slice(0, 255) : cur.sender,
    start_from: p.start_from != null ? (/^\d{4}-\d{2}-\d{2}$/.test(String(p.start_from)) ? String(p.start_from) : cur.start_from) : cur.start_from,
    interval: INTERVAL_LABEL[p.interval] ? p.interval : cur.interval,
    send_hour: p.send_hour != null ? Math.min(23, Math.max(0, parseInt(p.send_hour, 10) || 0)) : cur.send_hour,
    directions: Array.isArray(p.directions) ? p.directions.filter((d) => d === 'ap' || d === 'ar') : cur.directions,
    include_proforma: p.include_proforma != null ? !!p.include_proforma : cur.include_proforma,
    max_mb: p.max_mb != null ? Math.min(30, Math.max(2, Number(p.max_mb) || 20)) : cur.max_mb,
  });
  // změna „od kdy" = začít počítat období znovu od tohoto data
  if (p.start_from && p.start_from !== cur.start_from) next.last_period_to = null;
  await setSetting(CFG_KEY, next, { type: 'json', description: 'Účetní doklady — automatický export příloh účetním (období, příjemci, max. velikost)', scope: 'accounting', userId });
  return next;
}

// Délka jednoho období ve dnech. 'month' se počítá kalendářně (ne 30 dní),
// proto stojí stranou. Neznámý interval = týden (bezpečný default).
const INTERVAL_DAYS = { day: 1, '2days': 2, '3days': 3, week: 7, '2weeks': 14 };

function addInterval(from, interval) {
  const d = new Date(from);
  if (interval === 'month') d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + (INTERVAL_DAYS[interval] || 7));
  return d;
}
// Další období k odeslání: [od, do) — od = konec minulého (nebo start_from)
function nextPeriod(cfg) {
  if (!cfg.start_from && !cfg.last_period_to) return null;
  const from = cfg.last_period_to ? new Date(cfg.last_period_to) : dayStart(cfg.start_from);
  const to = addInterval(from, cfg.interval);
  const sendAt = new Date(to); sendAt.setHours(cfg.send_hour || 0, 0, 0, 0);
  return { from, to, sendAt };
}

// Doklady založené v období (a ještě neodeslané), s přílohou
async function collectDocs(from, to, cfg, { includeSent = false } = {}) {
  const dirs = (cfg.directions && cfg.directions.length) ? cfg.directions : ['ap', 'ar'];
  const where = { created_at: { gte: from, lt: to }, status: { notIn: SKIP_STATUSES }, direction: { in: dirs } };
  if (!cfg.include_proforma) where.type = { notIn: ['proforma_received', 'proforma_issued'] };
  const invoices = await prisma.invoice.findMany({ where, select: { id: true, invoice_number: true, external_number: true, direction: true, type: true, date_issued: true, total: true, currency: true, variable_symbol: true, source_file_path: true, pdf_file_path: true, created_at: true, company: { select: { name: true, ico: true } } }, orderBy: [{ direction: 'asc' }, { created_at: 'asc' }] });
  let sentIds = new Set();
  if (!includeSent && invoices.length) {
    const sent = await prisma.accountingExportItem.findMany({ where: { invoice_id: { in: invoices.map((i) => i.id) }, sent: true }, select: { invoice_id: true } });
    sentIds = new Set(sent.map((s) => s.invoice_id));
  }
  const docs = [];
  for (const inv of invoices) {
    if (sentIds.has(inv.id)) continue;
    const src = [inv.source_file_path, inv.pdf_file_path].find((p) => p && fs.existsSync(p)) || null;
    const ext = src ? (path.extname(src).toLowerCase() || '.pdf') : '.pdf';
    const label = inv.direction === 'ap' ? 'prijate' : 'vydane';
    const file = label + '/' + safeName(inv.invoice_number) + (inv.external_number ? '_' + safeName(inv.external_number) : '') + '_' + safeName(inv.company && inv.company.name) + ext;
    let bytes = 0; try { if (src) bytes = fs.statSync(src).size; } catch (_) { /* */ }
    docs.push({ inv, src, file, bytes, needsPdf: !src && inv.direction === 'ar' });
  }
  return docs;
}

// Vydané faktury bez uloženého PDF → vygenerovat
async function materializePdfs(docs) {
  const need = docs.filter((d) => d.needsPdf);
  if (!need.length) return;
  const our = await getOurCompany().catch(() => null);
  if (!our) return;
  const { generateInvoicePdf } = require('../pdf/invoice-pdf');
  for (const d of need) {
    try {
      const full = await prisma.invoice.findUnique({ where: { id: d.inv.id }, include: { company: true, items: { orderBy: { line_order: 'asc' } } } });
      d.buffer = await generateInvoicePdf(full, our); d.bytes = d.buffer.length; d.needsPdf = false;
    } catch (e) { console.warn('[acc-export] PDF', d.inv.invoice_number, e.message); }
  }
}

// Rozdělení do částí podle max. velikosti (ZIP PDF ≈ součet souborů; rezerva na CSV + base64 hlídá max_mb)
function splitParts(docs, maxBytes) {
  const parts = []; let cur = [], size = 0;
  const withFile = docs.filter((d) => d.src || d.buffer);
  for (const d of withFile) {
    if (cur.length && size + d.bytes > maxBytes) { parts.push(cur); cur = []; size = 0; }
    cur.push(d); size += d.bytes;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

function listCsv(docs, partOf) {
  const head = ['Část', 'Směr', 'Číslo dokladu', 'Číslo dodavatele / externí', 'Firma', 'IČO', 'Datum vystavení', 'VS', 'Částka', 'Měna', 'Soubor v ZIPu', 'Poznámka'];
  const rows = docs.map((d) => [partOf(d) || '', d.inv.direction === 'ap' ? 'Přijatá' : 'Vydaná', d.inv.invoice_number, d.inv.external_number || '', d.inv.company && d.inv.company.name, d.inv.company && d.inv.company.ico, csDate(d.inv.date_issued), d.inv.variable_symbol || '', Number(d.inv.total || 0).toFixed(2).replace('.', ','), d.inv.currency || 'CZK', (d.src || d.buffer) ? d.file : '', (d.src || d.buffer) ? '' : 'bez přílohy']);
  return '﻿' + [head, ...rows].map((r) => r.map(csv).join(';')).join('\r\n');
}

function writeZip(file, docs, csvText) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file); const zip = archiver('zip', { zlib: { level: 6 } });
    out.on('close', () => resolve(zip.pointer())); out.on('error', reject); zip.on('error', reject);
    zip.pipe(out);
    for (const d of docs) { if (d.buffer) zip.append(d.buffer, { name: d.file }); else if (d.src) zip.file(d.src, { name: d.file }); }
    zip.append(csvText, { name: 'seznam-dokladu.csv' });
    zip.finalize();
  });
}

async function sendPart({ sender, recipients, subject, body, file, filename }) {
  const buf = fs.readFileSync(file);
  const toList = String(recipients || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const graph = (() => { try { const g = require('../ms-graph-client'); return g.isConfigured && g.isConfigured() ? g : null; } catch (_) { return null; } })();
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222">' + body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div>';
  if (graph && sender && buf.length > GRAPH_INLINE_MAX) {
    await graph.sendMailWithLargeAttachment(sender, { to: toList, subject, htmlBody: html, file: { filename, buffer: buf, contentType: 'application/zip' } });
    return { via: 'graph-upload' };
  }
  const { sendMail } = require('../email');
  const r = await sendMail({ to: toList.length === 1 ? toList[0] : toList, from: sender || undefined, subject, body, attachments: [{ filename, content: buf, contentType: 'application/zip' }] });
  if (!r || r.sent === false) throw new Error((r && (r.error || r.skipped)) || 'neodesláno');
  return { via: r.via || 'mail' };
}

// ── Potvrzení kolegům, že export odešel ─────────────────────────────────────
// Krátký e-mail BEZ příloh pro lidi z „Potvrzení o odeslání" — aby věděli, že
// doklady za období odešly účetní, aniž by jim chodily desítky MB ZIPů.
// Testovací odeslání se nehlásí (to je jen kontrola doručení) a selhání
// potvrzení nikdy neshodí samotný export.
async function sendConfirmation(cfg, { periodTxt, docs, missing, partInfo, status, recipients, firm }) {
  const to = emailList(cfg.confirm_recipients);
  if (!to) return;
  const okParts = partInfo.filter((x) => x.sent);
  const totalMb = (partInfo.reduce((a, x) => a + (x.bytes || 0), 0) / 1048576).toFixed(1).replace('.', ',');
  const ap = docs.filter((d) => d.inv.direction === 'ap').length;
  const ar = docs.filter((d) => d.inv.direction === 'ar').length;
  const when = new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' });

  let subject, head;
  if (status === 'sent') {
    subject = '✅ Doklady za ' + periodTxt + ' odeslány účetní';
    head = 'doklady za období ' + periodTxt + ' byly odeslány účetní.';
  } else if (status === 'partial') {
    subject = '⚠️ Doklady za ' + periodTxt + ' odešly jen zčásti';
    head = 'doklady za období ' + periodTxt + ' se podařilo odeslat jen zčásti — zbytek je potřeba poslat znovu.';
  } else {
    subject = '⛔ Doklady za ' + periodTxt + ' se nepodařilo odeslat';
    head = 'doklady za období ' + periodTxt + ' se NEPODAŘILO odeslat účetní.';
  }

  const chyby = partInfo.filter((x) => x.error);
  const body = 'Dobrý den,\n\n' + head + '\n\n'
    + 'Období: ' + periodTxt + '\n'
    + 'Dokladů: ' + docs.length + ' (přijaté ' + ap + ', vydané ' + ar + ')'
      + (missing.length ? ', z toho ' + missing.length + ' bez přílohy' : '') + '\n'
    + 'E-mailů: ' + okParts.length + ' z ' + partInfo.length + ' (celkem ' + totalMb + ' MB)\n'
    + 'Komu: ' + recipients + '\n'
    + 'Kdy: ' + when + '\n'
    + (chyby.length ? '\nChyby:\n' + chyby.map((x) => '- část ' + x.part + ': ' + x.error).join('\n') + '\n' : '')
    + (status === 'sent' ? '' : '\nOpakované odeslání najdete v Účetních dokladech → 📦 Exporty → Historie odeslání (tlačítko ↻).\n')
    + '\nToto je jen potvrzení, doklady v příloze nejsou.\n\nS pozdravem\n' + firm;

  try {
    const { sendMail } = require('../email');
    const list = to.split(', ').filter(Boolean);
    const r = await sendMail({ to: list.length === 1 ? list[0] : list, from: cfg.sender || undefined, subject, body });
    if (!r || r.sent === false) throw new Error((r && (r.error || r.skipped)) || 'neodesláno');
    console.log('[acc-export] potvrzení odesláno na', to);
  } catch (e) {
    // Potvrzení je doplněk — když selže, export tím nepadá.
    console.warn('[acc-export] potvrzení se nepodařilo odeslat:', e.message);
  }
}

/**
 * Sestaví ZIPy za období a odešle je. opts: { trigger, recipients?, includeSent?, userId?, dryRun? }
 * dryRun = jen spočítá (náhled), nic nevytváří ani neposílá.
 */
async function runExport(from, to, opts = {}) {
  const cfg = await getConfig();
  const recipients = String(opts.recipients || cfg.recipients || '').trim();
  const maxBytes = Math.round((Number(cfg.max_mb) || 20) * 1024 * 1024 * 0.72); // base64 (+33 %) + hlavičky → rezerva
  const docs = await collectDocs(from, to, cfg, { includeSent: !!opts.includeSent });
  if (opts.dryRun) {
    const withFile = docs.filter((d) => d.src || d.needsPdf);
    const est = withFile.reduce((s, d) => s + (d.bytes || 150000), 0);
    return { from, to, doc_count: docs.length, with_file: withFile.length, missing: docs.length - withFile.length, est_bytes: est, est_parts: Math.max(withFile.length ? 1 : 0, Math.ceil(est / maxBytes)), recipients, max_mb: cfg.max_mb };
  }
  if (!recipients) throw new Error('Není nastavený e-mail účetní (příjemci)');
  await materializePdfs(docs);
  const parts = splitParts(docs, maxBytes);
  const partOf = new Map(); parts.forEach((p, i) => p.forEach((d) => partOf.set(d, i + 1)));
  const missing = docs.filter((d) => !d.src && !d.buffer);
  const exp = await prisma.accountingExport.create({ data: { period_from: from, period_to: to, run_trigger: opts.trigger || 'manual', status: 'pending', recipients, sender: cfg.sender || null, doc_count: docs.length, missing_count: missing.length, part_count: parts.length, created_by_user_id: opts.userId || null } });
  if (docs.length) {
    await prisma.accountingExportItem.createMany({ data: docs.map((d) => ({ export_id: exp.id, invoice_id: d.inv.id, invoice_number: d.inv.invoice_number, external_number: d.inv.external_number || null, direction: d.inv.direction, type: d.inv.type || null, company_name: (d.inv.company && d.inv.company.name || '').slice(0, 255) || null, date_issued: d.inv.date_issued || null, total: d.inv.total != null ? d.inv.total : null, currency: d.inv.currency || null, part: partOf.get(d) || 0, file_name: (d.src || d.buffer) ? d.file.slice(0, 255) : null, file_bytes: d.bytes || 0, missing: !(d.src || d.buffer) })) });
  }
  if (!docs.length) {
    await prisma.accountingExport.update({ where: { id: exp.id }, data: { status: 'empty', parts: [] } });
    return { id: exp.id, status: 'empty', doc_count: 0 };
  }
  const dir = path.join(EXPORT_DIR, String(exp.id)); fs.mkdirSync(dir, { recursive: true });
  const fullCsv = listCsv(docs, (d) => partOf.get(d));
  const periodTxt = csDate(from) + ' – ' + csDate(new Date(to.getTime() - 1));
  const our = await getOurCompany().catch(() => null);
  const firm = (our && our.name) || 'Best Series';
  const partInfo = []; let total = 0, okCount = 0;
  // Bez příloh, ale s doklady (jen seznam) → pošle se aspoň seznam v jednom ZIPu
  // Test: jen první ZIP (ať se zkouška neposílá v desítkách MB); doklady se neoznačí jako odeslané → automatika je pošle normálně
  const sendList = parts.length ? (opts.test ? parts.slice(0, 1) : parts) : [[]];
  for (let i = 0; i < sendList.length; i++) {
    const p = sendList[i]; const n = i + 1, N = Math.max(sendList.length, parts.length); // N = skutečný počet částí (i v testu, kdy jde jen 1.)
    const fname = 'doklady_' + ymd(from) + '_' + ymd(new Date(to.getTime() - 1)) + (N > 1 ? '_cast-' + n + 'z' + N : '') + '.zip';
    const zipPath = path.join(dir, fname);
    const bytes = await writeZip(zipPath, p, i === 0 ? fullCsv : listCsv(p, () => n));
    total += bytes;
    const subject = (opts.test ? '[TEST] ' : '') + 'Doklady ' + periodTxt + ' — ' + firm + (N > 1 ? ' (část ' + n + '/' + N + ')' : '');
    const eml = (k) => k + ' ' + (k >= 2 && k <= 4 ? 'e-mailech' : 'e-mailech');
    const body = 'Dobrý den,\n\nv příloze zasíláme doklady za období ' + periodTxt + '.\n\n'
      + (N > 1 ? '⚠️ Kvůli velikosti příloh posíláme doklady za toto období ve ' + eml(N) + '. Toto je ' + n + '. e-mail z ' + N + (opts.test ? ' (v testu se posílá jen tento první)' : ' — prosím zkontrolujte, že vám dorazily všechny') + '.\n\n' : '')
      + 'V této zprávě: ' + p.length + ' dokladů (' + (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB).\n'
      + 'Celkem za období: ' + docs.length + ' dokladů (přijaté ' + docs.filter((d) => d.inv.direction === 'ap').length + ', vydané ' + docs.filter((d) => d.inv.direction === 'ar').length + ')' + (missing.length ? ', z toho ' + missing.length + ' bez přílohy (uvedeny v seznamu)' : '') + '.\n'
      + 'Úplný seznam dokladů je v souboru seznam-dokladu.csv' + (N > 1 ? ' v části 1' : '') + '.\n' + (opts.test ? '\nTOTO JE TESTOVACÍ ODESLÁNÍ: posílá se jen 1. část' + (N > 1 ? ' z ' + N + ' (zbylých ' + (docs.length - p.length) + ' dokladů by přišlo v dalších e-mailech)' : '') + '; doklady nejsou označené jako odeslané.\n' : '') + '\nS pozdravem\n' + firm;
    const info = { part: n, file: fname, bytes, docs: p.length, sent: false };
    try {
      const r = await sendPart({ sender: cfg.sender, recipients, subject, body, file: zipPath, filename: fname });
      info.sent = true; info.sent_at = new Date().toISOString(); info.via = r.via; okCount++;
      if (p.length && !opts.test) await prisma.accountingExportItem.updateMany({ where: { export_id: exp.id, part: n }, data: { sent: true } }); // test = neoznačovat jako odeslané
    } catch (e) { info.error = String(e.message || e).slice(0, 500); console.warn('[acc-export] část', n, info.error); }
    partInfo.push(info);
  }
  // doklady bez přílohy: odeslané v seznamu = „sent", když prošla část 1
  if (!opts.test && missing.length && partInfo[0] && partInfo[0].sent) await prisma.accountingExportItem.updateMany({ where: { export_id: exp.id, missing: true }, data: { sent: true } });
  const status = okCount === partInfo.length ? 'sent' : (okCount ? 'partial' : 'failed');
  await prisma.accountingExport.update({ where: { id: exp.id }, data: { status, parts: partInfo, total_bytes: total, error: status === 'sent' ? null : partInfo.filter((x) => x.error).map((x) => 'část ' + x.part + ': ' + x.error).join(' | ').slice(0, 2000) } });
  // Potvrzení kolegům — u testu ne, ten nic doopravdy neodesílá.
  if (!opts.test) await sendConfirmation(cfg, { periodTxt, docs, missing, partInfo, status, recipients, firm });
  return { id: exp.id, status, doc_count: docs.length, parts: partInfo };
}

// Opětovné odeslání neodeslaných (nebo všech) částí existujícího exportu
async function resendExport(id, { all = false, recipients } = {}) {
  const exp = await prisma.accountingExport.findUnique({ where: { id } });
  if (!exp) throw new Error('Export nenalezen');
  const cfg = await getConfig();
  const our = await getOurCompany().catch(() => null);
  const firm = (our && our.name) || 'Best Series';
  const parts = Array.isArray(exp.parts) ? exp.parts : [];
  const to = String(recipients || exp.recipients);
  const periodTxt = csDate(exp.period_from) + ' – ' + csDate(new Date(new Date(exp.period_to).getTime() - 1));
  let ok = 0;
  for (const p of parts) {
    if (p.sent && !all) { ok++; continue; }
    const file = path.join(EXPORT_DIR, String(exp.id), p.file);
    if (!fs.existsSync(file)) { p.error = 'ZIP už na disku není'; continue; }
    try {
      const r = await sendPart({ sender: cfg.sender, recipients: to, subject: 'Doklady ' + periodTxt + (parts.length > 1 ? ' (část ' + p.part + '/' + parts.length + ')' : '') + ' — opakované odeslání', body: 'Dobrý den,\n\nznovu zasíláme doklady za období ' + periodTxt + (parts.length > 1 ? ' — část ' + p.part + ' z ' + parts.length : '') + '.\n\nS pozdravem\n' + firm, file, filename: p.file });
      p.sent = true; p.sent_at = new Date().toISOString(); p.via = r.via; delete p.error; ok++;
      await prisma.accountingExportItem.updateMany({ where: { export_id: exp.id, part: p.part }, data: { sent: true } });
    } catch (e) { p.error = String(e.message || e).slice(0, 500); }
  }
  const status = ok === parts.length ? 'sent' : (ok ? 'partial' : 'failed');
  await prisma.accountingExport.update({ where: { id }, data: { parts, status, error: status === 'sent' ? null : parts.filter((x) => x.error).map((x) => 'část ' + x.part + ': ' + x.error).join(' | ').slice(0, 2000) } });
  return { id, status, parts };
}

function zipPathFor(exp, part) {
  const p = (Array.isArray(exp.parts) ? exp.parts : []).find((x) => Number(x.part) === Number(part));
  if (!p) return null;
  const f = path.join(EXPORT_DIR, String(exp.id), path.basename(p.file));
  return fs.existsSync(f) ? f : null;
}

// ── Úklid testovacích odeslání ──────────────────────────────────────────────
// Test je jen rychlá kontrola, že e-mail dorazí — v historii nemá co dělat
// a jeho ZIPy (klidně desítky MB) zbytečně drží místo na disku. Po 5 minutách
// se záznam i se soubory smaže sám.
const TEST_KEEP_MINUTES = 5;
// Rozdělaný test (status 'pending') běží — ten nemažeme, jinak by si běžící
// export sáhl na smazaný řádek. Když zůstane viset 10 minut (typicky restart serveru uprostřed odesílání), je po smrti.
const TEST_PENDING_KEEP_MINUTES = 10;

async function cleanupTestExports() {
  const now = Date.now();
  const done = new Date(now - TEST_KEEP_MINUTES * 60000);
  const stuck = new Date(now - TEST_PENDING_KEEP_MINUTES * 60000);
  try {
    // Ostrý export, který visí v „Probíhá" déle než 30 min, je přerušený (restart serveru) → označit jako chybu, ať jde znovu odeslat tlačítkem ↻
    await prisma.accountingExport.updateMany({
      where: { run_trigger: { not: 'test' }, status: 'pending', created_at: { lt: new Date(now - 30 * 60000) } },
      data: { status: 'failed', error: 'Odesílání bylo přerušeno (pravděpodobně restart serveru) — odešlete znovu tlačítkem ↻' },
    }).catch(() => {});
    const old = await prisma.accountingExport.findMany({
      where: {
        run_trigger: 'test',
        OR: [
          { status: { not: 'pending' }, created_at: { lt: done } },
          { status: 'pending', created_at: { lt: stuck } },
        ],
      },
      select: { id: true },
    });
    if (!old.length) return 0;
    for (const e of old) {
      try {
        fs.rmSync(path.join(EXPORT_DIR, String(e.id)), { recursive: true, force: true });
      } catch (err) {
        console.warn('[acc-export] ZIPy testu #' + e.id + ' se nepodařilo smazat:', err.message);
      }
    }
    // Položky exportu mají onDelete: Cascade, takže stačí smazat hlavičku.
    const r = await prisma.accountingExport.deleteMany({ where: { id: { in: old.map((e) => e.id) } } });
    console.log('[acc-export] úklid: smazáno ' + r.count + ' testovacích odeslání starších než ' + TEST_KEEP_MINUTES + ' min');
    return r.count;
  } catch (e) {
    console.warn('[acc-export] úklid testů selhal:', e.message);
    return 0;
  }
}

// ── Automatické odesílání (worker) ──
let running = false;
async function tick() {
  if (running) return; running = true;
  try {
    await cleanupTestExports();
    for (let guard = 0; guard < 12; guard++) { // dohnat i víc zmeškaných období, max 12 najednou
      const cfg = await getConfig();
      if (!cfg.enabled || !cfg.recipients) break;
      const np = nextPeriod(cfg); if (!np || Date.now() < np.sendAt.getTime()) break;
      const r = await runExport(np.from, np.to, { trigger: 'auto' });
      console.log('[acc-export] období', ymd(np.from), '→', ymd(np.to), r.status, r.doc_count, 'dokladů');
      if (r.status === 'failed') break; // období neposouvat — zkusí se znovu příště
      const cur = Object.assign({}, cfg, { last_period_to: np.to.toISOString() });
      await setSetting(CFG_KEY, cur, { type: 'json', scope: 'accounting' });
    }
  } catch (e) { console.warn('[acc-export] tick:', e.message); } finally { running = false; }
}
let timer = null;
let cleanupTimer = null;
function start() {
  if (timer) return;
  timer = setInterval(tick, 30 * 60 * 1000); setTimeout(tick, 3 * 60 * 1000);
  // Úklid testů má vlastní, častější interval — 30 minut by na „po 5 minutách" nestačilo.
  cleanupTimer = setInterval(cleanupTestExports, TEST_KEEP_MINUTES * 60 * 1000);
  console.log('[acc-export] worker spuštěn (kontrola 2× za hodinu, úklid testů po ' + TEST_KEEP_MINUTES + ' min)');
}

module.exports = { getConfig, saveConfig, nextPeriod, runExport, resendExport, zipPathFor, start, tick, cleanupTestExports, sendConfirmation, TEST_KEEP_MINUTES, INTERVAL_LABEL, dayStart, addInterval };
