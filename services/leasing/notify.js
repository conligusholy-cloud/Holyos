// =============================================================================
// HolyOS — Leasing: notifikace do Velína o reakci leasingové společnosti na poptávku
// =============================================================================
// Když leasingovka na veřejném odkazu označí stav (otevřeno / zpracovává se /
// schváleno / zamítnuto), pošli push + zvonek obchodníkovi, který poptávku odeslal,
// a vždy Janu a Tomáši Holému.
// =============================================================================

'use strict';

const { notifyPerson } = require('../push/expo-push');
const { createNotification } = require('../../routes/notifications.routes');

const ALWAYS = [{ first_name: 'Jan', last_name: 'Holý' }, { first_name: 'Tomáš', last_name: 'Holý' }];
const STATUS_LABEL = { opened: '👀 otevřela poptávku', in_progress: '⏳ zpracovává', approved: '✅ SCHVÁLENO', rejected: '❌ zamítnuto', sent: '📨 poptávka odeslána', canceled: 'zrušeno', deleted: '🗑️ poptávka smazána', bounced: '⚠️ E-MAIL NEDORUČEN' };

async function alwaysIds(prisma) {
  const ids = [];
  for (const w of ALWAYS) {
    try { const p = await prisma.person.findFirst({ where: { active: true, first_name: { equals: w.first_name, mode: 'insensitive' }, last_name: { equals: w.last_name, mode: 'insensitive' } }, select: { id: true } }); if (p) ids.push(p.id); } catch (e) { /* */ }
  }
  return ids;
}

async function notifyLeasingInquiry(prisma, inquiry, status, extra) {
  try {
    extra = extra || {};
    const company = await prisma.leasingCompany.findUnique({ where: { id: inquiry.leasing_company_id }, select: { name: true } }).catch(() => null);
    const ids = new Set(await alwaysIds(prisma));
    if (inquiry.sent_by_person_id) ids.add(inquiry.sent_by_person_id);
    if (!ids.size) return;
    const client = ((inquiry.client_first_name || '') + ' ' + (inquiry.client_last_name || '')).trim() || 'klient';
    const title = '🏦 ' + ((company && company.name) || 'Leasingovka') + ' ' + (STATUS_LABEL[status] || status) + ': ' + client;
    const parts = [inquiry.subject, Math.round(Number(inquiry.price) || 0).toLocaleString('cs-CZ') + ' Kč'];
    if (status === 'approved' && inquiry.result_monthly) parts.push('splátka ' + Math.round(Number(inquiry.result_monthly)).toLocaleString('cs-CZ') + ' Kč/měs');
    if (inquiry.result_note) parts.push(String(inquiry.result_note).slice(0, 120));
    if (status === 'bounced') parts.push(extra.note || 'zkontroluj e-mail leasingovky a pošli znovu (🔔)');
    if ((status === 'sent' || status === 'deleted') && extra.by) parts.push((status === 'sent' ? 'odeslal ' : 'smazal ') + extra.by);
    if (status === 'sent' && inquiry.deadline_at) parts.push('výsledek do ' + new Date(inquiry.deadline_at).toLocaleDateString('cs-CZ'));
    const body = parts.filter(Boolean).join(' · ');
    const link = '/modules/prodejni-objednavky/index.html?gs_tab=leasing';
    const persons = await prisma.person.findMany({ where: { id: { in: Array.from(ids) } }, select: { id: true, user_id: true } });
    for (const p of persons) {
      notifyPerson(prisma, p.id, { title, body, data: { type: 'leasing_inquiry', inquiry_id: inquiry.id, status, link }, sound: 'default' }).catch((e) => console.warn('[leasing-notify] push', p.id, e.message));
      if (p.user_id) createNotification({ userId: p.user_id, type: 'system', title, body, link, meta: { inquiry_id: inquiry.id, status } }).catch((e) => console.warn('[leasing-notify] zvonek', p.user_id, e.message));
    }
  } catch (e) { console.warn('[leasing-notify] selhalo:', e.message); }
}

module.exports = { notifyLeasingInquiry, STATUS_LABEL };
