// =============================================================================
// HolyOS — Centralizovaný generátor čísla faktury
// =============================================================================
//
// Sdílená logika pro všechny moduly, které vytvářejí Invoice (accounting,
// orders/final-invoice worker, …). Zachovává konvenci:
//   received            → FP-2026-00001
//   issued              → FV-2026-00001
//   credit_note_received→ DP-2026-00001
//   credit_note_issued  → DV-2026-00001
//   proforma_received   → ZP-2026-00001
//   proforma_issued     → ZV-2026-00001

const { prisma: defaultPrisma } = require('../../config/database');

const PREFIX_MAP = {
  received: 'FP',
  issued: 'FV',
  credit_note_received: 'DP',
  credit_note_issued: 'DV',
  proforma_received: 'ZP',
  proforma_issued: 'ZV',
};

/**
 * @param {string} type Invoice.type
 * @param {object} [opts]
 * @param {object} [opts.prisma] Volitelný klient (např. transakce)
 */
async function generateInvoiceNumber(type, opts = {}) {
  const db = opts.prisma || defaultPrisma;
  const year = new Date().getFullYear();
  const prefix = PREFIX_MAP[type] || 'FP';
  const yearPart = `${prefix}-${year}-`;

  const last = await db.invoice.findFirst({
    where: { invoice_number: { startsWith: yearPart } },
    orderBy: { invoice_number: 'desc' },
    select: { invoice_number: true },
  });

  let nextSeq = 1;
  if (last) {
    const match = last.invoice_number.match(/(\d+)$/);
    if (match) nextSeq = parseInt(match[1], 10) + 1;
  }
  return `${yearPart}${String(nextSeq).padStart(5, '0')}`;
}

module.exports = { generateInvoiceNumber, PREFIX_MAP };
