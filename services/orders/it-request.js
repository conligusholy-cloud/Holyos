// HolyOS — IT požadavky k objednávce (checklist pro zákazníka)
// =============================================================================
// Šablona checklistu (AppSetting it_requirements.template) se upravuje v Prodejní objednávky → Ceník → IT požadavky.
// „Odeslat zákazníkovi" vytvoří OrderItRequest (snímek otázek + token), pošle e-mail s odkazem /it-pozadavky/<token>
// a termín vyplnění (výchozí 3 dny, AppSetting it_requirements.due_days). Zákazník nevyplní → worker (každých 30 min)
// pošle Radkovi Bečkovi e-mail + push do Velína + zvonek v HolyOS (jednou).
// =============================================================================

'use strict';

const crypto = require('crypto');
const { prisma } = require('../../config/database');
const { getSetting, setSetting } = require('../settings');
const { buildShareUrl } = require('../share-url');

// Odeslání přes stejného odesílatele jako potvrzení objednávky (Graph send-as z e-mailu naší firmy);
// bez `from` by e-mail nešel nikam, když není nastavený SMTP.
// Odesílatel: info@bestseries.cz (env IT_MAIL_FROM), grafika Prádlomaty. Když schránka nemá oprávnění
// odesílat (Graph), zkusí se záložní adresa (e-mail naší firmy / COMPOUNDER_MAIL_FROM / SMTP_FROM).
async function mail(opts) {
  const { sendMail } = require('../email');
  let our = null; try { our = await require('../settings').getOurCompany(); } catch (e) { /* */ }
  const primary = process.env.IT_MAIL_FROM || 'info@bestseries.cz';
  const fallback = (our && our.email) || process.env.COMPOUNDER_MAIL_FROM || process.env.SMTP_FROM || undefined;
  const base = Object.assign({ fromName: 'Best Series — Prádlomaty', brand: 'pradlomaty', lang: 'cs' }, opts);
  const r = await sendMail(Object.assign({}, base, { from: primary }));
  if (r && r.sent) return r;
  if (fallback && fallback.toLowerCase() !== primary.toLowerCase()) {
    console.warn('[it-request] odeslání z ' + primary + ' selhalo (' + (r && (r.error || r.skipped)) + '), zkouším ' + fallback);
    const r2 = await sendMail(Object.assign({}, base, { from: fallback }));
    if (r2 && r2.sent) return r2;
    return Object.assign({}, r2, { error: 'z ' + primary + ': ' + ((r && (r.error || r.skipped)) || '?') + ' | ze ' + fallback + ': ' + ((r2 && (r2.error || r2.skipped)) || '?') });
  }
  return r;
}
function mailErr(res) { return res && !res.sent ? (res.error || res.skipped || 'e-mail se neodeslal') : null; }

const TEMPLATE_KEY ='it_requirements.template';
const DUE_DAYS_KEY = 'it_requirements.due_days';
const TYPES = ['yesno', 'text', 'textarea', 'choice'];

// Výchozí checklist = „Údaje pro onboarding nového provozovatele prádlomatů"
const DEFAULT_TEMPLATE = [
  { id: 'price_wash', label: 'Cena praní pro každou velikost stroje', type: 'textarea', required: true },
  { id: 'price_softener', label: 'Cena za aviváž pro každou velikost stroje', type: 'textarea', required: true },
  { id: 'price_clean', label: 'Cena za čištění pro každou velikost stroje', type: 'textarea', required: true },
  { id: 'price_dry', label: 'Cena sušení za 15 minut', type: 'text', required: true },
  { id: 'acceptors', label: 'Nastavení akceptorů — které mince a bankovky neakceptuje (centy, vysoké nominály)', type: 'textarea', required: true },
  { id: 'own_logo', label: 'Vlastní logo? (zašlete nejlépe v křivkách e-mailem)', type: 'yesno', required: true },
  { id: 'languages', label: 'Jazyky aplikace (max. 6) a telefonní číslo INFOLINKY', type: 'textarea', required: true },
  { id: 'receipt_billing', label: 'Fakturační údaje na účtence', type: 'textarea', required: true },
  { id: 'receipt_footer', label: 'Zpráva do patičky účtenky', type: 'text', required: false },
  { id: 'receipt_mail', label: 'Vlastní e-mailový účet pro zasílání účtenek — jeho údaje (jinak použijeme náš)', type: 'text', required: false },
  { id: 'nayax_operator', label: 'Operator ID a název Nayax účtu', type: 'text', required: true },
  { id: 'nayax_registrar', label: 'Název registrátora Nayax účtu (Jimark, Corevend, …)', type: 'text', required: true },
  { id: 'teamviewer_has', label: 'Vlastníte TeamViewer účet?', type: 'yesno', required: true },
  { id: 'teamviewer_mail', label: 'E-mail TeamViewer účtu (pokud nemáte, vytvoříme na zadaný e-mail nový)', type: 'text', required: true },
  { id: 'ewelink_has', label: 'Vlastníte eWeLink účet?', type: 'yesno', required: true },
  { id: 'ewelink_mail', label: 'E-mail eWeLink účtu (pokud nemáte, vytvoříme na zadaný e-mail nový)', type: 'text', required: true },
];

