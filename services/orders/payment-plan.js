// =============================================================================
// HolyOS — Rozložení plateb prodejní objednávky (splátkový kalendář)
// =============================================================================
// Objednávka má splátky (OrderPayment) buď nad celou objednávkou (payment_scope='order'),
// nebo nad každou položkou zvlášť (payment_scope='items' — stroje s různým termínem dodání).
//
// Splátka = milník (při objednání / před výrobou / po dodání) + výše (% ze základu nebo částka
// bez DPH) + druh dokladu (deposit = zálohová faktura, final = finální faktura / vyúčtování,
// která odečte zaplacené zálohy stejného rozsahu).
//
// Vystavení faktury je zatím RUČNÍ (tlačítko u splátky). Milníky hlídá worker
// (payment-milestone-worker.js) a jen posílá notifikaci do Velína — připraveno na automat.
// Zaplacení splátky „před výrobou" (nebo „při objednání", když jiná není) uvolní objednávku
// do výroby přes stávající releaseOrderToProduction.
// =============================================================================

'use strict';

const { prisma: defaultPrisma } = require('../../config/database');

const MILESTONES = ['at_order', 'before_production', 'after_delivery'];
const MILESTONE_LABEL = { at_order: 'Při objednání', before_production: 'Před výrobou', after_delivery: 'Po dodání' };
const KINDS = ['deposit', 'final'];

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Základ pro % — cena bez DPH objednávky nebo položky.
function baseOf(order, item) {
  if (item) return r2(Number(item.total_price) || (Number(item.quantity) || 0) * (Number(item.unit_price) || 0));
  return r2(order.total_amount);
}

function amountOf(p, base) {
  if (p.amount != null && p.amount !== '') return r2(p.amount);
  if (p.percent != null && p.percent !== '') return r2(base * Number(p.percent) / 100);
  return 0;
}

/**
 * Validace plánu (jedna skupina = objednávka nebo jedna položka).
 * Vrací { ok, error } — součet musí dát 100 % / celou cenu, poslední splátka je final.
 */
function validateGroup(rows, base) {
  if (!rows.length) return { ok: true };
  let sum = 0;
  for (const p of rows) {
    if (!MILESTONES.includes(p.milestone)) return { ok: false, error: 'Neznámý milník: ' + p.milestone };
    if (!KINDS.includes(p.kind)) return { ok: false, error: 'Neznámý druh dokladu: ' + p.kind };
    const hasPct = p.percent != null && p.percent !== '';
    const hasAmt = p.amount != null && p.amount !== '';
    if (!hasPct && !hasAmt) return { ok: false, error: 'Každá splátka musí mít % nebo částku' };
    if (hasPct && (Number(p.percent) <= 0 || Number(p.percent) > 100)) return { ok: false, error: '% musí být v rozmezí 0–100' };
    sum += amountOf(p, base);
  }
  const finals = rows.filter((p) => p.kind === 'final');
  if (finals.length > 1) return { ok: false, error: 'Jen jedna splátka může být finální faktura' };
  if (finals.length === 1 && rows[rows.length - 1].kind !== 'final') return { ok: false, error: 'Finální faktura musí být poslední splátka' };
  if (base > 0 && Math.abs(sum - base) > 1) return { ok: false, error: 'Součet splátek (' + sum.toLocaleString('cs-CZ') + ') neodpovídá základu (' + base.toLocaleString('cs-CZ') + ')' };
  // Pořadí milníků musí být nerostoucí → at_order < before_production < after_delivery
  const idx = rows.map((p) => MILESTONES.indexOf(p.milestone));
  for (let i = 1; i < idx.length; i++) if (idx[i] < idx[i - 1]) return { ok: false, error: 'Milníky musí jít v pořadí: při objednání → před výrobou → po dodání' };
  return { ok: true };
}

