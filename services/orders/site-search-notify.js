// HolyOS — „Slíbeno s místem": po přijaté platbě upozornit Michala Jandu, že má okamžitě hledat místo
// =============================================================================
// U objednávky se ručně zadá: slíbeno s místem ANO/NE, v jaké lokalitě hledat a do kdy to má být vyřešené.
// Jakmile k objednávce přijde platba (první zaplacená splátka), odejde jednou e-mail + push do Velína + zvonek v HolyOS.
// Příjemce: AppSetting site_search.notify_person_ids (JSON pole Person.id), jinak osoba „Michal Janda".

'use strict';

const { prisma } = require('../../config/database');
const { getSetting } = require('../settings');
const { buildShareUrl } = require('../share-url');

async function recipients() {
  const ids = await getSetting('site_search.notify_person_ids', { type: 'json', defaultValue: [] }).catch(() => []);
  const list = Array.isArray(ids) ? ids.filter((n) => Number.isInteger(n) && n > 0) : [];
  const select = { id: true, user_id: true, email: true, first_name: true, last_name: true };
  if (list.length) return prisma.person.findMany({ where: { id: { in: list }, active: true }, select });
  return prisma.person.findMany({ where: { active: true, first_name: { startsWith: 'Michal', mode: 'insensitive' }, last_name: { contains: 'Janda', mode: 'insensitive' } }, select });
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' }) : '—');

// Pošle upozornění, pokud je objednávka „slíbená s místem", je zaplacená a ještě se neposílalo. Idempotentní.
async function notifyIfDue(orderId) {
  try {
    if (!orderId) return { skipped: 'bez objednávky' };
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { company: { select: { name: true } } } });
    if (!order || !order.location_promised || order.location_notified_at) return { skipped: 'nic k odeslání' };
    const paid = (await prisma.orderPayment.count({ where: { order_id: orderId, paid: true } })) > 0 || !!order.deposit_paid;
    if (!paid) return { skipped: 'ještě nezaplaceno' };
    // Nejdřív označit (atomicky) — aby se upozornění neposlalo dvakrát při souběhu
    const claim = await prisma.order.updateMany({ where: { id: orderId, location_notified_at: null }, data: { location_notified_at: new Date() } });
    if (claim.count === 0) return { skipped: 'už odesláno' };

    const people = await recipients();
    const cust = (order.company && order.company.name) || 'zákazník';
    const area = order.location_search_area || '—';
    const deadline = fmtDate(order.location_search_deadline);
    const title = '📍 Okamžitě hledat místo: ' + area + ' — do ' + deadline;
    const body = 'Objednávka ' + order.order_number + ' (' + cust + ') byla zaplacena a byla slíbena s místem.\n\nLokalita, kde hledat: ' + area + '\nTermín, do kdy musí být místo vyřešené: ' + deadline + '\n\nProsím začni hledat místo hned.';
    const link = '/modules/prodejni-objednavky/index.html';
    const { notifyPerson } = require('../push/expo-push');
    let createNotification = null; try { ({ createNotification } = require('../../routes/notifications.routes')); } catch (e) { /* volitelné */ }
    const { mail } = require('./it-request');
    for (const p of people) {
      notifyPerson(prisma, p.id, { title, body: 'Obj. ' + order.order_number + ' · ' + cust + ' · ' + area + ' · do ' + deadline, data: { type: 'site_search', order_id: orderId, link }, sound: 'default' }).catch((e) => console.warn('[site-search] push', p.id, e.message));
      if (p.user_id && createNotification) createNotification({ userId: p.user_id, type: 'system', title, body: 'Obj. ' + order.order_number + ' · ' + cust + ' · ' + area + ' · do ' + deadline, link, meta: { order_id: orderId } }).catch((e) => console.warn('[site-search] zvonek', e.message));
      if (p.email) mail({ to: p.email, subject: title, body, link: buildShareUrl(link), linkLabel: 'Otevřít Prodejní objednávky', brand: undefined }).catch((e) => console.warn('[site-search] e-mail', p.email, e.message));
    }
    try { require('../order-events').logOrderEvent(orderId, { type: 'site_search_notified', label: 'Odesláno upozornění: hledat místo — ' + area + ' do ' + deadline, detail: people.map((p) => p.first_name + ' ' + p.last_name).join(', ') || 'příjemce nenalezen', actor: 'systém (platba)' }); } catch (e) { /* */ }
    if (!people.length) console.warn('[site-search] příjemce (Michal Janda) nenalezen — nastav site_search.notify_person_ids');
    return { notified: people.length };
  } catch (e) { console.warn('[site-search] selhalo:', e.message); return { error: e.message }; }
}

module.exports = { notifyIfDue, recipients };