// ── Nastavení (AppSetting) ───────────────────────────────────────────────────
const SETTINGS_KEY = 'it_requirements.settings';
const DEFAULT_NAYAX_SUBJECT = 'Založení Nayax účtu pro platební terminál — objednávka {objednavka}';
const DEFAULT_NAYAX_BODY = 'Dobrý den,\n\nděkujeme za Vaši platbu k objednávce {objednavka}. Aby Váš prádlomat mohl přijímat platby kartou, potřebujeme, abyste si založili účet u poskytovatele platebního terminálu Nayax.\n\nPostup:\n1. Kontaktujte registrátora Nayax účtu (např. Jimark, Corevend) a požádejte o založení provozovatelského účtu.\n2. Po založení nám pošlete Operator ID a název Nayax účtu a název registrátora.\n3. Nayax účet nastavíme na Váš prádlomat před expedicí.\n\nPokud si nevíte rady, odpovězte na tento e-mail a pomůžeme Vám.\n\nDěkujeme,\nBest Series s.r.o.';
const DEFAULT_SETTINGS = { due_days: 3, auto_send: true, result_emails: ['martin.polraich@bestseries.cz'], include_radek: true, nayax_enabled: true, nayax_delay_days: 2, nayax_subject: DEFAULT_NAYAX_SUBJECT, nayax_body: DEFAULT_NAYAX_BODY };
function cleanEmails(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/);
  return [...new Set(arr.map((s) => String(s).trim().toLowerCase()).filter((s) => /^\S+@\S+\.\S+$/.test(s)))].slice(0, 20);
}
async function getSettings() {
  const v = await getSetting(SETTINGS_KEY, { type: 'json', defaultValue: null }).catch(() => null);
  const s = Object.assign({}, DEFAULT_SETTINGS, v || {});
  s.due_days = Math.min(30, Math.max(1, parseInt(s.due_days, 10) || 3));
  s.auto_send = s.auto_send !== false;
  s.include_radek = s.include_radek !== false;
  s.result_emails = cleanEmails(s.result_emails);
  s.nayax_enabled = s.nayax_enabled !== false;
  s.nayax_delay_days = Math.min(30, Math.max(0, Number.isFinite(parseInt(s.nayax_delay_days, 10)) ? parseInt(s.nayax_delay_days, 10) : 2));
  s.nayax_subject = String(s.nayax_subject || '').trim() || DEFAULT_NAYAX_SUBJECT;
  s.nayax_body = String(s.nayax_body || '').trim() || DEFAULT_NAYAX_BODY;
  return s;
}
async function saveSettings(b) {
  const nd = parseInt(b.nayax_delay_days, 10);
  const s = { due_days: Math.min(30, Math.max(1, parseInt(b.due_days, 10) || 3)), auto_send: !!b.auto_send, include_radek: b.include_radek !== false, result_emails: cleanEmails(b.result_emails),
    nayax_enabled: !!b.nayax_enabled, nayax_delay_days: Math.min(30, Math.max(0, Number.isFinite(nd) ? nd : 2)),
    nayax_subject: String(b.nayax_subject || '').trim().slice(0, 300) || DEFAULT_NAYAX_SUBJECT, nayax_body: String(b.nayax_body || '').trim().slice(0, 8000) || DEFAULT_NAYAX_BODY };
  await setSetting(SETTINGS_KEY, s, { type: 'json', scope: 'sales', description: 'IT požadavky — nastavení (termín, automatické odeslání, příjemci výsledků)' });
  return s;
}

