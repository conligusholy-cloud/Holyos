// =============================================================================
// HolyOS — Spare Parts Shop notifikace
// Při nové objednávce pošle e-mail (Graph send-as) + Velín push odpovědné
// osobě (notification_person_id v EshopSettings).
// =============================================================================

const { prisma } = require('../../config/database');
const { sendMail } = require('../email');
const { notifyPerson } = require('../push/expo-push');

function formatMoney(n, currency) {
  const v = Number(n || 0).toFixed(2);
  return `${v} ${currency || ''}`.trim();
}

function buildOrderEmailBody(order) {
  const lines = [
    `Nová objednávka v eshopu Best Series — Spare Parts Shop`,
    ``,
    `Číslo: ${order.order_number}`,
    `Partner: ${order.partner ? order.partner.display_name : '-'}`,
    `Firma:   ${order.company ? order.company.name : (order.ship_to_company || '-')}`,
    `Doprava: ${order.shipping_method ? order.shipping_method.name : '-'}`,
    `Platba:  ${order.payment_method ? order.payment_method.name : '-'}`,
    ``,
    `Položky:`,
  ];
  for (const it of (order.items || [])) {
    lines.push(`  ${it.material_code} — ${it.material_name}  ×  ${Number(it.quantity)} ${it.unit}  =  ${formatMoney(it.total_excl, order.currency)}`);
  }
  lines.push(``);
  lines.push(`Mezisoučet:  ${formatMoney(order.subtotal_excl, order.currency)}`);
  lines.push(`Doprava:     ${formatMoney(order.shipping_excl, order.currency)}`);
  if (Number(order.payment_fee_excl) > 0) {
    lines.push(`Poplatek za platbu:  ${formatMoney(order.payment_fee_excl, order.currency)}`);
  }
  lines.push(`Celkem bez DPH:  ${formatMoney(order.total_excl, order.currency)}`);
  lines.push(`Celkem s DPH (${Number(order.vat_pct)} %):  ${formatMoney(order.total_incl_vat, order.currency)}`);
  lines.push(``);
  lines.push(`Adresa dodání:`);
  lines.push(`  ${order.ship_to_name}`);
  if (order.ship_to_company) lines.push(`  ${order.ship_to_company}`);
  lines.push(`  ${order.ship_to_address}`);
  lines.push(`  ${order.ship_to_zip} ${order.ship_to_city}, ${order.ship_to_country}`);
  if (order.ship_to_phone) lines.push(`  Tel: ${order.ship_to_phone}`);
  if (order.ship_to_email) lines.push(`  E-mail: ${order.ship_to_email}`);
  if (order.customer_note) {
    lines.push(``);
    lines.push(`Poznámka zákazníka:`);
    lines.push(order.customer_note);
  }
  return lines.join('\n');
}

/**
 * Spustí notifikaci o nové eshopové objednávce. Volá se z routes/shop.routes.js
 * po úspěšném vytvoření objednávky. Nikdy nehází — chyby pouze loguje, aby
 * neblokovala odpověď partnerovi.
 */