/** Načte objednávku se splátkami a dopočítá částky + stav milníků. */
async function getPlan(orderId, db = defaultPrisma) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: { select: { id: true, name: true, quantity: true, unit_price: true, total_price: true, serial_number: true, status: true, delivered_quantity: true,
        slot_assignments: { select: { slot: { select: { start_date: true, end_date: true } } } } } },
      payments: { orderBy: [{ order_item_id: 'asc' }, { seq: 'asc' }], include: { invoice: { select: { id: true, invoice_number: true, total: true, status: true, date_due: true, delivery_status: true } } } },
    },
  });
  if (!order) return null;
  const itemById = new Map(order.items.map((i) => [i.id, i]));
  const now = Date.now();
  const leadDays = order.final_invoice_lead_days || 14;

  // Start výroby objednávky = nejranější slot; položky mají vlastní slot.
  const itemStart = (it) => { const ds = (it.slot_assignments || []).map((a) => a.slot && a.slot.start_date).filter(Boolean).map((d) => new Date(d).getTime()); return ds.length ? Math.min(...ds) : null; };
  const orderStart = (() => { const ds = order.items.map(itemStart).filter((x) => x != null); return ds.length ? Math.min(...ds) : null; })();
  const orderDelivered = ['delivered', 'done'].includes(order.status);
  const confirmed = ['confirmed', 'in_production', 'ordered', 'delivered', 'done', 'signed'].includes(order.status) || !!order.customer_confirmed_at;

  function milestoneReached(p, item) {
    if (p.milestone === 'at_order') return confirmed;
    if (p.milestone === 'before_production') {
      const st = item ? itemStart(item) : orderStart;
      return st != null && st - now <= leadDays * 86400000;
    }
    if (p.milestone === 'after_delivery') {
      if (item) return orderDelivered || item.status === 'delivered' || (Number(item.delivered_quantity) > 0 && Number(item.delivered_quantity) >= Number(item.quantity));
      return orderDelivered;
    }
    return false;
  }

  const payments = order.payments.map((p) => {
    const item = p.order_item_id ? itemById.get(p.order_item_id) : null;
    const base = baseOf(order, item);
    return {
      id: p.id, order_item_id: p.order_item_id, seq: p.seq, milestone: p.milestone, milestone_label: MILESTONE_LABEL[p.milestone] || p.milestone,
      kind: p.kind, percent: p.percent == null ? null : Number(p.percent), amount_fixed: p.amount == null ? null : Number(p.amount),
      base, amount: amountOf(p, base), label: p.label, due_days: p.due_days, note: p.note,
      invoice: p.invoice, paid: p.paid, paid_at: p.paid_at, milestone_at: p.milestone_at,
      milestone_reached: milestoneReached(p, item),
      item: item ? { id: item.id, name: item.name, serial_number: item.serial_number } : null,
    };
  });

  const total = r2(order.total_amount);
  const paidSum = r2(payments.filter((p) => p.paid).reduce((s, p) => s + p.amount, 0));
  return {
    order_id: order.id, scope: order.payment_scope || 'order', currency: order.currency || 'CZK', total,
    items: order.items.map((i) => ({ id: i.id, name: i.name, serial_number: i.serial_number, base: baseOf(order, i), production_start: itemStart(i) })),
    payments, paid_sum: paidSum, remaining: r2(total - paidSum),
  };
}

/**
 * Uloží celý plán (nahradí stávající; splátky s fakturou/zaplacené zůstanou nedotčené podle id).
 * body: { scope: 'order'|'items', payments: [{ id?, order_item_id?, milestone, kind, percent?, amount?, label?, due_days? }] }
 */