function sanitizeItems(arr) {
  const used = new Set(); const out = [];
  (Array.isArray(arr) ? arr : []).forEach((q, i) => {
    if (!q || !String(q.label || '').trim()) return;
    let id = String(q.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || ('q' + (i + 1));
    while (used.has(id)) id += '_';
    used.add(id);
    const type = TYPES.includes(q.type) ? q.type : 'text';
    const item = { id, label: String(q.label).trim().slice(0, 400), type, required: !!q.required };
    if (type === 'choice') {
      const opts = (Array.isArray(q.options) ? q.options : String(q.options || '').split(/[,\n;]/)).map((o) => String(o).trim()).filter(Boolean).slice(0, 20);
      item.options = opts.length ? opts : ['Ano', 'Ne'];
    }
    if (q.help) item.help = String(q.help).trim().slice(0, 300);
    out.push(item);
  });
  return out;
}

async function getTemplate() {
  const v = await getSetting(TEMPLATE_KEY, { type: 'json', defaultValue: null }).catch(() => null);
  const items = sanitizeItems(v);
  return items.length ? items : sanitizeItems(DEFAULT_TEMPLATE);
}
async function saveTemplate(items) {
  const clean = sanitizeItems(items);
  if (!clean.length) { const e = new Error('Checklist musí mít aspoň jednu otázku'); e.status = 400; throw e; }
  await setSetting(TEMPLATE_KEY, clean, { type: 'json', scope: 'sales', description: 'IT požadavky — šablona checklistu pro zákazníka' });
  return clean;
}
async function getDueDays() { return (await getSettings()).due_days; }

function publicUrl(token) { return buildShareUrl('/it-pozadavky/' + token); }

// Vytvoří (nebo obnoví nevyplněný) požadavek a pošle zákazníkovi e-mail s odkazem.
async function sendToCustomer(orderId, opts = {}) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { company: true } });
  if (!order) { const e = new Error('Objednávka nenalezena'); e.status = 404; throw e; }
  const email = String(opts.email || order.customer_email || (order.company && order.company.email) || '').trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) { const e = new Error('Zadej platný e-mail zákazníka'); e.status = 400; throw e; }

  const dueDays = await getDueDays();
  const due = new Date(Date.now() + dueDays * 86400000);
  let req = await prisma.orderItRequest.findFirst({ where: { order_id: orderId, status: 'sent' }, orderBy: { id: 'desc' } });
  if (req) {
    req = await prisma.orderItRequest.update({ where: { id: req.id }, data: { customer_email: email, due_at: due, sent_at: new Date(), reminder_sent_at: null } });
  } else {
    req = await prisma.orderItRequest.create({ data: { order_id: orderId, token: crypto.randomBytes(24).toString('hex'), items: await getTemplate(), customer_email: email, due_at: due, created_by_user_id: opts.userId || null } });
  }

  const url = publicUrl(req.token);
  const { sendMail } = require('../email');
  let ourName = 'Best Series s.r.o.';
  try { const our = await require('../settings').getOurCompany(); if (our && our.name) ourName = our.name; } catch (e) { /* výchozí */ }
  const dueTxt = due.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' });
  const body = 'Dobrý den,\n\nk Vaší objednávce ' + order.order_number + ' potřebujeme zjistit několik technických informací o místě instalace (internet, elektřina, kontaktní osoba). '
    + 'Prosíme o vyplnění krátkého formuláře nejpozději do ' + dueTxt + ' (do ' + dueDays + ' dnů), ať můžeme instalaci včas připravit.\n\n'
    + 'Vyplnění zabere pár minut. Odpovědi jde zadat jedním odkazem bez přihlášení.\n\nDěkujeme.\n' + ourName;
  const res = await mail({ audience: 'customer', to: email, subject: 'IT požadavky k objednávce ' + order.order_number + ' — prosíme o vyplnění do ' + dueTxt, body, link: url, linkLabel: 'Vyplnit IT požadavky' });
  try { require('../order-events').logOrderEvent(orderId, { type: 'it_request_sent', label: 'IT požadavky odeslány zákazníkovi', detail: email + ' · vyplnit do ' + dueTxt + (res && res.sent ? '' : ' · e-mail se NEODESLAL' + (res && (res.error || res.skipped) ? ' (' + (res.error || res.skipped) + ')' : '')), actor: opts.actor || 'uživatel' }); } catch (e) { /* nekritické */ }
  return { request: req, url, sent: !!(res && res.sent), mail_error: res && !res.sent ? (res.error || res.skipped || 'e-mail se neodeslal') : null, due_at: due };
}