async function sendNewOrderNotification(orderId) {
  try {
    const [order, settings] = await Promise.all([
      prisma.shopOrder.findUnique({
        where: { id: orderId },
        include: {
          partner: { select: { id: true, display_name: true, email: true } },
          company: { select: { id: true, name: true } },
          shipping_method: { select: { id: true, name: true } },
          payment_method: { select: { id: true, name: true, code: true } },
          items: { orderBy: { id: 'asc' } },
        },
      }),
      prisma.eshopSettings.findUnique({ where: { id: 1 } }),
    ]);
    if (!order) return { sent: false, skipped: 'order-not-found' };

    const recipientEmail = (settings && settings.notification_email)
      || process.env.ESHOP_NOTIFICATION_EMAIL
      || null;
    const recipientPersonId = settings ? settings.notification_person_id : null;
    const fromAddr = process.env.ESHOP_NOTIFICATION_FROM
      || process.env.GRAPH_DEFAULT_FROM
      || null;

    const subject = `[Spare Parts] Nová objednávka ${order.order_number} — ${formatMoney(order.total_incl_vat, order.currency)}`;
    const body = buildOrderEmailBody(order);

    const results = { email: null, push: null };

    if (recipientEmail) {
      try {
        results.email = await sendMail({
          to: recipientEmail,
          from: fromAddr || undefined,
          subject,
          body,
        });
      } catch (e) {
        console.error('[shop-notify] e-mail selhal:', e.message);
        results.email = { sent: false, error: e.message };
      }
    } else {
      results.email = { sent: false, skipped: 'no-recipient' };
    }

    // Konfirmace partnerovi — preferujeme ship_to_email z objednávky (partner ho
    // mohl zadat jinou než login adresu), fallback na partner.email v účtu.
    const partnerEmail = order.ship_to_email || (order.partner && order.partner.email) || null;
    if (partnerEmail) {
      const partnerSubject = `Potvrzení objednávky ${order.order_number} — Best Series Spare Parts Shop`;
      const partnerBody = [
        `Dobrý den ${order.ship_to_name || ''},`,
        ``,
        `děkujeme za vaši objednávku v Best Series Spare Parts Shop. Tady je její přehled:`,
        ``,
        `Číslo objednávky: ${order.order_number}`,
        `Datum: ${new Date(order.created_at).toLocaleString('cs-CZ')}`,
        `Stav: ${order.status === 'new' ? 'Přijata (čeká na potvrzení)' : order.status}`,
        ``,
        `Položky:`,
        ...order.items.map(it => `  ${it.material_code} — ${it.material_name}  ×  ${Number(it.quantity)} ${it.unit}  =  ${formatMoney(it.total_excl, order.currency)}`),
        ``,
        `Doprava (${order.shipping_method ? order.shipping_method.name : '-'}): ${formatMoney(order.shipping_excl, order.currency)}`,
        Number(order.payment_fee_excl) > 0 ? `Poplatek za platbu: ${formatMoney(order.payment_fee_excl, order.currency)}` : null,
        `Celkem bez DPH: ${formatMoney(order.total_excl, order.currency)}`,
        `Celkem s DPH (${Number(order.vat_pct)} %): ${formatMoney(order.total_incl_vat, order.currency)}`,
        ``,
        `Způsob platby: ${order.payment_method ? order.payment_method.name : '-'}`,
        order.payment_method && order.payment_method.code === 'bank_transfer'
          ? `Zaplaťte prosím na účet uvedený v zaslané proforma faktuře. Zboží odešleme po připsání platby.`
          : null,
        ``,
        `Sledovat objednávku můžete v partner UI po přihlášení:`,
        `${process.env.SHARE_BASE_URL || 'https://bestseries.cash'}/spare-parts`,
        ``,
        `S pozdravem,`,
        `Best Series s.r.o.`,
      ].filter(Boolean).join('\n');
      try {
        results.partner_email = await sendMail({
          to: partnerEmail,
          from: fromAddr || undefined,
          subject: partnerSubject,
          body: partnerBody,
        });
      } catch (e) {
        console.error('[shop-notify] e-mail partnerovi selhal:', e.message);
        results.partner_email = { sent: false, error: e.message };
      }
    } else {
      results.partner_email = { sent: false, skipped: 'no-partner-email' };
    }

    if (recipientPersonId) {
      try {
        const tickets = await notifyPerson(prisma, recipientPersonId, {
          title: `🛒 Nová objednávka ${order.order_number}`,
          body: `${order.partner ? order.partner.display_name : 'Partner'} — ${formatMoney(order.total_incl_vat, order.currency)}`,
          data: {
            kind: 'shop_order_new',
            order_id: order.id,
            order_number: order.order_number,
            url: `/modules/spare-parts/index.html?order=${order.id}`,
          },
          channelId: 'shop-orders',
        });
        results.push = { sent: true, tickets: tickets.length };
      } catch (e) {
        console.error('[shop-notify] push selhal:', e.message);
        results.push = { sent: false, error: e.message };
      }
    } else {
      results.push = { sent: false, skipped: 'no-person' };
    }

    console.log(`[shop-notify] ${order.order_number}:`, JSON.stringify(results));
    return results;
  } catch (err) {
    console.error('[shop-notify] selhalo:', err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = { sendNewOrderNotification };