async function savePlan(orderId, body, db = defaultPrisma) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: { select: { id: true, quantity: true, unit_price: true, total_price: true } }, payments: true } });
  if (!order) throw Object.assign(new Error('Objednávka nenalezena'), { status: 404 });
  const scope = body.scope === 'items' ? 'items' : 'order';
  const rows = Array.isArray(body.payments) ? body.payments : [];

  // Normalizace + seskupení
  const groups = new Map(); // key: 'order' | item id
  for (const r of rows) {
    const itemId = scope === 'items' ? parseInt(r.order_item_id, 10) : null;
    if (scope === 'items' && !order.items.some((i) => i.id === itemId)) throw Object.assign(new Error('Položka #' + r.order_item_id + ' nepatří k objednávce'), { status: 400 });
    const key = scope === 'items' ? itemId : 'order';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      id: r.id ? parseInt(r.id, 10) : null, order_item_id: itemId,
      milestone: String(r.milestone || ''), kind: r.kind === 'final' ? 'final' : 'deposit',
      percent: (r.percent === '' || r.percent == null) ? null : r2(r.percent),
      amount: (r.amount === '' || r.amount == null) ? null : r2(r.amount),
      label: r.label ? String(r.label).slice(0, 120) : null,
      due_days: Number.isFinite(Number(r.due_days)) ? Math.max(0, parseInt(r.due_days, 10)) : 7,
      note: r.note ? String(r.note).slice(0, 2000) : null,
    });
  }
  for (const [key, list] of groups) {
    const item = key === 'order' ? null : order.items.find((i) => i.id === key);
    const v = validateGroup(list, baseOf(order, item));
    if (!v.ok) throw Object.assign(new Error((item ? 'Položka #' + key + ': ' : '') + v.error), { status: 400 });
  }

  // Splátky s fakturou nebo zaplacené nelze smazat/přepsat výší
  const locked = new Map(order.payments.filter((p) => p.invoice_id || p.paid).map((p) => [p.id, p]));
  const keepIds = new Set();
  await db.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { payment_scope: scope } });
    for (const [, list] of groups) {
      let seq = 0;
      for (const p of list) {
        seq++;
        const data = { order_item_id: p.order_item_id, seq, milestone: p.milestone, kind: p.kind, percent: p.percent, amount: p.amount, label: p.label, due_days: p.due_days, note: p.note };
        if (p.id && locked.has(p.id)) {
          const l = locked.get(p.id);
          await tx.orderPayment.update({ where: { id: p.id }, data: { seq, label: p.label, note: p.note, milestone: p.milestone, due_days: p.due_days, percent: l.percent, amount: l.amount, kind: l.kind, order_item_id: l.order_item_id } });
          keepIds.add(p.id);
        } else if (p.id && order.payments.some((x) => x.id === p.id)) {
          await tx.orderPayment.update({ where: { id: p.id }, data }); keepIds.add(p.id);
        } else {
          const c = await tx.orderPayment.create({ data: { ...data, order_id: orderId } }); keepIds.add(c.id);
        }
      }
    }
    const toDelete = order.payments.filter((p) => !keepIds.has(p.id));
    const blocked = toDelete.filter((p) => locked.has(p.id));
    if (blocked.length) throw Object.assign(new Error('Splátku s vystavenou fakturou nebo zaplacenou nelze smazat (#' + blocked.map((b) => b.id).join(', #') + ')'), { status: 400 });
    if (toDelete.length) await tx.orderPayment.deleteMany({ where: { id: { in: toDelete.map((p) => p.id) } } });
  });
  return getPlan(orderId, db);
}

/**
 * Vystaví fakturu k dané splátce (ručně z UI). deposit → zálohová (proforma_issued, role deposit),
 * final → finální (issued, role final) s odečtem ZAPLACENÝCH záloh stejného rozsahu.
 * Částky bez DPH; CZK = 21 %, cizí měna = reverse charge 0 %.
 */