// ── Veřejná část (zákazník) ──────────────────────────────────────────────────
const PREVIEW_TOKEN = 'nahled';
async function getPublic(token) {
  if (token === PREVIEW_TOKEN) return { status: 'sent', preview: true, items: await getTemplate(), answers: {}, due_at: new Date(Date.now() + 3 * 86400000), order_number: 'TEST', customer: 'Náhled (nic se neukládá)' };
  const r = await prisma.orderItRequest.findUnique({ where: { token: String(token || '') } });
  if (!r) return null;
  const order = await prisma.order.findUnique({ where: { id: r.order_id }, select: { order_number: true, company: { select: { name: true } } } });
  return { status: r.status, items: r.items, answers: r.answers || {}, due_at: r.due_at, filled_at: r.filled_at, order_number: order && order.order_number, customer: order && order.company && order.company.name };
}
async function submitPublic(token, answers, name) {
  const preview = token === PREVIEW_TOKEN;
  const r = preview ? { id: 0, order_id: 0, items: await getTemplate() } : await prisma.orderItRequest.findUnique({ where: { token: String(token || '') } });
  if (!r) { const e = new Error('Odkaz není platný'); e.status = 404; throw e; }
  const items = Array.isArray(r.items) ? r.items : [];
  const a = {}; const missing = [];
  items.forEach((q) => {
    let v = answers && answers[q.id];
    v = v == null ? '' : String(v).trim().slice(0, 2000);
    if (q.type === 'yesno' && v && !['Ano', 'Ne'].includes(v)) v = '';
    if (q.type === 'choice' && v && !(q.options || []).includes(v)) v = '';
    if (q.required && !v) missing.push(q.label);
    if (v) a[q.id] = v;
  });
  if (missing.length) { const e = new Error('Vyplňte prosím povinné otázky: ' + missing.slice(0, 3).join('; ') + (missing.length > 3 ? ' …' : '')); e.status = 400; throw e; }
  if (preview) return { ok: true, preview: true };
  if (r.status === 'filled') { const e = new Error('Dotazník už byl vyplněn'); e.status = 409; throw e; }
  await prisma.orderItRequest.update({ where: { id: r.id }, data: { answers: a, status: 'filled', filled_at: new Date(), filled_by: String(name || '').trim().slice(0, 255) || null } });
  try { require('../order-events').logOrderEvent(r.order_id, { type: 'it_request_filled', label: 'Zákazník vyplnil IT požadavky', detail: String(name || '').slice(0, 120), actor: 'zákazník' }); } catch (e) { /* nekritické */ }
  sendResultMail(r.order_id, items, a, name).catch((e) => console.warn('[it-request] e-mail s výsledkem:', e.message));
  return { ok: true };
}

