// =============================================================================
// HolyOS — Worker milníků splátek (rozložení plateb objednávky)
// =============================================================================
// Jednou za hodinu projde otevřené prodejní objednávky se splátkovým plánem a
// u splátek, jejichž milník právě nastal (potvrzeno / blíží se start výroby /
// dodáno) a ještě nemají fakturu, pošle Velín push + zvonek Janovi, Tomášovi
// a odpovědnému obchodníkovi: „Vystavit zálohovou fakturu …".
// Faktura se zatím vystavuje RUČNĚ (tlačítko u splátky). Přepínač
// AppSetting payments.auto_invoice = 'true' ji v budoucnu vystaví automaticky
// (kód připraven: issueInvoiceForPayment).
// =============================================================================

'use strict';

const { prisma } = require('../../config/database');
const { notifyPerson } = require('../push/expo-push');
const { createNotification } = require('../../routes/notifications.routes');
const pp = require('./payment-plan');

const ALWAYS = [{ first_name: 'Jan', last_name: 'Holý' }, { first_name: 'Tomáš', last_name: 'Holý' }];

async function recipientIds(order) {
  const ids = new Set();
  for (const w of ALWAYS) {
    try { const p = await prisma.person.findFirst({ where: { active: true, first_name: { equals: w.first_name, mode: 'insensitive' }, last_name: { equals: w.last_name, mode: 'insensitive' } }, select: { id: true } }); if (p) ids.add(p.id); } catch (e) { /* */ }
  }
  if (order.sales_person_id) ids.add(order.sales_person_id);
  return Array.from(ids);
}

async function notify(order, payment, plan) {
  const cur = plan.currency;
  const title = '💳 ' + (payment.kind === 'final' ? 'Vystavit finální fakturu' : 'Vystavit zálohovou fakturu') + ' — ' + order.order_number;
  const body = payment.milestone_label + ' · ' + payment.amount.toLocaleString('cs-CZ') + ' ' + cur + (payment.percent != null ? ' (' + payment.percent + ' %)' : '') + (payment.item ? ' · ' + payment.item.name : '') + ' · ' + ((order.company && order.company.name) || '');
  const link = '/modules/prodejni-objednavky/index.html?order=' + order.id;
  const ids = await recipientIds(order);
  const persons = await prisma.person.findMany({ where: { id: { in: ids } }, select: { id: true, user_id: true } });
  for (const p of persons) {
    notifyPerson(prisma, p.id, { title, body, data: { type: 'order_payment_milestone', order_id: order.id, payment_id: payment.id, link }, sound: 'default' }).catch((e) => console.warn('[payment-milestones] push', p.id, e.message));
    if (p.user_id) createNotification({ userId: p.user_id, type: 'system', title, body, link, meta: { order_id: order.id, payment_id: payment.id } }).catch((e) => console.warn('[payment-milestones] zvonek', p.user_id, e.message));
  }
}

let running = false;
async function tick() {
  if (running) return; running = true;
  try {
    const orders = await prisma.order.findMany({
      where: { type: 'sales', status: { notIn: ['cancelled', 'expired'] }, payments: { some: { invoice_id: null, milestone_at: null } } },
      select: { id: true, order_number: true, sales_person_id: true, company: { select: { name: true } } },
      take: 200,
    });
    let auto = false;
    try { const { getSetting } = require('../settings'); auto = (await getSetting('payments.auto_invoice', { type: 'boolean', defaultValue: false })) === true; } catch (e) { /* */ }
    let n = 0;
    for (const o of orders) {
      const plan = await pp.getPlan(o.id);
      if (!plan) continue;
      for (const pay of plan.payments) {
        if (pay.invoice || pay.milestone_at || !pay.milestone_reached || pay.amount <= 0) continue;
        await prisma.orderPayment.update({ where: { id: pay.id }, data: { milestone_at: new Date() } });
        if (auto) {
          try { await pp.issueInvoiceForPayment(pay.id, { actor: 'automat' }); } catch (e) { console.warn('[payment-milestones] auto faktura selhala:', e.message); }
        }
        await notify(o, pay, plan);
        n++;
      }
    }
    if (n) console.log(`[payment-milestones] milníků nastalo: ${n}`);
  } catch (e) {
    console.warn('[payment-milestones] tick selhal:', e.message);
  } finally { running = false; }
}

let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(tick, 60 * 60 * 1000);
  setTimeout(tick, 90 * 1000);
  console.log('[payment-milestones] worker spuštěn (1× za hodinu)');
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { start, stop, tick };
