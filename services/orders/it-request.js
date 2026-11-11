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

const TEMPLATE_KEY = 'it_requirements.template';
const DUE_DAYS_KEY = 'it_requirements.due_days';
const TYPES = ['yesno', 'text', 'textarea', 'choice'];

const DEFAULT_TEMPLATE = [
  { id: 'internet', label: 'Je v místě instalace dostupné internetové připojení?', type: 'yesno', required: true },
  { id: 'conn_type', label: 'Typ připojení', type: 'choice', options: ['Kabel (LAN)', 'Wi-Fi', 'LTE / 5G router', 'Zatím žádné'], required: true },
  { id: 'isp', label: 'Poskytovatel internetu a rychlost připojení', type: 'text', required: false },
  { id: 'router_place', label: 'Umístění routeru / datové zásuvky a vzdálenost od stroje (v metrech)', type: 'text', required: true },
  { id: 'power', label: 'Elektrická přípojka v místě instalace', type: 'choice', options: ['230 V', '400 V', 'Zatím nevyřízeno'], required: true },
  { id: 'remote_ok', label: 'Povolíte vzdálený přístup a monitoring stroje (firewall / síťová pravidla)?', type: 'yesno', required: true },
  { id: 'it_contact', label: 'Kontakt na osobu za IT / techniku (jméno, telefon, e-mail)', type: 'text', required: true },
  { id: 'note', label: 'Poznámka', type: 'textarea', required: false },
];

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
async function getDueDays() {
  const n = await getSetting(DUE_DAYS_KEY, { type: 'number', defaultValue: 3 }).catch(() => 3);
  return Number.isFinite(Number(n)) && Number(n) > 0 ? Math.min(30, Math.round(Number(n))) : 3;
}

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
  const res = await sendMail({ audience: 'customer', to: email, subject: 'IT požadavky k objednávce ' + order.order_number + ' — prosíme o vyplnění do ' + dueTxt, body, link: url, linkLabel: 'Vyplnit IT požadavky', fromName: ourName });
  try { require('../order-events').logOrderEvent(orderId, { type: 'it_request_sent', label: 'IT požadavky odeslány zákazníkovi', detail: email + ' · vyplnit do ' + dueTxt + (res && res.sent ? '' : ' · e-mail se NEODESLAL' + (res && (res.error || res.skipped) ? ' (' + (res.error || res.skipped) + ')' : '')), actor: opts.actor || 'uživatel' }); } catch (e) { /* nekritické */ }
  return { request: req, url, sent: !!(res && res.sent), mail_error: res && !res.sent ? (res.error || res.skipped || 'e-mail se neodeslal') : null, due_at: due };
}

// ── Veřejná část (zákazník) ──────────────────────────────────────────────────
async function getPublic(token) {
  const r = await prisma.orderItRequest.findUnique({ where: { token: String(token || '') } });
  if (!r) return null;
  const order = await prisma.order.findUnique({ where: { id: r.order_id }, select: { order_number: true, company: { select: { name: true } } } });
  return { status: r.status, items: r.items, answers: r.answers || {}, due_at: r.due_at, filled_at: r.filled_at, order_number: order && order.order_number, customer: order && order.company && order.company.name };
}
async function submitPublic(token, answers, name) {
  const r = await prisma.orderItRequest.findUnique({ where: { token: String(token || '') } });
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
  await prisma.orderItRequest.update({ where: { id: r.id }, data: { answers: a, status: 'filled', filled_at: new Date(), filled_by: String(name || '').trim().slice(0, 255) || null } });
  try { require('../order-events').logOrderEvent(r.order_id, { type: 'it_request_filled', label: 'Zákazník vyplnil IT požadavky', detail: String(name || '').slice(0, 120), actor: 'zákazník' }); } catch (e) { /* nekritické */ }
  return { ok: true };
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
      if (p.email) sendMail({ to: p.email, subject: title, body, link: buildShareUrl(link), linkLabel: 'Otevřít Prodejní objednávky' }).catch((e) => console.warn('[it-request] e-mail', p.email, e.message));
    }
    try { require('../order-events').logOrderEvent(r.order_id, { type: 'it_request_overdue', label: 'IT požadavky nevyplněny včas — upozorněn ' + (people.map((p) => p.first_name + ' ' + p.last_name).join(', ') || 'nikdo (příjemce nenalezen)'), actor: 'systém' }); } catch (e) { /* nekritické */ }
    notified++;
  }
  return { notified };
}

module.exports = { getTemplate, saveTemplate, getDueDays, sendToCustomer, getPublic, submitPublic, getForOrder, sweepOverdue, sanitizeItems, DEFAULT_TEMPLATE };