async function issueInvoiceForPayment(paymentId, opts = {}) {
  const db = opts.prisma || defaultPrisma;
  const p = await db.orderPayment.findUnique({ where: { id: paymentId }, include: { order: { include: { items: true, company: true } }, order_item: true } });
  if (!p) throw Object.assign(new Error('Splátka nenalezena'), { status: 404 });
  if (p.invoice_id) { const inv = await db.invoice.findUnique({ where: { id: p.invoice_id } }); return { created: false, reason: 'already_issued', invoice: inv }; }
  const order = p.order;
  const base = baseOf(order, p.order_item);
  const net = amountOf(p, base);
  if (net <= 0) throw Object.assign(new Error('Částka splátky je 0'), { status: 400 });

  const { generateInvoiceNumber } = require('../accountant/invoice-numbering');
  const isForeign = (order.currency || 'CZK') !== 'CZK';
  const rate = isForeign ? 0 : 21;
  const vatRegime = isForeign ? 'reverse_charge' : 'standard';
  const money = (sub) => { const s = r2(sub); const v = r2(s * rate / 100); return { sub: s, vat: v, tot: r2(s + v) }; };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(today.getTime() + (p.due_days || 7) * 86400000);
  const scopeTxt = p.order_item ? (p.order_item.name + (p.order_item.serial_number ? ' (' + p.order_item.serial_number + ')' : '')) : ('objednávka ' + order.order_number);
  const pctTxt = p.percent != null ? Number(p.percent) + ' % ' : '';
  const mLabel = MILESTONE_LABEL[p.milestone] || p.milestone;

  let invoice;
  if (p.kind === 'deposit') {
    const m = money(net);
    const invNo = await generateInvoiceNumber('proforma_issued', { prisma: db });
    invoice = await db.invoice.create({ data: {
      invoice_number: invNo, type: 'proforma_issued', direction: 'ar', company_id: order.company_id, order_id: order.id,
      currency: order.currency || 'CZK', subtotal: m.sub, vat_amount: m.vat, total: m.tot, vat_regime: vatRegime,
      date_issued: today, date_due: due, variable_symbol: (invNo.match(/(\d+)$/) || [])[1] || null,
      status: 'draft', invoice_role: 'deposit', source: 'from_order', created_by_user_id: opts.createdByUserId || null,
      note: 'Zálohová faktura ' + pctTxt + '(' + mLabel.toLowerCase() + ') — ' + scopeTxt,
      items: { create: [{ line_order: 0, description: 'Záloha ' + pctTxt + '— ' + scopeTxt + ' · ' + mLabel.toLowerCase(), quantity: 1, unit: 'ks', unit_price: m.sub, vat_rate: rate, subtotal: m.sub, vat_amount: m.vat, total: m.tot, order_item_id: p.order_item_id || undefined }] },
    } });
  } else {
    // Finální: celkové plnění rozsahu − zaplacené zálohy téhož rozsahu (dle plánu)
    const siblings = await db.orderPayment.findMany({ where: { order_id: order.id, order_item_id: p.order_item_id, kind: 'deposit', paid: true, id: { not: p.id } }, include: { invoice: { select: { invoice_number: true } } } });
    const plneni = money(base);
    const items = [{ line_order: 1, description: 'Celkové plnění — ' + scopeTxt, quantity: 1, unit: 'ks', unit_price: plneni.sub, vat_rate: rate, subtotal: plneni.sub, vat_amount: plneni.vat, total: plneni.tot, order_item_id: p.order_item_id || undefined }];
    let dSub = 0, dVat = 0, dTot = 0, li = 2;
    for (const s of siblings) {
      const m = money(amountOf(s, base));
      dSub += m.sub; dVat += m.vat; dTot += m.tot;
      items.push({ line_order: li++, description: 'Odečet zaplacené zálohy' + (s.invoice ? ' dle ' + s.invoice.invoice_number : '') + ' (' + (MILESTONE_LABEL[s.milestone] || '').toLowerCase() + ')', quantity: 1, unit: 'ks', unit_price: -m.sub, vat_rate: rate, subtotal: -m.sub, vat_amount: -m.vat, total: -m.tot });
    }
    const invNo = await generateInvoiceNumber('issued', { prisma: db });
    invoice = await db.invoice.create({ data: {
      invoice_number: invNo, type: 'issued', direction: 'ar', company_id: order.company_id, order_id: order.id,
      currency: order.currency || 'CZK', exchange_rate: 1, subtotal: r2(plneni.sub - dSub), vat_amount: r2(plneni.vat - dVat), total: r2(plneni.tot - dTot), vat_regime: vatRegime,
      date_issued: today, date_taxable: today, date_due: due, payment_method: 'bank_transfer', variable_symbol: invNo.replace(/\D/g, '').slice(-10),
      status: 'draft', invoice_role: 'final', source: 'from_order', created_by_user_id: opts.createdByUserId || null,
      note: 'Finální faktura (' + mLabel.toLowerCase() + ') — ' + scopeTxt + (dTot > 0 ? '. Započtené zálohy: ' + dTot.toLocaleString('cs-CZ') + ' ' + (order.currency || 'CZK') : ''),
      items: { create: items },
    } });
    if (!p.order_item_id && !order.final_invoice_id) await db.order.update({ where: { id: order.id }, data: { final_invoice_id: invoice.id } }).catch(() => {});
  }
  await db.orderPayment.update({ where: { id: p.id }, data: { invoice_id: invoice.id } });
  try { require('../order-events').logOrderEvent(order.id, { type: 'invoice_created', label: (p.kind === 'deposit' ? 'Vytvořena zálohová faktura' : 'Vytvořena finální faktura') + ' ke splátce', detail: invoice.invoice_number + ' · ' + Number(invoice.total).toLocaleString('cs-CZ') + ' ' + (order.currency || 'CZK') + ' · ' + mLabel + ' · ' + scopeTxt, actor: opts.actor || 'uživatel' }); } catch (e) { /* */ }
  return { created: true, invoice };
}

