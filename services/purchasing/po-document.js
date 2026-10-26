// HolyOS — Nákupní objednávka jako dokument podle šablony ze „Šablony dokumentů" (purchase_order)
// Stejný vzhled jako náhled v modulu Šablony dokumentů — pro tisk, PDF a přílohu e-mailu dodavateli.
'use strict';

const { prisma } = require('../../config/database');
const { purchaseOrderHtml } = require('../pdf/doc-previews');

async function buildPoHtml(orderId) {
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { orderBy: { id: 'asc' } }, company: true, creator: { select: { first_name: true, last_name: true, email: true, phone: true } } },
  });
  if (!o) return null;
  const pd = o.po_data || {};
  const issuedBy = pd.issued_by || (o.creator ? (o.creator.first_name + ' ' + o.creator.last_name).trim() : '');
  const order = {
    ...o,
    issued_by: issuedBy,
    payment_terms: pd.pay_method || (o.company && o.company.payment_terms_days ? 'Splatnost ' + o.company.payment_terms_days + ' dní' : null),
    // Položky: naše požadované termíny; pokud dodavatel potvrdil jiný termín / cenu, dokument je ukáže
    items: (o.items || []).map((it) => ({
      ...it,
      unit_price: it.confirmed_price != null ? it.confirmed_price : it.unit_price,
      spec: [it.spec, it.confirmed_delivery && it.expected_delivery && String(it.confirmed_delivery) !== String(it.expected_delivery) ? 'Potvrzený termín dodavatele: ' + new Date(it.confirmed_delivery).toLocaleDateString('cs-CZ') : null, it.supplier_note ? 'Dodavatel: ' + it.supplier_note : null].filter(Boolean).join(' · ') || null,
    })),
    confirmed_delivery: o.supplier_confirmed_at ? (o.items || []).map((i) => i.confirmed_delivery).filter(Boolean).sort().slice(-1)[0] || null : null,
  };
  return { html: purchaseOrderHtml(order, null, { demo: false }), order: o };
}

async function buildPoPdf(orderId) {
  const r = await buildPoHtml(orderId);
  if (!r) return null;
  const { htmlToPdfBuffer } = require('../pdf/contracts');
  const pdf = await htmlToPdfBuffer(r.html);
  return { pdf, filename: 'Objednavka-' + r.order.order_number + '.pdf', order: r.order };
}

module.exports = { buildPoHtml, buildPoPdf };