// ── E-mail s vyplněnými odpovědmi (Radek Bečka + nastavení příjemci) ─────────
function resultBody(orderNo, customer, items, a, name, when) {
  const rows = items.map((q) => q.label + '\n→ ' + (a[q.id] || '—')).join('\n\n');
  return 'Zákazník ' + customer + ' vyplnil IT požadavky k objednávce ' + orderNo + (name ? ' (vyplnil: ' + name + ')' : '') + ' — ' + when + '.\nOdpovědi jsou uložené u objednávky (detail → 💻 IT dotazník).\n\n' + rows;
}
async function resultRecipients() {
  const s = await getSettings();
  const list = [...s.result_emails];
  if (s.include_radek) { try { (await recipients()).forEach((p) => { if (p.email) list.push(String(p.email).toLowerCase()); }); } catch (e) { /* */ } }
  return [...new Set(list)];
}
async function sendResultMail(orderId, items, a, name, opts = {}) {
  const { sendMail } = require('../email');
  const order = orderId ? await prisma.order.findUnique({ where: { id: orderId }, select: { order_number: true, company: { select: { name: true } } } }) : null;
  const orderNo = opts.orderNo || (order && order.order_number) || ('#' + orderId);
  const customer = opts.customer || (order && order.company && order.company.name) || 'zákazník';
  const to = opts.to ? [opts.to] : await resultRecipients();
  const text = resultBody(orderNo, customer, items, a, name, new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' }));
  const subject = (opts.test ? '[TEST] ' : '') + 'IT požadavky vyplněny: ' + customer + ' (' + orderNo + ')';
  const link = buildShareUrl('/modules/prodejni-objednavky/index.html');
  const errors = [];
  for (const t of to) {
    try { const r = await mail({ to: t, subject, body: text, link, linkLabel: 'Otevřít Prodejní objednávky' }); const er = mailErr(r); if (er) errors.push(t + ': ' + er); }
    catch (e) { errors.push(t + ': ' + e.message); }
  }
  if (errors.length) { console.warn('[it-request] e-mail s výsledkem selhal:', errors.join(' | ')); if (opts.test) { const e = new Error('E-mail se neodeslal — ' + errors.join(' | ')); e.status = 502; throw e; } }
  return to;
}

// Test: pošle na zadaný e-mail ukázku e-mailu zákazníkovi i e-mailu s vyplněnými odpověďmi
async function sendTest(email) {
  const to = String(email || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(to)) { const e = new Error('Zadej platný e-mail'); e.status = 400; throw e; }
  const { sendMail } = require('../email');
  const s = await getSettings(); const items = await getTemplate();
  const due = new Date(Date.now() + s.due_days * 86400000).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' });
  const url = publicUrl(PREVIEW_TOKEN);
  const r1 = await mail({ to, subject: '[TEST] IT požadavky k objednávce SO-TEST — prosíme o vyplnění do ' + due, body: 'Dobrý den,\n\nk Vaší objednávce SO-TEST potřebujeme zjistit několik informací pro onboarding nového provozovatele prádlomatů. Prosíme o vyplnění krátkého formuláře nejpozději do ' + due + '.\n\nToto je TESTOVACÍ e-mail — formulář se v náhledu neukládá.', link: url, linkLabel: 'Vyplnit IT požadavky' });
  if (mailErr(r1)) { const e = new Error('E-mail se neodeslal — ' + mailErr(r1)); e.status = 502; throw e; }
  const sample = {}; items.forEach((q) => { sample[q.id] = q.type === 'yesno' ? 'Ano' : q.type === 'choice' ? ((q.options || [])[0] || 'Ano') : 'Ukázková odpověď'; });
  await sendResultMail(0, items, sample, 'Jan Zákazník', { to, test: true, orderNo: 'SO-TEST', customer: 'Ukázková firma s.r.o.' });
  return { ok: true, url };
}

// ── E-mail „Založení Nayax účtu" — X dní (výchozí 2) po první platbě; text je editovatelný v nastavení ──
function fillNayax(text, orderNo, customer) {
  return String(text || '').replace(/\{objednavka\}/gi, orderNo || '').replace(/\{zakaznik\}/gi, customer || '');
}
async function scheduleNayaxMail(orderId) {
  try {
    const s = await getSettings();
    if (!s.nayax_enabled || !orderId) return;
    const exists = await prisma.orderNayaxMail.findUnique({ where: { order_id: orderId } });
    if (exists) return;
    await prisma.orderNayaxMail.create({ data: { order_id: orderId, send_at: new Date(Date.now() + s.nayax_delay_days * 86400000) } });
    try { require('../order-events').logOrderEvent(orderId, { type: 'nayax_mail_scheduled', label: 'Naplánován e-mail se zakládáním Nayax účtu', detail: 'odeslání za ' + s.nayax_delay_days + ' dny', actor: 'systém (první platba)' }); } catch (e) { /* */ }
  } catch (e) { console.warn('[it-request] plán Nayax e-mailu selhal:', e.message); }
}
async function sendDueNayaxMails() {
  const due = await prisma.orderNayaxMail.findMany({ where: { sent_at: null, send_at: { lte: new Date() } }, take: 50 });
  if (!due.length) return { sent: 0 };
  const s = await getSettings(); const { sendMail } = require('../email'); let sent = 0;
  for (const m of due) {
    await prisma.orderNayaxMail.update({ where: { id: m.id }, data: { sent_at: new Date() } }); // nejdřív označ — neopakovat
    try {
      if (!s.nayax_enabled) continue;
      const order = await prisma.order.findUnique({ where: { id: m.order_id }, include: { company: true } });
      const email = order && (order.customer_email || (order.company && order.company.email));
      const evt = (label, detail) => require('../order-events').logOrderEvent(m.order_id, { type: 'nayax_mail', label, detail, actor: 'systém' });
      if (!email) { await evt('E-mail se zakládáním Nayax účtu nelze odeslat — chybí e-mail zákazníka'); continue; }
      const cust = (order.company && order.company.name) || '';
      const res = await mail({ audience: 'customer', to: email, subject: fillNayax(s.nayax_subject, order.order_number, cust), body: fillNayax(s.nayax_body, order.order_number, cust), link: 'https://pradlomaty.info', linkLabel: 'pradlomaty.info' });
      await prisma.orderNayaxMail.update({ where: { id: m.id }, data: { to_email: email, error: res && res.sent ? null : String((res && (res.error || res.skipped)) || 'neodesláno') } });
      await evt(res && res.sent ? 'Odeslán e-mail se zakládáním Nayax účtu' : 'E-mail se zakládáním Nayax účtu se NEODESLAL', email + (res && res.sent ? '' : ' · ' + ((res && (res.error || res.skipped)) || '')));
      if (res && res.sent) sent++;
    } catch (e) { console.warn('[it-request] Nayax e-mail:', e.message); }
  }
  return { sent };
}
async function sendNayaxTest(email, body) {
  const to = String(email || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(to)) { const e = new Error('Zadej platný e-mail'); e.status = 400; throw e; }
  const s = await getSettings(); const { sendMail } = require('../email');
  const subj = (body && body.nayax_subject) || s.nayax_subject; const txt = (body && body.nayax_body) || s.nayax_body;
  const res = await mail({ to, subject: '[TEST] ' + fillNayax(subj, 'SO-TEST', 'Ukázková firma s.r.o.'), body: fillNayax(txt, 'SO-TEST', 'Ukázková firma s.r.o.'), link: 'https://pradlomaty.info', linkLabel: 'pradlomaty.info' });
  return { ok: true, sent: !!(res && res.sent), error: res && !res.sent ? (res.error || res.skipped) : null };
}

// Automaticky po PRVNÍ přijaté platbě k objednávce (objednávka je tím podepsaná/autorizovaná)
async function autoSendOnFirstPayment(orderId) {
  try {
    await scheduleNayaxMail(orderId); // Nayax e-mail se plánuje nezávisle na dotazníku (jednou na objednávku)
    const s = await getSettings();
    if (!s.auto_send || !orderId) return { skipped: 'vypnuto' };
    const exists = await prisma.orderItRequest.findFirst({ where: { order_id: orderId } });
    if (exists) return { skipped: 'už odesláno' };
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { company: true } });
    const email = order && (order.customer_email || (order.company && order.company.email));
    if (!email) {
      try { require('../order-events').logOrderEvent(orderId, { type: 'it_request_failed', label: 'IT požadavky nelze odeslat automaticky — chybí e-mail zákazníka', actor: 'systém' }); } catch (e) { /* */ }
      return { skipped: 'bez e-mailu' };
    }
    return await sendToCustomer(orderId, { email, actor: 'systém (první platba)' });
  } catch (e) { console.warn('[it-request] auto odeslání selhalo:', e.message); return { error: e.message }; }
}