/** Označí splátku zaplacenou / nezaplacenou; po zaplacení „release" splátky uvolní výrobu. */
async function setPaid(paymentId, paid, opts = {}) {
  const db = opts.prisma || defaultPrisma;
  const p = await db.orderPayment.findUnique({ where: { id: paymentId }, include: { order: true } });
  if (!p) throw Object.assign(new Error('Splátka nenalezena'), { status: 404 });
  const upd = await db.orderPayment.update({ where: { id: p.id }, data: { paid: !!paid, paid_at: paid ? new Date() : null } });
  if (p.invoice_id) await db.invoice.update({ where: { id: p.invoice_id }, data: paid ? { status: 'paid', paid_amount: undefined } : { status: 'issued' } }).catch(() => {});
  try { require('../order-events').logOrderEvent(p.order_id, { type: paid ? 'payment_received' : 'payment_unmarked', label: (paid ? 'Zaplacena splátka' : 'Zrušeno zaplacení splátky') + ' — ' + (MILESTONE_LABEL[p.milestone] || p.milestone), detail: (p.percent != null ? Number(p.percent) + ' %' : (p.amount != null ? Number(p.amount).toLocaleString('cs-CZ') : '')), actor: opts.actor || 'uživatel' }); } catch (e) { /* */ }

  let release = null;
  if (paid) {
    // Uvolnění do výroby: zaplacené všechny splátky „před výrobou" (nebo „při objednání", když před výrobou žádná není) — nad objednávkou,
    // u režimu položek stačí, že je zaplacená pro kteroukoli položku (výroba se dnes uvolňuje za celou objednávku).
    const all = await db.orderPayment.findMany({ where: { order_id: p.order_id } });
    const gate = all.filter((x) => x.milestone === 'before_production').length ? 'before_production' : 'at_order';
    const gateRows = all.filter((x) => x.milestone === gate);
    const gatePaid = gateRows.length > 0 && gateRows.some((x) => x.paid);
    if (gatePaid && !p.order.released_at) {
      const data = { deposit_paid: true, deposit_paid_at: new Date() };
      if (['new', 'quoted', 'ordered'].includes(p.order.status)) data.status = 'confirmed';
      await db.order.update({ where: { id: p.order_id }, data });
      await db.slotAssignment.updateMany({ where: { order_id: p.order_id, reservation_status: 'reserved' }, data: { reservation_status: 'confirmed', reservation_confirmed_at: new Date() } }).catch(() => {});
      try { const { releaseOrderToProduction } = require('./release-to-production'); release = await releaseOrderToProduction(p.order_id, { createdById: opts.createdById || null }); } catch (e) { console.error('[payment-plan] release selhal:', e.message); }
    }
    const allPaid = all.length && all.every((x) => x.id === p.id ? true : x.paid);
    if (allPaid) await db.order.update({ where: { id: p.order_id }, data: { final_paid: true, final_paid_at: new Date() } }).catch(() => {});
  }
  return { payment: upd, release };
}

/** Výchozí šablony splátek (pro UI). */
const TEMPLATES = [
  { key: '100_at_order', label: '100 % při objednání', rows: [{ milestone: 'at_order', kind: 'final', percent: 100 }] },
  { key: '50_50', label: '50 % záloha · 50 % po dodání', rows: [{ milestone: 'at_order', kind: 'deposit', percent: 50 }, { milestone: 'after_delivery', kind: 'final', percent: 50 }] },
  { key: '75_25', label: '75 % záloha · 25 % po dodání', rows: [{ milestone: 'at_order', kind: 'deposit', percent: 75 }, { milestone: 'after_delivery', kind: 'final', percent: 25 }] },
  { key: '30_40_30', label: '30 % objednání · 40 % před výrobou · 30 % po dodání', rows: [{ milestone: 'at_order', kind: 'deposit', percent: 30 }, { milestone: 'before_production', kind: 'deposit', percent: 40 }, { milestone: 'after_delivery', kind: 'final', percent: 30 }] },
  { key: '100_after', label: '100 % po dodání', rows: [{ milestone: 'after_delivery', kind: 'final', percent: 100 }] },
];

module.exports = { MILESTONES, MILESTONE_LABEL, TEMPLATES, getPlan, savePlan, issueInvoiceForPayment, setPaid, amountOf, baseOf };