// ── Interní stav pro detail objednávky ───────────────────────────────────────
async function getForOrder(orderId) {
  const r = await prisma.orderItRequest.findFirst({ where: { order_id: orderId }, orderBy: { id: 'desc' } });
  if (!r) return null;
  return { id: r.id, status: r.status, items: r.items, answers: r.answers || {}, customer_email: r.customer_email, sent_at: r.sent_at, due_at: r.due_at, filled_at: r.filled_at, filled_by: r.filled_by, reminder_sent_at: r.reminder_sent_at, overdue: r.status === 'sent' && new Date(r.due_at) < new Date(), url: publicUrl(r.token) };
}

// ── Upozornění: termín uplynul a zákazník nevyplnil → Radek Bečka (e-mail + Velín + zvonek) ──
async function recipients() {
  const ids = await getSetting('it_requirements.notify_person_ids', { type: 'json', defaultValue: [] }).catch(() => []);
  const list = Array.isArray(ids) ? ids.filter((n) => Number.isInteger(n) && n > 0) : [];
  const select = { id: true, user_id: true, email: true, first_name: true, last_name: true };
  if (list.length) return prisma.person.findMany({ where: { id: { in: list }, active: true }, select });
  return prisma.person.findMany({ where: { active: true, first_name: { startsWith: 'Rad', mode: 'insensitive' }, last_name: { contains: 'Beč', mode: 'insensitive' } }, select });
}

async function sweepOverdue() {
  const due = await prisma.orderItRequest.findMany({ where: { status: 'sent', due_at: { lt: new Date() }, reminder_sent_at: null }, take: 50 });
  if (!due.length) return { notified: 0 };
  const people = await recipients();
  const { notifyPerson } = require('../push/expo-push');
  let createNotification = null; try { ({ createNotification } = require('../../routes/notifications.routes')); } catch (e) { /* volitelné */ }
  const { sendMail } = require('../email');
  let notified = 0;
  for (const r of due) {
    // nejdřív označ (ať se upozornění neopakuje, i kdyby něco selhalo)
    await prisma.orderItRequest.update({ where: { id: r.id }, data: { reminder_sent_at: new Date() } });
    const order = await prisma.order.findUnique({ where: { id: r.order_id }, select: { order_number: true, company: { select: { name: true } } } }).catch(() => null);
    const cust = (order && order.company && order.company.name) || 'zákazník';
    const num = (order && order.order_number) || ('#' + r.order_id);
    const title = '⚠️ IT požadavky nevyplněny: ' + cust;
    const body = 'Zákazník ' + cust + ' (obj. ' + num + ') nevyplnil IT dotazník do termínu ' + new Date(r.due_at).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' }) + '. Odesláno na ' + (r.customer_email || '—') + '.';
    const link = '/modules/prodejni-objednavky/index.html';
    for (const p of people) {
      notifyPerson(prisma, p.id, { title, body, data: { type: 'it_request_overdue', order_id: r.order_id, link }, sound: 'default' }).catch((e) => console.warn('[it-request] push', p.id, e.message));
      if (p.user_id && createNotification) createNotification({ userId: p.user_id, type: 'system', title, body, link, meta: { order_id: r.order_id } }).catch((e) => console.warn('[it-request] zvonek', e.message));
      if (p.email) mail({ to: p.email, subject: title, body, link: buildShareUrl(link), linkLabel: 'Otevřít Prodejní objednávky' }).catch((e) => console.warn('[it-request] e-mail', p.email, e.message));
    }
    try { require('../order-events').logOrderEvent(r.order_id, { type: 'it_request_overdue', label: 'IT požadavky nevyplněny včas — upozorněn ' + (people.map((p) => p.first_name + ' ' + p.last_name).join(', ') || 'nikdo (příjemce nenalezen)'), actor: 'systém' }); } catch (e) { /* nekritické */ }
    notified++;
  }
  return { notified };
}

module.exports = { sendNayaxTest, sendDueNayaxMails, scheduleNayaxMail, getSettings, saveSettings, sendTest, autoSendOnFirstPayment, getTemplate, saveTemplate, getDueDays, sendToCustomer, getPublic, submitPublic, getForOrder, sweepOverdue, sanitizeItems, DEFAULT_TEMPLATE };
